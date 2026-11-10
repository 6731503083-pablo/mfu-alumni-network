# Testing

How the MFU Alumni Network is tested, how to run each test, and where the results are. All results
are from 9 November 2026.

| Kind | What it covers | Run it | Result | Evidence |
|---|---|---|---|---|
| Automated | Every API route, the security rules, and the web page's safety rules. Runs in the Workers runtime against a real D1 database (Miniflare) | `npm test` | **341 of 341 pass** in about 2 s | [report](evidence/tests/automated-test-report-2026-11-10.txt) |
| Type check | `src` and `test` | `npm run typecheck` | No errors | |
| End to end, live | The presentation's five steps to a mentor, plus consent withdrawal, security and admin, against the deployed API | `npm run demo` | **35 of 35 checks pass** | [live run](evidence/demo-run-live-2026-11-09.txt) |
| Security, live | 40 attacks and privacy checks against the deployed site. It writes nothing to the live database | `npm run evidence:security` | **40 of 40 pass** | [live run](evidence/security/live-security-checks-2026-11-09.txt), [SECURITY.md](SECURITY.md) |
| Partner, live | Our call to Team 17's internship API, with their request ID | `npm run evidence:team17` | 200 | [integration evidence](evidence/team17-internships-integration.md) |
| Manual | The web app in a real browser, for every role and at phone width | [log](evidence/tests/manual-test-log.md) | **25 checks: 18 passed, 7 failed and were fixed** | [screenshots](evidence/screenshots/) |

## Automated tests by file

| File | Tests | What it checks |
|---|---|---|
| [`test/alumni.test.ts`](test/alumni.test.ts) | 65 | Profile create and update (allow-list, consent rules), search with every filter including Burmese and Thai text, the three profile views, reveal logging, and stored script tags returned as data |
| [`test/requests.test.ts`](test/requests.test.ts) | 61 | Sending requests (one per alumni, five in total), listing, accepting as one transaction, a burst of simultaneous accepts at capacity, reject and cancel, the state machine, ownership, and the reveal log |
| [`test/auth.test.ts`](test/auth.test.ts) | 56 | Every protected route refuses a missing, forged, expired or unsigned (`alg: none`) token, and a role matrix covers student, alumni, admin and an unknown role on every Mentoring API route |
| [`test/app.test.ts`](test/app.test.ts) | 24 | Demo sign-in (passcode, fixed roles, demo-only IDs), demo admin limits, `GET /alumni/me`, admin read access, and `/app`'s Content-Security-Policy nonce, no HTML parsing, reference data and no secrets |
| [`test/partner-internships.test.ts`](test/partner-internships.test.ts) | 24 | Team 17 integration against a fake Team 17: field mapping, forwarded filters, broken listings, unsafe links, 503, timeout and bad responses |
| [`test/partner-mentors.test.ts`](test/partner-mentors.test.ts) | 14 | The public mentor counts for other teams: only alumni who can take a mentee are counted, no name, ID or contact detail ever appears, Team 17's categories map to our interests, bad queries are refused, and any site may read it |
| [`test/events-clubs.test.ts`](test/events-clubs.test.ts) | 23 | The signed Events & Clubs webhook: signature checks, a missing secret, retries stored once, and malformed events |
| [`test/docs-and-lab.test.ts`](test/docs-and-lab.test.ts) | 21 | The docs page has a console for every route and no secrets, the seed lists, error shapes, security headers on every answer, the HTTPS redirect, and the A5 lab routes |
| [`test/connections-admin.test.ts`](test/connections-admin.test.ts) | 10 | Ending a connection (either party only) and admin deactivation |
| [`test/quality-security.test.ts`](test/quality-security.test.ts) | 12 | A second, focused pass by Quality and Security: protected routes, admin-only routes, contact details only after a connection and only while consented, duplicate and closed requests, and webhook signatures and retries. See [QUALITY_ASSURANCE_REPORT.md](QUALITY_ASSURANCE_REPORT.md) |
| [`test/alumni-verification.test.ts`](test/alumni-verification.test.ts) | 26 | The PRD Assumption 1 fallback: personal-email claims (student addresses refused), the admin review queue, single-use sign-in codes (expired, reused, raced), and sign-up through to a profile students can find |
| [`test/phase2-validation.test.ts`](test/phase2-validation.test.ts) | 5 | Input validation: missing request fields, a blank display name, a wrong JSON type, an over-long webhook title and an unsupported URL scheme |

### The PRD's 11 planned tests

| PRD test | Where | Status |
|---|---|---|
| 1. Search with filters, including non-Latin input | `alumni.test.ts`: "applies each filter, alone and combined" | ✅ |
| 2. Privacy: consent filtering on profile views | `alumni.test.ts`: "shows a connected student only the fields consented to right now" | ✅ |
| 3. Profile update allow-list | `alumni.test.ts`: "rejects fields outside the allow-list and changes nothing" | ✅ |
| 4. Request limits (BR-05, BR-08) | `requests.test.ts`: "rejects a second pending request…", "rejects a sixth pending request" | ✅ |
| 5. Accept end to end (connection, reveal log, outbox row) | `requests.test.ts`: "creates the connection, reveal log and queued event together" | ✅ |
| 6. Event notification (outbox delivery, idempotent `event_id`) | Same test, queueing half only | ⚠️ Delivery isn't built |
| 7. Unauthorized access (role and ownership matrix) | `auth.test.ts` "role checks", `requests.test.ts` "ownership" | ✅ |
| 8. Concurrent accept at capacity | `requests.test.ts`: "racing requests" | ✅ |
| 9. State machine violations return 409 | `requests.test.ts`: "state machine" | ✅ |
| 10. Stored XSS | `alumni.test.ts` (API returns it as data), `app.test.ts` (the page never parses it as HTML) | ✅ |
| 11. Expired JWT rejected | `auth.test.ts`: "rejects an expired token" | ✅ |

## Failed tests that led to fixes

Three real security problems were found on 9 November: two by an automated security review, and one
while collecting the [security evidence](SECURITY.md). For each one we wrote a test, ran it against
the code **before** the fix (it failed), and then ran it against the fixed code (it passed). The
first two before runs used a separate checkout of the old commit, with the fix's test file added.

| Bug | Before | After | Evidence |
|---|---|---|---|
| A contact detail consented **after** a connection was made was shown to the student without a reveal-log row (BR-10) | 1 test failed | 2 of 2 pass (fix `bd95c01`) | [red-green-reveal-log.txt](evidence/tests/red-green-reveal-log.txt) |
| Anyone with the demo passcode could get an admin token able to turn off **any** profile | 4 tests failed | 6 of 6 pass (fix `67079bf`) | [red-green-demo-admin.txt](evidence/tests/red-green-demo-admin.txt) |
| The live API's answers and `/docs` had no security headers, and plain `http://` was served | 7 tests failed | 8 of 8 pass (fix `76a8ec0`) | [red-green-security-headers.txt](evidence/tests/red-green-security-headers.txt) |

Manual testing found 7 more failures in the web app (M13 to M15, M18, M20, M21 and M23 in the
[manual log](evidence/tests/manual-test-log.md)). All were fixed and checked again.

The automated tests also check that bad input fails the way it should: a forged token gets 401, the
wrong role 403, a duplicate request 409, a broken webhook signature 401, and a Team 17 outage 503.

## Before the evaluation

1. `npm test`: all pass.
2. `npm run demo`: all 35 checks pass on the live site.
3. `npm run evidence:team17`: 200, which also confirms Team 17 is online.
4. `npm run evidence:security`: all 40 checks pass.
5. A team member does the human re-check (H1 to H10) at the end of the manual log.
6. Afterwards, `npm run demo:reset` ends Su Myat's and Ko Min's connections, cancels their pending
   requests and puts the seed profiles back. Then present the live happy path as **Ko Min** asking
   **Nattaya Srisuk** (search "พยาบาล"). [DEMO-DAY.md](DEMO-DAY.md) has the full script.
