"use client";
import { useEffect, useState } from "react";
import { Button } from "@repo/ui/button";
import { Badge } from "@repo/ui";
import { FlightDetailsSchema, HotelDetailsSchema, type Meeting } from "@repo/types";
import { api, dateTime, statusLabel } from "@/lib/trip-client";
import { Heading } from "./travel-primitives";
type View = { title: string; name: string; language: "fr" | "en"; meeting: Meeting | null; editable: boolean;
  confirmation_status: string; response_text: string | null; availability: { source?: string } | null;
  itinerary: { flight: { details: unknown } | null; hotel: { details: unknown } | null } };
export function TravelerReply({ token }: { token: string }) {
  const [view, setView] = useState<View | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const path = "/api/r/" + encodeURIComponent(token);
  useEffect(() => { let active = true; void api<View>(path).then((v) => { if (active) setView(v); }).catch((e: Error) => { if (active) setError(e.message); }); return () => { active = false; }; }, [path]);
  async function reply(decision: string) {
    setBusy(true); setError("");
    try { setView(await api<View>(path, { decision, message })); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save your response."); }
    finally { setBusy(false); }
  }
  if (!view) return <main className="traveler-public surface"><h1>Travel Manager</h1><p role={error ? "alert" : "status"}>{error || "Loading your itinerary…"}</p></main>;
  const fr = view.language === "fr", zone = view.meeting?.timezone ?? "Europe/Paris";
  const flight = view.itinerary.flight ? FlightDetailsSchema.omit({ token: true }).parse(view.itinerary.flight.details) : null;
  const hotel = view.itinerary.hotel ? HotelDetailsSchema.omit({ token: true }).parse(view.itinerary.hotel.details) : null;
  return <main className="traveler-public stack"><Heading eyebrow={view.name} title={view.title} subtitle={fr ? "Vérifiez votre itinéraire et répondez à votre gestionnaire." : "Review your itinerary and reply to your travel manager."} />
    <section className="surface stack"><Badge>{statusLabel(view.confirmation_status)}</Badge>
      {view.meeting && <><h2>{view.meeting.title}</h2><p>{dateTime(view.meeting.start, zone)} – {dateTime(view.meeting.end, zone)} · {zone}</p><p>{view.meeting.location}</p></>}
      {flight && <div><h2>{flight.outbound.origin} → {flight.outbound.destination}</h2><p>{dateTime(flight.outbound.departure, zone)} → {dateTime(flight.outbound.arrival, zone)}</p>
        {flight.inbound && <p>{fr ? "Retour" : "Return"} : {dateTime(flight.inbound.departure, zone)} → {dateTime(flight.inbound.arrival, zone)}</p>}</div>}
      {hotel && <div className="hotel-row"><div><strong>{hotel.name}</strong><p>{hotel.address}</p><p>{hotel.checkin} → {hotel.checkout}</p></div></div>}
      <p className="muted">{fr ? "Proposition non payée. Votre confirmation ne réserve ni ne paie le voyage." : "Unpaid proposal. Your confirmation does not book or pay for travel."}</p>
      {view.availability?.source === "unknown" && <p className="warning-text">{fr ? "Votre agenda n’est pas accessible : vérifiez vous-même votre disponibilité." : "Your calendar is unavailable: please check your availability yourself."}</p>}
    </section>
    {error && <p className="inline-alert tone-danger" role="alert">{error}</p>}
    {view.editable ? <section className="surface form-stack"><h2>{fr ? "Votre réponse" : "Your response"}</h2>
      <label>{fr ? "Autre horaire ou commentaire" : "Alternative time or comment"}<textarea maxLength={4000} rows={4} value={message} onChange={(e) => setMessage(e.target.value)} /></label>
      <div className="button-row"><Button disabled={busy} onClick={() => void reply("confirmed")}>{fr ? "Je confirme" : "I confirm"}</Button>
        <Button variant="outline" disabled={busy || message.trim().length < 5} onClick={() => void reply("counter_proposal")}>{fr ? "Proposer un autre horaire" : "Propose another time"}</Button>
        <Button variant="outline" disabled={busy} onClick={() => void reply("declined")}>{fr ? "Je ne peux pas participer" : "I cannot attend"}</Button></div>
      {view.response_text && <p role="status">{fr ? "Réponse enregistrée : " : "Saved response: "}{view.response_text}</p>}
    </section> : <p className="surface">{fr ? "Votre réponse est enregistrée. Contactez votre gestionnaire pour toute modification." : "Your response is saved. Contact your travel manager for changes."}</p>}
  </main>;
}
