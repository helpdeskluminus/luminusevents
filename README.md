# Luminus Events — techfest check-in system

Role-based event check-in system: main-gate + per-competition venue scanning,
QR ticket emails sent from a no-reply address, and scoped dashboards for
Admin, Event OC, and the Disciplinary Committee.

**Stack:** Vite + React + TypeScript + shadcn/ui, backed entirely by
[Lovable Cloud](https://docs.lovable.dev/features/cloud) (a managed Supabase
project — Postgres + Auth + Storage + Edge Functions). There is no separate
Node server to run — the app is a static SPA that talks directly to Supabase,
with all privileged logic (creating staff accounts, verifying scans, sending
email) living in Edge Functions that use the service-role key server-side.

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

There's no public sign-up. Create the first admin manually:

1. In the Supabase Dashboard, go to Authentication → Users → Add user, and
   create an account for yourself.
2. Run `BOOTSTRAP_FIRST_ADMIN.sql` (in this repo) in the SQL Editor, with
   your email swapped in.
3. Sign in at `/auth`. From the Admin dashboard you can now create every
   other staff account (Event OC / Disciplinary) — no one else ever needs
   direct SQL access.

## How the roles work

- **admin** — creates events and competitions, creates Event OC /
  Disciplinary staff logins (via the `create-staff-user` edge function,
  which validates the caller is an admin before touching `auth.admin`),
  sees every dashboard, can scan at either checkpoint.
- **event_oc** — scoped server-side to exactly one competition
  (`user_roles.competition_id`). The `scan-ticket` edge function reads this
  from the caller's own `user_roles` row — it is never taken from client
  input — so an Event OC account cannot see or scan another competition's
  registrations even by tampering with requests.
- **disciplinary** — cross-fest read access (all registrations, all
  check-ins) plus main-gate scanning authority.

There's intentionally no `gate_staff` role yet — main-gate scanning
currently requires `admin` or `disciplinary`. Worth adding if you don't want
full-privilege accounts physically operating gate devices; see "Extending
this" below.

Participants themselves are **not** app users — they never get a password.
A participant is just a row created by the public registration flow, keyed
to a unique, cryptographically random `qr_secret_token` (their only
"credential").

## How check-in works

1. A participant registers for a competition (`register-participant` edge
   function) — this creates/updates their `participants` row, creates a
   `registrations` row with a signed QR token, and fires the ticket email.
2. **Main gate scan** (`mode: "gate"`, admin/disciplinary only): verifies the
   QR signature, looks up the registration, checks for a very recent
   duplicate scan (6s debounce, to absorb a phone camera re-triggering on
   the same code), logs the check-in.
3. **Venue scan** (`mode: "venue"`, Event OC scoped to their own competition,
   or admin): same verification, plus confirms the ticket is actually
   registered for *that* competition before logging it.

Both write to a single `checkins` table — every dashboard (Admin/OC/DC) is
just a filtered, RLS-scoped read over that same table via Supabase Realtime,
so they can't drift out of sync with each other.

## Ticket emails

Sent via [Resend](https://resend.com) from `send-ticket-email`, styled like
a real event ticket: event/competition poster image, attendee name, venue,
date/time, ticket code, and an embedded QR code image (rendered server-side
and stored in the public `event-images` bucket so email clients can load
it). Requires two Edge Function secrets to actually deliver:

- `RESEND_API_KEY`
- `FROM_EMAIL` — e.g. `"Luminus Events <no-reply@yourdomain.com>"`, using a
  domain verified in Resend. Without this it falls back to Resend's sandbox
  address, which is fine for testing but will not reliably land in inboxes
  for a real fest.

If `RESEND_API_KEY` isn't set, the function logs a warning and returns
`{ skipped: true }` rather than failing registration — but the participant
won't receive a ticket, so confirm this secret is set before go-live.

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
- Confirm `RESEND_API_KEY` / `FROM_EMAIL` are set (see above).
- SPF/DKIM/DMARC configured for your sending domain in Resend, or mail will
  land in spam.
- No system is "unhackable" — this avoids the common high-impact mistakes
  (unscoped data access, client-trusted roles, guessable tickets), but get
  someone to review it before it's load-bearing for a real fest.

## CSV / bulk registration

Not currently implemented as bulk upload — registration happens one
participant at a time via `register-participant`. Worth adding if you need
to pre-load a roster instead of relying on self-registration.

## Extending this

- Add a `gate_staff` role scoped to a single checkpoint, separate from full
  `admin`/`disciplinary` privileges.
- Bulk CSV participant upload for pre-registered rosters.
- Exit scans / occupancy tracking, rather than cumulative check-in counts.
