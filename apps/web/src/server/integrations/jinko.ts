import "server-only";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { type Journey, type Meeting, type BookingDetails } from "@repo/types";
import { getEnv } from "../env";
import { IntegrationError, type Audit } from "./errors";
import { CartSchema, CheckoutSchema, parseFlights, parseHotels, toolData } from "./jinko-contract";

// Names/arguments are mapped from the captured live listTools output.
// Payment, cancellation and modification tools are deliberately not callable here.
const TOOLS = { flights: "flight_search", hotels: "hotel_search", details: "hotel_details", cart: "trip", quote: "checkout", inspect: "get_trip" } as const;
let loggedCatalog = false;
const windowArgs = (window: Journey["departure_window"]) => window
  ? Object.fromEntries(Object.entries(window).filter(([, value]) => value !== null)) : undefined;

export class Jinko {
  private tools = new Map<string, Tool>();
  private validator = new AjvJsonSchemaValidator();
  private client = new Client({ name: "travel-manager", version: "0.2.0" });
  constructor(private audit: Audit) {}
  async connect() {
    const env = getEnv(["JINKO_MCP_URL", "JINKO_API_KEY", "JINKO_API_KEY_HEADER"]);
    const header = env.JINKO_API_KEY_HEADER;
    await this.audit("Jinko: connect and discover tools");
    try {
      await this.client.connect(new StreamableHTTPClientTransport(new URL(env.JINKO_MCP_URL), {
        requestInit: { headers: { [header]: header.toLowerCase() === "authorization" ? "Bearer " + env.JINKO_API_KEY : env.JINKO_API_KEY } },
      }), { timeout: 30000 });
      let cursor: string | undefined;
      do {
        const page = await this.client.listTools(cursor ? { cursor } : undefined, { timeout: 30000 });
        page.tools.forEach((tool) => this.tools.set(tool.name, tool));
        cursor = page.nextCursor;
      } while (cursor);
      if (!loggedCatalog) {
        console.info("Jinko listTools()", JSON.stringify([...this.tools.values()].map(({ name, inputSchema }) => ({ name, inputSchema }))));
        loggedCatalog = true;
      }
      for (const name of Object.values(TOOLS)) if (!this.tools.has(name)) throw new IntegrationError("Jinko", "MISSING_TOOL", "Jinko does not expose required tool " + name + ".");
      await this.audit("Jinko tools discovered", "Input schemas loaded.", { tools: [...this.tools.keys()] });
    } catch (error) {
      const safe = error instanceof IntegrationError ? error : new IntegrationError("Jinko", "CONNECTION_FAILED", "Could not connect to Jinko. Check JINKO_MCP_URL, JINKO_API_KEY and JINKO_API_KEY_HEADER.");
      await this.audit("Jinko connection failed", safe.message);
      throw safe;
    }
  }
  async close() { await this.client.close().catch(() => undefined); }
  private async call(name: string, args: Record<string, unknown>) {
    const tool = this.tools.get(name);
    if (!tool || !Object.values(TOOLS).some((allowed) => allowed === name)) throw new IntegrationError("Jinko", "TOOL_NOT_ALLOWED", "Unsupported Jinko operation.");
    const valid = this.validator.getValidator(tool.inputSchema as JsonSchemaType)(args);
    if (!valid.valid) throw new IntegrationError("Jinko", "SCHEMA_CHANGED", "Jinko arguments no longer match listTools() for " + name + ". Check the current tool schema.");
    await this.audit("Jinko: " + name, "Provider request started.");
    try {
      // No retry of provider mutations: their inputs expose no idempotency key.
      const result = await this.client.callTool({ name, arguments: args }, undefined, { timeout: name === TOOLS.quote ? 180000 : 90000 });
      toolData(result);
      await this.audit("Jinko: " + name + " completed", "Structured provider response received.");
      return result;
    } catch (error) {
      const safe = error instanceof IntegrationError ? error : new IntegrationError("Jinko", "REQUEST_FAILED", "Jinko did not return a valid response. Check the timeline before retrying.");
      await this.audit("Jinko call failed", safe.message, { tool: name, code: safe.code });
      throw safe;
    }
  }
  async searchFlights(homeAirport: string, journey: Journey, meeting: Meeting, language: "fr" | "en") {
    const search = {
      origin: homeAirport, origin_type: "airport", destination: journey.destination_iata, departure_date: journey.departure_date,
      ...(journey.one_way ? { trip_type: "oneway" } : { trip_type: "roundtrip", return_date: journey.return_date }),
      ...(journey.cabin ? { cabin_class: journey.cabin } : {}),
      ...(journey.max_stops !== null ? { max_stops: journey.max_stops } : {}),
      ...(journey.refundable_only ? { refundable_only: true } : {}),
      ...(journey.checked_bag_included ? { checked_bag_included: true } : {}),
      ...(journey.departure_window ? { departure_time_range: windowArgs(journey.departure_window) } : {}),
      ...(journey.arrival_window ? { arrival_time_range: windowArgs(journey.arrival_window) } : {}),
      limit: 30,
    };
    const raw = await this.call(TOOLS.flights, { search, passengers: { adults: 1 }, currency: "EUR", locale: language === "fr" ? "fr-FR" : "en-GB" });
    return { ...parseFlights(raw, journey, meeting, homeAirport), raw };
  }
  async searchHotels(journey: Journey, timezone: string) {
    const raw = await this.call(TOOLS.hotels, {
      destination: { query: journey.hotel_query }, checkin: journey.hotel_checkin, checkout: journey.hotel_checkout,
      occupancies: [{ adults: 1 }], currency: "EUR", filters: { max_results: 12 },
    });
    return { ...parseHotels(raw, journey, timezone), raw };
  }
  async getHotelDetails(hotelId: string) {
    const raw = await this.call(TOOLS.details, { hotel_id: hotelId });
    const data = toolData(raw);
    // The property metadata remains descriptive; rates always come from hotel_search.
    return { data: z.record(z.unknown()).parse(data), raw };
  }
  async addItem(token: string, tripId?: string) {
    const raw = await this.call(TOOLS.cart, { ...(tripId ? { trip_id: tripId } : {}), add_item: { trip_item_token: token } });
    return { ...CartSchema.parse(toolData(raw)), raw };
  }
  async setTraveler(tripId: string, details: BookingDetails, email: string, hasFlight: boolean) {
    const raw = await this.call(TOOLS.cart, { trip_id: tripId, upsert_travelers: {
      travelers: [{ first_name: details.first_name, last_name: details.last_name, passenger_type: details.passenger_type,
        ...(hasFlight ? { date_of_birth: details.date_of_birth, gender: details.gender } : {}) }],
      contact: { email, phone: details.phone },
    } });
    return { ...CartSchema.parse(toolData(raw)), raw };
  }
  async quote(tripId: string) {
    const raw = await this.call(TOOLS.quote, { trip_id: tripId });
    const quote = CheckoutSchema.parse(toolData(raw));
    if (quote.status === "failed" || quote.status === "pending") throw new IntegrationError("Jinko", "QUOTE_NOT_READY", "The provider quote needs reconciliation before another checkout attempt.");
    return { data: quote, raw };
  }
  async getTrip(tripId: string) { const raw = await this.call(TOOLS.inspect, { trip_id: tripId }); return { data: toolData(raw), raw }; }
}
export async function withJinko<T>(audit: Audit, run: (jinko: Jinko) => Promise<T>) {
  const jinko = new Jinko(audit);
  try { await jinko.connect(); return await run(jinko); }
  finally { await jinko.close(); }
}
