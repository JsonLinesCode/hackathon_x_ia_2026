import "server-only";
import { createHash } from "node:crypto";
import { BusyWindowSchema, type Meeting } from "@repo/types";
import { googleRequest, GoogleError } from "./google-auth";
import type { Audit } from "./errors";
export type CalendarEvent = {
  id: string; summary?: string; status?: string; updated?: string; location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string }; end?: { dateTime?: string; date?: string; timeZone?: string };
  organizer?: { email?: string }; attendees?: { email?: string }[];
  extendedProperties?: { private?: Record<string, string> };
};
export async function listEvents(owner: string, start: string, end: string, audit: Audit, travelerId?: string) {
  const items: CalendarEvent[] = []; let token: string | undefined;
  do {
    const params = new URLSearchParams({ timeMin: start, timeMax: end, singleEvents: "true", maxResults: "250", ...(token ? { pageToken: token } : {}) });
    const data = await googleRequest<{ items?: CalendarEvent[]; nextPageToken?: string }>(owner,
      "/calendar/v3/calendars/primary/events?" + params, audit, { label: "read calendar", travelerId });
    items.push(...(data.items ?? [])); token = data.nextPageToken;
    if (items.length > 1000) throw new GoogleError(422, "Too many calendar events in this window; narrow the travel dates.");
  } while (token);
  return items;
}
export function matchMeeting(meeting: Meeting, events: CalendarEvent[]) {
  const matches = events.filter((e) => e.status !== "cancelled" && e.start?.dateTime && e.end?.dateTime
    && Date.parse(e.start.dateTime) === Date.parse(meeting.start) && Date.parse(e.end.dateTime) === Date.parse(meeting.end)
    && (e.summary?.toLowerCase().trim() === meeting.title.toLowerCase().trim()
      || (!!meeting.location && e.location?.toLowerCase().includes(meeting.location.toLowerCase()))));
  return matches.length === 1 ? matches[0] : null;
}
export async function freeBusy(owner: string, email: string, start: string, end: string, audit: Audit, travelerId?: string) {
  const id = travelerId ? "primary" : email;
  const result = await googleRequest<{ calendars?: Record<string, { errors?: unknown[]; busy?: unknown[] }> }>(owner,
    "/calendar/v3/freeBusy", audit, { method: "POST", label: "check availability", travelerId, body: { timeMin: start, timeMax: end, items: [{ id }] } });
  const calendar = result.calendars?.[id];
  if (!calendar || calendar.errors?.length) return null;
  return BusyWindowSchema.array().parse(calendar.busy ?? []);
}
export async function getEvent(owner: string, id: string, audit: Audit) {
  try { return await googleRequest<CalendarEvent>(owner, "/calendar/v3/calendars/primary/events/" + encodeURIComponent(id), audit, { label: "read meeting" }); }
  catch (error) { if (error instanceof GoogleError && [404, 410].includes(error.googleStatus)) return null; throw error; }
}
export const calendarEventId = (actionId: string) => "tm" + createHash("sha256").update(actionId).digest("hex");
export async function insertEvent(owner: string, actionId: string, tripId: string, event: Record<string, unknown>, audit: Audit) {
  const id = calendarEventId(actionId);
  const existing = await getEvent(owner, id, audit);
  if (existing) {
    if (existing.extendedProperties?.private?.action_id !== actionId || existing.status === "cancelled") throw new GoogleError(409, "The saved calendar event requires review.");
    return existing;
  }
  try {
    return await googleRequest<CalendarEvent>(owner, "/calendar/v3/calendars/primary/events?sendUpdates=all", audit, {
      label: "invite travelers", method: "POST", body: { ...event, id, extendedProperties: { private: { action_id: actionId, trip_id: tripId } } },
    });
  } catch (error) {
    if (error instanceof GoogleError && error.googleStatus === 409) {
      const found = await getEvent(owner, id, audit);
      if (found?.extendedProperties?.private?.action_id === actionId) return found;
    }
    throw error;
  }
}
