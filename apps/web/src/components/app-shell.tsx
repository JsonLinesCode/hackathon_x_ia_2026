"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  Bell,
  Bot,
  ChevronsUpDown,
  Home,
  LayoutDashboard,
  Luggage,
  Search,
  Settings,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  Users,
} from "lucide-react";
import { PRODUCT_NAME } from "@repo/core";
import { Avatar } from "@repo/ui";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/utils";
import { type Screen } from "@/lib/travel-data";
import { Dashboard } from "./dashboard";
import {
  CreateTrip,
  Planning,
  TripPlan,
} from "./trip-workspace";
import {
  Disruptions,
  Itinerary,
  TravelerHome,
  Assistant,
} from "./traveler-views";
import { TravelersManager, PoliciesManager, ManagerSettings } from "./managed-data";
import { DesignSystem } from "./design-system";

const navigation = [
  {
    label: "Overview",
    href: "/",
    icon: LayoutDashboard,
    screens: ["overview"],
  },
  {
    label: "Trips",
    href: "/trips",
    icon: Luggage,
    screens: ["trips", "create", "planning", "trip", "home", "itinerary"],
  },
  {
    label: "Travelers",
    href: "/travelers",
    icon: Users,
    screens: ["travelers"],
  },
  {
    label: "Policies",
    href: "/policies",
    icon: ShieldCheck,
    screens: ["policies"],
  },
  {
    label: "Disruptions",
    href: "/disruptions",
    icon: TriangleAlert,
    screens: ["disruptions"],
  },
  {
    label: "Settings",
    href: "/profile",
    icon: Settings,
    screens: ["profile", "design-system"],
  },
];
const breadcrumbs: Record<Screen, string> = {
  overview: "Overview",
  trips: "Trips",
  create: "Trips / Create trip",
  planning: "Trips / Berlin Offsite / Planning",
  trip: "Trips / Berlin Team Offsite",
  disruptions: "Disruptions / Berlin Offsite / Alice",
  home: "My trip / Berlin Offsite",
  assistant: "Assistant",
  itinerary: "Trips / Berlin Offsite / Itinerary",
  travelers: "Travelers",
  policies: "Policies",
  profile: "Settings",
  "design-system": "Shared UI",
};
const mobileTitles: Record<Screen, [string, string]> = {
  overview: ["Berlin Offsite", "Tuesday, October 13"],
  home: ["Berlin Offsite", "Tuesday, October 13"],
  assistant: ["Assistant", "Ready when you are"],
  disruptions: ["Trip update", "Berlin Offsite"],
  itinerary: ["Updated itinerary", "Berlin Offsite · Oct 13–15"],
  trips: ["Trips", "Your team travel"],
  create: ["Create trip", "Acme Europe"],
  planning: ["Planning", "Berlin Offsite"],
  trip: ["Berlin Team Offsite", "October 13–15"],
  travelers: ["Travelers", "Acme Europe"],
  policies: ["Travel policy", "Acme Europe"],
  profile: ["Profile", "Your travel preferences"],
  "design-system": ["Shared UI", "Travel Manager"],
};

export function AppShell({ screen = "overview" }: { screen?: Screen }) {
  const reducedMotion = useReducedMotion();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        searchRef.current?.focus();
        setSearchOpen(true);
      }
      if (event.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  const results = [
    {
      title: "Berlin Team Offsite",
      detail: "October 13–15 · 12 travelers",
      href: "/trips/berlin",
    },
    {
      title: "Alice Martin",
      detail: "Paris · Product Lead",
      href: "/travelers",
    },
    {
      title: "Marc Bennett",
      detail: "London · Sales Director",
      href: "/travelers",
    },
    {
      title: "Sarah Ruiz",
      detail: "Madrid · Design Manager",
      href: "/travelers",
    },
    {
      title: "Acme Europe travel policy",
      detail: "Economy · €180/night",
      href: "/policies",
    },
    {
      title: "Flight AF1234 cancelled",
      detail: "Replacement confirmed",
      href: "/disruptions",
    },
  ].filter((item) =>
    `${item.title} ${item.detail}`.toLowerCase().includes(query.toLowerCase()),
  );
  const travelerScreen = ["home", "assistant", "itinerary", "profile"].includes(
    screen,
  );
  const [mobileTitle, mobileSubtitle] = mobileTitles[screen];

  return (
    <div
      className={cn(
        "app-shell",
        screen === "design-system" && "showcase-shell",
      )}
    >
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <Image
              src="/images/brand-route.svg"
              alt=""
              width={17}
              height={17}
            />
          </span>
          <span>{PRODUCT_NAME}</span>
        </Link>
        <Link href="/profile" className="workspace-switch">
          <Avatar size="sm">AC</Avatar>
          <span>
            <strong>Acme Europe</strong>
            <small>Business plan</small>
          </span>
          <ChevronsUpDown size={13} />
        </Link>
        <nav aria-label="Main navigation">
          {navigation.map(({ label, href, icon: Icon, screens }) => (
            <Link
              key={label}
              href={href}
              className={cn("nav-item", screens.includes(screen) && "active")}
              aria-current={screens.includes(screen) ? "page" : undefined}
            >
              <Icon size={16} />
              <span>{label}</span>
              {label === "Disruptions" && (
                <span className="notification-count">1</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="coordinator-status">
          <span className="status-dot" />
          AI coordinator online
        </div>
      </aside>
      <div className="app-workspace">
        <header className="desktop-header">
          <span>{breadcrumbs[screen]}</span>
          <div className="topbar-actions">
            <div
              className="search-wrapper"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                  setSearchOpen(false);
              }}
            >
              <div className="search-input">
                <Search size={14} />
                <input
                  ref={searchRef}
                  aria-label="Search trips and travelers"
                  placeholder="Search trips, travelers..."
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setSearchOpen(true);
                  }}
                  onFocus={() => setSearchOpen(true)}
                />
                <kbd>⌘ K</kbd>
              </div>
              {searchOpen && (
                <div className="search-results">
                  {results.length ? (
                    results.map((item) => (
                      <Link
                        key={item.title}
                        href={item.href}
                        onClick={() => setSearchOpen(false)}
                      >
                        <strong>{item.title}</strong>
                        <small>{item.detail}</small>
                      </Link>
                    ))
                  ) : (
                    <p>No matching trips or travelers.</p>
                  )}
                </div>
              )}
            </div>
            <Button asChild variant="outline" size="icon" title="Notifications">
              <Link href="/disruptions" aria-label="Notifications">
                <Bell size={16} />
              </Link>
            </Button>
            <Link href="/profile" aria-label="Your profile">
              <Avatar size="sm">AL</Avatar>
            </Link>
          </div>
        </header>
        <header className="mobile-header">
          <div>
            <h1>{mobileTitle}</h1>
            <p>{mobileSubtitle}</p>
          </div>
          <Link href="/profile" aria-label="Your profile">
            <Avatar>
              {screen === "assistant" ? <UserRound size={20} /> : "AM"}
            </Avatar>
          </Link>
        </header>
        <motion.main
          id="main-content"
          initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.2 }}
          className={cn(
            "main-content",
            travelerScreen && "traveler-content",
            screen === "assistant" && "assistant-content",
            screen === "create" && "create-content",
          )}
        >
          {screen === "overview" && (
            <>
              <div className="desktop-overview">
                <Dashboard />
              </div>
              <div className="mobile-home">
                <TravelerHome />
              </div>
            </>
          )}
          {screen === "trips" && <Dashboard tripsOnly />}
          {screen === "create" && <CreateTrip />}
          {screen === "planning" && <Planning />}
          {screen === "trip" && <TripPlan />}
          {screen === "disruptions" && <Disruptions />}
          {screen === "home" && <TravelerHome />}
          {screen === "assistant" && <Assistant />}
          {screen === "itinerary" && <Itinerary />}
          {screen === "travelers" && <TravelersManager />}
          {screen === "policies" && <PoliciesManager />}
          {screen === "profile" && <ManagerSettings />}
          {screen === "design-system" && <DesignSystem />}
        </motion.main>
      </div>
      <nav className="mobile-nav" aria-label="Traveler navigation">
        {[
          {
            label: "Home",
            href: "/",
            icon: Home,
            active: ["overview", "home"].includes(screen),
          },
          {
            label: "Assistant",
            href: "/assistant",
            icon: Bot,
            active: screen === "assistant",
          },
          {
            label: "Updates",
            href: "/disruptions",
            icon: Bell,
            active: ["disruptions", "itinerary"].includes(screen),
          },
          {
            label: "Profile",
            href: "/profile",
            icon: UserRound,
            active: screen === "profile",
          },
        ].map(({ label, href, icon: Icon, active }) => (
          <Link
            key={label}
            href={href}
            className={cn(active && "active")}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={22} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
