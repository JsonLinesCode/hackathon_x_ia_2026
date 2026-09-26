"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  ArrowDown,
  ArrowRight,
  Building2,
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  GitCompareArrows,
  MapPin,
  MessageSquareText,
  Mic,
  Paperclip,
  Plane,
  PlaneTakeoff,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserPlus,
  WalletCards,
} from "lucide-react";
import { Avatar, Badge, BudgetProgress } from "@repo/ui";
import { Button } from "@repo/ui/button";
import { formatTravelerSummary } from "@repo/core";
import { travelers, travelerDetails, euro } from "@/lib/travel-data";
import { Heading, IconBox, Modal } from "./travel-primitives";

const defaultRequest =
  "Organize the Berlin offsite for Alice, Marc and Sarah next Tuesday. Everyone must arrive before 18:00 and the total budget is €2,500.";
const DraftSchema = z.object({
  request: z.string().min(10),
  destination: z.string().min(1),
  budget: z.coerce.number().positive(),
  arrival: z.string().min(1),
  added: z.array(z.object({ name: z.string(), city: z.string() })).default([]),
});
type Draft = z.infer<typeof DraftSchema>;
const defaultDraft: Draft = {
  request: defaultRequest,
  destination: "Berlin, Germany",
  budget: 2500,
  arrival: "18:00",
  added: [],
};

export function TravelerRows({ added = [] }: { added?: Draft["added"] }) {
  return (
    <div className="traveler-rows">
      {travelers.map((traveler, index) => {
        const detail = travelerDetails[index];
        return (
          <div className="traveler-row" key={traveler.id}>
            <div className="person">
              <Avatar>{detail.initials}</Avatar>
              <div>
                <strong>{traveler.name}</strong>
                <small>{detail.role}</small>
              </div>
            </div>
            <span className="inline-detail">
              <MapPin size={14} />
              {traveler.homeCity}
            </span>
            <span className="inline-detail availability">
              <CalendarCheck size={14} />
              {detail.availability}
            </span>
            <span
              className={`preference tone-${index === 1 ? "warning" : "success"}`}
            >
              {detail.preference}
            </span>
          </div>
        );
      })}
      {added.map((traveler, i) => (
        <div className="traveler-row" key={`${traveler.name}-${i}`}>
          <div className="person">
            <Avatar>
              {traveler.name
                .split(" ")
                .map((p) => p[0])
                .join("")
                .slice(0, 2)}
            </Avatar>
            <strong>{traveler.name}</strong>
          </div>
          <span className="inline-detail">
            <MapPin size={14} />
            {traveler.city}
          </span>
          <small className="muted">Availability to confirm</small>
          <Badge tone="neutral">Added</Badge>
        </div>
      ))}
    </div>
  );
}

export function PolicyDetails() {
  return (
    <details className="policy-details">
      <summary>
        <IconBox icon={ShieldCheck} tone="success" />
        <span>
          <strong>Acme Europe travel policy</strong>
          <small>
            Economy under 6h · Hotel cap €180/night · Rail preferred under 3h
          </small>
        </span>
        <ChevronDown size={14} />
      </summary>
      <div className="policy-expanded">
        <p>
          <strong>Flights:</strong> Economy class for journeys under six hours.
        </p>
        <p>
          <strong>Hotels:</strong> Maximum €180 per person, per night.
        </p>
        <p>
          <strong>Rail:</strong> Preferred for journeys under three hours.
        </p>
        <p>
          <strong>Exceptions:</strong> Manager approval is required before
          booking outside policy.
        </p>
      </div>
    </details>
  );
}

export function CreateTrip() {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(defaultDraft);
  const [message, setMessage] = useState("");
  const [adding, setAdding] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    try {
      const stored = localStorage.getItem("travel-manager-draft");
      if (stored) {
        const result = DraftSchema.safeParse(JSON.parse(stored));
        if (result.success) setDraft(result.data);
      }
    } catch {
      /* The form remains usable when browser storage is unavailable. */
    }
  }, []);
  function save(plan = false) {
    const result = DraftSchema.safeParse(draft);
    if (!result.success) {
      setMessage(
        "Add a destination, a positive budget, and a request of at least 10 characters.",
      );
      return;
    }
    try {
      localStorage.setItem("travel-manager-draft", JSON.stringify(result.data));
      setMessage("Draft saved on this device.");
    } catch {
      setMessage(
        "Browser storage is unavailable. Keep this tab open to retain your changes.",
      );
    }
    if (plan) router.push("/trips/berlin/planning");
  }
  function addTraveler(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const city = String(data.get("city") ?? "").trim();
    if (!name || !city) return;
    setDraft((previous) => ({
      ...previous,
      added: [...previous.added, { name, city }],
    }));
    setAdding(false);
  }
  return (
    <div className="create-trip stack">
      <Heading
        eyebrow="New multi-person trip"
        title="What should we organize?"
        subtitle="Describe the outcome. The coordinator will structure the details and resolve the logistics."
      />
      <section className="request-box">
        <div className="section-heading">
          <div className="inline-detail">
            <IconBox icon={Sparkles} tone="primary" />
            <strong>Ask Travel Manager</strong>
          </div>
          <Badge>AI-assisted</Badge>
        </div>
        <textarea
          aria-label="Trip request"
          value={draft.request}
          onChange={(event) =>
            setDraft({ ...draft, request: event.target.value })
          }
        />
        <div className="request-footer">
          <span>
            {files.length
              ? files.join(", ")
              : "Add a file, policy note, or calendar constraint"}
          </span>
          <div>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={(event) =>
                setFiles(
                  Array.from(event.target.files ?? []).map((file) => file.name),
                )
              }
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Attach a file"
              title="Attach a file"
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Voice input unavailable"
              title="Voice input is not connected"
              onClick={() =>
                setMessage(
                  "Voice input is not connected. You can type your request above.",
                )
              }
            >
              <Mic size={16} />
            </Button>
          </div>
        </div>
      </section>
      <div className="trip-fields">
        <label>
          <IconBox icon={MapPin} />
          <span>
            <small>Destination</small>
            <input
              aria-label="Destination"
              value={draft.destination}
              onChange={(event) =>
                setDraft({ ...draft, destination: event.target.value })
              }
            />
          </span>
        </label>
        <div>
          <IconBox icon={CalendarDays} />
          <span>
            <small>Dates</small>
            <span>Tue 13 Oct — Thu 15 Oct</span>
          </span>
        </div>
        <label>
          <IconBox icon={Clock3} />
          <span>
            <small>Arrival deadline</small>
            <span className="time-field">
              Before{" "}
              <input
                aria-label="Arrival deadline"
                type="time"
                value={draft.arrival}
                onChange={(event) =>
                  setDraft({ ...draft, arrival: event.target.value })
                }
              />
            </span>
          </span>
        </label>
        <label>
          <IconBox icon={WalletCards} />
          <span>
            <small>Total budget</small>
            <span className="currency-field">
              €
              <input
                aria-label="Total budget"
                type="number"
                min="1"
                value={draft.budget}
                onChange={(event) =>
                  setDraft({ ...draft, budget: Number(event.target.value) })
                }
              />
            </span>
          </span>
        </label>
      </div>
      <section className="surface travelers-section">
        <div className="section-heading">
          <div>
            <h2>Travelers</h2>
            <p className="muted small">
              {3 + draft.added.length} people ·{" "}
              {3 +
                new Set(
                  draft.added
                    .map((t) => t.city)
                    .filter(
                      (city) => !["Paris", "London", "Madrid"].includes(city),
                    ),
                ).size}{" "}
              origins · calendars connected
            </p>
          </div>
          <Button variant="outline" onClick={() => setAdding(true)}>
            <UserPlus size={16} />
            Add traveler
          </Button>
        </div>
        <TravelerRows added={draft.added} />
        <PolicyDetails />
      </section>
      <div className="form-footer">
        <p className={message ? "muted" : "success-text"} role="status">
          {message || "✓ All required details found"}
        </p>
        <div className="button-row">
          <Button variant="outline" onClick={() => save()}>
            Save draft
          </Button>
          <Button onClick={() => save(true)}>
            <Sparkles size={16} />
            Plan trip
          </Button>
        </div>
      </div>
      {adding && (
        <Modal title="Add traveler" onClose={() => setAdding(false)}>
          <form className="form-stack" onSubmit={addTraveler}>
            <label>
              Full name
              <input name="name" autoFocus required maxLength={80} />
            </label>
            <label>
              Departure city
              <input name="city" required maxLength={80} />
            </label>
            <Button type="submit">
              <UserPlus size={16} />
              Add traveler
            </Button>
          </form>
        </Modal>
      )}
    </div>
  );
}

const progress = [
  {
    icon: MessageSquareText,
    name: "Understanding request",
    detail: "3 travelers · Berlin · €2,500",
    status: "Completed",
    tone: "success",
  },
  {
    icon: CalendarCheck,
    name: "Checking calendars",
    detail: "Found 4 viable departure windows",
    status: "Completed",
    tone: "success",
  },
  {
    icon: PlaneTakeoff,
    name: "Searching travel",
    detail: "Comparing 128 flights and 24 trains",
    status: "Searching",
    tone: "primary",
  },
  {
    icon: ShieldCheck,
    name: "Checking company policy",
    detail: "Validating fares, hotel and class",
    status: "Running",
    tone: "primary",
  },
  {
    icon: SlidersHorizontal,
    name: "Optimizing options",
    detail: "Balancing cost, arrival and work time",
    status: "Queued",
    tone: "neutral",
  },
] as const;

export function Planning() {
  return (
    <div className="stack planning-page">
      <Heading
        title="Coordinating Berlin Offsite"
        subtitle="Building one compliant plan across people, calendars and travel."
      >
        <Badge>AI planning in progress</Badge>
      </Heading>
      <section className="workflow-surface">
        <div className="coordinator-card">
          <span className="coordinator-icon">
            <Sparkles size={25} />
          </span>
          <div>
            <small>Travel AI coordinator</small>
            <p>Orchestrating 5 connected workflows</p>
          </div>
          <span className="live-label">
            <span className="status-dot" />
            Live
          </span>
        </div>
        <div className="workflow-arrow">
          <ArrowDown size={30} strokeWidth={1.4} />
        </div>
        <div className="workflow-nodes">
          {[
            {
              icon: CalendarDays,
              name: "Calendar",
              detail: "3 calendars synced",
              tone: "success",
            },
            {
              icon: Plane,
              name: "Travel",
              detail: "152 options",
              tone: "primary",
            },
            {
              icon: ShieldCheck,
              name: "Policy",
              detail: "14 rules checked",
              tone: "success",
            },
            {
              icon: GitCompareArrows,
              name: "Optimizer",
              detail: "Cost × time",
              tone: "neutral",
            },
          ].map((item) => (
            <div
              key={item.name}
              className={`workflow-node ${item.name === "Travel" ? "selected" : ""}`}
            >
              <IconBox
                icon={item.icon}
                tone={item.tone as "success" | "primary" | "neutral"}
              />
              <span>
                <strong>{item.name}</strong>
                <small>{item.detail}</small>
              </span>
            </div>
          ))}
        </div>
        <div className="workflow-caption">
          <span>
            Travel agent is comparing arrival times against calendar
            constraints...
          </span>
          <span>128 options screened</span>
        </div>
      </section>
      <div className="planning-columns">
        <section className="surface">
          <h2>Plan progress</h2>
          <div className="progress-list">
            {progress.map((item) => (
              <div className="progress-row" key={item.name}>
                <IconBox icon={item.icon} tone={item.tone} />
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.detail}</small>
                </span>
                <Badge tone={item.tone}>{item.status}</Badge>
              </div>
            ))}
          </div>
        </section>
        <aside className="dark-panel">
          <h2>Coordination snapshot</h2>
          <p className="muted">Live constraints in this plan</p>
          <dl className="summary-list">
            <div>
              <dt>Travelers</dt>
              <dd>3 from 3 cities</dd>
            </div>
            <div>
              <dt>Arrival deadline</dt>
              <dd>Tuesday · 18:00</dd>
            </div>
            <div>
              <dt>Budget ceiling</dt>
              <dd>€2,500</dd>
            </div>
            <div>
              <dt>Policy</dt>
              <dd>Acme Europe v4.2</dd>
            </div>
          </dl>
          <div className="dark-note">
            <ShieldCheck size={16} className="success-text" />
            <span>
              Policy and budget are checked before any option is proposed.
            </span>
          </div>
        </aside>
      </div>
      <div className="align-end">
        <Button asChild>
          <Link href="/trips/berlin">
            Review travel plan
            <ArrowRight size={16} />
          </Link>
        </Button>
      </div>
    </div>
  );
}

export function TripPlan() {
  const [approved, setApproved] = useState(false);
  const [alternatives, setAlternatives] = useState(false);
  const [plan, setPlan] = useState("balanced");
  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("travel-manager-plan") ?? "null",
      );
      if (saved && ["balanced", "lowest"].includes(saved.plan)) {
        setPlan(saved.plan);
        setApproved(saved.approved === true);
      }
    } catch {}
  }, []);
  function approve() {
    setApproved(true);
    try {
      localStorage.setItem(
        "travel-manager-plan",
        JSON.stringify({ plan, approved: true }),
      );
    } catch {}
  }
  const cost = plan === "lowest" ? 2040 : 2180;
  return (
    <div className="stack trip-plan">
      <Heading
        title="Berlin Team Offsite"
        subtitle="October 13–15 · 12 travelers · Berlin, Germany"
        eyebrow={
          <>
            <Badge tone="success">
              {approved ? "Approved" : "Ready for approval"}
            </Badge>
            <span className="muted">TR-1048</span>
          </>
        }
      >
        <Button variant="outline" onClick={() => setAlternatives(true)}>
          View alternatives
        </Button>
        <Button asChild variant="outline">
          <Link href="/trips/new">
            <SlidersHorizontal size={16} />
            Modify
          </Link>
        </Button>
        <Button onClick={approve} disabled={approved}>
          <Check size={16} />
          {approved ? "Approved" : "Approve"}
        </Button>
      </Heading>
      {approved && (
        <div className="inline-alert tone-success" role="status">
          <Check size={18} />
          <span>
            Plan approved on this device. No bookings or notifications have been
            sent.
          </span>
        </div>
      )}
      <div className="plan-metrics">
        {[
          {
            icon: CircleDollarSign,
            label: "Total cost",
            value: euro(cost),
            tone: "success",
          },
          {
            icon: WalletCards,
            label: "Budget remaining",
            value: euro(2500 - cost),
            tone: "primary",
          },
          {
            icon: ShieldCheck,
            label: "Policy compliance",
            value: "100%",
            tone: "success",
          },
          {
            icon: Clock3,
            label: "Arrival deadline",
            value: "Before 18:00",
            tone: "neutral",
          },
        ].map((item) => (
          <div key={item.label}>
            <IconBox
              icon={item.icon}
              tone={item.tone as "success" | "primary" | "neutral"}
            />
            <span>
              <small>{item.label}</small>
              <strong>{item.value}</strong>
            </span>
          </div>
        ))}
      </div>
      <div className="plan-columns">
        <section className="surface team-plan">
          <div className="section-heading">
            <div>
              <h2>Team travel plan</h2>
              <p className="muted small">
                Recommended arrivals, compared across the team
              </p>
            </div>
            <Badge tone="success">12 arrive on time</Badge>
          </div>
          <div className="table-scroll">
            <table className="team-table">
              <thead>
                <tr>
                  {[
                    "Traveler",
                    "Route",
                    "Depart",
                    "Arrive",
                    "Price",
                    "Policy",
                  ].map((text) => (
                    <th key={text}>{text}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {travelers.map((traveler, i) => (
                  <tr key={traveler.id}>
                    <td>
                      <div className="person">
                        <Avatar size="sm">{travelerDetails[i].initials}</Avatar>
                        {traveler.name.split(" ")[0]}
                      </div>
                    </td>
                    <td>
                      {traveler.homeCity} → Berlin
                      <small>Flight · {travelerDetails[i].flight}</small>
                    </td>
                    <td>{travelerDetails[i].depart}</td>
                    <td>
                      <strong>{travelerDetails[i].arrive}</strong>
                      <small className="success-text">Before 18:00</small>
                    </td>
                    <td>{euro(travelerDetails[i].price)}</td>
                    <td>
                      <span className="preference tone-success">Compliant</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="more-travelers">
            <span className="avatar-stack">
              <Avatar size="xs" muted>
                +9
              </Avatar>
              <Avatar size="xs" muted>
                JL
              </Avatar>
              <Avatar size="xs" muted>
                EK
              </Avatar>
            </span>
            <span>9 more travelers follow comparable compliant routes</span>
          </div>
          <div className="hotel-row">
            <IconBox icon={Building2} tone="primary" />
            <span>
              <strong>Motel One Berlin Alexanderplatz</strong>
              <small>€165/night · 12 rooms · 2 nights · 8 min from venue</small>
            </span>
            <Badge tone="success">Policy compliant</Badge>
          </div>
        </section>
        <aside className="dark-panel optimization">
          <small className="uppercase">Optimization summary</small>
          <h2>
            {plan === "lowest" ? "Lowest cost plan" : "Best balanced plan"}
          </h2>
          <dl className="summary-list">
            <div>
              <dt>Total travel cost</dt>
              <dd>{euro(cost)}</dd>
            </div>
            <div>
              <dt>Budget</dt>
              <dd>€2,500</dd>
            </div>
            <div>
              <dt>Savings</dt>
              <dd className="success-text">{euro(2500 - cost)}</dd>
            </div>
            <div>
              <dt>Lost work time</dt>
              <dd>{plan === "lowest" ? "7h 10m" : "5h 20m"}</dd>
            </div>
            <div>
              <dt>Policy violations</dt>
              <dd className="success-text">0</dd>
            </div>
          </dl>
          <div className="dark-note vertical">
            <Sparkles size={17} className="primary-text" />
            <p>
              Selected plan balances cost, arrival time and lost work hours.
            </p>
          </div>
          <div className="confidence">
            <div className="between">
              <span>Plan confidence</span>
              <strong>96%</strong>
            </div>
            <BudgetProgress spent={96} total={100} label="Plan confidence" />
          </div>
        </aside>
      </div>
      {alternatives && (
        <Modal
          title="Compare travel plans"
          onClose={() => setAlternatives(false)}
        >
          <div className="alternative-options">
            {[
              {
                id: "balanced",
                title: "Best balanced plan",
                cost: "€2,180",
                detail: "5h 20m lost work time · 100% compliant",
              },
              {
                id: "lowest",
                title: "Lowest cost plan",
                cost: "€2,040",
                detail: "7h 10m lost work time · 100% compliant",
              },
            ].map((option) => (
              <label key={option.id}>
                <input
                  type="radio"
                  name="plan"
                  checked={plan === option.id}
                  onChange={() => {
                    setPlan(option.id);
                    setApproved(false);
                    try {
                      localStorage.setItem(
                        "travel-manager-plan",
                        JSON.stringify({ plan: option.id, approved: false }),
                      );
                    } catch {}
                  }}
                />
                <span>
                  <strong>{option.title}</strong>
                  <small>{option.detail}</small>
                </span>
                <strong>{option.cost}</strong>
              </label>
            ))}
          </div>
          <Button onClick={() => setAlternatives(false)}>
            Use selected plan
          </Button>
        </Modal>
      )}
    </div>
  );
}

export function TravelersPage() {
  const [query, setQuery] = useState("");
  return (
    <div className="stack">
      <Heading
        title="Travelers"
        subtitle={formatTravelerSummary(travelers.length, "Berlin")}
      >
        <Button asChild>
          <Link href="/trips/new">
            <UserPlus size={16} />
            Add to a trip
          </Link>
        </Button>
      </Heading>
      <label className="filter-input">
        <Search size={16} />
        <input
          aria-label="Search travelers"
          placeholder="Search travelers"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="traveler-directory">
        {travelers
          .filter((t) =>
            `${t.name} ${t.homeCity}`
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
          .map((t) => (
            <Link href="/trips/berlin" className="surface" key={t.id}>
              <div className="person">
                <Avatar>
                  {t.name
                    .split(" ")
                    .map((p) => p[0])
                    .join("")}
                </Avatar>
                <div>
                  <h2>{t.name}</h2>
                  <p className="muted">{t.homeCity} → Berlin</p>
                </div>
                <Badge tone="success">Synced</Badge>
              </div>
            </Link>
          ))}
        {!travelers.some((t) =>
          `${t.name} ${t.homeCity}`.toLowerCase().includes(query.toLowerCase()),
        ) && <p>No travelers found.</p>}
      </div>
    </div>
  );
}

export function PoliciesPage() {
  return (
    <div className="stack">
      <Heading
        title="Company travel policy"
        subtitle="Acme Europe · Version 4.2"
      >
        <Badge tone="success">Active</Badge>
      </Heading>
      <div className="policy-page">
        <PolicyDetails />
        <div className="inline-alert tone-success">
          <ShieldCheck size={20} />
          <div>
            <strong>Policy compliant</strong>
            <p>14 rules checked · 0 exceptions in the Berlin travel plan</p>
          </div>
        </div>
        <h2>Policy exceptions</h2>
        <div className="inline-alert tone-warning">
          <ShieldCheck size={20} />
          <span>
            London Client Meeting: Heathrow departure preference requires a
            manager review.
          </span>
        </div>
        <Button asChild variant="outline">
          <Link href="/trips">
            View trips
            <ArrowRight size={16} />
          </Link>
        </Button>
      </div>
    </div>
  );
}
