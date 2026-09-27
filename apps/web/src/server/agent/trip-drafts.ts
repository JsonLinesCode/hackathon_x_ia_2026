import "server-only";
import { randomUUID } from "node:crypto";
import { TripCardSchema, TripMessageSchema, type DraftChange, type TripCard, type TripMessage } from "@repo/types";
import { applyDraftChanges, cardToValidatedPlan, DRAFT_LABELS, DraftError, draftSummary, draftIssues, interpretDraft, requiredDraftFields, shiftDay } from "@repo/core";
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
function clarification(card: TripCard) {
  const fr = card.language === "fr", day = card.meeting_date.value;
  return { question: fr ? "Quel changement souhaitez-vous ? Choisissez une proposition ou précisez le champ et sa nouvelle valeur." : "What would you like to change? Choose a proposal or specify a field and its new value.",
    options: day ? [fr ? `Retour le ${day} soir` : `Return ${day} evening`, fr ? `Retour le ${shiftDay(day, 1)} matin` : `Return ${shiftDay(day, 1)} morning`] : [fr ? "La réunion est demain à 10h" : "The meeting is tomorrow at 10:00", fr ? "La réunion est demain à 14h" : "The meeting is tomorrow at 14:00"] };
}
export async function validateDraft(store: TripStore, revision: number, key: string, history?: TripMessage[], preceding?: TripMessage[]) {
  const messages = history ?? await draftMessages(store.owner, store.id);
  if (messages.some((m) => m.id === key)) return false;
  const card = cardFrom(store, revision), fr = card.language === "fr";
  const missing = requiredDraftFields(card);
  let problem = missing.length ? (fr ? "Avant de valider, complétez " : "Before validating, complete ") + missing.map((k) => DRAFT_LABELS[k][fr ? 1 : 0]).join(", ") + "." : "";
  const issues = draftIssues(card);
  if (!problem && issues.length) problem = fr ? "Vérifiez les dates et précisez les contraintes non prises en charge dans la carte avant la recherche." : issues.join(" ");
  let plan: ReturnType<typeof cardToValidatedPlan> | null = null;
  if (!problem) {
    try { plan = cardToValidatedPlan(card, store.state.directory); }
    catch (error) { if (!(error instanceof DraftError)) throw error; problem = fr ? "La proposition contient des dates incompatibles ou passées. Vérifiez les dates de réunion, d’aller et de retour." : error.message; }
  }
  const start = preceding ?? [message(store, "user", fr ? "Valider et rechercher" : "Validate and search", [], key)];
  if (!plan) { await save(store, card, [...start, message(store, "agent", problem, [], randomUUID(), 1)]); return false; }
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
  const intent = await interpretTripMessage(content, before, store.state.directory, history, store.audit);
  const userMessage = message(store, "user", content, [], key);
  if (intent.intent === "validate" && intent.confidence >= 0.85 && !first) return validateDraft(store, revision, key, history, [userMessage]);
  if (first) {
    intent.changes = intent.changes.filter((c) => c.field !== "remove_traveler" && c.field !== "travelers" && !(c.field === "add_traveler" && overrides[c.traveler_id ?? String(c.value)] === false));
  }
  let card = { ...before, language: intent.language }, response = "", replies: string[] = [];
  try {
    const result = interpretDraft(before, intent, content, store.state.directory, new Date(), first);
    card = result.card;
    if (result.applied) response = draftSummary(before, card, store.state.directory);
    else { const q = intent.clarification ?? clarification(card); response = q.question; replies = q.options; }
  } catch (error) {
    if (!(error instanceof DraftError) && !(error instanceof Error && error.name === "ZodError")) throw error;
    const q = clarification(card);
    response = (card.language === "fr" ? "Aucune modification appliquée. Vérifiez les voyageurs et les valeurs dans la carte. " : "No changes applied. Check the travelers and values in the card. ") + q.question;
    replies = q.options;
  }
  await save(store, card, [userMessage, message(store, "agent", response, replies, randomUUID(), 1)]);
  return false;
}
export async function editDraftCard(store: TripStore, changes: DraftChange[], key: string, revision: number) {
  const history = await draftMessages(store.owner, store.id);
  if (history.some((m) => m.id === key)) return;
  const before = cardFrom(store, revision);
  let card: TripCard;
  try { card = applyDraftChanges(before, changes, store.state.directory, "Edited", new Date(), false); }
  catch (error) { if (error instanceof DraftError) throw new HttpError(400, error.message); throw error; }
  const describe = changes.map((c) => {
    if (["add_traveler", "remove_traveler"].includes(c.field)) return c.field.replaceAll("_", " ") + " · " + (store.state.directory.find((p) => p.id === (c.traveler_id ?? c.value))?.full_name ?? "traveler");
    const value = c.field === "outbound" || c.field === "return" ? card[c.field].value : c.value;
    return c.field.replaceAll("_", " ") + " · " + (value && typeof value === "object" && "date" in value ? `${value.date} ${"part" in value ? value.part : ""}` : String(value ?? "default"));
  }).join("; ");
  await save(store, card, [message(store, "system", "Edited in the card · " + describe, [], key), message(store, "agent", draftSummary(before, card, store.state.directory), [], randomUUID(), 1)]);
}
