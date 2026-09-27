import { TravelerSchema, type Traveler } from "@repo/types";

export type Screen =
  | "overview"
  | "trips"
  | "create"
  | "planning"
  | "trip"
  | "disruptions"
  | "home"
  | "assistant"
  | "itinerary"
  | "travelers"
  | "policies"
  | "profile"
  | "design-system";

export const screens: Record<string, Screen> = {
  disruptions: "disruptions",
  "my-trip": "home",
  assistant: "assistant",
  "design-system": "design-system",
};

export const travelers: Traveler[] = TravelerSchema.array().parse([
  { id: "alice", name: "Alice Martin", homeCity: "Paris", status: "ready" },
  { id: "marc", name: "Marc Bennett", homeCity: "London", status: "ready" },
  { id: "sarah", name: "Sarah Ruiz", homeCity: "Madrid", status: "ready" },
]);

export const travelerDetails = [
  {
    initials: "AM",
    role: "Product Lead",
    availability: "Available after 11:30",
    preference: "Aisle seat · No early flights",
    depart: "14:10",
    arrive: "15:55",
    flight: "AF1734",
    price: 420,
  },
  {
    initials: "MB",
    role: "Sales Director",
    availability: "Client call until 11:00",
    preference: "Heathrow preferred",
    depart: "13:20",
    arrive: "16:05",
    flight: "BA984",
    price: 510,
  },
  {
    initials: "SR",
    role: "Design Manager",
    availability: "Flexible all day",
    depart: "12:40",
    arrive: "15:35",
    flight: "IB3672",
    price: 468,
    preference: "Vegetarian meal",
  },
];

export const trips = [
  {
    name: "Berlin Offsite",
    date: "October 13–15",
    count: 12,
    initials: ["AM", "MB", "SR"],
    spent: 7420,
    total: 8000,
    status: "Ready",
    tone: "success",
    href: "/trips/berlin",
  },
  {
    name: "London Client Meeting",
    date: "October 18",
    count: 4,
    initials: ["JG", "ML", "KS"],
    spent: 2840,
    total: 3200,
    status: "1 issue",
    tone: "warning",
    href: "/trips?selected=london",
  },
  {
    name: "Paris Leadership Summit",
    date: "October 22–24",
    count: 8,
    initials: ["AA", "NS", "CW"],
    spent: 3180,
    total: 6500,
    status: "Planning",
    tone: "primary",
    href: "/trips?selected=paris",
  },
] as const;

export const euro = (value: number) =>
  new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);

export const itinerary = [
  {
    time: "11:55",
    title: "Leave office",
    detail: "Car to Charles de Gaulle · 45 min",
    icon: "car",
    changed: false,
  },
  {
    time: "12:40",
    title: "Charles de Gaulle",
    detail: "Terminal 1 · Gate B28",
    icon: "pin",
    changed: true,
  },
  {
    time: "13:35",
    title: "Flight to Frankfurt",
    detail: "LH1027 · Seat 14C · 1h 15m",
    icon: "takeoff",
    changed: true,
  },
  {
    time: "15:15",
    title: "Connection",
    detail: "Frankfurt · Gate A12 → B04 · 50 min",
    icon: "route",
    changed: true,
  },
  {
    time: "17:20",
    title: "Berlin arrival",
    detail: "BER Terminal 1 · Driver confirmed",
    icon: "landing",
    changed: true,
  },
  {
    time: "18:10",
    title: "Motel One Alexanderplatz",
    detail: "12 rooms · Booking TM-8821",
    icon: "hotel",
    changed: false,
  },
  {
    time: "Wed 09:00",
    title: "Team meeting",
    detail: "Studio 3 · Alexanderplatz",
    icon: "users",
    changed: false,
  },
] as const;
