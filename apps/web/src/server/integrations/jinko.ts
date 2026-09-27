import "server-only";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { type Journey, type Meeting, type BookingDetails, type Booking, type CancellationPreview, ProviderMoneySchema } from "@repo/types";
import { getEnv } from "../env";
import { IntegrationError, type Audit } from "./errors";
import { CartSchema, CheckoutSchema, parseFlights, parseHotels, toolData } from "./jinko-contract";

// Names/arguments are mapped from the captured live listTools output.
// Payment and one-shot refund tools are never exposed.
const TOOLS = { flights: "flight_search", hotels: "hotel_search", details: "hotel_details", cart: "trip", quote: "checkout", inspect: "get_trip" } as const;
const OPTIONAL_TOOLS = { booking: "get_booking", flightCancel: "flight_refund", hotelCancel: "hotel_cancel" } as const;
export const CancellationQuoteSchema = z.object({
  quote: z.string().regex(/^svq_/), refund: ProviderMoneySchema, penalty: ProviderMoneySchema,
  fee_known: z.boolean().optional(), support_level: z.string().optional(), expires_at: z.string().datetime({ offset: true }).optional(),
}).passthrough();
export const CancellationOperationSchema = z.object({
  operation: z.string().regex(/^svc_/), status: z.string(),
}).passthrough();
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
    if (!tool || ![...Object.values(TOOLS), ...Object.values(OPTIONAL_TOOLS)].some((allowed) => allowed === name)) throw new IntegrationError("Jinko", "TOOL_NOT_ALLOWED", "Unsupported Jinko operation.");
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
  async searchFlights(homeAirport: string, journey: Journey, meeting: Meeting, language: "fr" | "en", allowLate = false) {
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
    return { ...parseFlights(raw, journey, meeting, homeAirport, allowLate), raw };
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

  async previewCancellation(booking: Booking): Promise<{ preview: CancellationPreview; raw: Record<string, unknown> }> {
    const manual = (instruction: string, raw: Record<string, unknown> = {}, bookingRef: string | null = null) => ({
      preview: { booking_id: booking.id, kind: booking.kind, mode: "manual" as const, booking_ref: bookingRef ?? booking.provider_ref,
        item_id: null, quote: null, refund: null, fee_eur: null, expires_at: null,
        instruction: "Manual cancellation required. " + instruction + " Reference: " + (bookingRef ?? booking.provider_ref ?? "not available") + ". Contact the provider or Jinko support; do not assume this quote is unpaid." }, raw,
    });
    const tool = booking.kind === "flight" ? OPTIONAL_TOOLS.flightCancel : OPTIONAL_TOOLS.hotelCancel;
    if (!this.tools.has(tool) || !this.tools.has(OPTIONAL_TOOLS.booking)) return manual("This environment has no compatible cancellation tool.");
    if (!booking.provider_ref) return manual("No provider cart reference was saved.");
    const inspected = await this.getTrip(booking.provider_ref);
    const trip = z.object({ trip: z.object({ booking_ref: z.string().regex(/^JNK-[A-Z0-9]{6}$/).nullable().optional() }).passthrough() }).safeParse(inspected.data);
    const ref = trip.success ? trip.data.trip.booking_ref : null;
    if (!ref) return manual("No servicing booking reference was returned.", { trip: inspected.raw });
    const rawBooking = await this.call(OPTIONAL_TOOLS.booking, { booking_ref: ref });
    const data = z.object({ items: z.array(z.object({ item_id: z.number().int().positive(), kind: z.string().optional(), type: z.string().optional(),
      can_refund: z.boolean().optional(), refund_support_level: z.string().optional() }).passthrough()) }).safeParse(toolData(rawBooking));
    if (!data.success) return manual("Booked items could not be verified.", { trip: inspected.raw, booking: rawBooking }, ref);
    const items = data.data.items.filter((i) => (i.kind ?? i.type)?.toLowerCase() === booking.kind);
    if (items.length !== 1 || items[0].can_refund === false) return manual("The intended booked item or its refund eligibility needs review.", { booking: rawBooking }, ref);
    const item = items[0];
    const raw = await this.call(tool, { action: "preview", booking_ref: ref, item_id: item.item_id });
    const parsed = CancellationQuoteSchema.safeParse(toolData(raw));
    if (!parsed.success || parsed.data.fee_known === false || parsed.data.support_level === "MANUAL_REQUIRED") return manual("The provider did not return a complete executable cancellation quote.", { preview: raw }, ref);
    const p = parsed.data;
    return { preview: { booking_id: booking.id, kind: booking.kind, mode: "provider", booking_ref: ref, item_id: item.item_id,
      quote: p.quote, refund: p.refund, fee_eur: p.penalty.value / 10 ** p.penalty.decimal_places, expires_at: p.expires_at ?? null,
      instruction: "Provider cancellation preview. The acknowledged customer refund is bound to this quote." },
      raw: { trip: inspected.raw, booking: rawBooking, preview: raw } };
  }
  async cancel(preview: CancellationPreview, operation?: string) {
    if (preview.mode !== "provider" || !preview.booking_ref || !preview.item_id || !preview.quote || !preview.refund || preview.fee_eur === null) {
      throw new IntegrationError("Jinko", "MANUAL_REQUIRED", preview.instruction);
    }
    const tool = preview.kind === "flight" ? OPTIONAL_TOOLS.flightCancel : OPTIONAL_TOOLS.hotelCancel;
    const raw = await this.call(tool, { action: operation ? "status" : "commit", booking_ref: preview.booking_ref, item_id: preview.item_id,
      ...(operation ? { operation } : { quote: preview.quote, acknowledged: preview.refund }) });
    const data = CancellationOperationSchema.parse(toolData(raw));
    return { data, raw };
  }

  async getTrip(tripId: string) { const raw = await this.call(TOOLS.inspect, { trip_id: tripId }); return { data: toolData(raw), raw }; }
}
export async function withJinko<T>(audit: Audit, run: (jinko: Jinko) => Promise<T>) {
  const jinko = new Jinko(audit);
  try { await jinko.connect(); return await run(jinko); }
  finally { await jinko.close(); }
}
