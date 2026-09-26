"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Plane,
  Plus,
  Search,
  ShieldAlert,
  TriangleAlert,
  UserCheck,
  Users,
  WalletCards,
} from "lucide-react";
import { Avatar, Badge, BudgetProgress } from "@repo/ui";
import { Button } from "@repo/ui/button";
import { euro, trips } from "@/lib/travel-data";
import { Heading, IconBox, Modal } from "./travel-primitives";

export function Dashboard({ tripsOnly = false }: { tripsOnly?: boolean }) {
  const [filter, setFilter] = useState("");
  const [detail, setDetail] = useState<string | null>(null);
  const visibleTrips = trips.filter((trip) =>
    trip.name.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <div className="dashboard stack">
      <Heading
        title={tripsOnly ? "Trips" : "Good morning, Alex"}
        subtitle={
          tripsOnly
            ? "All your team travel, in one place."
            : "Here's what's happening with your team travel."
        }
      >
        <Button asChild>
          <Link href="/trips/new">
            <Plus size={16} />
            Create trip
          </Link>
        </Button>
      </Heading>
      {!tripsOnly && (
        <div className="summary-grid">
          {[
            {
              title: "Upcoming trips",
              value: "8",
              detail: "3 starting this week",
              icon: CalendarDays,
              tone: "primary",
            },
            {
              title: "Travelers this week",
              value: "24",
              detail: "Across 6 destinations",
              icon: Users,
              tone: "neutral",
            },
            {
              title: "Total travel spend",
              value: "€38,420",
              detail: "72% of monthly budget",
              icon: WalletCards,
              tone: "success",
            },
            {
              title: "Trips requiring attention",
              value: "4",
              detail: "2 need action today",
              icon: TriangleAlert,
              tone: "warning",
            },
          ].map(({ title, value, detail, icon, tone }) => (
            <div key={title} className="metric">
              <div className="between">
                <span>{title}</span>
                <IconBox
                  icon={icon}
                  tone={tone as "primary" | "neutral" | "success" | "warning"}
                />
              </div>
              <strong>{value}</strong>
              <small className={tone === "warning" ? "warning-text" : "muted"}>
                {detail}
              </small>
            </div>
          ))}
        </div>
      )}
      <div className="dashboard-columns">
        <section className="surface active-trips">
          <div className="section-heading">
            <h2>{tripsOnly ? "All trips" : "Active trips"}</h2>
            {!tripsOnly && (
              <Link className="text-link" href="/trips">
                View all trips <ArrowRight size={13} />
              </Link>
            )}
          </div>
          {tripsOnly && (
            <label className="filter-input">
              <Search size={16} />
              <input
                placeholder="Search trips"
                aria-label="Filter trips"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </label>
          )}
          <div className="table-scroll">
            <table className="trip-table">
              <thead>
                <tr>
                  <th>Trip &amp; team</th>
                  <th>Dates</th>
                  <th>Budget</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleTrips.map((trip) => (
                  <tr key={trip.name}>
                    <td>
                      <button
                        className="trip-name"
                        onClick={() => {
                          setDetail(trip.name);
                        }}
                        hidden={trip.name === "Berlin Offsite"}
                      >
                        {trip.name}
                      </button>
                      {trip.name === "Berlin Offsite" && (
                        <Link className="trip-name" href="/trips/berlin">
                          {trip.name}
                        </Link>
                      )}
                      <div className="team-preview">
                        <span className="avatar-stack">
                          {trip.initials.map((initials, i) => (
                            <Avatar key={initials} size="xs" muted={i > 0}>
                              {initials}
                            </Avatar>
                          ))}
                        </span>
                        <span>+ {trip.count} travelers</span>
                      </div>
                    </td>
                    <td>{trip.date}</td>
                    <td>
                      <div className="budget-label">
                        <strong>{euro(trip.spent)}</strong>
                        <span>{euro(trip.total)}</span>
                      </div>
                      <BudgetProgress
                        spent={trip.spent}
                        total={trip.total}
                        tone={trip.tone === "warning" ? "warning" : "primary"}
                        label={`${trip.name} budget`}
                      />
                    </td>
                    <td>
                      <Badge tone={trip.tone}>{trip.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!visibleTrips.length && (
            <p className="empty-state">No trips match your search.</p>
          )}
        </section>
        <section className="surface attention-panel">
          <div className="section-heading">
            <h2>Attention required</h2>
            <span className="text-link">4 items</span>
          </div>
          <div className="attention-list">
            {[
              {
                icon: Plane,
                tone: "danger",
                title: "Flight cancelled",
                description: "Alice · Berlin Offsite",
                time: "4 min ago",
                href: "/disruptions",
              },
              {
                icon: ShieldAlert,
                tone: "warning",
                title: "Policy exception",
                description: "Marc · London Client Meeting",
                time: "Needs review",
                href: "/policies",
              },
              {
                icon: UserCheck,
                tone: "primary",
                title: "Traveler approval required",
                description: "2 travelers · Paris Summit",
                time: "Due today",
                href: "/travelers",
              },
              {
                icon: Building2,
                tone: "neutral",
                title: "Hotel price increase",
                description: "Berlin Offsite · +€140",
                time: "Auto-adjusted",
                href: "/trips/berlin",
              },
            ].map((item) => (
              <Link
                href={item.href}
                key={item.title}
                className="attention-item"
              >
                <IconBox
                  icon={item.icon}
                  tone={
                    item.tone as "danger" | "warning" | "primary" | "neutral"
                  }
                />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.description}</small>
                </span>
                <time>{item.time}</time>
              </Link>
            ))}
          </div>
          <div className="automation-note">
            <span className="status-dot" />
            <span>
              AI is actively monitoring 8 trips for schedule and policy changes.
            </span>
          </div>
        </section>
      </div>
      {detail && (
        <Modal title={detail} onClose={() => setDetail(null)}>
          <p className="muted">
            {detail.startsWith("London")
              ? "October 18 · 4 travelers · Budget €3,200"
              : "October 22–24 · 8 travelers · Budget €6,500"}
          </p>
          <p className="modal-copy">
            {detail.startsWith("London")
              ? "A policy exception needs review before this trip can be approved."
              : "Traveler approvals are pending. The travel plan is being prepared."}
          </p>
          <Button asChild>
            <Link
              href={detail.startsWith("London") ? "/policies" : "/travelers"}
            >
              {detail.startsWith("London") ? "Review policy" : "View travelers"}
              <ArrowRight size={16} />
            </Link>
          </Button>
        </Modal>
      )}
    </div>
  );
}
