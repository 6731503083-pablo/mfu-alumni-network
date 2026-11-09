# MFU Alumni Network API

A Cloudflare Worker with two parts:

- **Mentoring API:** the PRD's nine endpoints (API-01 to API-09). Students find alumni and ask for
  mentoring, and alumni decide what they share.
- **Team 17 integration lab (A5):** one endpoint exposed to a partner, one endpoint called on a
  partner, a signed webhook receiver and sender, and one idempotent create endpoint.

**Live:** <https://alumni-network-integration.phyo2lay.workers.dev>, with the API docs and a request
console at [`/docs`](https://alumni-network-integration.phyo2lay.workers.dev/docs).

## Setup

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:local
npm run dev
npm test
```

Then open <http://localhost:8787/docs> for the API docs, with a console for trying each endpoint.
To call the Mentoring API from there, paste `JWT_SECRET` from `.dev.vars` under "Sign in for testing".

`.dev.vars` needs these values:

```dotenv
WEBHOOK_SECRET=<a secret only you and Team 17 know>
PARTNER_WEBHOOK_SECRET=<Team 17's secret for the webhook they receive from you>
JWT_SECRET=<signs and verifies sign-in tokens until the Identity service publishes its contract>
EVENTS_CLUBS_WEBHOOK_SECRET=<a secret only you and Events & Clubs know>
```

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
npm run deploy
```

All four secrets are set on the live Worker. Secrets go in `wrangler secret put` or the Cloudflare
dashboard, never in the repo. The live `JWT_SECRET` is kept locally in `.demo.vars` (git-ignored) for
signing demo tokens.
