"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  ArrowUp,
  Bell,
  Bot,
  Building2,
  CalendarClock,
  CalendarPlus,
  CarFront,
  Check,
  ChevronRight,
  CircleCheck,
  FilePenLine,
  Lightbulb,
  ListTodo,
  MapPin,
  Mic,
  Plane,
  PlaneLanding,
  PlaneTakeoff,
  Route,
  Send,
  Sparkles,
  UserRound,
  Users,
  WalletCards,
  Clock3,
} from "lucide-react";
import { Avatar, Badge } from "@repo/ui";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/utils";
import { itinerary } from "@/lib/travel-data";
import { Heading, IconBox } from "./travel-primitives";

export function FlightCard() {
  return (
    <div className="flight-card">
      <div className="between">
        <span className="uppercase">Your next trip</span>
        <Badge tone="success">On time</Badge>
      </div>
      <div className="flight-route">
        <div>
          <strong>PAR</strong>
          <small>Paris</small>
        </div>
        <div className="flight-route-line">
          <Plane size={21} />
          <small>AF1734 · 1h 45m</small>
        </div>
        <div>
          <strong>BER</strong>
          <small>Berlin</small>
        </div>
      </div>
      <div className="flight-facts">
        <div>
          <small>Departure</small>
          <strong>14:10</strong>
        </div>
        <div>
          <small>Terminal</small>
          <strong>2F</strong>
        </div>
        <div>
          <small>Boarding</small>
          <strong className="success-text">13:35</strong>
        </div>
      </div>
    </div>
  );
}

export function TravelerHome() {
  return (
    <div className="traveler-stack">
      <div className="traveler-desktop-heading">
        <Heading title="Berlin Offsite" subtitle="Tuesday, October 13" />
      </div>
      <section className="surface welcome-panel">
        <div className="welcome-copy">
          <div>
            <small className="uppercase">Good morning</small>
            <h2>Hello, Alex</h2>
            <p>
              Your Berlin Offsite trip is on track. Ask Travel Manager
              what&apos;s happening with your flight, hotel, or transfer.
            </p>
          </div>
          <Avatar size="lg">AM</Avatar>
        </div>
        <div className="ask-preview">
          <Link href="/assistant" className="between">
            <span>
              <small className="uppercase">Ask Travel Manager</small>
              <p>What&apos;s the latest on my Berlin flight?</p>
            </span>
            <Avatar size="sm">AI</Avatar>
          </Link>
          <div className="suggestion-chips">
            <Link href="/assistant?topic=flight">Flight status</Link>
            <Link href="/assistant?topic=hotel">Hotel check-in</Link>
            <Link href="/assistant?topic=transfer">Transfer</Link>
          </div>
        </div>
      </section>
      <FlightCard />
      <section className="surface glance-panel">
        <h2>Your trip at a glance</h2>
        {[
          {
            icon: Building2,
            title: "Hotel",
            value: "Motel One Alexanderplatz",
            detail: "Check-in from 15:00",
          },
          {
            icon: CalendarClock,
            title: "Meeting",
            value: "Wednesday · 09:00",
            detail: "Studio 3 · Alexanderplatz",
          },
          {
            icon: CarFront,
            title: "Airport transfer",
            value: "Driver meets you at arrivals",
            detail: "Booking TM-8821",
          },
        ].map((item) => (
          <Link href="/itinerary" className="glance-row" key={item.title}>
            <IconBox icon={item.icon} />
            <span>
              <small className="uppercase">{item.title}</small>
              <strong>{item.value}</strong>
            </span>
            <small>{item.detail}</small>
          </Link>
        ))}
      </section>
      <Button asChild className="full-width">
        <Link href="/itinerary">
          <Route size={18} />
          View full itinerary
        </Link>
      </Button>
    </div>
  );
}

function ResponseSteps({ mobile = false }: { mobile?: boolean }) {
  return (
    <div className="response-steps">
      {[
        ["Searching alternatives", "46 routes evaluated"],
        [
          mobile ? "Checking company policy" : "Checking policy",
          "Replacement compliant",
        ],
        [
          mobile ? "Updating your itinerary" : "Recalculating itinerary",
          mobile ? "Complete" : "Arrival and meeting verified",
        ],
      ].map(([title, detail]) => (
        <div key={title}>
          <CircleCheck size={20} />
          <span>
            <strong>{title}</strong>
            <small>{detail}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

export function Disruptions() {
  return (
    <>
      <div className="desktop-disruption stack">
        <div className="cancellation-banner">
          <Plane size={20} />
          <div>
            <h1>Flight AF1234 cancelled</h1>
            <p>
              <Avatar size="xs">AM</Avatar>Alice is affected · Paris → Berlin ·
              Today at 14:10
            </p>
          </div>
          <Badge>Automatically handled</Badge>
        </div>
        <div className="resolved-banner">
          <span className="resolved-check">
            <Check size={28} />
          </span>
          <div>
            <h2>We found an alternative. No action required.</h2>
            <p>
              Alice arrives at 17:20. Her meeting, budget and company policy
              remain protected.
            </p>
          </div>
          <Button asChild>
            <Link href="/itinerary">View full itinerary</Link>
          </Button>
        </div>
        <div className="disruption-columns">
          <section className="surface">
            <div className="inline-detail">
              <IconBox icon={Sparkles} tone="primary" />
              <div>
                <h2>AI response</h2>
                <small className="muted">Resolved in 42 seconds</small>
              </div>
            </div>
            <ResponseSteps />
          </section>
          <section className="surface">
            <div className="section-heading">
              <h2>Itinerary comparison</h2>
              <small className="muted">Updated 10:24</small>
            </div>
            <div className="itinerary-comparison">
              <div className="flight-option original">
                <div className="between">
                  <small className="uppercase">Original</small>
                  <Badge tone="danger">Cancelled</Badge>
                </div>
                <h3>Paris → Berlin</h3>
                <div className="flight-times">
                  <div>
                    <strong>14:10</strong>
                    <small>CDG · Terminal 2F</small>
                  </div>
                  <ArrowRight size={22} />
                  <div>
                    <strong>15:55</strong>
                    <small>BER · Terminal 1</small>
                  </div>
                </div>
                <del>AF1234 · Direct · €420</del>
              </div>
              <div className="flight-option replacement">
                <div className="between">
                  <small className="uppercase primary-text">Replacement</small>
                  <Badge tone="success">Confirmed</Badge>
                </div>
                <h3>Paris → Frankfurt → Berlin</h3>
                <div className="flight-times">
                  <div>
                    <strong>13:35</strong>
                    <small>CDG · Terminal 1</small>
                  </div>
                  <ArrowRight size={22} />
                  <div>
                    <strong>17:20</strong>
                    <small>BER · Terminal 1</small>
                  </div>
                </div>
                <div className="replacement-badges">
                  <span className="preference tone-neutral">+€67</span>
                  <Badge tone="success">Policy compliant</Badge>
                  <Badge tone="success">Meeting unaffected</Badge>
                </div>
              </div>
            </div>
          </section>
        </div>
        <div className="disruption-metrics">
          {[
            {
              icon: WalletCards,
              label: "Budget still respected",
              detail: "€247 remaining",
            },
            {
              icon: Clock3,
              label: "Arrival deadline respected",
              detail: "Arrives 40 min early",
            },
            {
              icon: Send,
              label: "Traveler notified",
              detail: "Push + email sent",
            },
          ].map((item) => (
            <div className="metric-inline" key={item.label}>
              <IconBox icon={item.icon} tone="success" />
              <span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="mobile-disruption traveler-stack">
        <section className="mobile-cancellation">
          <Plane size={23} />
          <h2>Your flight was cancelled.</h2>
          <h3>We&apos;re already handling it.</h3>
          <p>
            AF1234 from Paris to Berlin was cancelled by the airline. You
            don&apos;t need to call anyone.
          </p>
        </section>
        <section className="surface">
          <h2>Travel Manager response</h2>
          <ResponseSteps mobile />
        </section>
        <section className="mobile-resolved">
          <div className="between">
            <div>
              <small className="uppercase success-text">Resolved</small>
              <h2>Your new trip is ready.</h2>
            </div>
            <Badge tone="success">Confirmed</Badge>
          </div>
          <div className="replacement-route">
            <strong>Paris</strong>
            <span>
              <Plane size={18} />
              via Frankfurt
            </span>
            <strong>Berlin</strong>
          </div>
          <div className="replacement-facts">
            <div>
              <small>New arrival</small>
              <p>17:20</p>
            </div>
            <div>
              <small>Additional cost</small>
              <p>Covered by company</p>
            </div>
            <div>
              <small>Meeting</small>
              <p>Unaffected</p>
            </div>
          </div>
        </section>
        <Button asChild className="full-width">
          <Link href="/itinerary">
            <Route size={18} />
            View updated itinerary
          </Link>
        </Button>
      </div>
    </>
  );
}

const timelineIcons = {
  car: CarFront,
  pin: MapPin,
  takeoff: PlaneTakeoff,
  route: GitRoute,
  landing: PlaneLanding,
  hotel: Building2,
  users: Users,
};
function GitRoute({ size }: { size?: number }) {
  return <Route size={size} />;
}

export function Itinerary() {
  const [exported, setExported] = useState(false);
  function downloadCalendar() {
    const events = [
      [
        "20261013T095500Z",
        "20261013T104000Z",
        "Leave office",
        "Car to Charles de Gaulle",
      ],
      [
        "20261013T104000Z",
        "20261013T113500Z",
        "Charles de Gaulle",
        "Terminal 1 - Gate B28",
      ],
      [
        "20261013T113500Z",
        "20261013T131500Z",
        "Flight to Frankfurt",
        "LH1027 - Seat 14C",
      ],
      [
        "20261013T131500Z",
        "20261013T140500Z",
        "Frankfurt connection",
        "Gate A12 to B04",
      ],
      [
        "20261013T152000Z",
        "20261013T161000Z",
        "Berlin arrival and transfer",
        "BER Terminal 1 - Driver confirmed",
      ],
      [
        "20261013T161000Z",
        "20261013T164000Z",
        "Hotel check-in",
        "Motel One Alexanderplatz",
      ],
      [
        "20261014T070000Z",
        "20261014T080000Z",
        "Team meeting",
        "Studio 3 - Alexanderplatz",
      ],
    ];
    const content = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Travel Manager//Itinerary//EN",
      "CALSCALE:GREGORIAN",
      ...events.flatMap(([start, end, title, location], i) => [
        "BEGIN:VEVENT",
        `UID:berlin-offsite-${i}@travel-manager.local`,
        "DTSTAMP:20260926T000000Z",
        `DTSTART:${start}`,
        `DTEND:${end}`,
        `SUMMARY:${title}`,
        `LOCATION:${location}`,
        "END:VEVENT",
      ]),
      "END:VCALENDAR",
      "",
    ].join("\r\n");
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/calendar;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "berlin-offsite.ics";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExported(true);
  }
  return (
    <div className="traveler-stack itinerary-page">
      <div className="traveler-desktop-heading">
        <Heading
          title="Updated itinerary"
          subtitle="Berlin Offsite · Oct 13–15"
        />
      </div>
      <div className="confirmed-banner">
        <span className="confirmation-check">
          <Check size={23} />
        </span>
        <div>
          <strong>Replacement confirmed</strong>
          <p>Changed steps highlighted · Meeting unaffected</p>
        </div>
        <Badge tone="success">Updated</Badge>
      </div>
      <div className="between">
        <h2>Tuesday, October 13</h2>
        <small className="muted">Local time</small>
      </div>
      <section className="itinerary-timeline" aria-label="Travel itinerary">
        {itinerary.map((item) => {
          const Icon = timelineIcons[item.icon];
          return (
            <div
              key={item.time}
              className={cn("timeline-row", item.changed && "changed")}
            >
              <time>{item.time}</time>
              <span className="timeline-marker">
                <Icon size={14} />
              </span>
              <div>
                <div className="between">
                  <strong>{item.title}</strong>
                  {item.changed && (
                    <span className="changed-label">Changed</span>
                  )}
                </div>
                <small>{item.detail}</small>
              </div>
            </div>
          );
        })}
      </section>
      <Button
        variant="outline"
        className="full-width"
        onClick={downloadCalendar}
      >
        <CalendarPlus size={18} />
        {exported ? "Download calendar again" : "Add itinerary to calendar"}
      </Button>
      {exported && (
        <p role="status" className="success-text small">
          Calendar file downloaded.
        </p>
      )}
    </div>
  );
}

const answers: Record<string, { question: string; answer: string }> = {
  flight: {
    question: "What's the latest on my Berlin flight?",
    answer:
      "Your original flight AF1234 was cancelled. The replacement route is Paris → Frankfurt → Berlin, arriving at 17:20. Your meeting is unaffected.",
  },
  hotel: {
    question: "When can I check in at the hotel?",
    answer:
      "Check-in at Motel One Alexanderplatz starts at 15:00. Your updated itinerary has you arriving at 18:10. Booking reference: TM-8821.",
  },
  transfer: {
    question: "Where is my airport transfer?",
    answer:
      "Your driver will meet you at arrivals in BER Terminal 1 after your 17:20 arrival. The transfer is included in booking TM-8821.",
  },
  policy: {
    question: "What happens if my flight is cancelled?",
    answer:
      "The selected itinerary includes a replacement via Frankfurt. The additional cost is covered by the company. Economy flights and a hotel under €180 per night comply with the Acme Europe policy.",
  },
  itinerary: {
    question: "Review my itinerary",
    answer:
      "Leave the office at 11:55, reach Charles de Gaulle at 12:40, and depart for Frankfurt at 13:35. Arrive in Berlin at 17:20 and at your hotel at 18:10. Your team meeting is Wednesday at 09:00.",
  },
};

export function Assistant() {
  const [messages, setMessages] = useState<
    { question: string; answer: string }[]
  >([]);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const topic = new URLSearchParams(window.location.search).get("topic");
    if (topic && answers[topic]) setMessages([answers[topic]]);
  }, []);
  useEffect(() => {
    if (messages.length) endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!input.trim()) return;
    const topic = /hotel|check.?in/i.test(input)
      ? "hotel"
      : /transfer|driver|car/i.test(input)
        ? "transfer"
        : /policy|cancel|refund/i.test(input)
          ? "policy"
          : /itinerary|meeting/i.test(input)
            ? "itinerary"
            : /flight|gate|board|delay/i.test(input)
              ? "flight"
              : null;
    setMessages((previous) => [
      ...previous,
      {
        question: input.trim(),
        answer: topic
          ? answers[topic].answer
          : "I can show the saved flight, hotel, transfer, and policy details for your Berlin trip. Live assistance is not connected yet.",
      },
    ]);
    setInput("");
  }
  return (
    <div className="assistant-page">
      <div className="traveler-desktop-heading">
        <Heading title="Assistant" subtitle="Ready when you are" />
      </div>
      <section className="surface assistant-welcome">
        <div>
          <small className="uppercase">Trip support</small>
          <h2>Good morning, Maya.</h2>
          <p>
            I can help with flight status, itinerary changes, transport, hotel
            details, and any travel questions before you leave.
          </p>
        </div>
        <span className="assistant-symbol">
          <Sparkles size={25} strokeWidth={1.4} />
        </span>
      </section>
      <div className="assistant-topics">
        <div className="section-heading">
          <h2>Ask about your trip</h2>
          <span className="muted">Tap to start</span>
        </div>
        {[
          {
            icon: ListTodo,
            title: "Check flight status",
            description: "See delays, gate changes, and boarding updates",
            topic: "flight",
          },
          {
            icon: FilePenLine,
            title: "Review itinerary",
            description:
              "See flights, transport, and hotel details in one place",
            topic: "itinerary",
          },
          {
            icon: Lightbulb,
            title: "Disruptions & policy",
            description:
              "Ask about cancellations, refunds, and rebooking rules",
            topic: "policy",
          },
        ].map((item) => (
          <button
            className="topic-button"
            key={item.topic}
            onClick={() =>
              setMessages((previous) => [...previous, answers[item.topic]])
            }
          >
            <span className="topic-icon">
              <item.icon size={21} strokeWidth={1.4} />
            </span>
            <span>
              <strong>{item.title}</strong>
              <small>{item.description}</small>
            </span>
            <ChevronRight size={18} />
          </button>
        ))}
      </div>
      <div className="conversation" aria-live="polite">
        {messages.map((message, i) => (
          <div key={i} className="conversation-pair">
            <p className="user-message">{message.question}</p>
            <div className="assistant-message">
              <Bot size={18} />
              <div>
                <p>{message.answer}</p>
                <Link href="/itinerary">
                  View itinerary <ArrowRight size={14} />
                </Link>
              </div>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form className="assistant-composer" onSubmit={submit}>
        <Button
          type="button"
          variant="outline"
          size="icon"
          title="Type your question"
          aria-label="Focus question input"
          onClick={() => inputRef.current?.focus()}
        >
          <Mic size={20} />
        </Button>
        <input
          ref={inputRef}
          aria-label="Ask Travel Manager"
          placeholder="Ask about flights, transport, hotel, or policy"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <Button
          type="submit"
          size="icon"
          aria-label="Send question"
          title="Send question"
          disabled={!input.trim()}
        >
          <ArrowUp size={22} />
        </Button>
      </form>
    </div>
  );
}

export function Profile() {
  const [saved, setSaved] = useState(false);
  const [seat, setSeat] = useState("aisle");
  const [notify, setNotify] = useState(true);
  useEffect(() => {
    try {
      const stored = JSON.parse(
        localStorage.getItem("travel-manager-preferences") ?? "null",
      );
      if (stored && ["aisle", "window", "none"].includes(stored.seat)) {
        setSeat(stored.seat);
        setNotify(Boolean(stored.notify));
      }
    } catch {}
  }, []);
  return (
    <div className="traveler-stack">
      <div className="person profile-person">
        <Avatar size="lg">
          <UserRound size={28} />
        </Avatar>
        <div>
          <h1>Alex Morgan</h1>
          <p className="muted">Acme Europe · Business plan</p>
        </div>
      </div>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            localStorage.setItem(
              "travel-manager-preferences",
              JSON.stringify({ seat, notify }),
            );
            setSaved(true);
          } catch {
            setSaved(false);
          }
        }}
      >
        <label>
          Seat preference
          <select
            value={seat}
            onChange={(event) => {
              setSeat(event.target.value);
              setSaved(false);
            }}
          >
            <option value="aisle">Aisle</option>
            <option value="window">Window</option>
            <option value="none">No preference</option>
          </select>
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={notify}
            onChange={(event) => {
              setNotify(event.target.checked);
              setSaved(false);
            }}
          />
          <Bell size={17} />
          Trip notifications
        </label>
        <Button type="submit">Save preferences</Button>
        {saved && (
          <p className="success-text" role="status">
            Preferences saved on this device.
          </p>
        )}
      </form>
      <div className="profile-links">
        <Link href="/trips">
          Team trips
          <ChevronRight size={17} />
        </Link>
        <Link href="/policies">
          Company travel policy
          <ChevronRight size={17} />
        </Link>
        <Link href="/design-system">
          Shared UI
          <ChevronRight size={17} />
        </Link>
      </div>
    </div>
  );
}
