# Travel Manager

B2B travel coordination interface, implemented from the Travel Manager Figma frames.

## Setup

```bash
corepack enable
pnpm install
```

## Development

```bash
pnpm dev
```

The web app runs from `apps/web`.

Open http://localhost:3000. Next.js uses the next available port if 3000 is busy.

## Screens

| Route | Figma frame | View |
| --- | --- | --- |
| `/` | `2:19289` / `2:20202` | Desktop overview / mobile traveler home |
| `/trips/new` | `2:19493` | Create a trip |
| `/trips/berlin/planning` | `2:19656` | Coordination progress |
| `/trips/berlin` | `2:19828` | Team plan and approval |
| `/disruptions` | `2:20034` / `3:60` | Desktop / mobile disruption response |
| `/my-trip` | `2:20202` | Traveler home at any screen size |
| `/assistant` | `17:80` | Traveler assistant |
| `/itinerary` | `2:20347` | Updated itinerary and calendar download |
| `/design-system` | `2:20451` | Shared UI reference |

Trips, travelers, policies, and profile navigation also have supporting views.
Mobile uses the traveler navigation from Figma; native phone status bars are omitted.

## Local Behavior

This is a frontend implementation with reference data, not a connected travel service.
Planning and disruption states reproduce the supplied frames. The planning screen has
an explicit **Review travel plan** action; it does not run a simulated background process.
The assistant answers from saved fixture details, without an AI or network integration.

Search, trip filtering, traveler entry, policy expansion, plan selection, and approval
are interactive. Drafts, plan choices, approval, and preferences use browser local storage.
Attachments stay in the current browser tab; nothing is uploaded. No bookings, emails,
calendar API calls, or notifications are sent. Calendar export downloads an `.ics` file
for the October 13-14, 2026 itinerary using the displayed local European times.

Inter is bundled locally with its OFL license under `apps/web/public/fonts`.
The brand mark is exported from Figma; other interface icons use lucide-react.
No additional runtime dependencies or environment variables are required.

## Validation

```bash
pnpm lint
pnpm typecheck
pnpm build
```

## Structure

- `apps/web` - Next.js application with App Router, Tailwind CSS, shadcn/ui setup, Motion, lucide-react, and Zod usage.
- `packages/ui` - Shared UI primitives.
- `packages/core` - Shared product constants and utilities.
- `packages/types` - Shared Zod schemas and TypeScript types.
