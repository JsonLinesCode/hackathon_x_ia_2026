# Travel Manager

## Product

We are building a B2B AI-powered travel coordination platform.

The core value proposition is:

"Give us the people, destination and constraints.
We make sure everyone gets there."

The product coordinates multi-person business travel.

Typical use case:

A company needs to send several employees from different cities to the same
meeting while respecting:

- employee schedules
- arrival deadlines
- company travel policy
- budget
- individual constraints
- transport availability

The system should later be able to react automatically to disruptions such
as flight cancellations.

## Demo goal

The final product will be demonstrated in less than 2 minutes.

The product must therefore be:

- visually understandable immediately
- responsive
- smooth
- reliable
- easy to demo

The final demo will work on both desktop and mobile.

## Tech stack

Use:

- pnpm
- Turborepo
- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Motion
- lucide-react
- Zod

Integrations authorized by BUILD_PLAN.md:

- Supabase Auth and Postgres: the persistence layer
- OpenAI
- Jinko
- Google Calendar
- Gmail

Implement only the phase explicitly requested by the user. Stop after that phase's
acceptance checks and report the SQL migration and manual configuration required.
Phase 1 authorizes Supabase persistence and Google sign-in; OpenAI, Jinko,
Calendar/Gmail operations and agent workflows belong to later phases.
Do not add Slack, Teams, a mock mode, or other integrations.

All secrets stay in server-only modules under apps/web/src/server. Use lazy,
phase-scoped Zod environment validation. User data is isolated with Supabase RLS;
Google refresh tokens are service-role-only. Preserve the existing layout.
Paid or irreversible actions require an explicit manager decision recorded in the
database. Never complete payments. Keep Next.js and eslint-config-next on the
latest patched 15.5.x; never downgrade them.

## Architecture

The monorepo should contain:

apps/web
packages/ui
packages/core
packages/types

Keep the architecture simple.

Do not introduce:

- a separate backend
- microservices
- Docker
- unnecessary abstractions
- unnecessary dependencies

Use Next.js Route Handlers when backend functionality is eventually needed.

External services must later be isolated behind adapters.

## UI

The application must be responsive.

Desktop:
- dashboard-oriented interface
- sidebar
- main workspace

Mobile:
- compact navigation
- traveler-friendly experience
- same underlying design system

Target aesthetic:

- premium B2B SaaS
- minimal
- clean
- lots of whitespace
- strong typography
- subtle borders
- subtle shadows
- restrained accent color

Avoid:
- excessive gradients
- glassmorphism everywhere
- excessive rounded cards
- playful visual design
- unnecessary visual effects

## Motion

Motion will later be used for meaningful transitions and micro-interactions.

Animations should be:

- subtle
- fast
- professional
- functional

Avoid exaggerated bounce animations.

## Development principles

Prefer:

1. simplicity
2. maintainability
3. demo reliability
4. clear code
5. responsive design

over premature abstraction.

Reuse components when appropriate, but do not create abstractions before
they are useful.

## Validation

Before considering a task complete:

- run lint
- run typecheck
- run build
- run test (Vitest, from Phase 1 onward)
- fix resulting errors

Never knowingly leave the repository in a broken state.
