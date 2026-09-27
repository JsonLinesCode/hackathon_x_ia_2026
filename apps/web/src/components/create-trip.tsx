"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Pencil, Send, UserPlus, X } from "lucide-react";
import { Avatar, Badge } from "@repo/ui";
import { Button } from "@repo/ui/button";
import { TRIP_CITIES, changedDraftFields, draftIssues, requiredDraftFields, selectedDraftTravelers } from "@repo/core";
import type { DraftChange, DraftField, FieldSource, JourneyMoment, TravelerRecord, TripCard, TripDetail, TripMessage } from "@repo/types";
import { api, useTrip } from "@/lib/trip-client";
import { PlanningProgress } from "./trip-workspace";

type Profile = { full_name: string; email: string };
type DraftView = TripDetail & { messages: TripMessage[] };
const initials = (name: string) => name.split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();
function enterSends(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
}
function Team({ people, selected, onToggle, disabled = false }: { people: TravelerRecord[]; selected: string[]; onToggle: (id: string) => void; disabled?: boolean }) {
  return <div className="draft-team">{people.map((p) => <button key={p.id} type="button" className={"draft-person " + (selected.includes(p.id) ? "is-selected" : "")} aria-pressed={selected.includes(p.id)} disabled={disabled} onClick={() => onToggle(p.id)}>
    <Avatar size="sm">{initials(p.full_name)}</Avatar><span className="draft-person-details"><strong>{p.full_name}</strong><small>{p.email}</small><small>{p.home_city} · {p.home_airport} <span className="draft-source">Profile</span></small></span><span className="draft-check">{selected.includes(p.id) && <Check size={13} />}</span>
  </button>)}</div>;
}
export function CreateTrip({ tripId }: { tripId?: string }) {
  const [people, setPeople] = useState<TravelerRecord[]>([]), [profile, setProfile] = useState<Profile | null>(null), [error, setError] = useState("");
  useEffect(() => { let active = true; void Promise.all([api<TravelerRecord[]>("/api/travelers"), api<Profile>("/api/profile")]).then(([p, account]) => { if (active) { setPeople(p); setProfile(account); } }).catch((e: Error) => { if (active) setError(e.message); }); return () => { active = false; }; }, []);
  if (error) return <div className="surface form-stack" role="alert"><p>{error}</p><Button variant="outline" onClick={() => window.location.reload()}>Try again</Button></div>;
  return tripId ? <DraftConversation key={tripId} id={tripId} people={people} profile={profile} /> : <TripLanding people={people} profile={profile} />;
}
function TripLanding({ people, profile }: { people: TravelerRecord[]; profile: Profile | null }) {
  const router = useRouter(), key = useRef<string | null>(null);
  const [text, setText] = useState(""), [overrides, setOverrides] = useState<Record<string, boolean>>({}), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const selected = selectedDraftTravelers(text, people, overrides);
  function toggle(id: string) { key.current = null; setOverrides((previous) => ({ ...previous, [id]: !selected.includes(id) })); }
  async function send(event: FormEvent) {
    event.preventDefault(); if (!text.trim() || busy) return;
    setBusy(true); setError(""); key.current ??= crypto.randomUUID();
    try { const trip = await api<{ id: string }>("/api/trips", { request_text: text, traveler_ids: selected, traveler_overrides: overrides, idempotency_key: key.current }); router.push("/trips/new?draft=" + trip.id); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <div className="draft-landing">
    <div className="draft-intro"><p className="uppercase">NEW MULTI-PERSON TRIP</p><h1>What should we organize?</h1><p>Tell the agent who travels, where, and when the meeting is. It fills in the rest.</p></div>
    <form className="draft-message-box" onSubmit={(e) => void send(e)}>
      {selected.length > 0 && <div className="draft-chips">{people.filter((p) => selected.includes(p.id)).map((p) => <button key={p.id} type="button" disabled={busy} onClick={() => toggle(p.id)} aria-label={"Remove " + p.full_name}><Avatar size="sm">{initials(p.full_name)}</Avatar>{p.full_name}<X size={13} /></button>)}</div>}
      <textarea aria-label="Trip request" placeholder="A team meeting in Berlin next Tuesday at 10:00, with Alice and Marc…" maxLength={12000} value={text} disabled={busy} onChange={(e) => { setText(e.target.value); key.current = null; }} onKeyDown={enterSends} />
      <div className="draft-composer-footer"><small>French or English · Shift + Enter for a new line</small><Button type="submit" disabled={busy || !profile || !text.trim()}>{busy ? "Preparing draft…" : "Send"}<Send size={16} /></Button></div>
    </form>
    {error && <p className="inline-alert tone-danger" role="alert">{error}</p>}
    <section className="draft-directory"><div className="section-heading"><h2>Your team</h2><Button asChild variant="outline" size="sm"><Link href="/travelers"><UserPlus size={15} />Manage travelers</Link></Button></div>
      {!profile ? <p role="status" className="muted">Loading your workspace…</p> : !people.length ? <p className="muted">Add travelers to your team to include them in this request.</p> : <Team people={people} selected={selected} onToggle={toggle} disabled={busy} />}
    </section>
  </div>;
}
function DraftConversation({ id, people, profile }: { id: string; people: TravelerRecord[]; profile: Profile | null }) {
  const { data, error: loadError, reload, mutate } = useTrip(id);
  const [view, setView] = useState<DraftView | null>(null), [text, setText] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [changed, setChanged] = useState<string[]>([]), lastCard = useRef<TripCard | null>(null), thread = useRef<HTMLDivElement>(null);
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const card = (view?.trip.card?.revision ?? -1) > (data?.trip.card?.revision ?? -1) ? view?.trip.card : data?.trip.card;
  useEffect(() => { let active = true; void api<DraftView>("/api/trips/" + id + "/messages").then((v) => { if (active) setView(v); }).catch((e: Error) => { if (active) setError(e.message); }); return () => { active = false; }; }, [id, data?.trip.card?.revision]);
  useEffect(() => {
    if (!card || lastCard.current?.revision === card.revision) return;
    if (lastCard.current) setChanged(changedDraftFields(lastCard.current, card));
    lastCard.current = card;
  }, [card]);
  useEffect(() => {
    if (!changed.length) return;
    const timer = setTimeout(() => setChanged([]), 2100); return () => clearTimeout(timer);
  }, [changed]);
  useEffect(() => { if (thread.current) thread.current.scrollTop = thread.current.scrollHeight; }, [view?.messages.length]);
  async function update(endpoint: "messages" | "card" | "validate", payload: Record<string, unknown>) {
    if (!card || busy) return false;
    setBusy(true); setError("");
    const signature = JSON.stringify({ endpoint, payload, revision: card.revision });
    if (retry.current?.signature !== signature) retry.current = { signature, key: crypto.randomUUID() };
    try {
      const next = await api<DraftView>("/api/trips/" + id + "/" + endpoint, { ...payload, revision: card.revision, idempotency_key: retry.current.key }, endpoint === "card" ? "PATCH" : "POST");
      setView(next); retry.current = null; await reload(); return true;
    } catch (e) { setError((e as Error).message); await reload().catch(() => undefined); return false; }
    finally { setBusy(false); }
  }
  async function send(value = text) { if (value.trim() && await update("messages", { content: value })) setText(""); }
  if (!data || !card || !view) return <div className="surface" role="status">{error || loadError || "Loading your draft…"}</div>;
  const validated = Boolean(card.validated_at), latestAgent = [...view.messages].reverse().find((m) => m.role === "agent")?.id;
  return <div className="draft-workspace">
    <section className="draft-chat" aria-label="Trip conversation">
      <div ref={thread} className="draft-messages" aria-live="polite">{view.messages.map((m) => <div key={m.id} className={"draft-message draft-message-" + m.role}>
        {m.role !== "system" && <div className="draft-message-author"><Avatar size="sm">{m.role === "agent" ? "AI" : initials(profile?.full_name || profile?.email || "")}</Avatar><strong>{m.role === "agent" ? "Travel Manager" : profile?.full_name || profile?.email || "You"}</strong></div>}
        <p>{m.content}</p>{m.id === latestAgent && !validated && m.quick_replies.length > 0 && <div className="draft-quick-replies">{m.quick_replies.map((reply) => <Button key={reply} variant="outline" size="sm" disabled={busy} onClick={() => void send(reply)}>{reply}</Button>)}</div>}
      </div>)}{busy && <p role="status" className="muted small">Updating your request…</p>}</div>
      {(error || loadError) && <p className="inline-alert tone-danger" role="alert">{error || loadError}</p>}
      <form className="draft-chat-composer" onSubmit={(e) => { e.preventDefault(); void send(); }}><textarea aria-label="Modify or clarify the trip" placeholder={validated ? "Request validated — continue from the trip page" : "Modify or clarify the trip…"} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={enterSends} maxLength={12000} disabled={busy || validated} rows={2} />
        <Button type="submit" size="icon" aria-label="Send message" disabled={busy || validated || !text.trim()}><Send size={17} /></Button></form>
    </section>
    <aside className="draft-right-panel">{validated ? <section className="surface stack"><div className="between"><h2>Planning progress</h2><Badge tone="success">Validated</Badge></div><PlanningProgress data={data} />
      {data.workflow_error && <><p role="alert" className="danger-text">{data.workflow_error}</p><Button variant="outline" onClick={() => void mutate("/api/trips/" + id + "/run", { retry: true })}>Retry step</Button></>}
      {data.options.length > 0 ? <Button asChild><Link href={"/trips/" + id}>See options<ArrowRight size={16} /></Link></Button> : <p className="muted small">Availability and search progress are saved automatically.</p>}
      {data.trip.status === "needs_info" && <Button asChild variant="outline"><Link href={"/trips/" + id + "/planning"}>Review search feedback</Link></Button>}
    </section> : <LiveTripCard card={card} people={people} busy={busy} changed={changed} edit={(changes) => update("card", { changes })} validate={() => void update("validate", {})} />}</aside>
  </div>;
}
const change = (field: DraftField, value: DraftChange["value"], traveler_id: string | null = null): DraftChange => ({ field, value, traveler_id });
function Source({ source, reference }: { source: FieldSource; reference?: string | null }) { return <span className={"draft-source source-" + source.toLowerCase()} title={reference ?? undefined}>{source}{reference ? " · " + reference : ""}</span>; }
type EditableValue = string | number | JourneyMoment | null;
function CardField({ label, field: name, entry, type = "text", required = false, changed, busy, edit, dependency = false, readonly = false }: {
  label: string; field: DraftField; entry: { value: EditableValue; source: FieldSource; reference?: string | null }; type?: string; required?: boolean; changed: string[]; busy: boolean;
  edit: (changes: DraftChange[]) => Promise<boolean>; dependency?: boolean; readonly?: boolean;
}) {
  const [editing, setEditing] = useState(false), [value, setValue] = useState(""), [part, setPart] = useState<JourneyMoment["part"]>("morning");
  const missing = required && entry.value === null;
  const display = typeof entry.value === "object" && entry.value ? entry.value.date + " · " + entry.value.part : entry.value === null ? dependency ? "Depends on the meeting" : required ? "to complete" : "Not set" : String(entry.value).replaceAll("_", " ");
  function open() { setValue(typeof entry.value === "object" && entry.value ? entry.value.date : String(entry.value ?? "")); if (typeof entry.value === "object" && entry.value) setPart(entry.value.part); setEditing(true); }
  async function save() {
    const parsed = type === "journey" ? value ? { date: value, weekday: null, relative_day: null, part, relative_to: "meeting" as const } : null : type === "number" ? value === "" ? null : Number(value) : value || null;
    if (await edit([change(name, parsed)])) setEditing(false);
  }
  const control = type === "city" ? <select aria-label={label} autoFocus value={value} onChange={(e) => setValue(e.target.value)}><option value="">Select a city</option>{TRIP_CITIES.map((c) => <option key={c.name}>{c.name}</option>)}</select> : type === "cabin" ? <select aria-label={label} autoFocus value={value} onChange={(e) => setValue(e.target.value)}>{["economy", "premium_economy", "business", "first"].map((c) => <option key={c} value={c}>{c.replaceAll("_", " ")}</option>)}</select> : <input aria-label={label} autoFocus type={type === "journey" ? "date" : type} min={type === "number" ? 0 : undefined} step={type === "number" ? "any" : undefined} value={value} onChange={(e) => setValue(e.target.value)} />;
  return <div className={"draft-field " + (changed.includes(name) ? "draft-changed" : "")}><div className="draft-field-heading"><span>{label}{missing && <span className="danger-text" aria-label="required"> *</span>}</span><Source source={missing ? "Missing" : entry.source} reference={entry.reference} /></div>
    {editing ? <form className="draft-inline-editor" onSubmit={(e) => { e.preventDefault(); void save(); }} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setEditing(false); } }}>
      {control}{type === "journey" && <select aria-label={label + " part of day"} value={part} onChange={(e) => setPart(e.target.value as JourneyMoment["part"])}>{["morning", "midday", "afternoon", "evening"].map((v) => <option key={v}>{v}</option>)}</select>}
      <Button size="sm" disabled={busy}>OK</Button><button type="button" className="draft-cancel-edit" aria-label="Cancel edit" onClick={() => setEditing(false)}><X size={14} /></button>
    </form> : readonly ? <span className="draft-field-value">{display}</span> : <button className={"draft-field-value " + (missing || dependency && entry.value === null ? "muted" : "")} type="button" onClick={open} disabled={busy} aria-label={"Edit " + label}><span>{display}</span><Pencil size={13} /></button>}
  </div>;
}
function LiveTripCard({ card, people, busy, changed, edit, validate }: { card: TripCard; people: TravelerRecord[]; busy: boolean; changed: string[]; edit: (changes: DraftChange[]) => Promise<boolean>; validate: () => void }) {
  const missing = requiredDraftFields(card), issues = draftIssues(card), common = { changed, busy, edit };
  return <section className="surface draft-card" aria-label="Live trip card"><div className="draft-card-title"><div><small className="uppercase">PROPOSED TRIP</small><h2>{card.destination.value ? "Meeting in " + card.destination.value : "Your trip"}</h2></div><Badge tone={missing.length || issues.length ? "warning" : "success"}>{missing.length ? missing.length + " required missing" : issues.length ? "Review required" : "Ready to validate"}</Badge></div>
    <p className="muted small">Review the proposal. Search starts only after your validation.</p>
    <section className={"draft-card-section " + (changed.includes("travelers") ? "draft-changed" : "")}><div className="between"><h3>Travelers{!card.travelers.value.length && <span className="danger-text"> *</span>}</h3><Source source={card.travelers.source} /></div>
      {!card.travelers.value.length && <p className="muted small">to complete</p>}<Team people={people} selected={card.travelers.value} disabled={busy} onToggle={(id) => void edit([change(card.travelers.value.includes(id) ? "remove_traveler" : "add_traveler", id, id)])} /></section>
    <section className="draft-card-section"><h3>Meeting</h3>
      <CardField {...common} label="Destination" field="destination" entry={card.destination} type="city" required />
      <div className="draft-field-grid"><CardField {...common} label="Date" field="meeting_date" entry={card.meeting_date} type="date" required /><CardField {...common} label="Start" field="meeting_start" entry={card.meeting_start} type="time" required /><CardField {...common} label="End" field="meeting_end" entry={card.meeting_end} type="time" dependency /></div>
      <CardField {...common} label="Venue" field="venue" entry={card.venue} dependency /><div className="draft-readonly"><small>{card.timezone.value ?? "Depends on the meeting"}</small><Source source={card.timezone.source} /></div>
    </section>
    <section className="draft-card-section"><h3>Journey</h3><CardField {...common} label="Outbound" field="outbound" entry={card.outbound} type="journey" dependency /><CardField {...common} label="Return" field="return" entry={card.return} type="journey" dependency /><CardField {...common} label="Hotel nights" field="hotel_nights" entry={card.hotel_nights} type="number" dependency />
      <div className="draft-readonly"><small>Round trip · {Object.values(card.transport.value).includes("flight") ? "Flights for travelers from another city" : card.destination.value ? "No flight for local travelers" : "Depends on the meeting"}</small><Source source="Default" /></div>
      <p className="muted small">Changing the meeting date resets outbound and return suggestions.</p>
    </section>
    <section className="draft-card-section"><h3>Rules</h3><CardField {...common} label="Budget / traveler (€)" field="budget" entry={card.budget} type="number" />
      <CardField {...common} label="Requested class" field="cabin" entry={card.cabin} type="cabin" /><div className="draft-readonly"><small>{card.class_rule.value}</small><Source source={card.class_rule.source} reference={card.class_rule.reference} /></div>
      <CardField {...common} label="Hotel cap (€ / night)" field="hotel_cap" entry={card.hotel_cap} readonly /><div className="draft-readonly"><small>Arrive {card.arrival_margin.value} min before the meeting</small><Source source={card.arrival_margin.source} /></div>
      <div className={changed.includes("constraints") ? "draft-changed" : ""}>{card.constraints.map((c) => <div className="draft-removable" key={c.value}><span>{c.value}<Source source={c.source} /></span><button type="button" aria-label={"Remove constraint: " + c.value} disabled={busy} onClick={() => void edit([change("remove_constraint", c.value)])}><X size={14} /></button></div>)}</div>
      {!card.constraints.length && <p className="muted small">No additional constraints stated.</p>}
    </section>
    {card.notes.length > 0 && <section className={"draft-card-section " + (changed.includes("notes") ? "draft-changed" : "")}><h3>Notes</h3>{card.notes.map((n) => <div className="draft-removable" key={n.value}><span>{n.value}<Source source={n.source} /></span><button type="button" aria-label={"Remove note: " + n.value} disabled={busy} onClick={() => void edit([change("remove_note", n.value)])}><X size={14} /></button></div>)}</section>}
    {issues.map((issue) => <p key={issue} className="warning-text small">{issue}</p>)}
    <Button className="full-width draft-validate" disabled={busy} aria-disabled={missing.length > 0 || issues.length > 0} onClick={validate}>Validate and search<ArrowRight size={16} /></Button>
  </section>;
}
