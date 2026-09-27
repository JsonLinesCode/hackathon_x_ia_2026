"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ArrowDown, ArrowRight, Building2, CalendarDays, Check, ChevronDown, CircleDollarSign, GitCompareArrows, Plane, ShieldCheck, Sparkles, WalletCards, Clock3 } from "lucide-react";
import { Avatar, Badge } from "@repo/ui";
import { Button } from "@repo/ui/button";
import { FlightDetailsSchema, HotelDetailsSchema, type Policy, type TripDetail, type TripOption, type PlanTraveler } from "@repo/types";
import { travelerCost } from "@repo/core";
import { automatic, dateTime, euro, statusLabel, useTrip } from "@/lib/trip-client";
import { RecoveryPanel } from "./disruption-workspace";
import { ResponseReview } from "./coordination-controls";
import { Heading, IconBox, Modal } from "./travel-primitives";

export function PolicyDetails({ policy }: { policy: Policy | null }) {
  return <details className="policy-details">
    <summary><IconBox icon={ShieldCheck} tone="success" /><span><strong>Company travel policy</strong>
      <small>{policy ? "Economy under " + policy.rules.economy_under_hours + "h · Hotel cap " + euro(policy.rules.hotel_cap_eur) + "/night" : "Policy loads from your workspace"}</small></span><ChevronDown size={14} /></summary>
    {policy && <div className="policy-expanded"><p>Arrive at least {policy.rules.arrival_margin_minutes} minutes before the meeting.</p>
      <p>Per traveler budget: {policy.rules.max_trip_budget_per_traveler === null ? "Set in the request" : euro(policy.rules.max_trip_budget_per_traveler)}.</p>
      <p>Exceptions require external approval, recorded by the manager before any quote.</p></div>}
  </details>;
}
export { CreateTrip } from "./create-trip";

export function Timeline({ data }: { data: TripDetail }) {
  return <section className="surface"><h2>Activity timeline</h2><ol className="trip-activity" aria-label="Trip activity">
    {data.timeline.length ? [...data.timeline].reverse().map((event) => <li key={event.id}>
      <span className="activity-dot" /><div><strong>{event.title}</strong><p>{event.detail}</p>
        <small className="muted">{dateTime(event.at, data.trip.meeting?.timezone)} · {event.actor} · {event.source}</small>
        {Array.isArray(event.data.warnings) && event.data.warnings.map((warning, index) => <p className="warning-text small" key={index}>{String(warning)}</p>)}</div>
    </li>) : <li>No activity yet.</li>}
  </ol></section>;
}
function ErrorNotice({ message }: { message: string }) { return message ? <div className="inline-alert tone-danger break-anywhere" role="alert">{message}</div> : null; }
export function TripLoading({ error }: { error: string }) {
  return <section className="surface empty-state" role={error ? "alert" : "status"}><h2>{error ? "Trip unavailable" : "Loading trip…"}</h2>
    {error && <><p>{error}</p><Button asChild variant="outline"><Link href="/trips">Back to trips</Link></Button></>}</section>;
}
function Clarification({ data, busy, mutate }: { data: TripDetail; busy: boolean; mutate: ReturnType<typeof useTrip>["mutate"] }) {
  const [text, setText] = useState(data.trip.request_text);
  return <section className="surface"><h2>A few details are missing</h2>
    <ul className="missing-fields">{data.trip.extracted?.missingFields.map((field) => <li key={field}>{field}</li>)}</ul>
    <form className="form-stack" onSubmit={(e) => { e.preventDefault(); void mutate("/api/trips/" + data.trip.id, { request_text: text }, "PATCH"); }}>
      <label>Complete your request<textarea required minLength={10} maxLength={12000} rows={5} value={text} onChange={(e) => setText(e.target.value)} /></label>
      <Button disabled={busy}>Continue planning<ArrowRight size={16} /></Button>
    </form>
  </section>;
}
function WorkflowIssue({ data, busy, mutate }: { data: TripDetail; busy: boolean; mutate: ReturnType<typeof useTrip>["mutate"] }) {
  if (!data.workflow_error) return null;
  const reconciliation = data.actions.some((a) => a.status === "failed");
  return <section className="surface stack"><ErrorNotice message={data.workflow_error} />
    {!reconciliation && <Button variant="outline" disabled={busy || data.running} onClick={() => void mutate("/api/trips/" + data.trip.id + "/run", { retry: true })}>Retry step</Button>}
  </section>;
}
export function Planning({ tripId }: { tripId: string }) {
  const { data, error, busy, mutate } = useTrip(tripId);
  if (!data) return <TripLoading error={error} />;
  const ready = data.options.length > 0;
  return <div className="stack planning-page">
    <Heading title={"Coordinating " + data.trip.title} subtitle="Building one plan across people, travel and company policy."><Badge>{statusLabel(data.trip.status)}</Badge></Heading>
    <ErrorNotice message={error} /><WorkflowIssue data={data} busy={busy} mutate={mutate} />
    <PlanningProgress data={data} />
    {data.trip.status === "needs_info" && <Clarification key={data.trip.updated_at} data={data} busy={busy} mutate={mutate} />}
    <div className="planning-columns"><Timeline data={data} /><aside className="dark-panel">
      <h2>Coordination snapshot</h2><p className="muted">Live constraints in this plan</p><dl className="summary-list">
        <div><dt>Travelers</dt><dd>{data.travelers.length}</dd></div>
        <div><dt>Meeting</dt><dd>{data.trip.meeting ? dateTime(data.trip.meeting.start, data.trip.meeting.timezone) : "To clarify"}</dd></div>
        <div><dt>Time zone</dt><dd>{data.trip.meeting?.timezone || "Europe/Paris"}</dd></div>
        <div><dt>Budget / traveler</dt><dd>{data.trip.budget_per_traveler === null ? "Company policy" : euro(data.trip.budget_per_traveler)}</dd></div>
      </dl><div className="dark-note"><ShieldCheck size={16} /><span>Every quote requires a manager decision.</span></div>
    </aside></div>
    {ready && <div className="align-end"><Button asChild><Link href={"/trips/" + tripId}>Review travel plan<ArrowRight size={16} /></Link></Button></div>}
  </div>;
}

function FareSummary({ item, timezone }: { item: TripOption["per_traveler"][number]; timezone: string }) {
  const flight = item.flight ? FlightDetailsSchema.parse(item.flight.details) : null;
  const hotel = item.hotel ? HotelDetailsSchema.parse(item.hotel.details) : null;
  return <div className="fare-summary">
    {flight && <><p><Plane size={14} /><strong>{flight.outbound.origin} → {flight.outbound.destination}</strong> · {flight.name}</p>
      <p>{dateTime(flight.outbound.departure, timezone)} → {dateTime(flight.outbound.arrival, timezone)}</p>
      {flight.inbound && <p>Return: {dateTime(flight.inbound.departure, timezone)} → {dateTime(flight.inbound.arrival, timezone)}</p>}
      <p className="muted small">{item.flight!.cabin.replaceAll("_", " ")} · {flight.outbound.stops} stops · {flight.checked_bag_included === true ? "Checked bag included" : "Checked bag not confirmed"}</p>
      {flight.outbound.segments.concat(flight.inbound?.segments ?? []).filter((s) => s.operating_carrier && s.operating_carrier !== s.carrier).map((s, i) => <p className="small" key={i}>{s.carrier} {s.flight_number} operated by {s.operating_carrier}</p>)}
      <p className="small">{flight.refundable === true ? "Refundable; cancellation fee not yet known." : flight.refundable === false ? "Non-refundable fare." : "Cancellation terms unknown."}</p></>}
    {hotel && <div className="hotel-row"><IconBox icon={Building2} tone="primary" /><span><strong>{hotel.name}</strong><small>{hotel.address}</small>
      <small>{hotel.checkin} → {hotel.checkout} · {item.hotel!.nights} nights · {euro(item.hotel!.nightly_eur)}/night</small>
      <small>{hotel.room} · {hotel.board}</small>
      <small>{hotel.cancellation_terms?.free_until ? "Free cancellation until " + dateTime(hotel.cancellation_terms.free_until, timezone) + "; later fee requires review." : hotel.refundable === false ? "Non-refundable rate" : "Cancellation fee not known"}</small>
      {hotel.extra_taxes.map((tax) => <small key={tax}>{tax}</small>)}</span></div>}
  </div>;
}
function ConfirmTraveler({ person, hasFlight, busy, error, onSave, onClose }: { person: PlanTraveler; hasFlight: boolean; busy: boolean; error: string; onSave: (body: unknown) => Promise<boolean>; onClose: () => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const success = await onSave({ traveler_id: person.traveler_id, booking_details: {
      first_name: String(form.get("first_name")), last_name: String(form.get("last_name")), phone: String(form.get("phone")),
      passenger_type: "ADULT", date_of_birth: String(form.get("date_of_birth") || "") || null,
      gender: String(form.get("gender") || "") || null, no_extras: form.get("no_extras") === "on",
    } });
    if (success) onClose();
  }
  return <Modal title={"Confirm " + person.traveler.full_name} onClose={onClose}>
    <p className="muted modal-copy">Confirm the traveler’s agreement and enter their details exactly as on their travel document. {person.traveler.email} will be the booking contact.</p>
    <ErrorNotice message={error} /><form className="form-stack" onSubmit={submit}>
      <div className="managed-form-grid"><label>First name<input name="first_name" required maxLength={100} defaultValue={person.booking_details?.first_name || ""} /></label>
        <label>Last name<input name="last_name" required maxLength={100} defaultValue={person.booking_details?.last_name || ""} /></label></div>
      {hasFlight && <div className="managed-form-grid"><label>Date of birth<input name="date_of_birth" type="date" required defaultValue={person.booking_details?.date_of_birth || ""} /></label>
        <label>Gender on document<select name="gender" required defaultValue={person.booking_details?.gender || ""}><option value="">Choose</option><option value="MALE">Male</option><option value="FEMALE">Female</option></select></label></div>}
      <label>Phone with country code<input name="phone" type="tel" required pattern="[+][1-9][0-9]{6,14}" placeholder="+33612345678" defaultValue={person.booking_details?.phone || ""} /></label>
      <label className="checkbox-label"><input name="adult" type="checkbox" required />Adult traveler (12+), itinerary confirmed.</label>
      <label className="checkbox-label"><input name="no_extras" type="checkbox" required />Prepare the selected fare only, without optional seats, bags or meals.</label>
      <Button disabled={busy} type="submit"><Check size={16} />{busy ? "Saving…" : "Record confirmation"}</Button>
    </form>
  </Modal>;
}
export function TripPlan({ tripId }: { tripId: string }) {
  const { data, error, busy, mutate } = useTrip(tripId);
  const [preview, setPreview] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<PlanTraveler | null>(null);
  const [note, setNote] = useState("");
  if (!data) return <TripLoading error={error} />;
  const selected = data.options.find((o) => o.selected);
  const option = data.options.find((o) => o.id === preview) ?? selected ?? data.options[0];
  const timezone = data.trip.meeting?.timezone ?? "Europe/Paris";
  const locked = busy || data.running;
  const path = "/api/trips/" + tripId;
  return <div className="stack trip-plan">
    <Heading title={data.trip.title} subtitle={[data.trip.destination, data.travelers.length + " travelers", timezone].filter(Boolean).join(" · ")}
      eyebrow={<Badge tone={data.trip.status === "booked" ? "success" : "primary"}>{statusLabel(data.trip.status)}</Badge>}>
      <Button asChild variant="outline"><Link href={"/trips/" + tripId + "/report"}>Expenses & report</Link></Button>
      {data.bookings.length > 0 && <Button asChild variant="outline"><Link href={path.replace("/api", "") + "/itinerary"}>View itinerary<ArrowRight size={16} /></Link></Button>}
      {!data.bookings.length && data.options.length > 0 && <Button variant="outline" disabled={locked || data.actions.some((a) => a.status === "executing" || (a.kind === "book" && ["executed", "failed"].includes(a.status)))}
        onClick={() => void mutate(path + "/run", { research: true })}>Search again</Button>}
    </Heading>
    <ErrorNotice message={error} /><WorkflowIssue data={data} busy={busy} mutate={mutate} />
    {data.trip.status === "needs_info" && <Clarification key={data.trip.updated_at} data={data} busy={busy} mutate={mutate} />}
    {!option ? <section className="surface empty-state"><p>{automatic(data) ? "The coordinator is preparing your options." : "No travel options yet."}</p>
      <Button asChild variant="outline"><Link href={"/trips/" + tripId + "/planning"}>View planning progress</Link></Button></section> : <>
      <div className="plan-metrics">
        {[{ icon: CircleDollarSign, label: "Search estimate", value: euro(option.total_eur) }, { icon: WalletCards, label: "Budget / traveler", value: data.trip.budget_per_traveler === null ? "Company policy" : euro(data.trip.budget_per_traveler) },
          { icon: ShieldCheck, label: "Policy", value: option.compliant ? "Compliant" : option.violations.length + " exceptions" }, { icon: Clock3, label: "Meeting", value: data.trip.meeting ? dateTime(data.trip.meeting.start, timezone) : "To clarify" }].map((m) =>
          <div key={m.label}><IconBox icon={m.icon} /><span><small>{m.label}</small><strong>{m.value}</strong></span></div>)}
      </div>
      <div className="option-tabs" role="group" aria-label="Compare travel options">{data.options.map((o) => <button key={o.id} type="button" aria-pressed={o.id === option.id}
        className={"surface option-tab " + (o.id === option.id ? "chosen" : "")} onClick={() => setPreview(o.id)}>
        <small>#{o.rank} · {o.selected ? "Selected" : o.compliant ? "Compliant" : "Policy exception"}</small><strong>{o.label}</strong><span>{euro(o.total_eur)}</span>
      </button>)}</div>
      <div className="plan-columns"><section className="surface team-plan">
        <div className="section-heading"><div><h2>Team travel plan</h2><p className="muted small">Times shown in {timezone}. Prices can change before checkout.</p></div>
          <Badge tone={option.compliant ? "success" : "warning"}>{option.compliant ? "Compliant" : "Exception required"}</Badge></div>
        {option.per_traveler.map((item) => <div className="real-traveler-plan" key={item.traveler_id}><div className="between"><strong>{data.travelers.find((t) => t.traveler_id === item.traveler_id)?.traveler.full_name}</strong><strong>{euro(travelerCost(item))}</strong></div>
          <FareSummary item={item} timezone={timezone} /></div>)}
        {!!option.violations.length && <ul className="missing-fields">{option.violations.map((v, i) => <li key={i}>{v.message}</li>)}</ul>}
        {data.trip.status === "options_ready" && <Button disabled={locked} onClick={() => void mutate(path + "/select", { option_id: option.id })}>Select this option<Check size={16} /></Button>}
      </section>
      <aside className="dark-panel optimization"><small className="uppercase">Optimization summary</small><h2>{option.label}</h2>
        <p>{option.explanation}</p><dl className="summary-list"><div><dt>Total estimate</dt><dd>{euro(option.total_eur)}</dd></div><div><dt>Violations</dt><dd>{option.violations.length}</dd></div></dl>
        <div className="dark-note"><ShieldCheck size={16} /><span>Search offers only. Calendar availability and traveler replies are tracked below.</span></div>
      </aside></div>
    </>}
    {data.trip.status === "awaiting_exception" && <section className="surface stack"><h2>Policy exception</h2><p>Obtain approval outside the app, then record it here for the selected option.</p>
      <ul className="missing-fields">{selected?.violations.map((v, i) => <li key={i}>{v.message}</li>)}</ul>
      <form className="form-stack" onSubmit={(e) => { e.preventDefault(); void mutate(path + "/exception", { approved: true, note }); }}>
        <label>Approval note (optional)<input value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="Who approved the exception?" /></label>
        <label className="checkbox-label"><input required type="checkbox" />I have obtained approval for these exceptions.</label>
        <Button disabled={locked}>Exception approved</Button></form></section>}
    {selected && <section className="surface"><div className="section-heading"><div><h2>Traveler confirmations</h2><p className="muted small">Confirmation emails and replies are tracked here. Add travel document details before preparing quotes.</p></div></div>
      <div className="traveler-rows">{data.travelers.map((person) => <div className="traveler-row confirmation-row" key={person.traveler_id}>
        <div className="person"><Avatar>{person.traveler.full_name.slice(0, 1)}</Avatar><div><strong>{person.traveler.full_name}</strong><small>{person.traveler.email}</small></div></div>
        <Badge tone={person.confirmation_status === "confirmed" ? "success" : "neutral"}>{statusLabel(person.confirmation_status)}</Badge>
        {data.trip.status === "awaiting_travelers" && <Button variant="outline" disabled={locked} onClick={() => setConfirming(person)}>{person.booking_details ? "Edit details / confirmation" : "Add details / confirmation"}</Button>}
        {person.confirmation_status === "pending" && <Button variant="outline" disabled={locked} onClick={() => void mutate(path + "/remind", { traveler_id: person.traveler_id })}>Remind</Button>}
      </div>)}</div></section>}
    {data.travelers.filter((t) => ["needs_review", "counter_proposal", "declined"].includes(t.confirmation_status)).map((person) => <ResponseReview key={person.traveler_id + person.response_text} person={person} busy={locked} submit={(decision, message) => void mutate(path + "/review", { traveler_id: person.traveler_id, decision, message })} />)}
    <RecoveryPanel data={data} busy={locked} mutate={mutate} />
    {data.actions.some((a) => a.kind === "book" && a.gate === "needs_manager" && !a.payload.disruption_id) && <section className="surface stack"><h2>Pending decisions</h2><p className="muted">Approval prepares a payment link. It does not pay or confirm a booking.</p>
      {data.actions.filter((a) => a.kind === "book" && a.gate === "needs_manager" && !a.payload.disruption_id).map((action) => <div className="decision-row" key={action.id}><div><strong>{action.summary}</strong><p>{action.rationale}</p>
        <p>{action.cost_eur === null ? "Cost unknown" : euro(action.cost_eur)} · Reversible: {action.reversible ? "Yes" : "No"} · {statusLabel(action.status)}</p>
        <small>Offer deadline: {(() => { const p = selected?.per_traveler.find((i) => i.traveler_id === action.payload.traveler_id); const expires = p?.flight ? FlightDetailsSchema.parse(p.flight.details).expires_at : null; return expires ? dateTime(expires, timezone) : "Not provided; availability may change"; })()}</small>
        {typeof action.result?.error === "string" && <p role="alert">{action.result.error}</p>}</div>
        {action.status === "proposed" && <div className="button-row"><Button variant="outline" disabled={locked} onClick={() => void mutate("/api/actions/" + action.id + "/decide", { decision: "reject" })}>Reject</Button>
          <Button disabled={locked} onClick={() => void mutate("/api/actions/" + action.id + "/decide", { decision: "approve" })}>Approve quote</Button></div>}
      </div>)}</section>}
    {data.bookings.length > 0 && <section className="surface stack"><h2>Payment links</h2><p>Quotes are unpaid. Check the final price and cancellation terms on Jinko before making any payment yourself.</p>
      {data.bookings.filter((b) => ["quoted", "booked"].includes(b.status) && !data.bookings.some((other) => other.payment_link === b.payment_link && !["quoted", "booked"].includes(other.status))).filter((b, i, all) => all.findIndex((other) => other.payment_link === b.payment_link) === i).map((b) => <div key={b.id} className="decision-row">
        <div><strong>{data.travelers.find((t) => t.traveler_id === b.traveler_id)?.traveler.full_name}</strong><p>Provider cart: {b.provider_ref}</p>
          <small>{typeof b.details.quote_expires_at === "string" ? "Quote expires: " + dateTime(b.details.quote_expires_at, timezone) : "Quote expiry not provided. Check with Jinko."}</small></div>
        {b.payment_link && <Button asChild variant="outline"><a href={b.payment_link} target="_blank" rel="noopener noreferrer">Open payment page<ArrowRight size={16} /></a></Button>}
      </div>)}</section>}
    <Timeline data={data} />
    {confirming && <ConfirmTraveler person={confirming} hasFlight={!!selected?.per_traveler.find((i) => i.traveler_id === confirming.traveler_id)?.flight}
      busy={busy} error={error} onSave={(body) => mutate(path + "/confirm", body)} onClose={() => setConfirming(null)} />}
  </div>;
}

export function PlanningProgress({ data }: { data: TripDetail }) {
  const searched = data.timeline.filter((e) => e.title === "Travel search saved").length;
  const ready = data.options.length > 0;
  const nodes = [
    { icon: CalendarDays, name: "Calendar", detail: data.travelers.filter((t) => t.availability).length + " calendars checked", tone: "neutral" as const },
    { icon: Plane, name: "Travel", detail: searched + " traveler searches saved", tone: searched ? "success" as const : "primary" as const },
    { icon: ShieldCheck, name: "Policy", detail: data.trip.status === "options_ready" && !ready ? "Search complete" : ready ? "Options evaluated" : "Waiting for offers", tone: ready ? "success" as const : "neutral" as const },
    { icon: GitCompareArrows, name: "Optimizer", detail: data.trip.status === "options_ready" && !ready ? "No matching offers" : ready ? data.options.length + " ranked options" : "Cost × time × compliance", tone: ready ? "success" as const : "neutral" as const },
  ];
  return (
    <section className="workflow-surface">
      <div className="coordinator-card"><span className="coordinator-icon"><Sparkles size={25} /></span><div><small>Travel AI coordinator</small>
        <p>{data.trip.status === "options_ready" && !ready ? "Search complete" : automatic(data) ? "Planning from live travel inventory" : "Waiting for your next decision"}</p></div><span className="live-label"><span className="status-dot" />{data.running ? "Running" : "Saved"}</span></div>
      <div className="workflow-arrow"><ArrowDown size={30} strokeWidth={1.4} /></div>
      <div className="workflow-nodes">{nodes.map((item) => <div key={item.name} className={"workflow-node " + (item.name === "Travel" && data.trip.status === "searching" ? "selected" : "")}>
        <IconBox icon={item.icon} tone={item.tone} /><span><strong>{item.name}</strong><small>{item.detail}</small></span></div>)}</div>
      <div className="workflow-caption"><span>{data.trip.extracted?.destination || "Understanding your request"}</span><span>{data.travelers.length} travelers</span></div>
    </section>
  );
}
