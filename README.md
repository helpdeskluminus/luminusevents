# Techfest check-in system

Role-based event check-in system: main gate + per-competition zone gate scanning,
QR codes emailed automatically from a no-reply address, and three scoped dashboards
(Admin, Event OC, Disciplinary Committee).

## Quick start

```bash
npm install
cp .env.example .env
# edit .env — set real secrets (see "Generating secrets" below) and SMTP details
node src/server.js
```

Visit `http://localhost:4000` — log in with the bootstrap admin credentials from `.env`
(`BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`), then **immediately change the
password and remove the bootstrap password from `.env`.**

The scanner UI is at `/scanner.html` (needs camera access — works on phones/tablets over HTTPS).

## Generating secrets

```bash
openssl rand -hex 64   # run twice — once for JWT_SECRET, once for QR_TOKEN_SECRET
```
Never reuse the same secret for both. If one leaks, the other credential class stays safe.

## How the roles work

- **Admin** — creates events, creates Event OC / Disciplinary Committee logins, bulk-uploads
  participants via CSV, triggers the QR emails, sees a fest-wide dashboard.
- **Event OC** — logs in and is *hard-scoped* server-side to their own `event_id`. They cannot
  query another event's data even by editing request parameters — the server ignores any
  client-supplied `event_id` for this role and substitutes their assigned one.
- **Disciplinary Committee** — cross-event read access: live occupancy across all zones, a feed
  of denials/duplicates/revocations, per-participant history, and can file incident reports.

## How check-in works

1. Participant is uploaded (CSV) or registered, gets a unique signed QR token, mailed to them.
2. **Main gate scan** (admin/gate-staff): validates the QR signature, checks it hasn't been
   revoked, checks for duplicate entry, logs it.
3. **Zone gate scan** (Event OC, scoped to their event): requires the participant already passed
   the main gate, requires they're registered for *that specific* competition, checks venue
   capacity, checks for duplicates, logs it.

Both scans write to one `scan_logs` table — live counts are just filtered queries over it, so
Admin/OC/DC dashboards never go out of sync with each other.

## Forgot password

`POST /api/auth/forgot-password` with `{ email }` — always returns the same generic message
regardless of whether the account exists, so it can't be used to check who has an account.
If the account exists, a one-time reset link is emailed (`/reset-password.html?token=...`).

- The raw token only ever exists in the email. The database stores its SHA-256 hash — the
  same principle as password hashing — so a database leak alone can't be replayed as a reset.
- Tokens expire after 30 minutes and are single-use; using one invalidates any other
  outstanding reset requests for that account.
- `POST /api/auth/reset-password` with `{ token, new_password }` gives the same generic
  "invalid or expired" error whether the token is wrong, expired, or already used — no
  information leakage either way.
- Both endpoints are rate-limited (5 requests / 15 min per IP) to blunt mail-bombing and
  token brute-forcing.

## CSV upload format

```csv
name,email,phone,ticket_type,events
Amit Kumar,amit@example.com,9999999999,general,Robo Wars;Hackathon
```
`events` is semicolon-separated — a participant can be registered for multiple competitions.
Re-uploading an existing email is safe (it's skipped, not duplicated).

## Security — what's implemented, and what you must still do

**Implemented:**
- Passwords hashed with bcrypt (cost 12), never stored or logged in plaintext.
- Session tokens are short-lived signed JWTs; QR tokens use a **separate** signing secret
  from login tokens, and are individually revocable via a `jti` stored per participant
  (revoke a lost/stolen badge without touching anyone else).
- Every write query uses parameterized statements (`better-sqlite3` prepared statements) —
  no string-concatenated SQL anywhere, so this is not vulnerable to SQL injection.
- Role checks happen server-side on every request; the Event OC's event scope is derived
  from their own account record, never trusted from client input.
- Login rate limiting + automatic account lockout after 5 failed attempts (15 min).
- `helmet` security headers, restrictive CORS (set `CORS_ORIGIN` to your real frontend origin,
  never `*`, in production).
- Input validation (`zod`) on every write endpoint; malformed input is rejected, not coerced.
- Audit log of admin actions, logins, and scan events (`audit_log`, `scan_logs` tables).
- Generic, non-enumerating error messages on login (doesn't reveal whether an email exists).
- Error handler never leaks stack traces to clients.

**You are responsible for, before going live:**
- **HTTPS.** This app must run behind TLS (a reverse proxy like Caddy/Nginx, or a platform
  that terminates TLS for you) — JWTs and passwords must never travel over plain HTTP.
  Camera access for the scanner page also requires HTTPS on mobile browsers.
- **A real transactional email provider** (SES, SendGrid, Postmark, Mailgun) with your
  domain's SPF/DKIM/DMARC configured — otherwise your "no-reply" mail will land in spam,
  and generic SMTP creds are easy to leak.
- **Secrets management** — don't commit `.env`; use your host's secret manager in production.
- **Backups** of the SQLite file (`data/techfest.db`), or migrate to Postgres for a
  multi-day fest with concurrent write load from many gate devices — SQLite handles
  moderate concurrent writes fine but has a ceiling.
- **A claim I won't make:** no system connected to the internet is "unhackable." This
  implementation avoids the common, high-impact mistakes (plaintext passwords, forgeable
  tokens, SQL injection, unscoped data access) — it does not guarantee immunity from every
  possible attack. Get someone to review it before a real event if it's mission-critical.

## Extending this

- Add a `gate_staff` role if you don't want full admins physically operating the main gate
  device — currently main-gate scanning requires the `admin` role for simplicity.
- Add WebSocket/SSE push instead of polling if you want dashboards to update without refresh.
- Add exit scans (`direction: 'out'`) if you need real-time *occupancy* rather than
  cumulative check-in counts.
