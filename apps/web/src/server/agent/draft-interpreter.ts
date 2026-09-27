import "server-only";
import { DraftIntentSchema, type TravelerRecord, type TripCard, type TripMessage } from "@repo/types";
import { TRIP_CITIES } from "@repo/core";
import { structured } from "../integrations/openai";
import type { Audit } from "../integrations/errors";
import { INTERPRET_TRIP_DRAFT } from "./prompts";
export function interpretTripMessage(message: string, card: TripCard, directory: TravelerRecord[], history: TripMessage[], audit: Audit, now = new Date()) {
  return structured(DraftIntentSchema, "trip_draft_intent", INTERPRET_TRIP_DRAFT, {
    message, card, current_time: now.toISOString(),
    history: history.slice(-16).map(({ role, content }) => ({ role, content })),
    directory: directory.map(({ id, full_name, email, home_city, home_airport }) => ({ id, full_name, email, home_city, home_airport })),
    supported_destinations: TRIP_CITIES.map((c) => c.name),
  }, audit);
}
