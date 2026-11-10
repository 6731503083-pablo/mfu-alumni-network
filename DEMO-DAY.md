# Demo day: 10 November 2026, 13:00 to 18:00

What the team does on the day: the checks before we start, the demo click by click, the live change,
the questions we expect, and what to do if something breaks. Everything here was rehearsed on
9 November.

**One laptop has the keys.** Deploying needs the Cloudflare login, and the live demo scripts need
`.demo.vars`. Both are on Phyo Phyo Lay's laptop, so run the commands there. Any of us can drive it.
The demo passcode isn't written here: ask Phyo Phyo Lay.

## Before 13:00

Run these in `alumni-network/`, in this order:

| # | Do | Expect |
|---|---|---|
| 1 | `git pull` and `npm install` | Up to date |
| 2 | `npm test` | 297 pass, in about 2 seconds |
| 3 | `npm run typecheck` | No TypeScript errors |
| 4 | `npm run evidence:team17` | `200`. This also confirms Team 17 is online. If it isn't, message Team 17 |
| 5 | `npm run evidence:security` | 40 of 40 pass |
| 6 | `npm run demo` | 35 of 35 checks pass. It creates a throwaway alumni and turns it off at the end |
| 7 | A team member does the human re-check, H1 to H10, by hand at the end of the [manual log](evidence/tests/manual-test-log.md), and fills in the last two columns | All pass |
| 8 | `npm run demo:reset` | Frees Su Myat and Ko Min, and puts the seed alumni's details and consent back |
| 9 | Open the tabs: [the web app](https://alumni-network-integration.phyo2lay.workers.dev/app) (signed out), [the repo](https://github.com/6731503083-pablo/mfu-alumni-network), [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), and VS Code with this folder | |

## The demo

About 7 minutes with talking (our estimate). The rehearsal on a local copy took 5 seconds of
machine time, and Team 17's first answer took about 3 seconds. Sign out between people with
**Sign out** at the top right. The passcode stays filled in until the tab reloads, so signing in as
the next person is one click on their name.

| # | Signed in as | Do | Say |
|---|---|---|---|
| 1 | **Ko Min** (student) | Type the passcode, then click **Ko Min** | "Until MFU's Identity service publishes its login, a demo sign-in stands in for it." |
| 2 | Ko Min | Type `พยาบาล` in Job title. The list updates as you type, no button needed | "Search works in Thai and Burmese." One result: Nattaya Srisuk (FR-01) |
| 3 | Ko Min | Open **Nattaya Srisuk** | "Her contact details say *Not shared yet*. They're hidden until she accepts." (BR-01) |
| 4 | Ko Min | Write what you want help with, then **Send request** | "One pending request per alumni and five in total, checked by the database." (BR-05, BR-08) |
| 5 | **Nattaya Srisuk** (alumni) | **Requests to me**, then **Accept** | The message says "Connected with Ko Min. You shared your email and LINE." "Capacity, the connection, the reveal log and the event happen in one transaction." (FR-06) |
| 6 | Ko Min | **My requests**, then **See contact details** | Email and LINE are *Shared with you*. LinkedIn is *Kept private*. "What he saw, and when, is now logged." (BR-10) |
| 7 | Nattaya | **My profile**, untick the email's **Share with students I accept**, then **Save changes** | "She can stop sharing at any time." (BR-03) |
| 8 | Ko Min | Open Nattaya again | Email is now *Kept private* |
| 9 | Ko Min | **Internships** | Team 17's live listings, with their request ID at the bottom. The first load takes about 3 seconds, so start talking: "This comes from Team 17's API, through our server." (Requirement 3) |
| 10 | Ko Min | **Find a mentor for this** on *Product Design Intern* | The directory, filtered to UX/UI Design: Ei Mon Thant |
| 11 | **Admin** | Look at the directory | Every profile has **Turn off profile**. "Admins see public fields only, never contact details." |

Optional proof after step 6, the reveal log in the live database:

```bash
npx wrangler d1 execute alumni-network-db --remote \
  --command "SELECT viewer_id, field_name, revealed_at FROM contact_reveal_log ORDER BY id DESC LIMIT 3"
```

**To run the demo again:** `npm run demo:reset`. Or use the backup pair: Su Myat finds Ei Mon Thant
through **Internships**, then **Find a mentor for this**.

## The live change (requirement 7)

### A visible change, deployed (rehearsed: about 20 seconds)

1. Open [`src/app.html`](src/app.html#L634), line 634, the sign-in page's tagline. Change the text.
2. Run it:

   ```bash
   npm test          # 297 pass, about 2 seconds
   npm run typecheck # no TypeScript errors
   npm run deploy    # about 9 seconds
   ```

3. Sign out on the web app and reload. The new text is live.
4. Undo it, or keep it:

   ```bash
   git checkout -- src/app.html && npm run deploy                 # undo, about 7 seconds
   git commit -am "Change the sign-in tagline" && git push        # or keep it
   ```

### A rule change, caught by the tests (rehearsed)

1. In [`src/routes/requests.ts`](src/routes/requests.ts#L9), line 9, change
   `MAX_PENDING_PER_STUDENT = 5` to `3`.
2. `npm test`: **3 tests fail**, each named after the rule: "rejects a sixth pending request",
   "holds the five-request cap when the last two arrive together", and "frees a slot when a pending
   request is cancelled".
3. `git checkout -- src/routes/requests.ts`, and `npm test` passes again. Don't deploy this one.

### Other changes they might ask for

| Change | Where | Note |
|---|---|---|
| Colours | [`src/app.html`](src/app.html#L11-L22), the variables at the top | |
| How long a demo sign-in lasts | [`src/routes/demo-auth.ts`](src/routes/demo-auth.ts#L10), line 10 | A test checks it's at most two hours |
| Most mentees an alumni can take | [`src/routes/alumni.ts`](src/routes/alumni.ts#L134), line 134 | The database also has a rule ([0002:31](migrations/0002_alumni_network.sql#L31)), which needs a new migration to change |
| A new interest | A new migration, plus the `reference` list in `src/app.html` | A test fails if the page and the database disagree |

**Undo a bad deploy:** `npx wrangler rollback` goes back to the version before.

## Questions we expect

The "Who" column suggests someone by PRD role. Swap as you like.

| Question | Short answer | Open | Who |
|---|---|---|---|
| How do two accepts at once not go over capacity? | One SQL statement checks room and accepts together, inside a transaction. A test fires a burst at once | [requests.ts:57-127](src/routes/requests.ts#L57-L127), [the race tests](test/requests.test.ts#L397) | Backend |
| Where is consent checked? | In SQL. Search never selects contact columns, and a connected student's view checks each switch on every load | [alumni.ts:22-24](src/routes/alumni.ts#L22-L24), [alumni.ts:85-87](src/routes/alumni.ts#L85-L87) | Backend |
| How do you know who saw what? | The reveal log, written at accept and on first view. Database triggers refuse edits and deletes | [requests.ts:88-104](src/routes/requests.ts#L88-L104), [0002:162-172](migrations/0002_alumni_network.sql#L162-L172) | Quality and Security |
| What about PDPA? | Consent per detail, with time and purpose, withdrawable, minimal data, and a log. Erasure isn't built yet | [SECURITY.md, section 2](SECURITY.md#2-pdpa) | Quality and Security |
| How do you stop SQL injection and XSS? | Bound SQL values. The page only inserts text, and its CSP blocks injected scripts. Live checks I1 to I4 and H1 | [SECURITY.md](SECURITY.md#3-common-attacks) | Quality and Security |
| What if Team 17 is down? | A clear 503 or 504, and the app shows *Try again*. Tests fake each failure | [partner-internships.ts:91-108](src/routes/partner-internships.ts#L91-L108) | Backend |
| How is the Team 17 integration proven? | Their request ID in our app and in their logs, plus saved live calls | [Integration evidence](evidence/team17-internships-integration.md) | Delivery and Document |
| How do you know a webhook is real? | An HMAC signature of the body, compared in constant time | [events-clubs.ts:34-39](src/routes/events-clubs.ts#L34-L39) | Quality and Security |
| Show a test failing | The rule change above, or the three saved before-and-after runs | [TESTING.md](TESTING.md#failed-tests-that-led-to-fixes) | Quality and Security |
| Does it work on a phone? | Yes. Tested at 390 px wide (M18). Open it on a phone | [Screenshot](evidence/screenshots/m18-phone-width.png) | Frontend |
| Why Cloudflare and not the PRD's Next.js and Supabase? | Our Week 06 integration was already live there, it never pauses on the free plan, and one deploy serves everything | [ARCHITECTURE.md](ARCHITECTURE.md#design-decisions) | Product Manager |
| What isn't built? | Erasure, AI matching, sending queued events, and the OpenAPI file | [ARCHITECTURE.md](ARCHITECTURE.md#built-and-planned) | Product Manager |
| Who did what? | The team table | [PROCESS.md](PROCESS.md#team) | Product Manager |
| How did you use AI, and how did you check it? | Claude Code wrote most of the code. Tests, live checks and reviews checked it, and we list what it got wrong | [PROCESS.md](PROCESS.md#ai-usage) | Delivery and Document |
| Can other teams use your API? | Yes. Team 17 has a public endpoint with counts only, plus a handover laid out like theirs. Show `curl "$B/api/mentors?category=Engineering"` | [handover/README.md](handover/README.md) | Delivery and Document |
| What would you do next? | Rate limiting, erasure, and switching to MFU Identity | [SECURITY.md, section 4](SECURITY.md#4-known-gaps) | Product Manager |

## If something breaks

| Problem | Do this |
|---|---|
| Internships says Team 17 can't be reached | Press *Try again* once. If it still fails, say so: this is the designed failure. Show the [saved screenshot](evidence/team17-internships-live.png) and the failure table in the [integration evidence](evidence/team17-internships-integration.md) |
| "You already have a pending request" or "already connected" | `npm run demo:reset`, or use the backup pair |
| The passcode is refused | Ask Phyo Phyo Lay for it again. It's case-sensitive |
| The live site is down | Run it locally: `npm run dev`, then `BASE_URL=http://localhost:8787 npm run demo:seed`, and open <http://localhost:8787/app>. The local passcode is in `.dev.vars` |
| No internet | The local copy works, except Internships |
| A deploy broke something | `npx wrangler rollback`, then check the site |
| The page looks stuck | Sign out and sign in again |

## After the evaluation

- Replace the three secrets that were shared in an AI chat:
  `npx wrangler secret put JWT_SECRET`, `EVENTS_CLUBS_WEBHOOK_SECRET` and `DEMO_PASSCODE`. Then update
  `.demo.vars` to match.
- Decide what to do with the open Week 06 routes (SECURITY.md, gap 4).
