import "server-only";
import { OutreachSchema } from "@repo/types";
import { verifyLink } from "@repo/core";
import { createServiceClient } from "./db";
import { getEnv } from "./env";
import { HttpError } from "./http";
import { planningDatabase, loadTrip } from "./agent/store";
import { publicItem } from "./agent/flows/confirmations";
export async function verifyOutreach(token: string, purpose: "calendar_access" | "trip_confirmation") {
  let id: string;
  try { id = (await verifyLink(token, purpose, getEnv(["APP_SECRET"]).APP_SECRET)).id; }
  catch { throw new HttpError(410, "This link is invalid or expired. Ask your travel manager for a new link."); }
  const result = await createServiceClient().from("outreach").select("*").eq("id", id).eq("purpose", purpose).maybeSingle();
  planningDatabase(result.error);
  if (!result.data) throw new HttpError(410, "This link is no longer available.");
  const outreach = OutreachSchema.parse(result.data);
  if (["expired", "failed"].includes(outreach.status) || Date.parse(String(outreach.metadata.expires_at)) <= Date.now()) throw new HttpError(410, "This link has expired.");
  const state = await loadTrip(outreach.owner_id, outreach.trip_id);
  const person = state.travelers.find((t) => t.traveler_id === outreach.traveler_id)!;
  const option = state.options.find((o) => o.selected);
  if (purpose === "trip_confirmation" && (option?.id !== outreach.metadata.option_id || !["awaiting_travelers", "ready_to_book", "booking", "booked"].includes(state.trip.status))) {
    throw new HttpError(410, "The itinerary has changed. Please use the newest confirmation email.");
  }
  return { outreach, state, person, option };
}
export async function travelerView(token: string) {
  const { outreach, state, person, option } = await verifyOutreach(token, "trip_confirmation");
  return { title: state.trip.title, name: person.traveler.full_name, language: state.trip.extracted?.language ?? "en",
    meeting: state.trip.meeting, itinerary: publicItem(option!.per_traveler.find((p) => p.traveler_id === person.traveler_id)!),
    confirmation_status: person.confirmation_status, response_text: person.response_text,
    editable: state.trip.status === "awaiting_travelers", availability: person.availability, expires_at: outreach.metadata.expires_at };
}
