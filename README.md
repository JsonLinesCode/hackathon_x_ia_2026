# Travel Manager

B2B travel coordination using the existing desktop dashboard and mobile design system.
Phase 1 of [BUILD_PLAN.md](BUILD_PLAN.md) is implemented: Google sign-in through
Supabase, persistent travelers and policy, connection settings, and the tested
domain foundation. No later-phase integrations or agent workflows are implemented.

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
- Future workflow tables are readable by their owner and writable only by trusted
  server workflows. Phase 1 grants user mutations only on travelers and policies.
  No background worker, queue, payment flow, email sender or calendar sync exists.
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
The LLM has no execution path in Phase 1.

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

## Screens retained for later phases

| Route | Current behavior |
| --- | --- |
| /login | Real Google sign-in |
| /travelers | Persistent traveler CRUD |
| /policies | Persistent policy editing |
| /profile | Manager account, Google status, reconnect, sign out |
| / | Existing overview / mobile traveler fixture |
| /trips, /trips/new | Existing trip fixtures and draft behavior |
| /trips/berlin/planning, /trips/berlin | Existing planning and approval fixtures |
| /disruptions, /my-trip, /itinerary | Existing travel fixtures and .ics export |
| /assistant | Existing fixture-based answers |
| /design-system | Shared UI reference |

The three wired pages no longer use browser localStorage or fixture records.
Draft and plan localStorage remains only in unwired Phase 2 screens; replace it
when those screens are connected. These screens do not book, email, sync, or
monitor real trips. Their original layout, typography, bundled Inter font,
brand mark, responsive navigation and shared UI components are preserved.

Only allowed dependencies were added: @supabase/supabase-js, @supabase/ssr,
server-only and Vitest (development). OpenAI, Jinko and Google service SDKs are
deferred to their phases.

Implementation references: [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client),
[Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google),
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
