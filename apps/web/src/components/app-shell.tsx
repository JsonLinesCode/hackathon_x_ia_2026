"use client";

import { motion } from "motion/react";
import {
  ArrowRight,
  Building2,
  CalendarCheck,
  CheckCircle2,
  CircleDollarSign,
  MapPinned,
  Menu,
  Plane
} from "lucide-react";
import { formatTravelerSummary, PRODUCT_NAME } from "@repo/core";
import { Button } from "@repo/ui/button";
import { TravelerSchema, type Traveler } from "@repo/types";

const travelers: Traveler[] = TravelerSchema.array().parse([
  {
    id: "trv_001",
    name: "Maya Chen",
    homeCity: "Paris",
    status: "ready"
  },
  {
    id: "trv_002",
    name: "Jon Bell",
    homeCity: "Berlin",
    status: "review"
  },
  {
    id: "trv_003",
    name: "Amara Singh",
    homeCity: "Madrid",
    status: "ready"
  }
]);

const navItems = ["Overview", "Travelers", "Constraints"];

export function AppShell() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 border-r bg-white px-5 py-6 md:block">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Plane className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold">{PRODUCT_NAME}</p>
              <p className="text-xs text-muted-foreground">Coordination desk</p>
            </div>
          </div>
          <nav className="mt-10 space-y-1">
            {navItems.map((item) => (
              <a
                key={item}
                className="block rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                href="#"
              >
                {item}
              </a>
            ))}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 items-center justify-between border-b bg-white px-4 md:px-8">
            <div className="flex items-center gap-3 md:hidden">
              <Button size="icon" variant="ghost" aria-label="Open navigation">
                <Menu className="h-4 w-4" aria-hidden="true" />
              </Button>
              <span className="text-sm font-semibold">{PRODUCT_NAME}</span>
            </div>
            <div className="hidden md:block">
              <p className="text-sm font-medium">Executive offsite</p>
              <p className="text-xs text-muted-foreground">
                San Francisco arrival before 09:30
              </p>
            </div>
            <Button size="sm">
              <CalendarCheck className="h-4 w-4" aria-hidden="true" />
              Review plan
            </Button>
          </header>

          <motion.main
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: "easeOut" }}
            className="flex-1 px-4 py-6 md:px-8 md:py-8"
          >
            <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_320px]">
              <section className="min-w-0">
                <div className="mb-6">
                  <p className="text-sm font-medium text-primary">
                    {formatTravelerSummary(travelers.length, "San Francisco")}
                  </p>
                  <h1 className="mt-2 max-w-2xl text-3xl font-semibold tracking-normal md:text-4xl">
                    Everyone arrives together, within policy.
                  </h1>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
                    A clean workspace for coordinating people, constraints,
                    deadlines, and travel decisions.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <StatusMetric
                    icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                    label="Ready"
                    value="2 travelers"
                  />
                  <StatusMetric
                    icon={<CircleDollarSign className="h-4 w-4" aria-hidden="true" />}
                    label="Policy"
                    value="Within limit"
                  />
                  <StatusMetric
                    icon={<MapPinned className="h-4 w-4" aria-hidden="true" />}
                    label="Arrival"
                    value="09:10 target"
                  />
                </div>

                <div className="mt-6 overflow-hidden rounded-lg border bg-white shadow-sm">
                  <div className="border-b px-5 py-4">
                    <h2 className="text-base font-semibold">Travelers</h2>
                  </div>
                  <div className="divide-y">
                    {travelers.map((traveler) => (
                      <div
                        key={traveler.id}
                        className="flex items-center justify-between gap-4 px-5 py-4"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {traveler.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Departing from {traveler.homeCity}
                          </p>
                        </div>
                        <span className="rounded-md border px-2.5 py-1 text-xs font-medium capitalize text-muted-foreground">
                          {traveler.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <aside className="rounded-lg border bg-white p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                    <Building2 className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold">Workspace status</h2>
                    <p className="text-xs text-muted-foreground">
                      Plan health is steady
                    </p>
                  </div>
                </div>
                <div className="mt-5 space-y-3 text-sm text-muted-foreground">
                  <p>Company policy is attached.</p>
                  <p>Traveler constraints are ready.</p>
                  <p>Arrival window is locked.</p>
                </div>
                <Button className="mt-6 w-full" variant="secondary">
                  Open coordination
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </aside>
            </div>
          </motion.main>
        </div>
      </div>
    </div>
  );
}

function StatusMetric({
  icon,
  label,
  value
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-medium uppercase tracking-normal">
          {label}
        </span>
      </div>
      <p className="mt-3 text-lg font-semibold">{value}</p>
    </div>
  );
}
