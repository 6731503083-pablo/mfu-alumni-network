# MFU Alumni Network API

A Cloudflare Worker with three parts:

- **Web app** at `/app`: the presentation's three screens (find a mentor, requests, and the
  alumni's profile and consent editor), plus admin's "turn off profile". Students, alumni and admin
  sign in with demo accounts.
- **Mentoring API:** the PRD's nine endpoints (API-01 to API-09). Students find alumni and ask for
  mentoring, and alumni decide what they share.
- **Team 17 integration lab (A5):** one endpoint exposed to a partner, one endpoint called on a
  partner, a signed webhook receiver and sender, and one idempotent create endpoint.
- **Team 17 internships:** the web app's Internships tab shows Team 17's live open internships from
  their public API, with "Find a mentor for this" linking each one to alumni in that field. See
  [evidence/team17-internships-integration.md](evidence/team17-internships-integration.md).

**Live:** the web app is at <https://alumni-network-integration.phyo2lay.workers.dev/app>, and the
API docs, with a request console, are at
[`/docs`](https://alumni-network-integration.phyo2lay.workers.dev/docs).

See [TESTING.md](TESTING.md) for how the system is tested and where the results are.

## Web app

One HTML page, [`src/app.html`](src/app.html), with plain JavaScript and no build step. The Worker
serves it with a strict Content-Security-Policy: every response gets a new nonce, and only the
page's own `<script>` and `<style>` tags carry it. The page only ever sets API text as text, never
as HTML. `test/app.test.ts` checks both.

Until MFU's Identity service publishes its login (PRD Assumption 1), the app signs people in through
`POST /auth/demo-login`. That route needs the `DEMO_PASSCODE` secret and only issues two-hour tokens
for IDs that start with `demo-`, so the browser never holds `JWT_SECRET`. Delete the route when
Identity arrives.

## Setup

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:local
npm run dev
npm test
```

Then open <http://localhost:8787/app> for the web app, and sign in with `DEMO_PASSCODE` from
`.dev.vars`. Run `BASE_URL=http://localhost:8787 npm run demo:seed` first, so there are alumni to
find. <http://localhost:8787/docs> has the API docs, with a console for trying each endpoint. To call
the Mentoring API from there, paste `JWT_SECRET` from `.dev.vars` under "Sign in for testing".

`.dev.vars` needs these values:

```dotenv
WEBHOOK_SECRET=<a secret only you and Team 17 know>
PARTNER_WEBHOOK_SECRET=<Team 17's secret for the webhook they receive from you>
JWT_SECRET=<signs and verifies sign-in tokens until the Identity service publishes its contract>
EVENTS_CLUBS_WEBHOOK_SECRET=<a secret only you and Events & Clubs know>
DEMO_PASSCODE=<the passcode people type to sign in to the web app's demo accounts>
```

## Happy-path demo

`npm run demo` runs the presentation's five steps to a mentor against the live API and checks
every response, so it doubles as an end-to-end test (exit code 1 if any check fails):

0. An alumni creates a profile and consents to share their email but not their LINE ID.
1. A student searches by country and by a Burmese or Thai job title.
2. The student opens the profile and sees no contact details.
3. The student sends a request. A message that's too short gets 400, and a second request to the
   same alumni gets 409.
4. The alumni accepts. A second alumni rejects a request, and a request past the mentee limit gets
   409.
5. The student sees the email and not the LINE ID. The reveal log and outbox rows are read from D1.
6. The alumni withdraws consent, and the email is hidden again.
7. Missing, forged and expired tokens get 401, and the wrong role or owner gets 403.
8. An admin deactivates the profile, which then returns 404 (skip this with `npm run demo -- --keep`).

```bash
npm run demo:seed                               # six fictional "(demo)" alumni, safe to rerun
npm run demo                                    # live site, signs tokens with .demo.vars
BASE_URL=http://localhost:8787 npm run demo     # local `npm run dev`, signs with .dev.vars
```

A saved live run is in [`evidence/demo-run-live-2026-11-09.txt`](evidence/demo-run-live-2026-11-09.txt).

## Evidence checklist for A5

### 1. Your public endpoint

```bash
curl -i http://localhost:8787/api/integration/status
```

Expect `200` with `{ team, service, version, status: "ok" }`.

### 2. Calling the partner's endpoint

```bash
curl -i http://localhost:8787/api/partner/status
```

Expect `200` with the partner's JSON. If the partner is down or `PARTNER_API_URL` is wrong,
expect `504` — not a crash.

### 3. Receiving a signed webhook

Compute the signature the same way the sender does (HMAC-SHA256 of the raw body, hex-encoded,
using `WEBHOOK_SECRET`), then:

```bash
BODY='{"id":"evt-1","type":"test.event","data":{}}'
SIG=$(node -e "console.log(require('crypto').createHmac('sha256', process.env.WEBHOOK_SECRET).update(process.env.BODY).digest('hex'))")

curl -i http://localhost:8787/api/webhooks/partner \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: $SIG" \
  -d "$BODY"
```

Expect `200` with `{ received: true }`. Resending the same `id` should return
`{ received: true, duplicate: true }` — not a second row.

An unsigned or wrongly-signed request must get `401`:

```bash
curl -i http://localhost:8787/api/webhooks/partner \
  -H "Content-Type: application/json" \
  -d "$BODY"
```

### 4. Sending a webhook to the partner

```bash
curl -i -X POST http://localhost:8787/api/webhooks/send-test
```

Expect `200` with `{ sent: true, partnerStatus: <partner's status code> }`. Confirm on the
partner's side that they logged the event.

### 5. Idempotent create

```bash
curl -i -X POST http://localhost:8787/api/connections \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: demo-key-1" \
  -d '{"studentId": 1, "alumniId": 1}'
```

Expect `201` the first time. Repeat the exact same request — expect `200` (or the same body)
with no new row created, proving the retry didn't duplicate the side effect.

## Before deploying

```bash
npm test
npm run db:remote                                # applies new migrations to the live database
npx wrangler secret put JWT_SECRET
npx wrangler secret put EVENTS_CLUBS_WEBHOOK_SECRET
npx wrangler secret put DEMO_PASSCODE
npm run deploy
```

The live Worker needs all five secrets. Secrets go in `wrangler secret put` or the Cloudflare
dashboard, never in the repo. The live `JWT_SECRET` and `DEMO_PASSCODE` are kept locally in
`.demo.vars` (git-ignored), for signing demo tokens and signing in to the web app.
