import "server-only";
import { randomUUID } from "node:crypto";
import { OutreachSchema } from "@repo/types";
import { createServiceClient } from "../db";
import { HttpError } from "../http";
import { planningDatabase, withTrip } from "./store";
import { getMessage, listMessages, mailHeader, mailText, senderAddress, type GmailMessage } from "../integrations/gmail";
import { classifyReply } from "../integrations/openai";
import { applyClassifiedReply } from "./flows/confirmations";
import { processDisruptionInbound, scanMeetings, refreshProviderReferences } from "./inbound";

export async function queueInbound(owner: string, kind: string, key: string, payload: Record<string, unknown>) {
  const db = createServiceClient();
  const result = await db.from("inbound_events").upsert({ owner_id: owner, kind, dedupe_key: owner + ":" + key, payload }, { onConflict: "dedupe_key", ignoreDuplicates: true });
  planningDatabase(result.error);
}
export async function processReply(owner: string, row: { id: string; payload: Record<string, unknown> }) {
  const message = row.payload.message as GmailMessage;
  const db = createServiceClient();
  const result = await db.from("outreach").select("*").eq("owner_id", owner).eq("gmail_thread_id", message.threadId).eq("purpose", "trip_confirmation").neq("status", "expired");
  planningDatabase(result.error);
  const outreachs = OutreachSchema.array().parse(result.data);
  for (const outreach of outreachs) {
    const done = await withTrip(owner, outreach.trip_id, async (store) => {
      const current = store.state.outreach.find((o) => o.id === outreach.id)!;
      const person = store.state.travelers.find((t) => t.traveler_id === current.traveler_id)!;
      if (senderAddress(message) !== person.traveler.email || (message.labelIds ?? []).includes("SENT") ||
        Number(message.internalDate ?? 0) < Math.max(Date.parse(current.sent_at), Number(current.metadata.last_reply_at ?? 0)) || current.metadata.option_id !== store.state.options.find((o) => o.selected)?.id
        || store.state.trip.status !== "awaiting_travelers") return false;
      const body = mailText(message);
      const classified = await classifyReply(mailHeader(message, "subject"), body, store.audit);
      await applyClassifiedReply(store, current, classified, body, row.id, Number(message.internalDate));
      return true;
    });
    if (done) return true;
  }
  return false;
}
export async function syncOwner(owner: string) {
  const db = createServiceClient(), token = randomUUID();
  const claim = await db.rpc("phase3_sync_claim", { p_owner: owner, p_token: token });
  planningDatabase(claim.error);
  if (!claim.data) return { running: true, processed: 0 };
  let processed = 0;
  const deadline = Date.now() + 150000;
  try {
    const stateResult = await db.from("google_sync_state").select("*").eq("owner_id", owner).single(); planningDatabase(stateResult.error);
    const sync = stateResult.data!;
    const trips = await db.from("trips").select("id").eq("owner_id", owner).not("status", "in", "(cancelled,completed,reported)").order("updated_at", { ascending: false }).limit(100);
    planningDatabase(trips.error);
    const auditTrip = trips.data?.[0]?.id;
    if (!auditTrip) return { running: false, processed };
    const audit = async (title: string, detail = "", data: Record<string, unknown> = {}) => {
      planningDatabase((await db.from("timeline_events").insert({ owner_id: owner, trip_id: auditTrip, actor: "provider", source: "google", title, detail, data })).error);
    };
    const scanStart = sync.scan_started_at ?? new Date().toISOString();
    const since = Math.max(Date.now() - 2 * 86400000, sync.last_sync ? Date.parse(sync.last_sync) - 120000 : 0);
    const listed = await listMessages(owner, "newer_than:2d -in:sent after:" + Math.floor(since / 1000), audit, sync.cursor ?? undefined);
    let loadedAll = true;
    for (const item of listed.messages ?? []) {
      if (Date.now() > deadline) { loadedAll = false; break; }
      const known = await db.from("inbound_events").select("id").eq("owner_id", owner).eq("dedupe_key", owner + ":gmail:" + item.id).maybeSingle(); planningDatabase(known.error);
      if (known.data) continue;
      const message = await getMessage(owner, item.id, audit);
      await queueInbound(owner, "gmail_message", "gmail:" + item.id, { message });
    }
    if (loadedAll) planningDatabase((await db.from("google_sync_state").update({ cursor: listed.nextPageToken ?? null,
      scan_started_at: listed.nextPageToken ? scanStart : null, ...(!listed.nextPageToken ? { last_sync: scanStart } : {}) }).eq("owner_id", owner).eq("token", token)).error);
    if (Date.now() < deadline - 90000) await refreshProviderReferences(owner, (trips.data ?? []).map((t) => t.id), deadline);
    await scanMeetings(owner, (trips.data ?? []).map((t) => t.id), deadline);
    const pending = await db.from("inbound_events").select("*").eq("owner_id", owner).in("kind", ["gmail_message", "travel_disruption", "simulated_email"]).is("processed_at", null).limit(20);
    planningDatabase(pending.error);
    for (const row of (pending.data ?? []).sort((a, b) => Number(a.payload.message?.internalDate ?? 0) - Number(b.payload.message?.internalDate ?? 0))) {
      if (Date.now() > deadline) break;
      try {
        const replied = row.kind === "gmail_message" && await processReply(owner, row);
        if (!replied) await processDisruptionInbound(owner, row);
        planningDatabase((await db.from("inbound_events").update({ processed_at: new Date().toISOString() }).eq("owner_id", owner).eq("id", row.id)).error);
        processed++;
      } catch (error) {
        if (error instanceof HttpError && error.status === 409) continue;
        throw error;
      }
    }
    return { running: false, processed, more: !!listed.nextPageToken };
  } finally {
    planningDatabase((await db.from("google_sync_state").update({ token: null, expires_at: null }).eq("owner_id", owner).eq("token", token)).error);
  }
}
