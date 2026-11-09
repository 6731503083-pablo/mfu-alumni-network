# MFU Alumni Network API

The group's **MFU Alumni Network** project (Team 19, Pod 5). This Worker holds two things:

- **Mentoring API** (`src/routes/`): the nine endpoints from [`../PRD 3.md`](../PRD%203.md) section 11,
  API-01 to API-09. `migrations/0002_alumni_network.sql` ports the schema from
  [`../Team19_Pod5_Data-and-Query-Design.md`](../Team19_Pod5_Data-and-Query-Design.md), keeping its
  table and column names.
- **Team 17 integration lab, A5** (`src/index.ts`): the five Week 06 routes from
  [`../06_integration_v2.md`](../06_integration_v2.md). They were submitted as evidence, so keep
  their behaviour unchanged.

`GET /docs` serves a hand-written API reference and request console from `src/docs.html`. Update it
whenever a route changes (a test fails if a route has no console), and never put a secret in it.

**Stack:** Cloudflare Workers · Hono · TypeScript · D1 (SQLite) · zod · Vitest.

This differs from the PRD, which specifies Next.js and Supabase, and from the data design, which
chose Supabase for its row locks. Invariant 1 explains how capacity stays safe without them.

Stay in this folder. Don't read or reuse `../assignment-2/` (Haze Watch), which is separate
individual work.

## Commands

Run everything from this directory (`platform/alumni-network/`), not from `platform/`.

```bash
npm install
cp .dev.vars.example .dev.vars   # then fill in the secrets
npm run db:local                 # apply migrations to LOCAL D1
npm run dev                      # wrangler dev on :8787, docs at /docs
npm test                         # Vitest inside the Workers runtime, with its own test secrets
npm run typecheck                # checks src and test
npm run demo:seed                # upserts six fictional "(demo)" alumni on BASE_URL (default: live)
npm run demo                     # happy path end to end on BASE_URL, exits 1 if a check fails
```

The demo scripts sign tokens with `JWT_SECRET` from `.demo.vars` (live) or `.dev.vars` (when
`BASE_URL` is localhost). Both files are git-ignored. The scripts aren't typechecked.

## Invariants

1. **Capacity and the pending cap are enforced by one SQL statement, never read-then-write.** D1 has
   no row locks. In `src/routes/requests.ts`, the accept flow's first statement is a conditional
   `UPDATE` that counts capacity and changes the status together, and the rest of the batch only acts
   if it passed. D1 runs a batch as one transaction. The burst test in `test/requests.test.ts` fails
   if this becomes a separate read and write.
2. **Never use `LIKE` on user text.** D1 rejects patterns over 50 bytes, which a Burmese job title
   passes in under 20 characters. Use `instr()`.
3. **Contact fields only leave the database through a consent check.** `PUBLIC_COLUMNS` in
   `src/routes/alumni.ts` is the privacy filter, and contact and consent columns stay out of it. A
   student sees contact details only with an active connection, and only fields consented right now.
4. **`contact_reveal_log` is append-only**, enforced by triggers. It is PDPA evidence.
5. **Webhook signatures are verified with a timing-safe comparison** (`timingSafeEqual` in
   `src/lib/hmac.ts`). Never compare HMAC digests with `===`.
6. **An empty secret must refuse requests.** `JWT_SECRET` and `EVENTS_CLUBS_WEBHOOK_SECRET` return 503
   when unset, because an empty key would let anyone sign.
7. **`webhook_events.source_id` has a UNIQUE index** so a partner's retried delivery isn't stored
   twice. The A5 receiver treats any insert error as a duplicate, so a signed event with no `id` or
   `type` gets `duplicate: true` and isn't stored. This is known and documented on the docs page.
8. **Secrets live only in `.dev.vars`** locally and `wrangler secret` when deployed, never committed.

## Not built yet

- Delivering queued events: `alumni.connection_created` waits in `webhook_outbox` (FR-10).
- AI matching and its rule-based fallback (FR-09), and setting student interests.
- Showing stored alumni events to students (FR-11), and sending `alumni.event` out.
- Erasure by anonymisation (BR-04).
- Real Identity service tokens: `src/lib/auth.ts` verifies HS256 with `JWT_SECRET` until the contract
  arrives (PRD Assumption 1). Only that file should need to change.
- The OpenAPI document (PRD section 11), and CORS for a frontend on another domain.

The Events & Clubs payload in `src/routes/events-clubs.ts` is a draft: that team hasn't published one.

## Partner team

Paired with **Team 17 — Internship Management** (`https://team17-internship.vercel.app`).
Their webhook receiver expects a raw shared secret in an `X-Webhook-Secret` header, not an HMAC
signature, plus a fixed payload shape (`event_id`/`event_type`/`occurred_at`/`source`/`data`).
This differs from how we verify inbound webhooks: each direction's contract is set by whoever owns
the receiver. `PARTNER_API_URL` and `PARTNER_WEBHOOK_URL` live in `wrangler.jsonc` `vars` (not
secret), and `PARTNER_WEBHOOK_SECRET` is a `wrangler secret`. `POST /api/webhooks/send-test` reaches
their live system, even from a local server.
