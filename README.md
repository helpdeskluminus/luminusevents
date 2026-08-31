# Luminus Events — techfest check-in system

Role-based event check-in system: main-gate + per-competition venue scanning,
QR ticket emails sent from a no-reply address, and scoped dashboards for
Admin, Event OC, and the Disciplinary Committee.

**Stack:** Vite + React + TypeScript + shadcn/ui, backed by Supabase
(Postgres + Auth + Storage + Edge Functions). There is no separate Node
server to run — the app is a static SPA hosted on Vercel that talks
directly to Supabase, with all privileged logic (creating staff accounts,
verifying scans, sending email) living in Edge Functions that use the
service-role key server-side.

> If you're browsing the repo history: earlier commits included a parallel
> Express + SQLite + JWT backend (`src/server.js`, `src/routes/`,
> `src/middleware/`, `src/db/`). It was never wired into `package.json` and
> never actually ran — it has been removed. The system described below is
> what is actually live.

## Quick start

```bash
npm install
cp .env.example .env   # fill in your Supabase project's URL + anon key
npm run dev
```

Visit the printed local URL. Sign in at `/auth` (staff only — see below).

## Bootstrapping the first admin

Staff sign-up is public (`/auth` → Create account), but a brand new account has
no role and can't reach any dashboard until an admin approves it — and the
very first admin has to be granted manually, since no admin exists yet to
approve them:

1. Go to `/auth` on your deployed site and create an account for yourself
   (Create account tab). This creates the auth user + a profile row with no
   role — you won't be able to access anything yet.
2. Run `BOOTSTRAP_FIRST_ADMIN.sql` (in this repo) in the Supabase SQL Editor,
   with your email swapped in. This grants your account the `admin` role
   directly.
3. Sign in at `/auth`. From the Admin dashboard's Staff tab, you'll now see a
   "Pending approval" queue for every future sign-up — pick their role (and
   competition, for Event OC) and approve, or reject to delete the account.
   No one else ever needs direct SQL access again.

## How the roles work

- **admin** — creates events and competitions, creates Event OC /
  Disciplinary / Gate Staff staff logins (via the `create-staff-user` edge
  function, which validates the caller is an admin before touching
  `auth.admin`), sees every dashboard, can scan at either checkpoint.
- **event_oc** — scoped server-side to exactly one competition
  (`user_roles.competition_id`). The `scan-ticket` edge function reads this
  from the caller's own `user_roles` row — it is never taken from client
  input — so an Event OC account cannot see or scan another competition's
  registrations even by tampering with requests.
- **disciplinary** — cross-fest read access (all registrations, all
  check-ins) plus main-gate scanning authority.
- **gate_staff** — main-gate scanning and exit-marking only, without the
  cross-fest read access or scan-limit overrides that `disciplinary` has.
  For a device physically sitting at the door, so it doesn't need to carry
  full admin/disciplinary privileges. Deliberately not per-checkpoint —
  it's always scoped to the main gate, matching how `scan-ticket` already
  separates `mode: "gate"` from `mode: "venue"`.

Participants themselves are **not** app users — they never get a password.
A participant is just a row created by the public registration flow, keyed
to a unique, cryptographically random `qr_secret_token` (their only
"credential").

## How check-in and occupancy work

1. A participant registers for a competition (`register-participant` edge
   function, or in bulk via `bulk-register-participants` — see "CSV / bulk
   registration" below) — this creates/updates their `participants` row,
   creates a `registrations` row with a signed QR token, and fires the
   ticket email.
2. **Main gate scan** (`mode: "gate"`, admin/disciplinary/gate_staff only):
   verifies the QR signature, looks up the registration, checks for a very
   recent duplicate scan (6s debounce, to absorb a phone camera re-triggering
   on the same code), logs the check-in, and marks the ticket's
   `registrations.currently_inside = true`.
3. **Exit marking**: gate staff mark a ticket exited from the scan result
   card or the live gate dashboard (`mark-exit` edge function) — not by
   scanning the QR again. This flips `currently_inside = false` and is
   reversible (mis-taps can be undone). Live occupancy at the gate is
   `count(registrations where currently_inside)`, which actually decreases
   as people leave, unlike the raw cumulative entry count.
4. **Venue scan** (`mode: "venue"`, Event OC scoped to their own competition,
   or admin): same verification, plus confirms the ticket is actually
   registered for *that* competition before logging it. Venue scans don't
   affect gate occupancy.

Both write to a single `checkins` table — every dashboard (Admin/OC/DC) is
just a filtered, RLS-scoped read over that same table via Supabase Realtime,
so they can't drift out of sync with each other.

## Ticket emails

Sent via [Brevo](https://www.brevo.com)'s transactional email HTTP API from
`send-ticket-email`, styled like a real event ticket: event/competition
poster image, attendee name, venue, date/time, ticket code, and an embedded
QR code image (rendered server-side and stored in the public `event-images`
bucket so email clients can load it).

Brevo was chosen over Gmail SMTP and over domain-less Resend specifically:
Gmail SMTP needs a raw TCP connection, and Supabase Edge Functions (Deno
Deploy) don't reliably support that — sends would hang or fail no matter how
correct the App Password was. Resend's free tier can only mail the account
owner unless you verify a full custom domain, which a plain-Gmail fest
doesn't have. Brevo's free tier only needs a single **sender email address**
verified (no DNS/domain setup), sends to any recipient, is called over
plain HTTPS so it works from Edge Functions, and gives 300 emails/day free.

Requires two Edge Function secrets (Project Settings -> Secrets) to
actually deliver:

- `BREVO_API_KEY` — create at https://app.brevo.com/settings/keys/api
- `BREVO_SENDER_EMAIL` — the address you verify under Brevo's
  **Senders, Domains & Dedicated IPs -> Senders** (your existing Gmail
  address works fine here; Brevo just emails you a one-click confirmation
  link). Optionally also set `BREVO_SENDER_NAME` for the display name.

If these aren't set, the function logs a warning and returns
`{ skipped: true }` rather than failing registration — but the participant
won't receive a ticket, so confirm these secrets are set before go-live.

## Security model

- RLS is enabled on every table, default-deny, with explicit per-role
  policies driven by a `security definer` `has_role()` function (not
  recursive — it queries `user_roles` directly, so it's safe to call from
  other tables' policies).
- `user_roles` is a separate, server-controlled table (never a column on a
  client-editable profile) — the standard fix for privilege-escalation via
  a user editing their own "role" field.
- Ticket QR tokens are unguessable random strings, not sequential IDs.
- Every write to `checkins`, `user_roles`, and staff account creation goes
  through an Edge Function using the service-role key — direct client
  writes to those tables are not permitted by RLS.
- Event OC's competition scope is read from their own `user_roles` row
  server-side on every scan — never trusted from the request body.

**Still your responsibility before a real event:**
- Confirm `BREVO_API_KEY` / `BREVO_SENDER_EMAIL` are set (see above), and that
  the sender address has clicked Brevo's verification email.
- Send a few real test emails and check they don't land in spam. Since this
  setup piggybacks on a plain Gmail address rather than a verified custom
  domain, deliverability is good but not guaranteed the way SPF/DKIM/DMARC
  on your own domain would be — if you later get a domain, verify it in
  Brevo for better inbox placement.
- No system is "unhackable" — this avoids the common high-impact mistakes
  (unscoped data access, client-trusted roles, guessable tickets), but get
  someone to review it before it's load-bearing for a real fest.

## CSV / bulk registration

Admins can bulk-register a roster from a CSV (name + email required; phone
and organization optional) via the "Bulk CSV upload" button on the
Competitions tab; Event OCs get the same tool scoped to their own
competition from their dashboard. Under the hood it's the
`bulk-register-participants` edge function, which runs the same
upsert-participant + create-registration + send-ticket-email logic as the
public flow, just looped over up to 500 rows per request, with per-row
success/duplicate/error results returned so you can see exactly which rows
failed and why. Ticket emails can be turned off per-upload if you'd rather
notify people separately.

## In-app password change

Staff can change their own password from the navbar (no need to go through
the email reset-link flow) — it re-confirms the current password before
calling Supabase's `updateUser`, so a session left open on a shared device
can't be used to silently take over the account.

## Public registration rate limiting

`register-participant` is intentionally public and unauthenticated (anyone
with a competition link can register), so it rate-limits by a salted hash of
the client IP rather than raw IP storage: 5 attempts/minute and 20/hour per
IP, tracked in `registration_attempts`. Tune the limits in
`supabase/functions/register-participant/index.ts` if your fest's traffic
pattern needs different numbers.

## Extending this

- Per-checkpoint gate roles, if `gate_staff` being main-gate-only ever stops
  being enough (e.g. multiple physical entrances that should be scoped
  separately, the way Event OC is scoped per competition).
- Rate limiting is IP-based today; consider adding a CAPTCHA or per-email
  cooldown too if a determined abuser rotates IPs.
- Bulk CSV upload fires ticket emails synchronously per row inside the edge
  function's execution window — for very large rosters (hundreds+), consider
  batching into multiple smaller uploads or moving email sends to a queue.
