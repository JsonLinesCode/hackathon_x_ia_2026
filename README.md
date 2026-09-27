# Travel Manager

B2B travel coordination using the existing desktop dashboard and mobile design system.
Phases 1–5 of [BUILD_PLAN.md](BUILD_PLAN.md) are implemented: persistent planning,
OpenAI extraction, live Jinko search and unpaid quotes, Google coordination,
disruption recovery, private receipts and approved expense reports. The existing
desktop and mobile layout is retained. Phase 6 (assistant) remains unimplemented.

## Demo scenario

Northstar Labs uses Travel Manager to coordinate multi-person business travel.
Emma Laurent, a Travel Manager based in Paris, is the primary user. She signs
into the dashboard and asks the agent to organize the Berlin Operations Summit
trip for three employees while respecting calendars, travel preferences, policy
and a target total budget of EUR 2,500.

The travelers are Alice Martin, Product Manager in Paris, Marc Evans, Sales
Manager in London, and Sarah Garcia, Marketing Manager in Madrid. Alice travels
from CDG, is busy until 14:30 on Tuesday, prefers direct flights, avoids
departures before 07:00 and prefers a window seat. Marc travels from LHR, is
busy until 12:00 on Tuesday, prefers Heathrow, avoids very early departures and
prefers an aisle seat. Sarah travels from MAD, is available from early Tuesday
afternoon, needs to be back in Madrid by late Thursday afternoon, requires
checked luggage and prefers direct flights.

The trip runs October 13-15, 2026, with the Q4 Europe Operations Summit on
October 14, 2026 from 09:00 to 17:00 at Alexanderplatz, Berlin
(`Europe/Berlin`). In the demo, Emma enters a natural-language request for the
Berlin trip. The agent extracts the requirements, checks traveler availability
with Google Calendar, searches travel options with Jinko, evaluates company
policy, ranks the best itineraries and presents the recommendation to Emma.
Travelers can then receive confirmation emails and calendar invitations.

The disruption story shows why the product matters after planning: Alice's
flight is cancelled, so the agent searches for alternatives, checks policy and
timing constraints, proposes a replacement, keeps Emma informed and updates the
traveler-facing itinerary.

## Demo accounts

The demo uses separate fictional Google accounts so reviewers can see realistic
Google Calendar, Gmail, traveler consent, availability and email communication
flows. Emma is the only person who signs into the Travel Manager dashboard.
Alice, Marc and Sarah are traveler records in the application; their Google
accounts only provide realistic calendars and email interactions. Reviewers do
not need to log into the traveler accounts.

```text
Emma Laurent
Travel Manager
|
v
Travel Manager app
|
+--> Google Calendar
+--> Gmail
+--> OpenAI
+--> Jinko
|
v
Alice / Marc / Sarah
Travelers
```

### Public calendar links for reviewers

For demo review, make only the four fictional Google calendars public. This
lets judges inspect the imported mock agendas without signing into the traveler
accounts or seeing any credentials.

For each fictional Google account, open Google Calendar on a computer:

1. Go to Settings -> Settings for my calendars -> the imported demo calendar.
2. Under Access permissions for events, enable Make available to public.
3. Set the permission to See all event details.
4. Under Integrate calendar, copy Public URL to this calendar.
5. Share that public URL with reviewers. Do not share passwords, recovery
   details, API keys, OAuth tokens or the Secret address in iCal format.

Reviewer links for the mock week:

| Calendar | Public reviewer link |
| --- | --- |
| Emma Laurent | Add public Google Calendar URL |
| Alice Martin | Add public Google Calendar URL |
| Marc Evans | Add public Google Calendar URL |
| Sarah Garcia | Add public Google Calendar URL |

If the copied public URL opens on the current date instead of the demo week,
append `&mode=WEEK&dates=20261012/20261019` to the Google Calendar embed URL so
reviewers land directly on the week containing October 12-15, 2026.

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
implemented search filters are returned for clarification. Calendar coordination, disruptions and expenses are implemented in Phases 3–5 below.

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
  before using a service client. The orchestrator handles Gmail/Calendar operations and approved report submissions.
  No background worker, queue or payment executor exists.
- The private receipts bucket uses owner-id/trip-id/filename paths and checks both
  account and trip ownership. Phase 5 routes validate uploads and hold workflow leases;
  direct client uploads/deletions are disabled to protect approved reports.
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
OpenAI extracts, explains, drafts and classifies. It has no tools and cannot execute actions.
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
| /trips/[id] | Ranked options, exceptions, emailed confirmations, decisions, recovery and timeline |
| /trips/[id]/itinerary | Stored quotes and tentative .ics export |
| /trips/berlin, /trips/berlin/planning, /itinerary | Redirect to the real trips list |
| /disruptions | Real disruptions and approved recovery actions |
| /r/[token] | Public, scoped traveler confirmation and itinerary |
| /my-trip | Redirect to the manager trips list |
| /trips/[id]/report | Private receipts, expense verification, totals and approved report delivery |
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

## Phase 4 — Disruptions

Apply **0004_disruptions.sql** after 0003. It adds a service-only checkpoint RPC
that can replace options while retaining booking/action history, and blocks
replacement while a quote is executing. Configure SIMULATION_SECRET (at least
32 characters) in .env.local and Vercel. No new dependency is required.

Calendar cancellation (including 404/410) and time changes, matched Gmail notices,
and POST /api/events enter the same persisted recovery flow. Inbound IDs are
deduplicated. A second disruption waits while the first recovery or a quote is
running. Gmail notices need confidence >= 0.8 and a unique saved booking/event
reference; ambiguous notices appear as review events and do not trigger recovery.
Sync reads one provider cart at a time to collect supplier references. A booking
reference alone is never treated as proof of payment.

Recovery checks other destination events on accessible calendars, alerts the
manager/travelers, displays cancellation previews, and proposes cancel, move or
keep. Unknown fees stay unknown. Jinko servicing uses the captured get_booking,
flight_refund and hotel_cancel contracts: preview before approval, the exact
acknowledged customer refund on commit, and the operation handle for status.
Missing tools, unrecognized output, missing item references, expired previews,
manual-only servicing and uncertain mutations require manual reconciliation.
No legacy one-shot refund/cancel operation or payment tool is called.

A replacement is searched from the affected outbound origin on the requested
travel dates. Already-departed and originally disrupted flights are excluded.
Late alternatives remain visibly non-compliant; existing active hotel costs count
toward policy. Selecting a replacement requires traveler confirmation, any policy
exception and a separate quote approval. If the dates/origin must change, use
Move travel dates (or a revised request for a different origin). Moving travel
does not silently cancel existing supplier bookings.

Manual acceptance:
- Delete or move the exact Calendar event linked to an active trip, then Sync now.
- Test a carrier email containing the exact saved provider/supplier reference.
- Open Disruptions: inspect other commitments, fees/refunds/deadlines and choices.
- Reject a cancellation: no provider commit may occur. Approve one only with a
  suitable sandbox booking and after reviewing its preview; no payment is needed.
- For an unsupported/unpaid cart, verify Manual follow-up with its reference.
  Record external cancellation only after checking with the provider.
- Test lost responses/reloads: no second cancellation commit. Pending provider
  operations are polled, and uncertain outcomes require reconciliation.
- Verify delayed-flight invitations update, cancelled/superseded invitations are
  removed, and replacement invitations appear after approved quoting.
- For a late arrival, check the organizer email (when the linked Calendar event
  supplied an organizer). No organizer address is guessed.
- Use separate trips or resolve the current recovery before testing another event.

Simulation examples (replace UUIDs, email, timestamps and provider reference;
SIMULATION_SECRET must already be in your shell environment). These are real
workflows: they can send emails/invitations and prepare decisions, not a mock mode.

```bash
curl "$APP_URL/api/events" -H "Authorization: Bearer $SIMULATION_SECRET" \
  --json '{"owner_email":"manager@example.com","idempotency_key":"meeting-cancelled-001","trip_id":"TRIP_UUID","kind":"meeting_cancelled","detail":"Meeting cancelled by the organizer."}'

curl "$APP_URL/api/events" -H "Authorization: Bearer $SIMULATION_SECRET" \
  --json '{"owner_email":"manager@example.com","idempotency_key":"meeting-moved-001","trip_id":"TRIP_UUID","kind":"meeting_moved","new_start":"FUTURE_ISO_START_WITH_OFFSET","new_end":"FUTURE_ISO_END_WITH_OFFSET"}'

curl "$APP_URL/api/events" -H "Authorization: Bearer $SIMULATION_SECRET" \
  --json '{"owner_email":"manager@example.com","idempotency_key":"flight-cancelled-001","trip_id":"TRIP_UUID","booking_id":"FLIGHT_BOOKING_UUID","kind":"flight_cancelled","detail":"Carrier cancellation notice."}'

curl "$APP_URL/api/events" -H "Authorization: Bearer $SIMULATION_SECRET" \
  --json '{"owner_email":"manager@example.com","idempotency_key":"flight-delayed-001","trip_id":"TRIP_UUID","booking_id":"FLIGHT_BOOKING_UUID","kind":"flight_delayed","new_arrival":"FUTURE_ISO_ARRIVAL_WITH_OFFSET","detail":"Carrier delay notice."}'

curl "$APP_URL/api/events" -H "Authorization: Bearer $SIMULATION_SECRET" \
  --json '{"owner_email":"manager@example.com","idempotency_key":"carrier-email-001","trip_id":"TRIP_UUID","kind":"inbound_email","subject":"Flight cancelled","body":"Your flight under reference EXACT_SAVED_PROVIDER_REFERENCE has been cancelled."}'
```

A logged-in request may omit the bearer header and owner_email; ownership then
comes exclusively from the session. Repeating the same idempotency key does not
create another recovery. Automatic tests use isolated provider doubles; no real
cancellation or refund was performed during implementation.

## Phase 5 — Receipts and expense reports

Apply [0005_post_trip.sql](supabase/migrations/0005_post_trip.sql) after 0004.
It adds owner-isolated receipt metadata, expense review fields, duplicate constraints
and an atomic checkpoint that invalidates pending report approvals when expenses
change. Once delivery starts, report data is frozen. Authenticated clients can
read their private receipts; only the leased server flow writes/deletes metadata
or uploads files. The bucket remains private.

No new dependency or environment variable is required. OPENAI_MODEL must support
the Responses API with structured outputs and image/PDF inputs. Use the existing
OpenAI and manager Gmail credentials; missing access is shown as an error.

From a trip, open **Expenses & report**. JPEG, PNG, WebP and PDF files up to
**4 MiB** are accepted. File signatures are checked and bytes are hashed to avoid
duplicate uploads, including recovery after an interrupted upload. Extraction
runs one receipt per saved step while the page is open. Unreadable fields remain
empty; they are never guessed. Files and extracted lines stay scoped to the manager.

Verify each line against the original receipt before saving it. For non-EUR
receipts, enter the EUR amount from an actual card statement or other verified
conversion source, and record that source in the note. There is no FX provider
and no inferred exchange rate. Hotel expenses require nights. The current policy
checks nightly hotel cost and cumulative per-traveler budget; potential duplicates,
unknown conversions, flight-class evidence and other business-purpose questions
are flagged. Policy issues stay visible in the approved report.

Reports require a **completed** or **cancelled** trip and at least one verified
expense. Mark a trip completed only after its recorded travel dates have ended
and its actual outcome has been checked. Cancelled trips can report incurred
expenses. All receipts must be reviewed or explicitly excluded with a reason.
The CSV export is available earlier and clearly exposes review/compliance fields.

The manager enters the recipient, prepares a report and reviews the exact email.
**Approve & send report** records a separate needs_manager decision. Until approval,
no report is sent. Rejections do not send. A changed expense or policy makes an old
approval unusable. The immutable report snapshot records the policy, lines and totals
per traveler. Successful Gmail delivery moves the trip to reported.

A lost response is reconciled through the saved RFC Message-ID. If delivery cannot
be proven, the action fails with manual instructions and the report remains frozen;
it is never sent a second time automatically. Inspect Gmail Sent/the recipient
before any manual follow-up. Do not reset execution markers or recreate a report
blindly. Receipts are not attached to the email; the recipient receives the verified
summary and expense lines. After submission, the report screen and CSV preserve the approved policy results
and traveler names from the immutable snapshot. Original files remain private, with short-lived download
URLs for the authenticated manager.

Manual acceptance:
1. Apply 0003, 0004 and 0005 in order if they have not yet been applied, then start
   the app with pnpm dev (or deploy the committed code through your normal process).
2. On a trip, upload a real photographed receipt and a PDF. Keep the report page
   open, verify the extracted merchant/date/amount/currency and correct any OCR
   error against the original. Check hotel nights and policy warnings.
3. Upload the exact same file again: no extra receipt or expense must be created.
   Test an unreadable date, a foreign currency, an unsupported file and a file
   over 4 MiB. Unknown EUR conversions must be absent from totals until verified.
4. Check expense totals per traveler, possible duplicates, excluded receipts and
   the CSV. Open the page on desktop and mobile. A second account must not read
   the trip, receipt metadata, download endpoint or private storage object.
5. Use a trip whose travel dates have ended, or a cancelled trip with incurred
   expenses. Complete/review it, enter a test recipient you control, then prepare
   a report. No report email should exist yet. Inspect its exact recipient and body.
6. Reject a proposal and verify no delivery. Prepare another, approve it and keep
   the page open until reported. Check the message in both Gmail Sent and the
   recipient inbox. Reload during processing and confirm there is only one report.
7. Before approving a draft, edit an expense: the earlier proposal must be rejected.
   A policy edit must make approval of a stale snapshot fail and require a fresh
   report. Read the final sent report from its saved snapshot.

Validation uses Vitest test doubles and a disposable local PostgreSQL engine for
migrations, ownership, private storage policies, atomic updates, approval
invalidation and frozen submissions. It does not send real emails, mutate Google
calendars, cancel provider bookings or apply migrations to your live project.
See [OpenAI PDF inputs](https://developers.openai.com/api/docs/guides/pdf-files)
for model requirements and document-input behavior.
