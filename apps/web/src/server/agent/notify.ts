import "server-only";
import { randomUUID } from "node:crypto";
import { ActionSchema, type Action, type Outreach } from "@repo/types";
import { assertActionExecutable, classifyAction } from "@repo/core";
import { getEnv } from "../env";
import { HttpError } from "../http";
import { draftEmail } from "../integrations/openai";
import { MailSchema, sendMail, findSent } from "../integrations/gmail";
import { insertEvent, removeEvent, updateEvent } from "../integrations/calendar";
import { planningDatabase, type TripStore } from "./store";

export function proposal(store: TripStore, input: Pick<Action, "kind" | "summary" | "payload" | "idempotency_key"> & Partial<Pick<Action, "cost_eur" | "reversible" | "rationale">>) {
  const value = { cost_eur: 0, reversible: true, rationale: "", ...input };
  return ActionSchema.parse({ ...value, id: randomUUID(), owner_id: store.owner, trip_id: store.id,
    gate: classifyAction(value), status: "proposed", decided_at: null, result: null });
}
export async function notify(store: TripStore, recipient: { email: string; name: string }, input: {
  key: string; purpose: string; facts: unknown; kind?: Action["kind"];
  links?: { label: string; url: string }[]; outreach?: Outreach; reminder?: Outreach;
}) {
  if (store.state.actions.some((a) => a.idempotency_key === input.key)) return;
  const draft = await draftEmail(input.purpose, recipient.name, store.state.trip.extracted?.language ?? "en", input.facts, store.audit);
  const action = proposal(store, { kind: input.kind ?? "send_information", summary: input.purpose + " · " + recipient.name,
    payload: {}, idempotency_key: input.key });
  const messageId = "<" + action.id + "@" + new URL(getEnv(["APP_URL"]).APP_URL).hostname + ">";
  const subject = input.reminder ? String(input.reminder.metadata.subject) : draft.subject;
  const mail = MailSchema.parse({ to: recipient.email, subject, body: draft.body, links: input.links ?? [], messageId,
    ...(input.reminder ? { threadId: input.reminder.gmail_thread_id, inReplyTo: input.reminder.metadata.message_id } : {}) });
  action.payload = { operation: "email", mail, outreach_id: input.outreach?.id ?? null, reminder_id: input.reminder?.id ?? null };
  const outreach = input.outreach ? { ...input.outreach, metadata: { ...input.outreach.metadata, subject, message_id: messageId } } : undefined;
  await store.save({ actions: [action], outreach: outreach ? [outreach] : undefined,
    events: [{ title: "Email prepared", detail: action.summary, data: { action_id: action.id } }] });
}
export async function executeCommunication(store: TripStore) {
  const action = store.state.actions.find((a) => a.gate === "auto" && ["proposed", "executing"].includes(a.status)
    && ["email", "calendar_insert", "calendar_delete", "calendar_patch"].includes(String(a.payload.operation)));
  if (!action) return false;
  if (action.status === "proposed") assertActionExecutable(action);
  let active = action;
  const complete = async (result: Record<string, unknown>, outreach?: Outreach[]) => {
    await store.save({ actions: [{ ...active, status: "executed", result }], outreach,
      events: [{ source: "google", title: "Action completed", detail: action.summary, data: { action_id: action.id } }] });
  };
  if (action.payload.operation === "calendar_patch") {
    if (action.status === "proposed") { active = { ...action, status: "executing" }; await store.save({ actions: [active] }); }
    await updateEvent(store.owner, String(action.payload.event_id), store.id, action.payload.patch as Record<string, unknown>, store.audit);
    await complete({ google_event_id: action.payload.event_id, updated: true }); return true;
  }
  if (action.payload.operation === "calendar_delete") {
    if (action.status === "proposed") { active = { ...action, status: "executing" }; await store.save({ actions: [active] }); }
    await removeEvent(store.owner, String(action.payload.event_id), store.audit);
    await complete({ google_event_id: action.payload.event_id, deleted: true }); return true;
  }
  if (action.payload.operation === "calendar_insert") {
    if (action.status === "proposed") {
      active = { ...action, status: "executing", result: { started_at: new Date().toISOString() } };
      await store.save({ actions: [active] });
    }
    const event = await insertEvent(store.owner, action.id, store.id, action.payload.event as Record<string, unknown>, store.audit);
    await complete({ google_event_id: event.id });
    return true;
  }
  const mail = MailSchema.parse(action.payload.mail);
  let sent: { id: string; threadId: string } | null = null;
  if (action.status === "executing") {
    sent = await findSent(store.owner, mail.messageId, store.audit);
    if (!sent) {
      const error = "Email delivery is uncertain. Check Sent in Gmail before preparing another message; this action will not be sent twice.";
      await store.save({ actions: [{ ...action, status: "failed", result: { error } }],
        events: [{ title: "Email needs review", detail: error }] });
      throw new HttpError(409, error);
    }
  } else {
    const profile = await store.db.from("profiles").select("email").eq("id", store.owner).single();
    planningDatabase(profile.error);
    active = { ...action, status: "executing", result: { started_at: new Date().toISOString() } };
    await store.save({ actions: [active], events: [{ title: "Sending email", detail: action.summary }] });
    sent = await sendMail(store.owner, profile.data!.email, mail, store.audit);
  }
  const timestamp = new Date().toISOString();
  const outreach = store.state.outreach.find((o) => o.id === (action.payload.outreach_id ?? action.payload.reminder_id));
  const changed = outreach ? [{ ...outreach, ...(action.payload.reminder_id
    ? { reminder_count: outreach.reminder_count + 1, last_reminder_at: timestamp }
    : { status: "sent" as const, gmail_message_id: sent.id, gmail_thread_id: sent.threadId, sent_at: timestamp }) }] : undefined;
  await complete({ gmail_message_id: sent.id, gmail_thread_id: sent.threadId }, changed);
  return true;
}
