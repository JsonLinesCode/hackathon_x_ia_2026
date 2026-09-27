"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import {
  Building2,
  CalendarCheck,
  Check,
  CircleDollarSign,
  Clock3,
  FastForward,
  Hotel,
  LayoutDashboard,
  Pause,
  Play,
  Plane,
  RefreshCw,
  Rewind,
  Route,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Users,
} from "lucide-react";
import { Avatar, Badge } from "@repo/ui";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/utils";

type DemoSceneId =
  | "intro"
  | "trip-request"
  | "understanding"
  | "checking-calendars"
  | "searching-travel"
  | "checking-policy"
  | "optimizing"
  | "optimized-plan"
  | "mobile-itinerary"
  | "disruption"
  | "replanning"
  | "updated-plan"
  | "mobile-updated"
  | "outro";

type DemoScene = {
  id: DemoSceneId;
  label: string;
  duration: number;
  next: DemoSceneId | null;
};

const scenes: DemoScene[] = [
  { id: "intro", label: "Intro", duration: 4500, next: "trip-request" },
  { id: "trip-request", label: "Trip request", duration: 6500, next: "understanding" },
  { id: "understanding", label: "Understanding", duration: 5500, next: "checking-calendars" },
  { id: "checking-calendars", label: "Checking calendars", duration: 5500, next: "searching-travel" },
  { id: "searching-travel", label: "Searching travel", duration: 5500, next: "checking-policy" },
  { id: "checking-policy", label: "Checking policy", duration: 5000, next: "optimizing" },
  { id: "optimizing", label: "Optimizing", duration: 6000, next: "optimized-plan" },
  { id: "optimized-plan", label: "Optimized plan", duration: 8000, next: "mobile-itinerary" },
  { id: "mobile-itinerary", label: "Mobile itinerary", duration: 6500, next: "disruption" },
  { id: "disruption", label: "Disruption", duration: 5500, next: "replanning" },
  { id: "replanning", label: "Replanning", duration: 6500, next: "updated-plan" },
  { id: "updated-plan", label: "Updated plan", duration: 7000, next: "mobile-updated" },
  { id: "mobile-updated", label: "Mobile updated", duration: 6000, next: "outro" },
  { id: "outro", label: "Outro", duration: 5000, next: null },
];

const sceneIndex = new Map(scenes.map((scene, index) => [scene.id, index]));
const requestText =
  "Organize the Berlin Operations Summit for Alice, Marc and Sarah. Everyone must arrive before Tuesday 18:00. The main meeting is Wednesday from 09:00 to 17:00. Return Thursday. Total target budget is EUR 2,500.";

const travelers = [
  {
    name: "Alice Martin",
    initials: "AM",
    role: "Product Manager",
    city: "Paris",
    airport: "CDG",
    available: "After 14:30 Tuesday",
    route: "Paris -> Berlin",
    time: "14:55 -> 16:40",
    seat: "Window",
    cost: 486,
    calendarUrl: "https://calendar.google.com/calendar/u/4?cid=YWxpY2UubWFydGluLmRlbW9jcm91dGVAZ21haWwuY29t",
  },
  {
    name: "Marc Evans",
    initials: "ME",
    role: "Sales Manager",
    city: "London",
    airport: "LHR",
    available: "After 12:00 Tuesday",
    route: "London -> Berlin",
    time: "13:10 -> 16:00",
    seat: "Aisle",
    cost: 552,
    calendarUrl: "https://calendar.google.com/calendar/u/7?cid=bWFyYy5ldmFucy5kZW1vY3JvdXRlQGdtYWlsLmNvbQ",
  },
  {
    name: "Sarah Garcia",
    initials: "SG",
    role: "Marketing Manager",
    city: "Madrid",
    airport: "MAD",
    available: "After 13:00 Tuesday",
    route: "Madrid -> Berlin",
    time: "13:40 -> 16:35",
    seat: "Checked bag",
    cost: 594,
    calendarUrl: "https://calendar.google.com/calendar/u/5?cid=c2FyYWguZ2FyY2lhLmRlbW9jcm91dGVAZ21haWwuY29t",
  },
];

const managerCalendar = {
  name: "Emma Laurent",
  calendarUrl: "https://calendar.google.com/calendar/u/3?cid=ZW1tYS5sYXVyZW50LmRlbW9jcm91dGVAZ21haWwuY29t",
};

const workflow = [
  { key: "calendars", label: "Calendars", icon: CalendarCheck },
  { key: "travel", label: "Travel", icon: Plane },
  { key: "policy", label: "Policy", icon: ShieldCheck },
  { key: "optimizer", label: "Optimizer", icon: Route },
];

const motionEase = "easeOut" as const;
const sceneVariants: Variants = {
  initial: { opacity: 0, y: 26, scale: 0.985, filter: "blur(8px)" },
  animate: { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" },
  exit: { opacity: 0, y: -18, scale: 1.01, filter: "blur(7px)" },
};
const shellVariants: Variants = {
  initial: { opacity: 0, y: 28, scale: 0.96 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.52, ease: motionEase, staggerChildren: 0.08, delayChildren: 0.1 } },
};
const interfacePieceVariants: Variants = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.42, ease: motionEase } },
};
const cardVariants: Variants = {
  initial: { opacity: 0, y: 18, scale: 0.97 },
  animate: (index = 0) => ({ opacity: 1, y: 0, scale: 1, transition: { delay: Number(index) * 0.13, duration: 0.38, ease: motionEase } }),
};

export function DemoShowcase({ clean = false }: { clean?: boolean }) {
  const reducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [autoplay, setAutoplay] = useState(true);
  const [controlsOpen, setControlsOpen] = useState(!clean);
  const scene = scenes[index];
  const totalDuration = useMemo(() => scenes.reduce((sum, item) => sum + item.duration, 0), []);
  const completedDuration = useMemo(() => scenes.slice(0, index).reduce((sum, item) => sum + item.duration, 0), [index]);
  const overallProgress = Math.min(100, ((completedDuration + elapsed) / totalDuration) * 100);
  const sceneProgress = Math.min(100, (elapsed / scene.duration) * 100);

  const goTo = useCallback((nextIndex: number) => {
    const bounded = Math.max(0, Math.min(scenes.length - 1, nextIndex));
    setIndex(bounded);
    setElapsed(0);
  }, []);

  const next = useCallback(() => {
    const nextId = scene.next;
    if (!nextId) {
      setPlaying(false);
      return;
    }
    goTo(sceneIndex.get(nextId) ?? index + 1);
  }, [goTo, index, scene.next]);

  const restart = useCallback(() => {
    goTo(0);
    setPlaying(true);
  }, [goTo]);

  useEffect(() => {
    if (!playing || !autoplay) return;
    const started = performance.now() - elapsed;
    const timer = window.setInterval(() => {
      const nextElapsed = performance.now() - started;
      if (nextElapsed >= scene.duration) {
        setElapsed(scene.duration);
        window.clearInterval(timer);
        window.setTimeout(next, reducedMotion ? 0 : 80);
      } else {
        setElapsed(nextElapsed);
      }
    }, 80);
    return () => window.clearInterval(timer);
  }, [autoplay, elapsed, index, next, playing, reducedMotion, scene.duration]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.code === "Space") {
        event.preventDefault();
        setPlaying((value) => !value);
      }
      if (event.key === "ArrowRight") next();
      if (event.key === "ArrowLeft") goTo(index - 1);
      if (event.key.toLowerCase() === "r") restart();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  });

  return (
    <main className={cn("demo-page", clean && "demo-page-clean")}>
      <div className="demo-progress" aria-hidden="true">
        <motion.span animate={{ width: overallProgress + "%" }} transition={{ duration: reducedMotion ? 0 : 0.2 }} />
      </div>
      <AnimatePresence mode="wait">
        <motion.section
          key={scene.id}
          className="demo-stage"
          variants={sceneVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{ duration: reducedMotion ? 0 : 0.32, ease: "easeOut" }}
        >
          <SceneContent scene={scene} sceneProgress={sceneProgress} />
        </motion.section>
      </AnimatePresence>
      {!clean && (
        <div className={cn("demo-controller", !controlsOpen && "collapsed")}>
          <button className="demo-controller-tab" type="button" onClick={() => setControlsOpen((value) => !value)}>
            {controlsOpen ? "Hide controls" : "Show controls"}
          </button>
          {controlsOpen && (
            <>
              <div>
                <strong>{scene.label}</strong>
                <small>{index + 1} / {scenes.length}</small>
              </div>
              <div className="demo-control-row">
                <Button size="sm" variant="outline" onClick={restart}><RefreshCw size={15} />Restart</Button>
                <Button size="sm" variant="outline" onClick={() => goTo(index - 1)} disabled={index === 0}><Rewind size={15} />Previous</Button>
                <Button size="sm" onClick={() => setPlaying((value) => !value)}>{playing ? <Pause size={15} /> : <Play size={15} />}{playing ? "Pause" : "Resume"}</Button>
                <Button size="sm" variant="outline" onClick={next} disabled={!scene.next}><FastForward size={15} />Next</Button>
              </div>
              <label className="demo-toggle">
                <input type="checkbox" checked={autoplay} onChange={(event) => setAutoplay(event.target.checked)} />
                Autoplay
              </label>
              <small className="muted">Space play/pause · arrows change scene · R restarts</small>
            </>
          )}
        </div>
      )}
    </main>
  );
}

function SceneContent({ scene, sceneProgress }: { scene: DemoScene; sceneProgress: number }) {
  switch (scene.id) {
    case "intro":
      return <IntroScene />;
    case "trip-request":
      return <TripRequestScene sceneProgress={sceneProgress} />;
    case "understanding":
      return <UnderstandingScene />;
    case "checking-calendars":
      return <WorkflowScene title="Checking traveler calendars" subtitle="Availability from the mock Google accounts" active="calendars" rows={travelers.map((t) => [t.name, t.available])} />;
    case "searching-travel":
      return <TravelSearchScene />;
    case "checking-policy":
      return <PolicyScene />;
    case "optimizing":
      return <OptimizingScene />;
    case "optimized-plan":
      return <OptimizedPlanScene />;
    case "mobile-itinerary":
      return <MobileScene updated={false} />;
    case "disruption":
      return <DisruptionScene />;
    case "replanning":
      return <WorkflowScene title="Recovering the trip" subtitle="The same controls run again with the disruption context" active="travel" rows={[["Searching alternatives", "Paris -> Frankfurt -> Berlin"], ["Checking policy", "Economy fare · budget remaining"], ["Recalculating arrival", "17:20 Tuesday"], ["Meeting impact", "Unaffected"]]} recovery />;
    case "updated-plan":
      return <UpdatedPlanScene />;
    case "mobile-updated":
      return <MobileScene updated />;
    case "outro":
      return <OutroScene />;
  }
}

function IntroScene() {
  const modules = ["Calendar", "Policy", "Jinko", "Gmail"];
  return (
    <div className="demo-intro">
      <div className="demo-orbit" aria-hidden="true">
        {modules.map((item, index) => <motion.span key={item} className={"demo-orbit-pill pill-" + index} initial={{ opacity: 0, scale: 0.82, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ delay: 0.24 + index * 0.12, duration: 0.42 }}>{item}</motion.span>)}
        <motion.span className="brand-mark" initial={{ scale: 0.78, opacity: 0, rotate: -10 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ duration: 0.52, ease: "easeOut" }}>
          <Route size={24} />
        </motion.span>
      </div>
      <motion.h1 initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16, duration: 0.42 }}>Travel Manager</motion.h1>
      <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.34, duration: 0.42 }}>Get everyone there. Whatever happens.</motion.p>
    </div>
  );
}

function DemoShell({ children, label = "Travel overview" }: { children: React.ReactNode; label?: string }) {
  return (
    <motion.div className="demo-app-frame" variants={shellVariants} initial="initial" animate="animate">
      <div className="demo-frame-glow" aria-hidden="true" />
      <motion.div className="demo-interface-grid" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.18, duration: 0.45 }}>
        <span />
        <span />
        <span />
      </motion.div>
      <motion.aside className="demo-sidebar" variants={interfacePieceVariants}>
        <motion.div className="brand" variants={interfacePieceVariants}><span className="brand-mark"><Route size={17} /></span><span>Travel Manager</span></motion.div>
        {[
          ["Overview", LayoutDashboard],
          ["Trips", Plane],
          ["Travelers", Users],
          ["Policies", ShieldCheck],
          ["Disruptions", TriangleAlert],
        ].map(([item, Icon]) => {
          const RealIcon = Icon as typeof LayoutDashboard;
          return <motion.div className={cn("demo-nav-item", item === "Trips" && "active")} key={String(item)} variants={interfacePieceVariants}><RealIcon size={16} /><span>{String(item)}</span></motion.div>;
        })}
        <motion.div className="coordinator-status" variants={interfacePieceVariants}><span className="status-dot" />AI coordinator online</motion.div>
      </motion.aside>
      <motion.div className="demo-workspace" variants={interfacePieceVariants}>
        <motion.header className="desktop-header demo-header" variants={interfacePieceVariants}>
          <span>{label}</span>
          <div className="topbar-actions"><Badge tone="success">Demo data</Badge><Avatar size="sm">EL</Avatar></div>
        </motion.header>
        <motion.div className="demo-main" variants={interfacePieceVariants}>{children}</motion.div>
      </motion.div>
    </motion.div>
  );
}

function TripRequestScene({ sceneProgress }: { sceneProgress: number }) {
  const visibleLength = Math.max(34, Math.floor((sceneProgress / 100) * requestText.length));
  const visibleText = requestText.slice(0, visibleLength);
  return (
    <DemoShell label="Trips / Create trip">
      <div className="demo-two-column">
        <motion.section className="request-box demo-request" variants={cardVariants} custom={0} initial="initial" animate="animate">
          <span className="demo-composer-sheen" aria-hidden="true" />
          <div className="section-heading">
            <div className="inline-detail"><span className="icon-box tone-primary"><Sparkles size={16} /></span><strong>Ask Travel Manager</strong></div>
            <Badge>Emma Laurent</Badge>
          </div>
          <p>{visibleText}<motion.span animate={{ opacity: [0, 1, 0] }} transition={{ repeat: Infinity, duration: 1 }}>|</motion.span></p>
          <div className="request-footer"><span>Natural-language request · Berlin Operations Summit</span></div>
        </motion.section>
        <motion.section className="surface demo-trip-summary" variants={cardVariants} custom={1} initial="initial" animate="animate">
          <h2>Northstar Labs</h2>
          <p className="muted">Emma coordinates Alice, Marc and Sarah across three origin cities.</p>
          <div className="demo-mini-grid">
            <Metric icon={Users} label="Travelers" value="3" />
            <Metric icon={Clock3} label="Deadline" value="Tue 18:00" />
            <Metric icon={CircleDollarSign} label="Budget" value="EUR 2,500" />
          </div>
          <div className="demo-calendar-links" aria-label="Public demo calendars">
            {[managerCalendar, ...travelers].map((person) => (
              <a key={person.name} href={person.calendarUrl} target="_blank" rel="noreferrer">
                <CalendarCheck size={14} />
                <span>{person.name}</span>
              </a>
            ))}
          </div>
          <Button className="demo-plan-button"><Sparkles size={16} />Plan trip</Button>
        </motion.section>
      </div>
    </DemoShell>
  );
}

function UnderstandingScene() {
  const items = [
    ["Destination", "Berlin"],
    ["Travelers", "Alice, Marc, Sarah"],
    ["Arrival deadline", "Tuesday before 18:00"],
    ["Budget", "EUR 2,500 total"],
    ["Meeting", "Q4 Europe Operations Summit · Wed 09:00"],
  ];
  return (
    <DemoShell label="Trips / Planning">
      <DemoHeading title="Understanding the request" subtitle="The agent turns Emma's request into structured trip requirements." />
      <div className="demo-checklist">
        {items.map(([label, value], index) => <AnimatedCheck key={label} label={label} value={value} delay={index * 0.16} />)}
      </div>
    </DemoShell>
  );
}

function WorkflowScene({ title, subtitle, active, rows, recovery = false }: { title: string; subtitle: string; active: string; rows: string[][]; recovery?: boolean }) {
  return (
    <DemoShell label={recovery ? "Disruptions / Recovery" : "Trips / Planning"}>
      <DemoHeading title={title} subtitle={subtitle} tone={recovery ? "warning" : "primary"} />
      <motion.section className="workflow-surface demo-workflow" variants={cardVariants} initial="initial" animate="animate">
        <div className="coordinator-card"><span className="coordinator-icon"><Sparkles size={25} /></span><div><small>Travel AI coordinator</small><p>{recovery ? "Recovering the affected itinerary" : "Coordinating calendars, travel and policy"}</p></div><span className="live-label"><span className="status-dot" />Running</span></div>
        <div className="workflow-nodes">
          {workflow.map(({ key, label, icon: Icon }, index) => (
            <motion.div className={cn("workflow-node", key === active && "selected")} key={key} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.12 }}>
              <span className={cn("icon-box", key === active ? "tone-primary" : "tone-success")}><Icon size={16} /></span>
              <span><strong>{label}</strong><small>{key === active ? "In progress" : index < (sceneOrder(active)) ? "Complete" : "Queued"}</small></span>
            </motion.div>
          ))}
        </div>
        <div className="workflow-caption"><span>Berlin Operations Summit</span><span>3 travelers</span></div>
      </motion.section>
      <div className="demo-status-list">
        {rows.map(([name, detail], index) => <AnimatedCheck key={name} label={name} value={detail} delay={0.2 + index * 0.18} />)}
      </div>
    </DemoShell>
  );
}

function sceneOrder(active: string) {
  return workflow.findIndex((item) => item.key === active);
}

function TravelSearchScene() {
  return (
    <DemoShell label="Trips / Planning">
      <DemoHeading title="Searching travel options" subtitle="Flights and hotel inventory are compared against the meeting deadline." />
      <div className="demo-route-grid">
        {travelers.map((person, index) => <motion.section className="surface demo-route-card" key={person.name} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.16 }}>
          <div className="between"><Avatar>{person.initials}</Avatar><Badge tone="primary">Searching</Badge></div>
          <h2>{person.name}</h2>
          <div className="flight-route">
            <div><strong>{person.airport}</strong><small>{person.city}</small></div>
            <AnimatedRouteLine label="Direct preferred" delay={0.28 + index * 0.12} />
            <div><strong>BER</strong><small>Berlin</small></div>
          </div>
          <motion.div className="demo-scan-bar" initial={{ width: "22%" }} animate={{ width: "100%" }} transition={{ duration: 1.6, repeat: Infinity, repeatType: "reverse" }} />
        </motion.section>)}
      </div>
    </DemoShell>
  );
}

function PolicyScene() {
  return (
    <DemoShell label="Trips / Policy">
      <DemoHeading title="Checking company policy" subtitle="Deterministic rules evaluate every candidate before Emma sees a recommendation." />
      <div className="demo-checklist">
        {[
          ["Economy required under 6h", "All selected flights are economy"],
          ["Hotel <= EUR 180 / night", "Motel One Berlin Alexanderplatz · EUR 164"],
          ["Arrival before deadline", "All travelers arrive before Tuesday 18:00"],
          ["Manager approval required for paid action", "Quote approvals stay gated"],
        ].map(([label, value], index) => <AnimatedCheck key={label} label={label} value={value} delay={index * 0.15} />)}
      </div>
    </DemoShell>
  );
}

function OptimizingScene() {
  const bundles = [
    ["Cheapest", "EUR 2,040", "More connection risk", 78],
    ["Balanced", "EUR 2,180", "Best cost + arrival margin", 94],
    ["Most flexible", "EUR 2,410", "Higher fare flexibility", 86],
  ] as const;
  return (
    <DemoShell label="Trips / Optimizer">
      <DemoHeading title="Ranking candidate bundles" subtitle="The balanced plan wins on cost, arrival time and lost work hours." />
      <div className="demo-bundle-grid">
        {bundles.map(([name, price, detail, score], index) => <motion.section className={cn("surface demo-bundle", name === "Balanced" && "selected")} key={name} initial={{ opacity: 0, y: 14, rotateX: 7 }} animate={{ opacity: 1, y: 0, rotateX: 0 }} transition={{ delay: index * 0.16, duration: 0.42 }}>
          <div className="between"><h2>{name}</h2>{name === "Balanced" && <Badge tone="success">Recommended</Badge>}</div>
          <strong>{price}</strong>
          <p className="muted">{detail}</p>
          <div className="demo-score"><motion.span initial={{ width: 0 }} animate={{ width: score + "%" }} transition={{ delay: 0.35 + index * 0.12, duration: 0.55 }} /></div>
          <small>Fit score {score}</small>
        </motion.section>)}
      </div>
    </DemoShell>
  );
}

function OptimizedPlanScene() {
  return (
    <DemoShell label="Trips / Travel plan">
      <DemoHeading title="Recommended team plan" subtitle="Balanced for cost, arrival time and lost work hours." />
      <div className="plan-metrics">
        <Metric icon={CircleDollarSign} label="Total" value="EUR 2,180" />
        <Metric icon={CircleDollarSign} label="Budget remaining" value="EUR 320" />
        <Metric icon={ShieldCheck} label="Policy violations" value="0" />
        <Metric icon={Hotel} label="Hotel" value="Motel One" />
      </div>
      <div className="demo-plan-grid">
        {travelers.map((person, index) => <TravelerPlanCard key={person.name} person={person} delay={index * 0.14} />)}
      </div>
    </DemoShell>
  );
}

function MobileScene({ updated }: { updated: boolean }) {
  return (
    <div className="demo-mobile-wrap">
      <div className="demo-mobile-caption">
        <Badge tone={updated ? "warning" : "success"}>{updated ? "Updated itinerary" : "Traveler view"}</Badge>
        <h1>{updated ? "Alice stays informed automatically." : "Alice receives a clear mobile itinerary."}</h1>
        <p>{updated ? "The affected flight is replaced, and the meeting remains safe." : "No dashboard login required for travelers."}</p>
      </div>
      <motion.div className="demo-phone" initial={{ opacity: 0, x: 34, rotate: 1.8, scale: 0.96 }} animate={{ opacity: 1, x: 0, rotate: 0, scale: 1 }} transition={{ duration: 0.48, ease: "easeOut" }}>
        <div className="demo-phone-bar" />
        <motion.section className="surface welcome-panel" variants={cardVariants} custom={0} initial="initial" animate="animate">
          <div className="welcome-copy"><div><small className="uppercase">Good morning</small><h2>Hello, Alice</h2><p>{updated ? "Your new route is confirmed for review." : "Your Berlin trip is ready."}</p></div><Avatar>AM</Avatar></div>
        </motion.section>
        <motion.div className={cn("flight-card", updated && "demo-flight-updated")} variants={cardVariants} custom={1} initial="initial" animate="animate">
          <div className="between"><span className="uppercase">{updated ? "Replacement route" : "Outbound flight"}</span><Badge tone={updated ? "warning" : "success"}>{updated ? "Updated" : "On time"}</Badge></div>
          <div className="flight-route"><div><strong>CDG</strong><small>Paris</small></div><AnimatedRouteLine label={updated ? "via FRA" : "Direct · 1h45"} delay={0.38} iconSize={21} warning={updated} /><div><strong>BER</strong><small>Berlin</small></div></div>
          <div className="flight-facts"><div><small>Departure</small><strong>{updated ? "13:35" : "14:55"}</strong></div><div><small>Arrival</small><strong>{updated ? "17:20" : "16:40"}</strong></div><div><small>Seat</small><strong>{updated ? "14C" : "12A"}</strong></div></div>
        </motion.div>
        <motion.section className="surface glance-panel" variants={cardVariants} custom={2} initial="initial" animate="animate">
          <h2>Your trip at a glance</h2>
          <MobileRow icon={Building2} title="Hotel" value="Motel One Alexanderplatz" detail="Check-in from 15:00" />
          <MobileRow icon={CalendarCheck} title="Meeting" value="Wed · 09:00" detail="Alexanderplatz, Berlin" />
          <MobileRow icon={Route} title={updated ? "Recovery" : "Route"} value={updated ? "Meeting unaffected" : "Direct flight"} detail={updated ? "+EUR 67 · within policy" : "Arrival before 18:00"} />
        </motion.section>
      </motion.div>
    </div>
  );
}

function DisruptionScene() {
  return (
    <DemoShell label="Disruptions">
      <div className="demo-disruption-layout">
        <motion.section className="surface demo-alert-panel" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.38 }}>
          <div className="inline-detail"><span className="icon-box tone-warning"><TriangleAlert size={16} /></span><strong>Flight cancelled</strong></div>
          <h1>Alice&apos;s outbound flight is affected.</h1>
          <p className="muted">The agent detects the carrier notice and opens a recovery workflow before the meeting is at risk.</p>
        </motion.section>
        <motion.section className="surface demo-cancelled-flight" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}>
          <div className="between"><Badge tone="warning">Cancelled</Badge><small>AF 1734</small></div>
          <div className="flight-route"><div><strong>CDG</strong><small>Paris</small></div><AnimatedRouteLine label="Original" delay={0.34} /><div><strong>BER</strong><small>Berlin</small></div></div>
          <motion.div className="demo-strike" initial={{ clipPath: "inset(0 100% 0 0)" }} animate={{ clipPath: "inset(0 0% 0 0)" }} transition={{ delay: 0.62, duration: 0.36 }} />
        </motion.section>
      </div>
    </DemoShell>
  );
}

function UpdatedPlanScene() {
  return (
    <DemoShell label="Disruptions / Replacement">
      <DemoHeading title="Replacement proposed" subtitle="The new plan stays within timing and policy constraints." tone="warning" />
      <div className="demo-update-grid">
        <motion.section className="surface demo-original" initial={{ opacity: 0, x: -22 }} animate={{ opacity: 0.72, x: 0 }} transition={{ duration: 0.36 }}>
          <Badge tone="warning">Original</Badge>
          <h2>{"Paris -> Berlin"}</h2>
          <p>AF 1734 · Cancelled</p>
        </motion.section>
        <motion.section className="surface demo-replacement" initial={{ opacity: 0, x: 30, scale: 0.97 }} animate={{ opacity: 1, x: 0, scale: 1 }} transition={{ delay: 0.22, duration: 0.42 }}>
          <Badge tone="success">Replacement</Badge>
          <h2>{"Paris -> Frankfurt -> Berlin"}</h2>
          <p>Arrival: 17:20 · Additional cost: +EUR 67</p>
        </motion.section>
      </div>
      <div className="demo-status-list compact">
        <AnimatedCheck label="Policy" value="Within policy" delay={0.05} />
        <AnimatedCheck label="Budget" value="EUR 253 remaining" delay={0.2} />
        <AnimatedCheck label="Meeting" value="Unaffected" delay={0.35} />
      </div>
    </DemoShell>
  );
}

function OutroScene() {
  return (
    <div className="demo-intro demo-outro">
      <motion.span className="brand-mark" initial={{ opacity: 0, scale: 0.82 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.42 }}><Sparkles size={24} /></motion.span>
      <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16, duration: 0.42 }}>Give us the people, destination and constraints.</motion.h1>
      <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.32, duration: 0.42 }}>Travel Manager makes sure everyone gets there.</motion.p>
    </div>
  );
}

function DemoHeading({ title, subtitle, tone = "primary" }: { title: string; subtitle: string; tone?: "primary" | "warning" }) {
  return <div className="page-heading demo-heading"><div><div className="eyebrow"><span className={cn("icon-box", tone === "warning" ? "tone-warning" : "tone-primary")}><Sparkles size={16} /></span>AI travel coordination</div><h1>{title}</h1><p className="muted">{subtitle}</p></div></div>;
}

function AnimatedCheck({ label, value, delay = 0 }: { label: string; value: string; delay?: number }) {
  return (
    <motion.div className="surface demo-check-row" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay, duration: 0.3 }}>
      <motion.span className="icon-box tone-success" initial={{ scale: 0.8 }} animate={{ scale: 1 }} transition={{ delay: delay + 0.16, type: "spring", stiffness: 260, damping: 18 }}><Check size={16} /></motion.span>
      <span><small className="uppercase">{label}</small><strong>{value}</strong></span>
    </motion.div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return <div className="metric-inline"><span className="icon-box tone-primary"><Icon size={16} /></span><span><small>{label}</small><strong>{value}</strong></span></div>;
}

function TravelerPlanCard({ person, delay }: { person: (typeof travelers)[number]; delay: number }) {
  return (
    <motion.section className="surface demo-traveler-card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.3 }}>
      <div className="between"><div className="person"><Avatar>{person.initials}</Avatar><div><strong>{person.name}</strong><small>{person.role} · {person.airport}</small></div></div><Badge tone="success">Compliant</Badge></div>
      <div className="flight-route"><div><strong>{person.airport}</strong><small>{person.city}</small></div><AnimatedRouteLine label="Direct" delay={delay + 0.16} /><div><strong>BER</strong><small>Berlin</small></div></div>
      <div className="flight-facts"><div><small>Time</small><strong>{person.time}</strong></div><div><small>Preference</small><strong>{person.seat}</strong></div><div><small>Cost</small><strong>EUR {person.cost}</strong></div></div>
    </motion.section>
  );
}

function AnimatedRouteLine({ label, delay = 0, iconSize = 20, warning = false }: { label: string; delay?: number; iconSize?: number; warning?: boolean }) {
  return (
    <div className={cn("flight-route-line demo-route-line", warning && "tone-warning")}>
      <motion.span className="demo-route-draw" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay, duration: 0.46, ease: "easeOut" }} />
      <motion.span className="demo-route-plane" initial={{ x: "-42%", opacity: 0 }} animate={{ x: "42%", opacity: 1 }} transition={{ delay: delay + 0.06, duration: 0.52, ease: "easeOut" }}><Plane size={iconSize} /></motion.span>
      <small>{label}</small>
    </div>
  );
}

function MobileRow({ icon: Icon, title, value, detail }: { icon: typeof Building2; title: string; value: string; detail: string }) {
  return <div className="glance-row"><span className="icon-box tone-neutral"><Icon size={16} /></span><span><small className="uppercase">{title}</small><strong>{value}</strong></span><small>{detail}</small></div>;
}
