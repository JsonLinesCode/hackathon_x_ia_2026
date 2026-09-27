"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Badge } from "@repo/ui";
import { Button } from "@repo/ui/button";
import { type TripDetail, type Action, FlightDetailsSchema } from "@repo/types";
import { api, dateTime, euro, statusLabel, useTrip } from "@/lib/trip-client";
import { Heading } from "./travel-primitives";
function MoveDates({ action, data, busy, save }: { action: Action; data: TripDetail; busy: boolean; save: (body: unknown) => Promise<boolean> }) {
  if (!data.journey || !data.trip.meeting) return null;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget), date = (name: string) => String(form.get(name) || "") || null;
    await save({ operation: "dates", action_id: action.id, journey: { ...data.journey, departure_date: date("departure"), return_date: date("return"), hotel_checkin: date("checkin"), hotel_checkout: date("checkout") },
      meeting: { ...data.trip.meeting, start: new Date(String(form.get("start")) + "Z").toISOString(), end: new Date(String(form.get("end")) + "Z").toISOString() } });
  }
  return <form className="form-stack" onSubmit={submit}><p className="muted small">Save new dates, then approve the move. Meeting times below are UTC.</p><div className="managed-form-grid">
    {data.journey.transport === "flight" && <><label>Departure<input type="date" name="departure" required defaultValue={data.journey.departure_date ?? ""} /></label>{!data.journey.one_way && <label>Return<input type="date" name="return" required defaultValue={data.journey.return_date ?? ""} /></label>}</>}
    {data.journey.hotel_needed && <><label>Hotel check-in<input type="date" name="checkin" required defaultValue={data.journey.hotel_checkin ?? ""} /></label><label>Hotel check-out<input type="date" name="checkout" required defaultValue={data.journey.hotel_checkout ?? ""} /></label></>}
    <label>Meeting start (UTC)<input type="datetime-local" name="start" required defaultValue={new Date(data.disruption?.event.new_start ?? data.trip.meeting.start).toISOString().slice(0,16)} /></label>
    <label>Meeting end (UTC)<input type="datetime-local" name="end" required defaultValue={new Date(data.disruption?.event.new_end ?? data.trip.meeting.end).toISOString().slice(0,16)} /></label>
    </div><Button variant="outline" disabled={busy}>Save dates for approval</Button></form>;
}
function ManualCancellation({ id, reference, busy, save }: { id: string; reference: string | null; busy: boolean; save: (body: unknown) => Promise<boolean> }) {
  const [note, setNote] = useState("");
  return <form className="form-stack" onSubmit={(e) => { e.preventDefault(); void save({ operation: "manual_cancelled", booking_id: id, note }); }}>
    <p>Provider reference: {reference ?? "Unavailable"}</p><label>Provider confirmation / evidence<input required minLength={10} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
    <label className="checkbox-label"><input type="checkbox" required />I verified that the provider cancelled this item.</label><Button variant="outline" disabled={busy || note.trim().length < 10}>Record external cancellation</Button></form>;
}
export function RecoveryPanel({ data, busy, mutate }: { data: TripDetail; busy: boolean; mutate: ReturnType<typeof useTrip>["mutate"] }) {
  const d = data.disruption; if (!d) return null;
  const save = (body: unknown) => mutate("/api/trips/" + data.trip.id + "/disruption", body);
  return <section className="surface stack disruption-panel"><div className="section-heading"><div><h2>Travel recovery</h2><p>{d.event.kind.replaceAll("_", " ")}</p></div><Badge tone={d.stage === "resolved" ? "success" : "warning"}>{statusLabel(d.stage)}</Badge></div>
    <p>{d.event.detail}</p>{d.event.new_start && <p>New meeting: {dateTime(d.event.new_start, data.trip.meeting?.timezone)} → {dateTime(d.event.new_end!, data.trip.meeting?.timezone)}</p>}{d.event.new_arrival && <p>Updated arrival: {dateTime(d.event.new_arrival, data.trip.meeting?.timezone)}</p>}{d.resolution && <p className="inline-alert">{d.resolution}</p>}
    {d.other_events.length > 0 && <div><h3>Other reasons to travel</h3>{d.other_events.map((e, i) => <p key={i}>{e.title} · {e.at}</p>)}</div>}
    {d.calendar_unknown.length > 0 && <p className="warning-text">Some calendars could not be checked. Review other commitments before cancelling.</p>}
    {Object.values(d.previews).map((p) => <div className="decision-row" key={p.booking_id}><div><strong>{p.kind} · {p.booking_ref ?? "No servicing reference"}</strong><p>Cancellation fee: {p.fee_eur === null ? "Unknown" : euro(p.fee_eur)}{p.refund ? " · Customer refund: " + euro(p.refund.value / 10 ** p.refund.decimal_places) : ""}</p><p className="small">{p.instruction}</p>{p.expires_at && <small>Preview expires: {dateTime(p.expires_at)}</small>}</div></div>)}
    {d.stage === "waiting" && data.actions.filter((a) => d.action_ids.includes(a.id)).map((a) => <div key={a.id} className="recovery-choice"><div className="section-heading"><h3>{a.summary}</h3><Badge>{statusLabel(a.status)}</Badge></div><p>{a.rationale}</p><p>Cost: {a.cost_eur === null ? "Unknown — manual review" : euro(a.cost_eur)} · Reversible: {a.reversible ? "Yes" : "No"}</p>
      {a.status === "proposed" && <>{a.payload.operation === "move_dates" && <MoveDates action={a} data={data} busy={busy} save={save} />}<div className="button-row"><Button variant="outline" disabled={busy} onClick={() => void mutate("/api/actions/" + a.id + "/decide", { decision: "reject" })}>Reject</Button><Button disabled={busy || (a.payload.operation === "move_dates" && !a.payload.journey)} onClick={() => void mutate("/api/actions/" + a.id + "/decide", { decision: "approve" })}>Approve {a.payload.operation === "cancel_all" ? "cancellation" : a.payload.operation === "keep_trip" ? "keeping trip" : "new search"}</Button></div></>}</div>)}
    {d.stage === "waiting" && d.replacement_options.length > 0 && <div className="stack"><h3>Replacement flights</h3>{d.replacement_options.map((o) => { const f = FlightDetailsSchema.parse(o.per_traveler[0].flight!.details); return <div className="recovery-choice" key={o.id}><div className="section-heading"><strong>{o.label} · {euro(o.total_eur)}</strong><Badge tone={o.compliant ? "success" : "warning"}>{o.compliant ? "Compliant" : "Exception required"}</Badge></div><p>{dateTime(f.outbound.departure, data.trip.meeting?.timezone)} → {dateTime(f.outbound.arrival, data.trip.meeting?.timezone)}</p><p>{o.explanation}</p><Button variant="outline" disabled={busy} onClick={() => void save({ operation: "replace", option_id: o.id })}>Select replacement for confirmation</Button></div>; })}</div>}
    {data.bookings.filter((b) => b.status === "cancel_requested").map((b) => <div className="recovery-choice" key={b.id}><h3>Manual follow-up · {b.kind}</h3><ManualCancellation id={b.id} reference={b.provider_ref} busy={busy} save={save} /></div>)}</section>;
}
function RecoveryTrip({ id }: { id: string }) {
  const { data, error, busy, mutate } = useTrip(id);
  if (!data) return <section className="surface"><p role={error ? "alert" : "status"}>{error || "Loading recovery…"}</p></section>;
  return <div className="stack"><div className="section-heading"><h2>{data.trip.title}</h2><Button asChild variant="outline"><Link href={"/trips/" + id}>Open travel plan</Link></Button></div>
    {(error || data.workflow_error) && <div className="inline-alert tone-danger" role="alert">{error || data.workflow_error}<Button variant="outline" disabled={busy} onClick={() => void mutate("/api/trips/" + id + "/run", { retry: true })}>Retry saved step</Button></div>}
    <RecoveryPanel data={data} busy={busy || data.running} mutate={mutate} /></div>;
}
export function ManagedDisruptions() {
  const [trips, setTrips] = useState<TripDetail[] | null>(null), [error, setError] = useState("");
  useEffect(() => { let active = true; const load = () => void api<TripDetail[]>("/api/disruptions").then((v) => { if (active) setTrips(v); }).catch((e: Error) => { if (active) setError(e.message); }); load(); const timer = setInterval(load, 15000); return () => { active = false; clearInterval(timer); }; }, []);
  return <div className="stack"><Heading title="Disruptions" subtitle="Coordinate changes, review fees and approve the next step." />{error && <p role="alert" className="inline-alert tone-danger">{error}</p>}{!trips ? <p role="status">Loading disruptions…</p> : !trips.length ? <section className="surface empty-state">No disruptions recorded.</section> : trips.map((t) => <RecoveryTrip key={t.trip.id} id={t.trip.id} />)}</div>;
}
