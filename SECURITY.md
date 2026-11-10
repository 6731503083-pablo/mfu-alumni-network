# Security and privacy

How the MFU Alumni Network protects its users and their personal data. For each control, this page
links to the code that does it and the test or live check that proves it works. Everything here was
checked on 9 November 2026 against the live site.

**The live site holds only fictional demo data.** All nine alumni profiles belong to `demo-` accounts.
No real person's details are stored.

## Proof at a glance

| Evidence | What it shows | Result |
|---|---|---|
| `npm test` | 297 automated tests. The ones cited below cover security and privacy | **297 of 297 pass** ([report](evidence/tests/automated-test-report-2026-11-09.txt)) |
| `npm run evidence:security` | 40 attacks and privacy checks against the **live** site. The IDs H1 to E1 below refer to it. It writes nothing to the live database | **40 of 40 pass** ([live run](evidence/security/live-security-checks-2026-11-09.txt)) |
| Live headers | The real response headers from the live site, captured with curl | [live-headers-2026-11-09.txt](evidence/security/live-headers-2026-11-09.txt) |
| Failed, then fixed | Three security problems we found. Each one's test failed on the old code and passes on the fix | [reveal log](evidence/tests/red-green-reveal-log.txt), [demo admin](evidence/tests/red-green-demo-admin.txt), [headers](evidence/tests/red-green-security-headers.txt) |
| `npm audit` | Known vulnerabilities in our dependencies | **0** (Hono updated to 4.13.17 on 9 November) |

## 1. Security controls

### Sign-in and permissions

| Control | What it does | Code | Proven by |
|---|---|---|---|
| Signed tokens | Every Mentoring API route needs a token signed with `JWT_SECRET`. Only HS256 is accepted, so `alg: none` fails. A token must have an expiry, and 30 seconds of clock difference is allowed | [auth.ts:13-47](src/lib/auth.ts#L13-L47) | [auth.test.ts "token checks"](test/auth.test.ts#L29), live A1 to A5 |
| Empty secrets refuse everything | If `JWT_SECRET`, `DEMO_PASSCODE` or `EVENTS_CLUBS_WEBHOOK_SECRET` isn't set, the server answers 503. An empty key would let anyone sign | [auth.ts:14-17](src/lib/auth.ts#L14-L17), [demo-auth.ts:43-49](src/routes/demo-auth.ts#L43-L49), [events-clubs.ts:30-32](src/routes/events-clubs.ts#L30-L32) | [auth.test.ts:92](test/auth.test.ts#L92), [app.test.ts:58](test/app.test.ts#L58), [events-clubs.test.ts:147](test/events-clubs.test.ts#L147) |
| Limited demo sign-in | Stands in for MFU's Identity service. It needs the passcode, compared in constant time. It only signs `demo-` IDs, and the ID fixes the role. Tokens last two hours and are marked `demo: true`. A demo admin can only turn off demo profiles | [demo-auth.ts:14-62](src/routes/demo-auth.ts#L14-L62), [admin.ts:12-23](src/routes/admin.ts#L12-L23) | [app.test.ts:14-101](test/app.test.ts#L14-L101), [red-green](evidence/tests/red-green-demo-admin.txt), live A6 to A9 |
| Role check on every route | Each route names the roles allowed to call it (student, alumni or admin). Any other role gets 403 | [auth.ts:50-57](src/lib/auth.ts#L50-L57) | [auth.test.ts role matrix](test/auth.test.ts#L105): every role on every route. Live R1 to R4 |
| Ownership checks | Only the sender can cancel a request. Only the alumni who received it can accept or reject it. Only the two people in a connection can end it. An alumni's profile is found from their token, never from an ID in the request | [requests.ts:238-241](src/routes/requests.ts#L238-L241), [connections.ts:25-27](src/routes/connections.ts#L25-L27), [alumni.ts:177-183](src/routes/alumni.ts#L177-L183) | [requests.test.ts "ownership"](test/requests.test.ts#L537), [requests.test.ts:54](test/requests.test.ts#L54), [connections-admin.test.ts:41](test/connections-admin.test.ts#L41), live R5 and R6 |

### Input

| Control | What it does | Code | Proven by |
|---|---|---|---|
| Strict input checks | Every body and query is checked for type, length and format with zod. Unknown fields are refused, so nobody can set `is_active`, `identity_user_id` or `consent_timestamp` themselves | [alumni.ts:99-158](src/routes/alumni.ts#L99-L158), [requests.ts:14-23](src/routes/requests.ts#L14-L23) | [alumni.test.ts:71](test/alumni.test.ts#L71), [21 bad values](test/alumni.test.ts#L95), live I3 to I7 |
| SQL with bound values | User input is always bound as a `?` value, never pasted into SQL. Column names in a profile update come from the fixed schema, not from the request | [alumni.ts:227-245](src/routes/alumni.ts#L227-L245), [alumni.ts:276-304](src/routes/alumni.ts#L276-L304) | [alumni.test.ts:279](test/alumni.test.ts#L279), live I1 and I2 |
| Safe links only | A LinkedIn link must be `https://linkedin.com/…`, so a `javascript:` link can't be stored. A Team 17 details link is kept only if it is https on Team 17's own site | [alumni.ts:146-152](src/routes/alumni.ts#L146-L152), [partner-internships.ts:62-66](src/routes/partner-internships.ts#L62-L66) | [alumni.test.ts:95](test/alumni.test.ts#L95), [partner-internships.test.ts:138](test/partner-internships.test.ts#L138), live I7 |
| Race-safe limits | Mentee capacity and the five-pending-requests cap are checked and applied in one SQL statement, and accepting runs as one transaction. Requests arriving at the same moment can't get past a limit | [requests.ts:57-127](src/routes/requests.ts#L57-L127), [requests.ts:153-165](src/routes/requests.ts#L153-L165) | [requests.test.ts "racing requests"](test/requests.test.ts#L397), [requests.test.ts:123](test/requests.test.ts#L123), [requests.test.ts:364](test/requests.test.ts#L364) |
| Database rules | CHECK constraints on lengths, formats and states, and a unique index allowing one pending request per student and alumni. They hold even if the code has a bug | [0002_alumni_network.sql:17-95](migrations/0002_alumni_network.sql#L17-L95) | [requests.test.ts:86](test/requests.test.ts#L86), [requests.test.ts:95](test/requests.test.ts#L95) |

### Browser and transport

| Control | What it does | Code | Proven by |
|---|---|---|---|
| Content-Security-Policy | The web app gets a new nonce on every response. Only our own `<script>` and `<style>` tags carry it, so injected code can't run. No inline handlers, no framing, and the page can only call our own site | [index.ts:87-102](src/index.ts#L87-L102) | [app.test.ts:157](test/app.test.ts#L157), [app.test.ts:171](test/app.test.ts#L171), live H1 |
| No HTML from data | The page builds everything with `createElement` and text nodes, so a name or bio is always shown as text | [app-ui-helpers.ts:5-21](src/app-ui-helpers.ts#L5-L21) | [app.test.ts:178](test/app.test.ts#L178), [alumni.test.ts:465](test/alumni.test.ts#L465) |
| Security headers | Every answer, errors included, carries HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store`. The last keeps profiles and contact details out of caches | [index.ts:28-45](src/index.ts#L28-L45) | [docs-and-lab.test.ts:88](test/docs-and-lab.test.ts#L88), [red-green](evidence/tests/red-green-security-headers.txt), live H2 to H5 |
| HTTPS only | Browsers always use HTTPS here, because `.dev` is on their HSTS preload list. Other clients asking for `http://` get a 308 redirect to `https://` | [index.ts:29-35](src/index.ts#L29-L35) | [docs-and-lab.test.ts:106](test/docs-and-lab.test.ts#L106), live H6 |

### Integrations, secrets and errors

| Control | What it does | Code | Proven by |
|---|---|---|---|
| Signed webhooks | Events & Clubs and Team 17 webhooks must carry an HMAC-SHA256 of the raw body, compared in constant time. A body changed after signing fails | [hmac.ts](src/lib/hmac.ts), [events-clubs.ts:34-39](src/routes/events-clubs.ts#L34-L39), [index.ts:127](src/index.ts#L127) | [events-clubs.test.ts:79-104](test/events-clubs.test.ts#L79-L104), live W1 to W3 |
| Replays stored once | A retried webhook with the same event ID isn't stored twice | [events-clubs.ts:57-65](src/routes/events-clubs.ts#L57-L65), [0001_init.sql:10](migrations/0001_init.sql#L10) | [events-clubs.test.ts:56](test/events-clubs.test.ts#L56), [events-clubs.test.ts:66](test/events-clubs.test.ts#L66) |
| Partner data checked | Each Team 17 listing is checked against their contract, and broken ones are skipped. Their call has a 10-second limit. Our query is checked before we call them, and we send them no personal data, only the search filters | [partner-internships.ts:78-90](src/routes/partner-internships.ts#L78-L90), [partner-internships.ts:116-142](src/routes/partner-internships.ts#L116-L142) | [partner-internships.test.ts:118-185](test/partner-internships.test.ts#L118-L185) |
| Public counts, no profiles | `GET /api/mentors` is open to other teams' websites with no sign-in, so it returns counts and links only: no names, IDs or contact details | [partner-mentors.ts](src/routes/partner-mentors.ts) | [partner-mentors.test.ts](test/partner-mentors.test.ts) |
| Secrets kept out | Live secrets are Cloudflare Worker secrets. `.dev.vars` and `.demo.vars` are git-ignored. Tests use fixed fake secrets, and the pages contain none | [.gitignore](.gitignore) | [docs-and-lab.test.ts:38](test/docs-and-lab.test.ts#L38), [app.test.ts:192](test/app.test.ts#L192) |
| Errors reveal nothing internal | Every error has one JSON shape. An unexpected failure answers "Something went wrong", and the detail goes only to the Worker's log | [errors.ts:24-34](src/lib/errors.ts#L24-L34) | [docs-and-lab.test.ts:74](test/docs-and-lab.test.ts#L74), live E1 |
| Few dependencies | Two runtime libraries, Hono and zod, with no known vulnerabilities | [package.json](package.json) | `npm audit`: 0 |

## 2. PDPA

Thailand's Personal Data Protection Act B.E. 2562 (2019), and the business rules in our PRD that
come from it.

| What it asks | What we built | Code | Proven by |
|---|---|---|---|
| **Consent before sharing** (section 19, BR-01) | Contact details are hidden by default. Email, LINE and LinkedIn each have their own switch. A student sees a detail only after the alumni accepts their request, and only while that switch is on | [0002:38-40](migrations/0002_alumni_network.sql#L38-L40), [alumni.ts:62-97](src/routes/alumni.ts#L62-L97) | [alumni.test.ts:370](test/alumni.test.ts#L370), [alumni.test.ts:432](test/alumni.test.ts#L432), live P3 |
| **A record of consent** (section 19, BR-02) | The server records when consent was given and for which purpose version (`v1`). Clients can't set either. The database refuses consent without that record, and consent to share an empty field | [alumni.ts:220-225](src/routes/alumni.ts#L220-L225), [0002:48-56](migrations/0002_alumni_network.sql#L48-L56) | [alumni.test.ts:142](test/alumni.test.ts#L142), [alumni.test.ts:155](test/alumni.test.ts#L155), live P5 |
| **Withdraw at any time** (section 19, BR-03) | Switching a detail off hides it from connected students straight away, because consent is checked on every view rather than copied when the request is accepted | [alumni.ts:85-87](src/routes/alumni.ts#L85-L87) | [alumni.test.ts:370](test/alumni.test.ts#L370), step 6 of the [live demo run](evidence/demo-run-live-2026-11-09.txt), manual check H6 |
| **Collect and show only what's needed** (section 22) | Search and other people's profile views use a fixed column list with no contact or consent fields. Admins get the public view only. Request lists never include contact details. Team 17 receives no personal data, and queued events carry IDs only | [alumni.ts:22-24](src/routes/alumni.ts#L22-L24), [requests.ts:105-113](src/routes/requests.ts#L105-L113) | [alumni.test.ts:309](test/alumni.test.ts#L309), [app.test.ts:129](test/app.test.ts#L129), [requests.test.ts:205](test/requests.test.ts#L205), live P1 to P4 |
| **Share only counts with other teams** (section 22) | The endpoint other teams call, `GET /api/mentors`, returns how many alumni can mentor in each field, never who they are | [partner-mentors.ts](src/routes/partner-mentors.ts) | [partner-mentors.test.ts](test/partner-mentors.test.ts) |
| **A record of who saw what** (BR-10) | Every contact detail a student can see is logged once per connection: when the request is accepted, or the first time they see a detail the alumni agreed to share later. Database triggers refuse any edit or delete of the log | [requests.ts:88-104](src/routes/requests.ts#L88-L104), [alumni.ts:62-82](src/routes/alumni.ts#L62-L82), [0002:162-172](migrations/0002_alumni_network.sql#L162-L172) | [requests.test.ts:303](test/requests.test.ts#L303), [alumni.test.ts:388](test/alumni.test.ts#L388), [requests.test.ts:587](test/requests.test.ts#L587), [red-green](evidence/tests/red-green-reveal-log.txt), live P6 to P8 |
| **Say what the data is for** (section 23) | The profile editor says who sees each detail and when, and shows the date and purpose version of the alumni's consent | [app.html:1249-1255](src/app.html#L1249-L1255) | Manual checks M09 and M23 |
| **Right of access** (section 30) | An alumni sees everything stored about them in My profile, including their consent switches and record. A student sees every request they sent | [alumni.ts:329-337](src/routes/alumni.ts#L329-L337) | [app.test.ts:110](test/app.test.ts#L110) |
| **No sensitive data** (section 26, BR-07) | The database has no fields for religion, health, ethnicity or similar | [0002:17-57](migrations/0002_alumni_network.sql#L17-L57) | |
| **Keep data secure** (section 37) | Section 1 of this page | | |

What PDPA asks that we **haven't built yet**:

- **Right to erasure** (section 33, BR-04). Planned as anonymisation: clear the name and contact
  details, set `identity_user_id` to NULL (the schema already allows it) and keep the reveal log.
  Today an admin can only turn a profile off, which hides it but keeps the data.
- **How long data is kept.** Requests, connections and logs have no time limit.
- **AI disclosure** (BR-09). AI matching isn't built, so no data goes to an AI service. When it is,
  the purpose statement must mention it and become `v2`.
- **Breach notification** (section 37). There is no written procedure for telling the regulator
  within 72 hours.
- **Where the data is stored** (section 28). Cloudflare picks the location of the D1 database, and we
  haven't checked whether it's outside Thailand. This must be settled before real alumni data goes in.

## 3. Common attacks

Mapped to the [OWASP Top 10 (2021)](https://owasp.org/Top10/).

| Attack | What stops it | Proven by |
|---|---|---|
| Reading or changing someone else's data, or acting above your role (A01) | Role checks, ownership checks, and an allow-list on profile updates | Live R1 to R6 and I6, [auth.test.ts role matrix](test/auth.test.ts#L105) |
| Becoming admin through demo sign-in (A01) | The demo ID fixes the role, and a demo admin can only turn off demo profiles | Live A7 and A9, [red-green](evidence/tests/red-green-demo-admin.txt) |
| Forged, edited, expired or unsigned tokens (A07) | The signature is checked with the algorithm fixed to HS256, and an expiry is required | Live A2 to A5 |
| SQL injection (A03) | Bound values only, and strict filters | Live I1 to I4 |
| Stored cross-site scripting (A03) | The API returns JSON, the page only ever inserts text, and the CSP blocks any script without the nonce | Live H1, [alumni.test.ts:465](test/alumni.test.ts#L465), [app.test.ts:178](test/app.test.ts#L178) |
| Clickjacking | `frame-ancestors 'none'` and `X-Frame-Options: DENY` | Live H1 to H5 |
| Cross-site request forgery | Tokens travel in the `Authorization` header, not cookies, so another site can't make a browser send them. Only the public mentor counts (`GET /api/mentors`) allow other sites to read them, and they hold no personal data | [Live headers](evidence/security/live-headers-2026-11-09.txt): no cookies, and no `Access-Control-Allow-Origin` on any other route |
| Eavesdropping (A02) | HTTPS only, with HSTS | Live H6 |
| Two requests at once getting past a limit (A04) | One-statement checks and a transaction | [requests.test.ts "racing requests"](test/requests.test.ts#L397) |
| Forged or replayed webhooks (A08) | HMAC signatures and unique event IDs | Live W1 to W3, [events-clubs.test.ts](test/events-clubs.test.ts) |
| Bad data from a partner (A08) | Each Team 17 listing is checked, unsafe links are dropped, and slow answers time out | [partner-internships.test.ts](test/partner-internships.test.ts) |
| Making our server call other sites (A10) | Partner URLs are fixed settings. User input only becomes checked query values | [partner-internships.ts:78-85](src/routes/partner-internships.ts#L78-L85) |
| Known-vulnerable libraries (A06) | `npm audit`, and only two runtime libraries | 0 vulnerabilities |
| Misconfiguration (A05) | Empty secrets refuse requests, security headers everywhere, and errors without internal detail | Live H2 to H5 and E1 |
| Guessing the demo passcode | **Not stopped**: there is no rate limit | See gap 1 |

## 4. Known gaps

| # | Gap | Risk | Plan |
|---|---|---|---|
| 1 | **No rate limit.** Someone could keep guessing the demo passcode, or flood the API | Medium | Cloudflare's rate-limiting binding on `POST /auth/demo-login`, then per user |
| 2 | **Demo sign-in instead of MFU Identity.** Anyone with the passcode can sign in as any demo person. The web app keeps the passcode in the open tab after sign-out, never in storage, so the next person at that browser can sign in until the tab reloads | Low today: all data is fictional, and a demo admin can only touch demo profiles | Switch to Identity tokens (only [auth.ts](src/lib/auth.ts) changes) and delete the demo route |
| 3 | **No erasure** (BR-04) | Medium before launch | Anonymisation, as described in section 2 |
| 4 | **Week 06 lab routes are open.** `POST /api/webhooks/send-test` needs no sign-in, so anyone can make us send Team 17 a fixed test webhook. `POST /api/connections` needs no sign-in and stores any JSON body. `GET /api/partner/status` shows the raw error text when Team 17 is down. They're unchanged because they were submitted as A5 evidence | Low: no personal data | Remove them, or require admin sign-in, after grading |
| 5 | **Admin actions aren't logged.** Nothing records which admin turned off which profile | Low | An append-only admin log, like the reveal log |
| 6 | **`/docs` has no Content-Security-Policy.** It loads Google Fonts and uses inline styles. It shows API answers as text only | Low | Host the fonts ourselves and give it a nonce policy like `/app` |
| 7 | **The web app keeps its token in `sessionStorage`.** A script running in the page could read it. The CSP is what stops such scripts, and the token is gone when the tab closes | Low | Revisit when Identity arrives |
| 8 | **Live secrets were shared in an AI assistant's chat** while deploying on 9 November (`JWT_SECRET`, `EVENTS_CLUBS_WEBHOOK_SECRET`, `DEMO_PASSCODE`) | Medium | Replace all three with `wrangler secret put` after the evaluation. From now on, type secrets straight into wrangler |
| 9 | **Data location not checked** (PDPA section 28) | Low today: fictional data only | Check before real data goes in |

## 5. Check it yourself

```bash
npm test                      # 297 tests
npm run evidence:security     # 40 checks against the live site. Writes nothing there
npm audit --omit=dev          # known vulnerabilities in runtime libraries
```

Quick checks to run in front of someone:

```bash
B=https://alumni-network-integration.phyo2lay.workers.dev
curl -i $B/alumni                                         # 401: no token
curl -i $B/alumni -H "Authorization: Bearer forged.token.here"   # 401: forged token
curl -sD - -o /dev/null $B/app                            # the security headers and the CSP
curl -sD - -o /dev/null http://${B#https://}/app          # 308 to https
```
