# Build plan — Travel Manager AI agent

This document is the full specification. Implement it **one phase at a time**: when asked for "Phase N", implement only that phase, make its acceptance checks pass, then stop and report (1) what changed, (2) any SQL migration I must run, (3) anything I must configure manually. Never start the next phase on your own.

Read `AGENTS.md` first and keep its conventions. In Phase 1, update `AGENTS.md`: the integrations listed here are now authorized, and Supabase is the persistence layer.

---

## 1. Context

The repo is a pnpm + Turborepo monorepo: `apps/web` (Next.js 15.5.26 App Router, Tailwind 4, shadcn/ui setup, Motion, lucide-react, Zod), `packages/ui`, `packages/core`, `packages/types`. Today it is a polished frontend with fixture data (Berlin offsite, disruption screens, regex assistant, `localStorage`). No auth, no backend, no integrations.

We are turning it into a working AI agent for business travel coordination. It is already deployed on Vercel (production branch `main`). Never downgrade Next.js: Vercel refuses to deploy versions with known vulnerabilities, so keep `next` and `eslint-config-next` on the latest patched 15.5.x. The team has already configured all API keys; **there is no mock mode**. If a required env var is missing, fail with a clear error message naming the variable.

## 2. Product model

- **User = travel manager ("gestionnaire").** Each account signs in with Google and organizes trips for their team or a few people. The agent acts on this user's behalf with their Google account (Calendar, Gmail).
- **Travelers are records, not accounts.** Name, email, home city, home airport, preferences. Travelers interact only through emails and signed links.
- **The agent** understands requests, checks calendars and policy, searches flights and hotels (Jinko), proposes explained options, contacts travelers, follows the trip until the end, and handles disruptions and expenses.
- **Policy exceptions**: the agent detects and explains the violation and blocks the related booking. The manager obtains approval outside the app, then clicks "Exception approved" (optional note: who approved). No manager accounts, no approval emails.
- **Traveler confirmation**: the agent emails each traveler with signed links "I confirm" / "Propose another time". Statuses update automatically from link clicks and from free-text email replies. The manager can send reminders.

**Core rule, enforced in code, never delegated to the LLM:** the agent may detect, verify, and prepare anything. It executes on its own only actions that are free and reversible (informational emails, confirmation requests, reminders, calendar invites, recap). Every action that costs money or is hard to undo (booking, paid cancellation, modification with a fee, submitting an expense report) requires an explicit manager decision recorded in the database.

## 3. Principles

- Single Next.js app. Backend = Route Handlers and server modules. No separate backend, no Docker, no queues.
- Secrets only on the server: modules under `apps/web/src/server/**` start with `import "server-only"`. Never expose the Supabase service role key, Google/OpenAI/Jinko secrets, or refresh tokens to the client.
- **Deterministic decisions, generative language.** Policy evaluation, action gating, cancellation fees, scoring, and state transitions are pure TypeScript in `packages/core` with unit tests. OpenAI extracts, compares, explains, drafts, and classifies.
- **The LLM proposes, the gate disposes.** LLM output can only create `proposed` actions. One function, `classifyAction`, decides `auto` vs `needs_manager`. Only the orchestrator executes actions.
- **Never pay.** A Jinko booking stops at quote / payment link. Store the link; never complete a payment.
- **Resumable steps.** Each orchestrator step reads the trip from the DB, does one unit of work, persists the result and a timeline event, then moves to the next step. Steps are idempotent, so a retry never double-books or double-sends. Set `export const maxDuration = 300` on long-running routes.
- **Everything visible.** Every step, external call, message sent, reply received, and human decision appends a `timeline_events` row. The UI renders the trip from DB state.
- Times are stored in UTC and displayed in the traveler's or meeting's time zone (default `Europe/Paris`). Relative dates ("mardi", "next Tuesday") are resolved from the current date in `Europe/Paris`.
- The agent writes emails and messages in the language of the request (French or English). UI chrome stays in English, like the existing app.
- Keep the existing design system and components. Replace fixtures with real data; do not redesign. Remove `localStorage` as a data store.
- Minimal dependencies. Allowed: `@supabase/supabase-js`, `@supabase/ssr`, `openai`, `@modelcontextprotocol/sdk`, `@googleapis/calendar`, `@googleapis/gmail`, `google-auth-library`, `server-only`, and `vitest` (dev). Justify anything else in the README.

## 4. Architecture

```
supabase/migrations/            numbered SQL files (the user runs them in the Supabase SQL editor)
packages/types/src/             Zod schemas + inferred types, shared by server and client
packages/core/src/
  policy.ts                     evaluatePolicy(option, policy) -> { compliant, violations[] }
  gate.ts                       classifyAction(action) -> "auto" | "needs_manager"
  cancellation.ts               computeCancellationCost(terms, now) -> { feeEur, refundable, deadline }
  scoring.ts                    rank options: cost, arrival margin before meeting, duration, compliance
  state-machine.ts              TripStatus transitions (reject invalid ones)
  dates.ts                      relative date resolution in a given time zone
  signed-link.ts                HMAC sign/verify of { purpose, id, exp } with APP_SECRET (Web Crypto)
apps/web/src/
  middleware.ts                 Supabase session refresh + protect app routes
  app/login, app/auth/callback  Google sign-in via Supabase
  app/r/[token]/page.tsx        public page for signed traveler links (confirm / counter-proposal)
  app/api/**                    route handlers (listed per phase)
  server/
    db.ts                       Supabase server clients (user-scoped + service role)
    agent/orchestrator.ts       step runner
    agent/flows/                plan-trip, confirmations, meeting-cancelled, carrier-disruption, post-trip
    integrations/openai.ts
    integrations/jinko.ts       MCP client
    integrations/google-auth.ts token storage + refresh (manager and travelers)
    integrations/calendar.ts
    integrations/gmail.ts
```

## 5. Data model (Supabase Postgres)

Enable RLS on every table. User-facing tables have an `owner_id uuid references auth.users` with policies restricting all access to `owner_id = auth.uid()`. Credential tables have RLS enabled and **no policies**: only the service role can read them.

- `profiles` (id = auth user id, email, full_name, created_at)
- `google_credentials` (user_id pk, refresh_token, scopes, updated_at), service role only
- `traveler_google_credentials` (traveler_id pk, refresh_token, scopes, updated_at), service role only
- `policies` (owner_id pk, rules jsonb). Seeded with a default on first sign-in: economy flights under 6 h, hotel cap €180 per person per night, max trip budget per traveler configurable, preferred arrival at least 60 min before the meeting.
- `travelers` (id, owner_id, full_name, email, home_city, home_airport, preferences jsonb, calendar_access `unknown | direct | consented | denied`)
- `trips` (id, owner_id, title, request_text, extracted jsonb, destination, meeting jsonb {title, start, end, timezone, location, google_event_id}, status, budget_per_traveler, created_at, updated_at)
- `trip_travelers` (trip_id, traveler_id, availability jsonb, confirmation_status `not_requested | pending | confirmed | counter_proposal | declined | needs_review`, response_text)
- `trip_options` (id, trip_id, label, rank, total_eur, per_traveler jsonb [flight, hotel per traveler], compliant, violations jsonb, explanation, selected, exception_approved, exception_note)
- `bookings` (id, trip_id, traveler_id, kind `flight | hotel`, status `quoted | booked | cancelled | cancel_requested | failed`, provider_ref, price_eur, payment_link, cancellation_terms jsonb, details jsonb, raw jsonb)
- `actions` (id, trip_id, kind, summary, cost_eur, reversible, gate `auto | needs_manager`, status `proposed | approved | rejected | executing | executed | failed`, payload jsonb, rationale, decided_at, result jsonb, idempotency_key unique)
- `outreach` (id, trip_id, traveler_id, purpose `calendar_access | trip_confirmation | info_request | notification`, channel `email`, status `sent | responded | expired`, gmail_thread_id, gmail_message_id, sent_at, reminder_count, last_reminder_at)
- `timeline_events` (id, trip_id, at, actor `agent | manager | traveler | provider | system`, source, title, detail, data jsonb)
- `inbound_events` (id, owner_id, kind, dedupe_key unique, payload jsonb, processed_at)
- `expenses` (id, trip_id, traveler_id, date, merchant, category, amount, currency, amount_eur, compliant, note, receipt_path)
- Storage bucket `receipts` (private).

`TripStatus`: `draft → understanding → needs_info → checking_availability → searching → options_ready → awaiting_exception → awaiting_travelers → ready_to_book → booking → booked → disrupted → cancelled → completed → reported`.

## 6. Integrations

**Supabase Auth with Google (manager sign-in).** `signInWithOAuth({ provider: "google", options: { scopes, redirectTo: APP_URL + "/auth/callback", queryParams: { access_type: "offline", prompt: "consent" } } })`. Scopes: `openid email profile https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly`. In `/auth/callback`, after `exchangeCodeForSession`, read `session.provider_refresh_token` and upsert it into `google_credentials` with the service role; Supabase exposes it only at this moment. If it is missing, show a clear message explaining how to revoke access at myaccount.google.com/permissions and reconnect. Use `@supabase/ssr` for cookies and middleware.

**Google token handling.** `google-auth.ts` builds an OAuth2 client from `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and a stored refresh token, for either the manager or a traveler. On `invalid_grant`, mark the credential invalid and surface "Reconnect Google" in the UI.

**Traveler calendar access.** Two paths, tried in order:
1. *Direct* (same Google Workspace organization): `freebusy.query` with the manager's token on the traveler's email. If the response has no errors for that calendar, set `calendar_access = direct`.
2. *Consent* (personal Gmail, other domains): if direct access fails (`notFound` or similar error in the freebusy response), send the traveler an email with a signed link to `/api/google/traveler/start?token=…`. That route redirects to Google OAuth (same client, scope `https://www.googleapis.com/auth/calendar.readonly`, `access_type=offline`, `prompt=consent`, signed `state`). `/api/google/traveler/callback` verifies the state, exchanges the code, stores the refresh token in `traveler_google_credentials`, sets `calendar_access = consented`, adds a timeline event, and shows a simple "Thank you" page. Freebusy is then queried with the traveler's own token. If Google returns `access_denied` (typically because the traveler is not a test user of the Google Cloud app, which is in Testing mode), show a clear page saying so and record it in the timeline so the manager can add the address as a test user.

If neither path works yet, availability is `unknown`. Planning continues; the confirmation email asks the traveler to check the proposed times.

**Gmail.** Send as the manager with a raw RFC 2822 message (base64url). Encode non-ASCII subjects with `=?UTF-8?B?…?=` and use `Content-Type: text/html; charset=UTF-8`, plus a plain-text alternative. Keep emails short and professional, with clear buttons (styled links). Store `threadId` and `id` in `outreach`. Reminders reply in the same thread (`threadId`, plus `In-Reply-To` and `References` headers built from the original `Message-ID`). Inbound detection happens in `/api/sync`.

**Calendar.** Read the manager's events to find the meeting: the user may name it, or the agent matches by date, title, and location, and stores `google_event_id`. After booking, create events on the manager's calendar (flights, hotel check-in) with travelers as attendees (`sendUpdates: "all"`), so they receive real invitations. Meeting cancellation detection: `events.get` on the stored meeting id during sync (`status === "cancelled"`, or 404/410), and time changes (start differs from the stored value).

**Sync.** `POST /api/sync` (authenticated) processes the current user:
1. Gmail messages newer than the last sync that are replies in known `outreach` threads, or that look like carrier or meeting notices (`newer_than:2d`).
2. Calendar changes for meetings of active trips.

The client triggers it every 60 s while the app is open, and from a "Sync now" button. Each inbound item is written to `inbound_events` with a dedupe key (Gmail message id, event id + updated) before processing.

**Signed links.** `/r/[token]` is public. It verifies the HMAC and expiry, shows the trip summary for that traveler, and offers "I confirm" or "Propose another time" (free-text field). The decision updates `trip_travelers`, `outreach`, and the timeline, then advances the trip if all travelers have answered. Links are single-purpose and expire after 7 days.

**Reply classification.** For free-text email replies, OpenAI classifies into `confirmed | counter_proposal | declined | question | unclear` with a confidence score and extracted constraints. Apply automatically only when confidence ≥ 0.8 and the class is `confirmed`, `declined` or `counter_proposal`. Otherwise set `needs_review` and show the reply to the manager with suggested buttons.

**OpenAI.** Responses API with structured outputs from Zod schemas (`zodTextFormat` from `openai/helpers/zod`). Model from `OPENAI_MODEL`. Uses:
- extract a `TravelRequest` from free text, returning `missingFields[]` instead of guessing;
- explain the ranked options (2–3 sentences each);
- draft emails;
- classify replies and inbound emails (carrier cancellation or delay, meeting cancellation, unrelated);
- extract expenses from receipt images or PDFs;
- summarize the trip for the expense report;
- the assistant (Phase 6).

Wrap every call with a timeout, one retry, and a timeline entry on failure.

**Jinko (flights + hotels) via MCP.** Use `@modelcontextprotocol/sdk` `Client` with `StreamableHTTPClientTransport` to `JINKO_MCP_URL`, passing `JINKO_API_KEY` in the header named by `JINKO_API_KEY_HEADER` (default `Authorization`). If the header is `Authorization`, send `Bearer <key>`; otherwise send the raw key. `JINKO_MCP_URL` may point to Jinko's sandbox or production; the code must not assume either. On first use, call `listTools()` and log the tool names and input schemas. Map them in one place (`jinko.ts`) to `searchFlights`, `searchHotels`, `getHotelDetails`, `book`/`quote`, and `cancel` if available. Do not hardcode argument shapes beyond what `listTools()` returns; validate tool outputs with Zod and keep the raw payload in `bookings.raw`. The orchestrator calls these functions directly; the LLM never calls booking or cancellation tools. If no cancellation tool exists, a cancellation action produces "manual cancellation required" with the provider reference and the instructions to follow.

## 7. Flows

**Plan trip (Phase 2, extended in Phase 3).**
1. `understanding`: extract the request; match or create travelers by name or email; on missing essentials, go to `needs_info` and show the question in the UI.
2. `checking_availability` (Phase 3): per traveler, direct freebusy or consent outreach; store availability windows.
3. `searching`: per traveler, flights from their home airport to the destination, arriving in the requested window; hotels near the meeting location for the required nights. Run in parallel with a concurrency limit.
4. Build 2–3 bundles (lowest cost, balanced, most flexible), evaluate policy per bundle, rank with `scoring.ts`, ask OpenAI for explanations. Go to `options_ready`.
5. The manager selects a bundle. If it is non-compliant, go to `awaiting_exception` until "Exception approved".
6. `awaiting_travelers` (Phase 3): send confirmation outreach. In Phase 2 only, the manager can mark each traveler confirmed manually.
7. `ready_to_book`: one `needs_manager` action per booking (or one grouped action), showing cost and cancellation terms.
8. On approval, `booking`: Jinko quote/book per item. Store the payment links. Go to `booked`.
9. Phase 3+: auto actions: calendar events with travelers invited, recap email (times, addresses, booking references, payment links for the manager only, useful contacts).

**Counter-proposal or decline.** Store the constraint, re-run the search for that traveler only, present the updated bundle, and return to `options_ready` for that part.

**Reminders.** "Remind" button per pending traveler, and via the assistant ("relance Marc"). Same thread, increment `reminder_count`. Auto (free, reversible), but rate-limited to one reminder per traveler per 2 hours.

**Meeting cancelled (Phase 4).** Detection: calendar sync, a classified inbound email, or a simulated event. Steps:
1. Mark the trip `disrupted`.
2. Check whether the trip is still needed: other events at the destination on those dates in the manager's or travelers' calendars.
3. Load bookings and compute fees and deadlines with `computeCancellationCost`.
4. Propose three `actions`: cancel all (total fees), move dates (re-search), keep the trip.
5. Any paid or irreversible cancellation is `needs_manager`.
6. After the decision, execute (Jinko cancel or "manual cancellation required"), notify travelers by email, update or delete calendar events, and set the status to `cancelled` or back to `booked`.

**Carrier cancellation or delay (Phase 4).** Detection: classified airline email or simulated event. Steps:
1. Alert the traveler and the manager.
2. Search replacement flights.
3. Check policy and arrival against the meeting start (`scoring.ts` arrival margin).
4. Propose replacements; the booking is `needs_manager`.
5. If arrival will be late, automatically email the meeting organizer (from the Google event organizer or attendees).
6. Update the calendar and the itinerary.

**Post-trip (Phase 5).** Upload receipts to the `receipts` bucket. OpenAI extracts the lines, the policy is checked per line, and the report shows a summary and totals per traveler. "Send report" (to an email address the manager enters) is a `needs_manager` action. Then the trip moves to `reported`.

**Simulation entry point (Phase 4).** `POST /api/events` accepts either a valid session or `Authorization: Bearer SIMULATION_SECRET` (with `owner_email` in the body). Supported `kind`s: `meeting_cancelled`, `meeting_moved`, `flight_cancelled`, `flight_delayed`, `inbound_email` (raw subject and body, processed like a synced email). Events go through exactly the same handlers as real detections. Document `curl` examples in the README.

## 8. UI wiring (reuse existing components and styles)

- `/login`: minimal page with "Continue with Google". Unauthenticated page requests are redirected here, except `/login`, `/r/*` and `/auth/*`. The middleware never redirects `/api/*` routes: each API route authenticates itself and returns 401 JSON (this keeps `/api/google/traveler/*` public and lets `/api/events` accept `SIMULATION_SECRET`). Exclude Next.js static assets from the middleware matcher.
- Overview (`/`): real counts, active trips, "Needs attention" built from pending actions, exceptions, `needs_review` replies, and disruptions.
- Trips (`/trips`), Create (`/trips/new`): the request textarea posts to `POST /api/trips`, then redirects to planning.
- Planning (`/trips/[id]/planning`): the existing workflow nodes (Calendar, Travel, Policy, Optimizer) driven by real step states from the timeline. The page polls every 1.5 s while the trip is in an automatic step.
- Trip plan (`/trips/[id]`): options with compliance and explanations, select, "Exception approved", per-traveler confirmation statuses with "Remind", a **Pending decisions** panel (cost, reversible, deadline, Approve / Reject), and the timeline.
- Itinerary (`/trips/[id]/itinerary`): from bookings; keep the existing `.ics` export.
- Disruptions (`/disruptions`): real disruptions and proposed actions.
- Travelers (`/travelers`): CRUD, with calendar-access status.
- Policies (`/policies`): edit the policy rules stored in the DB.
- Settings (`/profile`): Google connection status and "Reconnect", sign out.
- Assistant (`/assistant`, Phase 6): the manager's chat with the agent.
- Keep `/design-system`. Migrate from the `[...path]` catch-all to proper dynamic routes where needed; old fixture-only routes may redirect to the new ones.

Every screen needs loading, empty, and error states, and must stay responsive on mobile.

## 9. Environment variables

Update `.env.example` (all required unless marked optional):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
OPENAI_API_KEY=
OPENAI_MODEL=
JINKO_MCP_URL=
JINKO_API_KEY=
JINKO_API_KEY_HEADER=          # optional, default Authorization (Bearer)
APP_URL=                       # http://localhost:3000 locally, production URL on Vercel
APP_SECRET=                    # HMAC for signed links and OAuth state
SIMULATION_SECRET=
```

Validate env with Zod in one server module and fail fast with explicit messages. Each phase only requires the variables it uses. Validate lazily (when a server module first needs a variable), not at import time during `next build`, so the build never depends on runtime secrets.

The build runs through Turborepo, which hides undeclared environment variables. List every variable above in `globalEnv` in the root `turbo.json`, and add any new variable there in later phases.

## 10. Phases and acceptance checks

After every phase: `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm test` (from Phase 1) must pass. Keep the app usable at the end of every phase.

**Phase 1 — Foundation.** Dependencies; env validation; Supabase clients and middleware; `/login` and `/auth/callback` with refresh-token capture; SQL migration for the whole data model (tables, RLS, bucket); default policy seeded on first sign-in; Zod schemas in `packages/types`; everything in `packages/core` with Vitest tests (gate, policy, cancellation fees, state machine, relative dates, signed links); Travelers CRUD and Policies editing wired to the DB; Settings shows Google connection status. Update `AGENTS.md` and the README.
*Check:* sign in with Google, the `google_credentials` row exists, travelers persist, tests pass.

**Phase 2 — Plan trip with OpenAI + Jinko.** `integrations/openai.ts`, `integrations/jinko.ts` (log `listTools()` output), the orchestrator, plan-trip steps 1, 3–5, 7–8 (step 6 as a manual confirm), and the routes:
- `POST /api/trips`, `GET /api/trips/[id]`
- `POST /api/trips/[id]/select`, `POST /api/trips/[id]/exception`
- `POST /api/actions/[id]/decide`, `POST /api/trips/[id]/run`

Wire Create, Planning, Trip plan, and Itinerary.
*Check:* a free-text request produces ranked, explained, policy-checked options from Jinko. Selection, exception handling, and approval lead to Jinko quotes with payment links stored. Nothing is booked without an approved action.

**Phase 3 — Google Calendar + Gmail.** Token handling; direct and consent calendar access with the traveler OAuth routes; availability step; confirmation outreach by email with signed links and the `/r/[token]` page; `/api/sync` with reply classification; reminders; post-booking calendar invites and the recap email; "Needs review" handling in the UI.
*Check:* with personal Gmail accounts, travelers receive the consent email and the confirmation email. Link clicks and text replies update statuses automatically. "Remind" replies in the same thread. Invitations appear in the travelers' calendars after booking.

**Phase 4 — Disruptions.** `POST /api/events`, meeting-cancelled and meeting-moved flows, carrier cancellation and delay flows, detection from sync, and the Disruptions screen from real data. README `curl` examples.
*Check:* deleting the meeting in Google Calendar, or sending a fake airline email, leads to proposed actions with correct fees. Paid cancellations wait for approval. Travelers and the organizer are notified. Calendars are updated.

**Phase 5 — Post-trip.** Receipt upload, extraction, policy check per line, the report screen, and the gated "Send report" action.
*Check:* a photographed receipt becomes a correct expense line, and the report email is sent only after approval.

**Phase 6 — Assistant (optional).** `POST /api/assistant` using OpenAI function calling with a restricted tool set: `get_trips`, `get_trip_status`, `send_reminder` (auto), `search_alternatives`, `propose_action` (creates a `proposed` action that goes through the gate). The answer is grounded only in DB data. Wire the existing Assistant screen.
*Check:* "relance Marc" sends a reminder; "annule l'hôtel de Sarah" creates a pending action but does not execute it.

## 11. Do not

- Do not add mocks, fake data generators, or a demo mode. Keep existing fixtures only where a screen is not yet wired, and remove them once it is.
- Do not let the LLM execute bookings, cancellations, payments, or report submissions.
- Do not complete payments.
- Do not expose secrets or refresh tokens to the client, or log them.
- Do not add Slack, Microsoft Teams, or other messaging channels yet. Keep outreach behind a small `notify(traveler, message)` function in `server/agent/` so a chat channel can be added later without touching the flows.
- Do not add auth roles, a separate backend, Docker, queues, or cron infrastructure.
- Do not hardcode dates, model names, Jinko tool argument shapes, or URLs (use `APP_URL`).
- Do not break existing routes or the design system.