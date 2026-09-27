import "server-only";
import { DisruptionEventSchema, type DisruptionEvent, type NoticeClassificationSchema } from "@repo/types";
import { z } from "zod";
import { withJinko } from "../integrations/jinko";
import { createServiceClient } from "../db";
import { classifyNotice } from "../integrations/openai";
import { mailText, mailHeader, type GmailMessage } from "../integrations/gmail";
import { getEvent } from "../integrations/calendar";
import { planningDatabase, loadTrip, withTrip } from "./store";
import { receiveDisruption } from "./flows/disruptions";
import { HttpError } from "../http";

export async function classifyInbound(owner: string, id: string, subject: string, body: string, explicitTrip?: string) {
  const db = createServiceClient();
  const trips = explicitTrip ? [{ id: explicitTrip }] : (await db.from("trips").select("id").eq("owner_id", owner).not("status", "in", "(cancelled,completed,reported)")).data ?? [];
  if (!trips.length) return false;
  const state = await loadTrip(owner, trips[0].id);
  const audit = async (title: string, detail = "", data: Record<string, unknown> = {}) => {
    planningDatabase((await db.from("timeline_events").insert({ owner_id: owner, trip_id: state.trip.id, actor: "provider", source: "openai", title, detail, data })).error);
  };
  const notice: z.infer<typeof NoticeClassificationSchema> = await classifyNotice(subject, body, audit);
  if (notice.kind === "unrelated") return false;
  const candidates: DisruptionEvent[] = [];
  for (const trip of trips) {
    const current = trip.id === state.trip.id ? state : await loadTrip(owner, trip.id);
    const bookings = current.bookings.filter((b) => notice.booking_ref && [b.provider_ref, b.details.booking_ref, b.details.booking_reference, ...(Array.isArray(b.details.provider_references) ? b.details.provider_references : [])].includes(notice.booking_ref));
    if (notice.kind.startsWith("flight_") && bookings.filter((b) => b.kind === "flight").length === 1) {
      candidates.push(DisruptionEventSchema.parse({ ...notice, trip_id: trip.id, booking_id: bookings.find((b) => b.kind === "flight")!.id }));
    } else if (notice.kind.startsWith("meeting_") && (explicitTrip || (notice.meeting_event_id && current.trip.meeting?.google_event_id === notice.meeting_event_id))) {
      candidates.push(DisruptionEventSchema.parse({ ...notice, trip_id: trip.id }));
    }
  }
  if (notice.confidence < 0.8 || candidates.length !== 1) {
    await audit("Notice needs review", "No automatic recovery: confidence or booking/meeting match was insufficient.", { inbound_id: id, classification: notice.kind });
    return false;
  }
  await withTrip(owner, candidates[0].trip_id, (store) => receiveDisruption(store, candidates[0], id));
  return true;
}
export async function processDisruptionInbound(owner: string, row: { id: string; kind: string; payload: Record<string, unknown> }) {
  if (row.kind === "travel_disruption") {
    const event = DisruptionEventSchema.parse(row.payload);
    await withTrip(owner, event.trip_id, (store) => receiveDisruption(store, event, row.id));
    return true;
  }
  if (row.kind === "simulated_email") {
    return classifyInbound(owner, row.id, String(row.payload.subject), String(row.payload.body), String(row.payload.trip_id));
  }
  if (row.kind === "gmail_message") {
    const message = row.payload.message as GmailMessage;
    const subject = mailHeader(message, "subject"), body = mailText(message);
    if (!/cancel|annul|delay|retard|reschedul|report[eé]|modifi|change|moved|déplac/i.test(subject + " " + body)) return false;
    return classifyInbound(owner, row.id, subject, body);
  }
  return false;
}
export async function scanMeetings(owner: string, tripIds: string[], deadline: number) {
  const db = createServiceClient();
  for (const id of tripIds) {
    if (Date.now() > deadline) break;
    const state = await loadTrip(owner, id), meeting = state.trip.meeting;
    if (!meeting?.google_event_id) continue;
    const audit = async (title: string, detail = "") => { planningDatabase((await db.from("timeline_events").insert({ owner_id: owner, trip_id: id, actor: "provider", source: "google", title, detail })).error); };
    const live = await getEvent(owner, meeting.google_event_id, audit);
    let event: DisruptionEvent | null = null;
    if (!live || live.status === "cancelled") event = DisruptionEventSchema.parse({ kind: "meeting_cancelled", trip_id: id, detail: "The linked Google Calendar meeting was cancelled." });
    else if (live.start?.dateTime && live.end?.dateTime && (Date.parse(live.start.dateTime) !== Date.parse(meeting.start) || Date.parse(live.end.dateTime) !== Date.parse(meeting.end))) {
      event = DisruptionEventSchema.parse({ kind: "meeting_moved", trip_id: id, detail: "The linked Google Calendar meeting changed time.", new_start: live.start.dateTime, new_end: live.end.dateTime });
    }
    if (!event) continue;
    const key = owner + ":calendar:" + id + ":" + meeting.google_event_id + ":" + (live?.updated ?? "deleted");
    planningDatabase((await db.from("inbound_events").upsert({ owner_id: owner, kind: "travel_disruption", dedupe_key: key, payload: event }, { onConflict: "dedupe_key", ignoreDuplicates: true })).error);
  }
}
export function deferred(error: unknown) { return error instanceof HttpError && error.status === 409; }

export async function refreshProviderReferences(owner: string, tripIds: string[], deadline: number) {
  for (const id of tripIds) {
    if (Date.now() > deadline) return;
    const state = await loadTrip(owner, id);
    const booking = state.bookings.find((b) => ["quoted", "booked"].includes(b.status) && b.provider_ref &&
      (!b.details.provider_checked_at || Date.parse(String(b.details.provider_checked_at)) < Date.now() - 5 * 60000));
    if (!booking) continue;
    await withTrip(owner, id, async (store) => {
      let refs: string[] = [], raw: unknown = null;
      try {
        const inspected = await withJinko(store.audit, (jinko) => jinko.getTrip(booking.provider_ref!));
        raw = inspected.raw;
        const trip = z.object({ trip: z.object({ booking_ref: z.string().nullable().optional(),
          bookings: z.array(z.object({ booking_reference: z.string().nullable().optional() }).passthrough()).optional(),
        }).passthrough() }).safeParse(inspected.data);
        if (trip.success) refs = [trip.data.trip.booking_ref, ...(trip.data.trip.bookings ?? []).map((b) => b.booking_reference)].filter((v): v is string => !!v);
      } catch { await store.event("Provider lifecycle unavailable", "Carrier references will be checked again later."); }
      await store.save({ bookings: store.state.bookings.filter((b) => b.provider_ref === booking.provider_ref).map((b) => ({ ...b,
        details: { ...b.details, provider_checked_at: new Date().toISOString(), provider_references: refs.length ? refs : b.details.provider_references ?? [] },
        raw: raw ? { ...b.raw, lifecycle: raw } : b.raw })) });
    });
    return; // One cart per sync; keep Gmail/Calendar work bounded.
  }
}
