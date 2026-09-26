"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  Bell,
  Check,
  LayoutDashboard,
  Luggage,
  Plane,
  PlaneTakeoff,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  Users,
} from "lucide-react";
import { Avatar, Badge, BudgetProgress, type Tone } from "@repo/ui";
import { Button } from "@repo/ui/button";
import { Heading, IconBox } from "./travel-primitives";

export function DesignSystem() {
  const [status, setStatus] = useState("Ready");
  return (
    <div className="stack design-system">
      <Heading
        title="Travel Manager — Shared UI"
        subtitle="Production patterns for coordinated business travel, policy, budget and disruption states."
      >
        <Badge>Desktop + mobile</Badge>
        <Badge tone="neutral">v1.0</Badge>
      </Heading>
      <div className="showcase-topbar">
        <Link href="/trips/berlin">Trips / Berlin Offsite</Link>
        <div className="topbar-actions">
          <Link href="/trips" className="search-input">
            <Search size={14} />
            <span>Search trips, travelers...</span>
            <kbd>⌘ K</kbd>
          </Link>
          <Button asChild size="icon" variant="outline">
            <Link
              href="/disruptions"
              aria-label="Notifications"
              title="Notifications"
            >
              <Bell size={16} />
            </Link>
          </Button>
          <Link href="/profile" aria-label="Your profile">
            <Avatar size="sm">AL</Avatar>
          </Link>
        </div>
      </div>
      <div className="showcase-grid">
        <div className="showcase-column">
          <section className="surface">
            <h2 className="specimen-label">Sidebar navigation</h2>
            <nav className="specimen-navigation">
              {[
                { title: "Overview", icon: LayoutDashboard, href: "/" },
                { title: "Trips", icon: Luggage, href: "/trips" },
                { title: "Travelers", icon: Users, href: "/travelers" },
                { title: "Policies", icon: ShieldCheck, href: "/policies" },
              ].map((item) => (
                <Link
                  className={`nav-item ${item.title === "Trips" ? "active" : ""}`}
                  key={item.title}
                  href={item.href}
                >
                  <item.icon size={16} />
                  {item.title}
                </Link>
              ))}
            </nav>
          </section>
          <section className="surface">
            <h2 className="specimen-label">Trip card</h2>
            <div className="sample-trip">
              <div className="between">
                <div>
                  <strong>Berlin Offsite</strong>
                  <small>12 travelers · Oct 13–15</small>
                </div>
                <Badge tone="success">Ready</Badge>
              </div>
              <div className="budget-label">
                <strong>€7,420</strong>
                <span>€8,000</span>
              </div>
              <BudgetProgress spent={7420} total={8000} />
            </div>
          </section>
          <section className="surface">
            <h2 className="specimen-label">Traveler card</h2>
            <div className="person">
              <Avatar>AM</Avatar>
              <div>
                <strong>Alice Martin</strong>
                <small>Paris → Berlin · Product Lead</small>
              </div>
              <Badge tone="success">Synced</Badge>
            </div>
          </section>
          <section className="surface">
            <h2 className="specimen-label">Approval buttons</h2>
            <div className="button-row">
              <Button size="sm" onClick={() => setStatus("Approved")}>
                <Check size={14} />
                Approve
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/trips/new">
                  <SlidersHorizontal size={14} />
                  Modify
                </Link>
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setStatus("Declined")}
              >
                Decline
              </Button>
            </div>
            {status !== "Ready" && (
              <p className="small specimen-status" role="status">
                {status}
              </p>
            )}
          </section>
        </div>
        <div className="showcase-column">
          <section className="surface">
            <h2 className="specimen-label">Status badges</h2>
            <div className="badge-samples">
              {[
                ["Planning", "primary"],
                ["Ready", "success"],
                ["Attention", "warning"],
                ["Cancelled", "danger"],
                ["Draft", "neutral"],
              ].map(([label, tone]) => (
                <Badge key={label} tone={tone as Tone}>
                  {label}
                </Badge>
              ))}
            </div>
          </section>
          <section className="surface">
            <h2 className="specimen-label">Alert variants</h2>
            <div className="sample-alert tone-danger">
              <TriangleAlert size={17} />
              <div>
                <strong>Flight cancelled</strong>
                <small>We&apos;re finding an alternative.</small>
              </div>
            </div>
            <div className="sample-alert tone-success">
              <CircleCheckIcon />
              <div>
                <strong>Plan approved</strong>
                <small>Travelers will be notified.</small>
              </div>
            </div>
          </section>
          <section className="surface">
            <h2 className="specimen-label">Budget progress</h2>
            <div className="budget-label">
              <span>€2,180 spent</span>
              <span>€2,500</span>
            </div>
            <BudgetProgress spent={2180} total={2500} />
            <div className="budget-label second-budget">
              <span>€7,420 spent</span>
              <span>€8,000</span>
            </div>
            <BudgetProgress spent={7420} total={8000} tone="warning" />
          </section>
          <section className="surface">
            <h2 className="specimen-label">Policy status</h2>
            <div className="sample-alert tone-success">
              <ShieldCheck size={18} />
              <div>
                <strong>Policy compliant</strong>
                <small>14 rules checked · 0 exceptions</small>
              </div>
              <Badge tone="success">100%</Badge>
            </div>
          </section>
        </div>
        <div className="showcase-column">
          <section className="surface">
            <h2 className="specimen-label">AI workflow step</h2>
            <div className="sample-alert tone-primary">
              <PlaneTakeoff size={18} />
              <div>
                <strong>Searching travel</strong>
                <small>128 options screened</small>
              </div>
              <Badge>Running</Badge>
            </div>
          </section>
          <section className="surface">
            <h2 className="specimen-label">Timeline</h2>
            <div className="sample-timeline">
              {[
                ["13:35", "Paris departure"],
                ["15:15", "Frankfurt connection"],
                ["17:20", "Berlin arrival"],
              ].map(([time, title]) => (
                <div key={time}>
                  <time>{time}</time>
                  <span />
                  <p>{title}</p>
                </div>
              ))}
            </div>
          </section>
          <section className="surface">
            <h2 className="specimen-label">Disruption card</h2>
            <Link href="/disruptions" className="sample-dark">
              <div className="between">
                <strong>Replacement confirmed</strong>
                <Badge tone="success">Resolved</Badge>
              </div>
              <h3>Paris → Frankfurt → Berlin</h3>
              <small>Arrives 17:20 · +€67 · Meeting unaffected</small>
            </Link>
          </section>
        </div>
        <div className="showcase-column">
          <section className="surface">
            <h2 className="specimen-label">Mobile itinerary</h2>
            <Link href="/my-trip" className="sample-dark">
              <div className="between">
                <small>Next trip</small>
                <Badge tone="success">On time</Badge>
              </div>
              <div className="sample-flight">
                <span>PAR</span>
                <ArrowRight size={18} />
                <span>BER</span>
              </div>
              <div className="between">
                <span>14:10</span>
                <small>Terminal 2F</small>
              </div>
            </Link>
          </section>
          <section className="surface">
            <h2 className="specimen-label">Icon &amp; avatar scale</h2>
            <div className="icon-samples">
              <Avatar size="xs" muted>
                AM
              </Avatar>
              <Avatar>MB</Avatar>
              <Avatar size="lg" muted>
                SR
              </Avatar>
              <IconBox icon={Plane} tone="primary" />
              <IconBox icon={ShieldCheck} tone="success" />
            </div>
          </section>
          <section className="surface">
            <h2 className="specimen-label">Type hierarchy</h2>
            <h3 className="type-display">Trip workspace</h3>
            <h3 className="type-title">Team travel plan</h3>
            <p>Balanced for cost, arrival and policy.</p>
            <small className="uppercase">Supporting label</small>
          </section>
        </div>
      </div>
    </div>
  );
}

function CircleCheckIcon() {
  return <Check size={17} />;
}
