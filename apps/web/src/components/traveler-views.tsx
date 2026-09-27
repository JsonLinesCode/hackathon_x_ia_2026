"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  ArrowUp,
  Bot,
  Building2,
  CalendarClock,
  CalendarPlus,
  CarFront,
  ChevronRight,
  FilePenLine,
  Lightbulb,
  ListTodo,
  Mic,
  Plane,
  Route,
  Sparkles,
} from "lucide-react";
import { Avatar, Badge } from "@repo/ui";
import { Button } from "@repo/ui/button";
import { itineraryEvents, calendarFile } from "@repo/core";
import { useTrip, dateTime } from "@/lib/trip-client";
import { itinerary as demoItinerary } from "@/lib/travel-data";
import { TripLoading } from "./trip-workspace";
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

export { ManagedDisruptions as Disruptions } from "./disruption-workspace";

export function Itinerary({ tripId }: { tripId: string }) {
  const { data, error } = useTrip(tripId);
  const [exported, setExported] = useState(false);
  if (!data) return <TripLoading error={error} />;
  const events = itineraryEvents(data.bookings, data.trip.meeting);
  const timezone = data.trip.meeting?.timezone || "Europe/Paris";
  function downloadCalendar() {
    const url = URL.createObjectURL(new Blob([calendarFile(tripId, events, new Date())], { type: "text/calendar;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = "trip-" + tripId + ".ics";
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExported(true);
  }
  return <div className="traveler-stack itinerary-page">
    <div className="traveler-desktop-heading"><Heading title="Travel itinerary" subtitle={data.trip.title + " · " + timezone}>
      <Button asChild variant="outline"><Link href={"/trips/" + tripId}>Back to plan</Link></Button></Heading></div>
    {error && <p role="alert" className="inline-alert tone-danger">{error}</p>}
    <div className="confirmed-banner"><span className="confirmation-check"><CalendarClock size={23} /></span><div>
      <strong>{data.bookings.length ? "Quotes prepared" : "No travel quotes yet"}</strong><p>Payment and booking confirmation remain to be completed with Jinko.</p></div><Badge tone="warning">Unpaid</Badge></div>
    {!data.bookings.length ? <p className="surface empty-state">Approve your selected plan to prepare flight and hotel quotes.</p> : <>
      <div className="between"><h2>Your travel plan</h2><small className="muted">{timezone}</small></div>
      <section className="itinerary-timeline" aria-label="Travel itinerary">
        {events.map((item) => <div key={item.id} className="timeline-row"><time>{item.allDay ? item.start + " – " + item.end : dateTime(item.start, timezone)}</time>
          <span className="timeline-marker">{item.allDay ? <Building2 size={14} /> : <Plane size={14} />}</span><div>
            <div className="between"><strong>{item.title}</strong><Badge tone="neutral">{item.tentative ? "Tentative" : "Confirmed"}</Badge></div>
            <small>{item.location}</small>
            {!item.allDay && <small>Ends {dateTime(item.end, timezone)}</small>}
          </div></div>)}
      </section>
      <Button variant="outline" className="full-width" onClick={downloadCalendar}><CalendarPlus size={18} />{exported ? "Download calendar again" : "Export itinerary (.ics)"}</Button>
      {exported && <p role="status" className="success-text small">Calendar file downloaded. Unpaid quotes are marked tentative.</p>}
    </>}
  </div>;
}

function DemoTimelineIcon({ kind }: { kind: string }) {
  const Icon = kind === "car" ? CarFront
    : kind === "hotel" ? Building2
      : kind === "users" ? ListTodo
        : kind === "route" ? Route
          : kind === "pin" ? CalendarClock
            : Plane;
  return <Icon size={14} />;
}

export function DemoItinerary() {
  return <div className="traveler-stack itinerary-page">
    <div className="traveler-desktop-heading"><Heading title="Berlin itinerary" subtitle="Alice Martin · Demo traveler access" /></div>
    <div className="confirmed-banner"><span className="confirmation-check"><CalendarClock size={23} /></span><div>
      <strong>Updated route ready</strong><p>Your replacement flight via Frankfurt keeps the Wednesday meeting safe.</p></div><Badge tone="warning">Demo</Badge></div>
    <div className="between"><h2>Your travel plan</h2><small className="muted">Europe/Berlin</small></div>
    <section className="itinerary-timeline" aria-label="Demo travel itinerary">
      {demoItinerary.map((item) => <div key={item.time + item.title} className={"timeline-row" + (item.changed ? " changed" : "")}>
        <time>{item.time}</time>
        <span className="timeline-marker"><DemoTimelineIcon kind={item.icon} /></span>
        <div>
          <div className="between"><strong>{item.title}</strong><Badge tone={item.changed ? "warning" : "neutral"}>{item.changed ? "Updated" : "Confirmed"}</Badge></div>
          <small>{item.detail}</small>
        </div>
      </div>)}
    </section>
    <Button asChild variant="outline" className="full-width"><Link href="/my-trip"><ArrowRight size={18} />Back to trip home</Link></Button>
  </div>;
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
