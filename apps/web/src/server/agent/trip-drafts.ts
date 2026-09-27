import "server-only";
import { randomUUID } from "node:crypto";
import { TripCardSchema, TripMessageSchema, type DraftChange, type TripCard, type TripMessage } from "@repo/types";
import { applyDraftChanges, cardToValidatedPlan, DraftError, draftSummary, draftValidation, interpretDraft, normalizeDraftCard } from "@repo/core";
import { HttpError } from "../http";
import { createServiceClient } from "../db";
import { loadTrip, planningDatabase, publicTrip, type Changes, type TripStore } from "./store";
import { interpretTripMessage } from "./draft-interpreter";

export async function draftMessages(owner: string, id: string) {
  const result = await createServiceClient().from("trip_messages").select("*").eq("owner_id", owner).eq("trip_id", id).order("created_at").order("id");
  planningDatabase(result.error);
  return TripMessageSchema.array().parse(result.data);
}
export async function draftView(owner: string, id: string) {
  const state = await loadTrip(owner, id);
  return { ...publicTrip(state), messages: await draftMessages(owner, id) };
}
function cardFrom(store: TripStore, revision: number) {
  if (store.state.trip.status !== "awaiting_request_confirmation") throw new HttpError(409, "This draft has already been validated.");
  const card = TripCardSchema.parse(store.state.trip.card);
  if (card.revision !== revision) throw new HttpError(409, "This draft changed in another tab. Refresh before editing.");
  return card;
}
function message(store: TripStore, role: TripMessage["role"], content: string, replies: string[] = [], id: string = randomUUID(), offset = 0): TripMessage {
  return { id, owner_id: store.owner, trip_id: store.id, role, content, quick_replies: replies, created_at: new Date(Date.now() + offset).toISOString() };
}
async function save(store: TripStore, card: TripCard, messages: TripMessage[], changes: Changes = {}) {
  planningDatabase((await store.db.rpc("trip_draft_commit", { p_trip: store.id, p_owner: store.owner, p_token: store.token,
    p_revision: card.revision, p_card: card, p_messages: messages, p_changes: changes })).error);
}
export async function validateDraft(store: TripStore, revision: number, key: string, history?: TripMessage[], preceding?: TripMessage[]) {
  const messages = history ?? await draftMessages(store.owner, store.id);
  if (messages.some((m) => m.id === key)) return false;
  const card = normalizeDraftCard(cardFrom(store, revision), store.state.directory), fr = card.language === "fr";
  const validation = draftValidation(card);
  const plan = validation.canValidate ? cardToValidatedPlan(card, store.state.directory) : null;
  const start = preceding ?? [message(store, "user", fr ? "Valider et rechercher" : "Validate and search", [], key)];
  if (!plan) { await save(store, card, [...start, message(store, "agent", validation.question, [], randomUUID(), 1)]); return false; }
  const validated = { ...card, validated_at: new Date().toISOString() };
  await save(store, validated, [...start, message(store, "agent", fr ? "Demande validée. Je vérifie les disponibilités, puis recherche les offres. Aucune réservation n’est effectuée." : "Request validated. I’m checking availability, then searching for offers. No booking is made.", [], randomUUID(), 1)], {
    trip: { status: store.next("checking_availability"), title: plan.request.title, destination: plan.request.destination,
      extracted: plan.request, meeting: plan.meeting, budget_per_traveler: card.budget.value, workflow: plan.workflow },
    replace_travelers: true, travelers: card.travelers.value.map((traveler_id) => ({ traveler_id, confirmation_status: "not_requested", booking_details: null })),
    events: [{ actor: "manager", source: "draft", title: "Travel request validated", detail: "The manager reviewed the trip card and explicitly authorized availability checks and search.", data: { card_revision: card.revision } }],
  });
  return true;
}
export async function sendDraftMessage(store: TripStore, content: string, key: string, revision: number, first = false, overrides: Record<string, boolean> = {}) {
  const history = await draftMessages(store.owner, store.id);
  if (history.some((m) => m.id === key)) return false;
  const before = cardFrom(store, revision);
  const userMessage = message(store, "user", content, [], key);
  let intent;
  try { intent = await interpretTripMessage(content, before, store.state.directory, history, store.audit); }
  catch {
    const fr = before.language === "fr" || /\b(?:je|reunion|réunion|organise|deplacement|déplacement|retour|demain|ajoute|retire)\b/i.test(content);
    await save(store, before, [userMessage, message(store, "agent", fr
      ? "Je n’ai pas pu lire ce message. Réessayez : votre demande est conservée."
      : "I couldn’t read that message. Please try again; your trip details are unchanged.", [], randomUUID(), 1)]);
    return false;
  }
  if (intent.intent === "validate" && intent.confidence >= 0.85 && !first) return validateDraft(store, revision, key, history, [userMessage]);
  if (first) {
    intent.changes = intent.changes.filter((c) => c.field !== "remove_traveler" && c.field !== "travelers" && !(c.field === "add_traveler" && overrides[c.traveler_id ?? String(c.value)] === false));
  }
  const { card } = interpretDraft(before, intent, content, store.state.directory, new Date(), first);
  // Only deterministic questions about absent essentials reach the conversation.
  await save(store, card, [userMessage, message(store, "agent", draftSummary(before, card, store.state.directory), [], randomUUID(), 1)]);
  return false;
}
export async function editDraftCard(store: TripStore, changes: DraftChange[], key: string, revision: number) {
  const history = await draftMessages(store.owner, store.id);
  if (history.some((m) => m.id === key)) return;
  const before = cardFrom(store, revision);
  let card: TripCard;
  try { card = applyDraftChanges(before, changes, store.state.directory, "Edited", new Date()); }
  catch (error) { if (error instanceof DraftError) throw new HttpError(400, error.message); throw error; }
  const describe = changes.map((c) => {
    if (["add_traveler", "remove_traveler"].includes(c.field)) return c.field.replaceAll("_", " ") + " · " + (store.state.directory.find((p) => p.id === (c.traveler_id ?? c.value))?.full_name ?? "traveler");
    const value = c.field === "outbound" || c.field === "return" ? card[c.field].value : c.value;
    return c.field.replaceAll("_", " ") + " · " + (value && typeof value === "object" && "date" in value ? `${value.date} ${"part" in value ? value.part : ""}` : String(value ?? "default"));
  }).join("; ");
  await save(store, card, [message(store, "system", "Edited in the card · " + describe, [], key), message(store, "agent", draftSummary(before, card, store.state.directory), [], randomUUID(), 1)]);
}
