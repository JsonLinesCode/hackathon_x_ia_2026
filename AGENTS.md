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

Future integrations may include:

- OpenAI
- Jinko
- Google Calendar
- Supabase
- Slack

Do NOT implement these integrations unless explicitly requested.

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
- fix resulting errors

Never knowingly leave the repository in a broken state.