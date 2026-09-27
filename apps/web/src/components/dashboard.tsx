"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, CalendarDays, Plus, Search, TriangleAlert, Users } from "lucide-react";
import { Badge } from "@repo/ui";
import { Button } from "@repo/ui/button";
import type { Trip } from "@repo/types";
import { api, dateTime, euro, statusLabel } from "@/lib/trip-client";
import { Heading, IconBox } from "./travel-primitives";

type ListedTrip = Trip & { traveler_count: number; pending_decisions: number };
export function Dashboard({ tripsOnly = false }: { tripsOnly?: boolean }) {
  const [trips, setTrips] = useState<ListedTrip[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    void api<ListedTrip[]>("/api/trips").then((data) => { if (active) setTrips(data); })
      .catch((err: Error) => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [version]);
  const visible = trips.filter((t) => t.title.toLowerCase().includes(filter.toLowerCase()));
  const attention = trips.filter((t) => t.pending_decisions > 0 || ["needs_info", "awaiting_exception", "awaiting_travelers", "disrupted"].includes(t.status));
  return <div className="dashboard stack">
    <Heading title={tripsOnly ? "Trips" : "Travel overview"} subtitle="All your team travel, in one place."><Button asChild><Link href="/trips/new"><Plus size={16} />Create trip</Link></Button></Heading>
    {error && <div className="inline-alert tone-danger" role="alert"><span>{error}</span><Button variant="outline" onClick={() => setVersion((n) => n + 1)}>Retry</Button></div>}
    {loading ? <section className="surface" role="status">Loading trips…</section> : <>
      {!tripsOnly && <div className="summary-grid">
        {[{ title: "Active trips", value: trips.filter((t) => !["completed", "reported", "cancelled"].includes(t.status)).length, icon: CalendarDays },
          { title: "Traveler assignments", value: trips.reduce((sum, t) => sum + t.traveler_count, 0), icon: Users },
          { title: "Pending decisions", value: trips.reduce((sum, t) => sum + t.pending_decisions, 0), icon: TriangleAlert },
          { title: "Trips needing attention", value: attention.length, icon: TriangleAlert }].map((metric) => <div className="metric" key={metric.title}>
          <div className="between"><span>{metric.title}</span><IconBox icon={metric.icon} /></div><strong>{metric.value}</strong><small className="muted">Your workspace</small>
        </div>)}
      </div>}
      <div className="dashboard-columns"><section className="surface active-trips">
        <div className="section-heading"><h2>{tripsOnly ? "All trips" : "Active trips"}</h2>{!tripsOnly && <Link href="/trips" className="text-link">View all<ArrowRight size={13} /></Link>}</div>
        <label className="filter-input"><Search size={16} /><input placeholder="Search trips" aria-label="Filter trips" value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
        {!visible.length ? <div className="empty-state"><p>{filter ? "No matching trips." : "No trips yet. Start with a request for your team."}</p></div> :
          <div className="table-scroll"><table className="trip-table"><thead><tr><th>Trip &amp; team</th><th>Meeting</th><th>Budget / traveler</th><th>Status</th></tr></thead>
            <tbody>{visible.map((trip) => <tr key={trip.id}><td><Link className="trip-name" href={"/trips/" + trip.id + (["understanding", "searching", "needs_info"].includes(trip.status) ? "/planning" : "")}>{trip.title}</Link>
              <div className="team-preview">{trip.traveler_count} travelers · {trip.destination || "Destination to clarify"}</div></td>
              <td>{trip.meeting ? dateTime(trip.meeting.start, trip.meeting.timezone) : "To clarify"}</td><td>{trip.budget_per_traveler === null ? "Company policy" : euro(trip.budget_per_traveler)}</td>
              <td><Badge tone={trip.pending_decisions || trip.status === "awaiting_exception" ? "warning" : trip.status === "booked" ? "success" : "neutral"}>{statusLabel(trip.status)}</Badge></td>
            </tr>)}</tbody></table></div>}
      </section><section className="surface attention-panel"><div className="section-heading"><h2>Attention required</h2><span className="text-link">{attention.length} trips</span></div>
        <div className="attention-list">{attention.map((trip) => <Link href={"/trips/" + trip.id} key={trip.id} className="attention-item"><IconBox icon={TriangleAlert} tone="warning" />
          <span><strong>{trip.title}</strong><small>{trip.pending_decisions ? trip.pending_decisions + " pending decisions" : statusLabel(trip.status)}</small></span><ArrowRight size={14} /></Link>)}</div>
        {!attention.length && <p className="empty-state">No decisions awaiting your attention.</p>}
      </section></div>
    </>}
  </div>;
}
