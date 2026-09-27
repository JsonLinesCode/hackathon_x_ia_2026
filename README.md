# Travel Manager

B2B travel coordination using the existing desktop dashboard and mobile design system.
Phases 1 and 2 of [BUILD_PLAN.md](BUILD_PLAN.md) are implemented: Google sign-in,
persistent travelers and policy, OpenAI request extraction, live Jinko searches,
ranked options, recorded approvals and unpaid quote links. The existing desktop
and mobile layout is retained. Phases 3–6 are not implemented.

## Local setup

Use Node.js 22 or newer and the pinned pnpm version (10.17.1).
Next.js and eslint-config-next remain on patched 15.5.26.

```bash
corepack enable
pnpm install
# On a fresh checkout only; preserve your existing apps/web/.env.local.
cp .env.example apps/web/.env.local
pnpm dev
```

The Next.js application lives in apps/web. Keep its environment file there.
Phase 1 requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
SUPABASE_SERVICE_ROLE_KEY and APP_URL at runtime. Locally, use
APP_URL=http://localhost:3000 and keep that port free so OAuth redirects match.

Other variables are documented in .env.example for their respective phases.
APP_SECRET must have at least 32 random characters when signed links are used.
Signed-link helpers accept the secret explicitly; they never read secrets in client code.
Google's client ID and secret must already be configured in the Supabase Google
provider for Phase 1; application-side Google token refresh starts in Phase 3.

Environment validation is lazy and scoped to the operation. Missing variables
produce messages naming the variables. The build requires no runtime credentials.
All planned variable names are declared in turbo.json globalEnv.
Service keys, Google provider tokens, APP_SECRET and other secrets must never use a
NEXT_PUBLIC_ prefix. The existing .gitignore excludes apps/web/.env.local.

## Manual Supabase setup

1. Open your project's SQL editor and run
   [supabase/migrations/0001_foundation.sql](supabase/migrations/0001_foundation.sql)
   **once**. This creates all 14 tables, ownership constraints, RLS, the first-sign-in
   profile/policy trigger, and the private receipts bucket. It also initializes
   profiles and policies for any accounts already present.
2. In Authentication → Providers, enable Google and enter your Google Cloud OAuth
   web application's client ID and secret.
3. In Authentication → URL Configuration, set Site URL to APP_URL and allow the exact
   app callback URLs for local development and production:
   http://localhost:3000/auth/callback and your production APP_URL + /auth/callback.
4. In Google Cloud, register the **Supabase provider callback**
   https://YOUR_PROJECT.supabase.co/auth/v1/callback as an authorized redirect URI
   on that OAuth web client. This differs from the app callback above.
5. Enable the Google Calendar API and Gmail API. Configure the consent screen for:
   openid, email, profile, calendar.events, calendar.readonly, gmail.send and gmail.readonly.
   The four API scopes use the https://www.googleapis.com/auth/ prefix.
   While the Google app is in Testing, add each manager's email as a test user.
6. Copy the project URL, anon key and service-role key to apps/web/.env.local.
   Configure the same variables in Vercel, with APP_URL set to the production origin.

The migration is intentionally not applied automatically. Do not paste secrets
into SQL, commit them, or send them in chat. No SQL changes beyond 0001 are needed
for Phase 1.

## Phase 1 acceptance checks

After the configuration above, run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Then check the real account flow manually:

1. Open /login and continue with Google. Grant the requested permissions.
2. In the Supabase SQL editor, verify the credential exists without displaying it:
   `select user_id, updated_at, invalidated_at from public.google_credentials;`
3. Open /travelers. Create a traveler, reload, edit and reload again.
   Confirm name, email, airport and preferences persist; delete the record.
4. Open /policies, change a cap and save. Reload and sign out/in:
   your changes must persist and must not be replaced by defaults.
5. Open /profile: your account and Google connection should be shown.
6. Sign out. Protected pages redirect to /login; /api/travelers returns JSON 401.
   With a second Google test account, confirm the first account's travelers and
   policy are not visible.
7. Check /travelers, /policies and /profile on desktop and at mobile width.

If no Google refresh token is returned, Settings explains how to remove the
app's access at https://myaccount.google.com/permissions and reconnect.
“Connected” means a usable-looking stored credential exists; live token refresh
and API permission checks are part of Phase 3. A setup error names the missing
migration or environment variable rather than falling back to fixtures.

## Phase 2 setup and acceptance

Phase 1 is a prerequisite; do not rerun its migration on an initialized project.

1. Run [0002_planning.sql](supabase/migrations/0002_planning.sql) once in the Supabase SQL editor.
   It adds persisted workflow checkpoints, traveler booking details, service-only
   leases/RPCs, and a database guard that requires a recorded decision for quotes.
2. Set OPENAI_API_KEY, OPENAI_MODEL, JINKO_MCP_URL, JINKO_API_KEY and optionally
   JINKO_API_KEY_HEADER in apps/web/.env.local and in Vercel. The key must belong to
   the environment targeted by the Jinko URL. Authorization uses Bearer; other
   header names receive the raw key. No model or environment is assumed.
3. From the repository root, check the actual integrations:

   ```bash
   node apps/web/scripts/check-integrations.mjs
   # Optional read-only search; substitute real future dates and airport codes:
   node apps/web/scripts/check-jinko-search.mjs CDG BER Berlin YYYY-MM-DD YYYY-MM-DD
   pnpm dev
   ```

   The first script prints all Jinko tool names/input schemas and checks structured
   output with exactly OPENAI_MODEL. Discovery alone does not validate search access.
   The second script calls only flight/hotel search. Diagnostics may consume provider
   credits; they are never included in pnpm test.
4. Sign in, create/select real traveler records and open /trips/new. Supply the
   destination, exact departure/return dates, meeting start/end times, venue and
   time zone, hotel check-in/out dates, and budget. French and English are supported.
   Relative dates are resolved from the current date in Europe/Paris.
5. Confirm that the Planning screen advances through persisted events. Missing
   essential details must show a clarification form. A valid request must produce
   distinct, ranked, explained Jinko options. Two or three are shown when live
   inventory supplies distinct alternatives; no options are invented.
6. Select an option. For a non-compliant option, check that confirmations and
   quoting remain blocked until you obtain external approval and record
   **Exception approved**. A low policy hotel cap can exercise this path.
7. Record each traveler's confirmation with their real document names and contact
   phone. Flights also need date of birth and document gender. Confirm adult
   travelers and the choice to omit optional extras. Inspect cost and cancellation
   terms before clicking **Approve quote** for each traveler.
8. Reload or open a second tab while processing. Completed steps must persist.
   Repeated decisions/run requests must not create another cart or checkout.
   Reject an action on a separate test trip and verify no quote starts for it.
9. Verify that booking rows have status quoted, provider references, raw provider
   payloads and payment links; the action has decided_at and ends at executed.
   Open the payment page to inspect it if desired; **do not pay as part of this test**.
   The app never invokes a payment tool. The trip status booked is presented as
   "Payment links ready", not as a paid or ticketed reservation.
10. Open the itinerary, export .ics and verify UTC flight instants, hotel date-only
    stays, meeting time zone and tentative status. Check desktop and mobile widths.
    A second manager must not be able to load another manager's trip or approve its actions.

The agent has verified live discovery, OpenAI extraction/explanation, Jinko searches
and hotel details. The SQL migration was executed against a disposable local
PostgreSQL engine, including isolation, concurrent lease and action-gate checks.
The authenticated end-to-end quote/payment-link run is intentionally left to you:
it requires your migrated Supabase project, real traveler details and your decision.

If a provider mutation times out or the response cannot be saved, the persisted
inflight marker prevents automatic replay. The UI explains that reconciliation is
required, with the Jinko cart reference when known. Inspect that cart with Jinko
or ask their support before starting a replacement trip. Do not reset execution
markers blindly. Expired search offers can be refreshed with **Search again**
before a provider quote starts; this invalidates old confirmations and approvals.
An idle page resumes from persisted state; there is no background worker when the
application is closed. A crashed server lease expires after 350 seconds.

This phase supports up to 12 adult business travelers, shared travel dates, flights
(one-way or round trip), and one hotel room per traveler. Requirements outside the
implemented search filters are returned for clarification. Calendar checks, Gmail,
reminders, real disruption handling and expenses are still later phases.

See [the captured Jinko contract](docs/jinko-contract.md) for the actual tool names,
response shapes, money handling, cancellation limitations and diagnostics.

## Architecture and security boundaries

- apps/web/src/server: server-only environment access, Supabase clients and auth.
- apps/web/src/app/api: user-authenticated CRUD. Payloads are validated with Zod;
  owner IDs always come from the verified session.
- apps/web/src/middleware.ts: refreshes cookies and verifies the manager with
  Supabase getUser. /api routes authenticate themselves and never receive login
  redirects. /login, /auth/*, /r/* and static assets stay public.
- Supabase sessions use HttpOnly cookies. Provider access/refresh tokens are
  stripped before cookies are written; the Google refresh token is captured in
  /auth/callback and stored only using the service client.
- User-scoped clients perform travelers/policy CRUD under RLS.
  Credential tables have no user policies or grants. Composite foreign keys
  prevent attaching a different owner's traveler or trip, even in service workflows.
- Workflow tables are readable by their owner and writable only by trusted
  server workflows. Phase 1 grants user mutations only on travelers and policies.
  Phase 2 adds service-only atomic commits and leases. Each API checks ownership
  before using a service client. No background worker, queue, payment executor,
  email sender or calendar sync exists.
- The private receipts bucket uses owner-id/trip-id/filename paths and checks both
  account and trip ownership. Upload UI is Phase 5.
- packages/types: shared Zod domain contracts. The small original TravelerSchema
  remains only for screens still using the supplied fixtures; new records use
  TravelerRecordSchema.
- packages/core: pure policy evaluation, action gating, cancellation costs, option
  ranking, allowed state transitions, date resolution and Web Crypto signed links.

The action gate fails closed on unknown kinds, costs or malformed input. Booking,
cancellation, paid modification and report submission require a recorded manager
decision. Free informational messages, confirmation requests, reminders, recap
and calendar actions can be automatic only when explicitly reversible.
Unknown cancellation terms remain unknown and require review.
OpenAI only extracts and explains. It has no tools and cannot execute a booking.
Only the orchestrator can prepare approved Jinko quotes.

Default policy: economy below six hours, EUR 180 per person/night, a 60-minute
arrival margin, and no workspace budget cap until the manager sets one.
Policy evaluates each traveler's total, including every hotel night.
Ranking puts compliance first, then normalized cost, duration and arrival shortfall.
A bare weekday means the next occurrence including today; “next Tuesday” or
“mardi prochain” means strictly after today. Unclear dates, and ambiguous or
nonexistent daylight-saving times, are rejected for clarification.
Signed links are HMAC-SHA256, purpose-bound, and valid for at most seven days.

Vitest covers gate boundaries, policy thresholds, costs and ranking, cancellation
deadlines, state transitions, French/English dates, DST, signed-link tampering and
expiry, scoped env validation, cookie sanitization, OAuth capture, auth middleware,
and CRUD ownership/input/error handling. Unit tests use isolated test doubles;
the application has no mock mode.

## Screens

| Route | Current behavior |
| --- | --- |
| /login | Real Google sign-in |
| /travelers | Persistent traveler CRUD |
| /policies | Persistent policy editing |
| /profile | Manager account, Google status, reconnect, sign out |
| /, /trips | Real trip list and attention counts |
| /trips/new | Persisted free-text request |
| /trips/[id]/planning | Resumable planning and clarification |
| /trips/[id] | Ranked options, exception approval, manual confirmations, decisions, timeline |
| /trips/[id]/itinerary | Stored quotes and tentative .ics export |
| /trips/berlin, /trips/berlin/planning, /itinerary | Redirect to the real trips list |
| /disruptions, /my-trip | Original fixtures retained for their later phases |
| /assistant | Original fixture-based answers; Phase 6 |
| /design-system | Shared UI reference |

Wired screens use neither localStorage nor fixture records. Unwired screens do
not book, email, sync or monitor real trips. Layout, typography, bundled Inter
font, brand mark, navigation and shared UI components are preserved.

Dependencies added in Phase 2 are only openai and @modelcontextprotocol/sdk.
Tests use isolated doubles and small captured provider responses, never an
application mock mode. They cover request ambiguity, exact totals, UTC exports,
auth boundaries, recorded approval, interrupted mutations and duplicate runs.

Implementation references: [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client),
[Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google),
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
[Jinko MCP](https://docs.gojinko.com/connect/mcp).


## Phase 3 — Google coordination

Apply **0003_coordination.sql** after 0002. It adds service-only, single-use
OAuth state and sync leases, extends outreach checkpoints, and makes approved
action payloads immutable. The only new dependency is google-auth-library;
Calendar and Gmail use their documented REST APIs through server-only adapters.

In Google Cloud, enable **Gmail API** and **Google Calendar API**. Keep the
existing Supabase OAuth callback and add these **Authorized redirect URIs** to the
same OAuth web client:
- http://localhost:3000/api/google/traveler/callback
- your APP_URL + /api/google/traveler/callback on Vercel

Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL and APP_SECRET
locally and in Vercel. In OAuth consent **Testing**, add the manager and every
personal Gmail traveler as test users. Reconnect the manager from Settings to
grant Calendar read/write and Gmail read/send scopes if not already granted.
Travelers grant only identity/email and read-only Calendar access. Consent uses
PKCE, a signed state, a browser-bound cookie, one-time consumption and verified
Google email matching. Refresh tokens remain service-role-only.

Manual acceptance:
1. Create a trip using an existing Calendar meeting's exact title, location and
   times. Check the matched event and availability entries in the timeline.
2. With personal Gmail travelers, follow the consent email. Try a wrong Google
   account, denied access, expired link and an address absent from Google test
   users. None must silently grant access.
3. Select a plan and resolve exceptions. Open the confirmation link in a private
   browser without signing in. Only that traveler's itinerary is shown.
4. Confirm by link, then test a plain-text Gmail reply and **Sync now**. Confident
   confirmations/declines/counter-proposals are applied; ambiguous replies require
   manager review. A counter-proposal searches only that traveler and preserves
   the others' selected offers. A group meeting change needs manager clarification.
5. Test **Remind** after two hours: same Gmail thread, original subject and
   Message-ID references. Repeated clicks must not send another reminder.
6. Supply real travel-document details (or record a manual confirmation), approve
   quotes, then check tentative Calendar invitations and recap emails. Payment
   links appear only in the manager's recap, never in traveler emails.
7. Reload during sending. A saved message is reconciled using its Message-ID;
   uncertain delivery is flagged rather than resent. Calendar IDs are stable.
8. Revoke Google access: Settings should show reconnect required and the workflow
   must surface the failure.

Sync runs every 60 seconds while the app is open, or on **Sync now**. Gmail scans
are paginated and inbound IDs are deduplicated. There is no background worker.
Traveler links expire after seven days and stale itinerary links are rejected.
After expiry, refresh the plan to send new confirmations. Unknown availability is
explicit and confirmation asks the traveler to verify their own schedule.

Automated tests cover classification thresholds, reminder boundaries, MIME/header
safety, stable event IDs, ambiguous meeting matching, authenticated routes and
interrupted-send reconciliation. The migration was tested locally; real Gmail
delivery and Calendar invitations must be checked with your Google test accounts.
References: [Gmail sending](https://developers.google.com/workspace/gmail/api/guides/sending),
[Gmail threads](https://developers.google.com/workspace/gmail/api/guides/threads),
[Calendar events](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert),
[OAuth web server flow](https://developers.google.com/identity/protocols/oauth2/web-server).
