# How we built it

Who did what, how the work went, the git history, and how we used AI. For how the system itself is
built, see [ARCHITECTURE.md](ARCHITECTURE.md). For testing and security, see [TESTING.md](TESTING.md)
and [SECURITY.md](SECURITY.md).

## Team

Team 19, Pod 5. Roles are from the PRD. Student IDs are left out because this repo is public.

| Member | Nickname | Role | What the role covers in the PRD |
|---|---|---|---|
| Phyo Sithu | Phyo Si | Frontend UX/UI | The three screens: find a mentor, the mentoring request, and the profile and consent manager. All usable on a phone from 360 px wide, with loading, empty and error states (NFR-07) |
| Phyo Wai Yan Lin Zaw | Phyo Phyo Lay | Backend API and Database | The nine API endpoints (section 11), the data model (section 8), the accept transaction (FR-06), and the webhooks with other teams (FR-10, FR-11) |
| Nyan Linn Htet | Neon | Quality and Security | The 11 planned tests (section 14), security and privacy (section 12), and the unauthorised-access test group |
| Khun Be Be R Zar Ni | Erik | Delivery and Document | The API contract for other teams (section 11), the deployment plan and the seven runbooks (section 14) |
| Aye Min Aung | Ryan | Product Manager | Scope (section 2), the user journey (section 4), risks (section 16) and the acceptance criteria (section 17) |

All five are named on the group's PRD (v1.0, August 2026), Data and Query Design (Week 04) and
presentation. Those documents are outside this repo. The PRD also records that the group reviewed an
earlier draft together (failure analysis and an architecture challenge), which led to its consent,
outbox and security fixes.

The code in this repo is Phyo Phyo Lay's, in the backend role: the Week 06 integration with Team 17
(A5), the Mentoring API and its database, the web app (following the presentation's screens),
deployment, the Team 17 internships integration, and the test and security evidence.

## How the work went

| When | What | Evidence |
|---|---|---|
| August 2026 | The PRD, the Data and Query Design, and the presentation | Group documents, outside this repo |
| September 2026 | Week 06 integration with Team 17 (A5): our public status endpoint, a call to theirs, signed webhooks both ways, and an idempotent create. Deployed to Cloudflare | [A5 evidence](A5-Team19-Integration-Evidence.md), dated 21 September |
| 3 November | The Mentoring API (API-01 to API-09), built test-first from the PRD and the data design, with the `/docs` page | The oldest Mentoring API files are dated 3 November |
| 9 November | Getting ready for the final evaluation: the public repo, deployment, demo scripts, the web app, the Team 17 internships integration and our API handover to Team 17, and the test, security and process evidence | Commits from `4696391` on, below |
| 10 November | Final evaluation | |

### How we work

1. **Start from the documents.** The code uses the PRD's and data design's names (API-01, FR-04,
   BR-10, and the same table and column names), so anyone can trace a line of code back to a
   requirement.
2. **Agree the contract before coding against another team.** For internships we followed Team 17's
   handover (their OpenAPI file and Postman collection), and our Worker checks their answers against
   it every time.
3. **Test first.** Write the test, watch it fail, then write the code. For each security fix, the
   failing run is saved as evidence.
4. **Check before and after every deploy.** `npm test` and `npm run typecheck` must pass before
   `npm run deploy`. Afterwards, `npm run demo` checks the live site end to end. There's no CI
   pipeline, because the evaluation doesn't require one.
5. **Small commits**, each saying what changed and why.
6. **Save evidence when it happens**, with its date, in [`evidence/`](evidence/).

## Git history

The repository was created on 9 November 2026. The first seven commits import code built on our
machine since September, split into logical parts, so their times show the import, not when the work
was done:

| Commit | Time | What | Size |
|---|---|---|---|
| [`2201c3c`](https://github.com/6731503083-pablo/mfu-alumni-network/commit/2201c3c) | 9 Nov 13:25 | Set up Cloudflare Worker project (Hono, TypeScript, D1, Vitest) | 9 files, +2967 |
| [`5a4647a`](https://github.com/6731503083-pablo/mfu-alumni-network/commit/5a4647a) | 9 Nov 13:25 | Add D1 schema: A5 lab tables and Alumni Network data model | 2 files, +209 |
| [`24a1d39`](https://github.com/6731503083-pablo/mfu-alumni-network/commit/24a1d39) | 9 Nov 13:25 | Add shared libraries: JWT auth with roles, HMAC verification, errors, validation | 4 files, +157 |
| [`9105012`](https://github.com/6731503083-pablo/mfu-alumni-network/commit/9105012) | 9 Nov 13:25 | Add Mentoring API routes (API-01 to API-09) | 5 files, +700 |
| [`e463be8`](https://github.com/6731503083-pablo/mfu-alumni-network/commit/e463be8) | 9 Nov 13:25 | Add Team 17 integration routes (A5) and API docs page | 2 files, +1354 |
| [`d43b01f`](https://github.com/6731503083-pablo/mfu-alumni-network/commit/d43b01f) | 9 Nov 13:25 | Add Vitest suite running in the Workers runtime | 10 files, +1686 |
| [`0586154`](https://github.com/6731503083-pablo/mfu-alumni-network/commit/0586154) | 9 Nov 13:25 | Add README, project notes and A5 integration evidence | 5 files, +429 |

Every later commit is one real step, in the order it happened:

| Commit | Time | What | Size |
|---|---|---|---|
| [`4696391`](https://github.com/6731503083-pablo/mfu-alumni-network/commit/4696391) | 9 Nov 13:32 | Deploy Mentoring API and docs to Cloudflare Workers | 2 files, +7, −2 |
| [`bd95c01`](https://github.com/6731503083-pablo/mfu-alumni-network/commit/bd95c01) | 9 Nov 13:37 | Log contact fields consented after a connection is made (BR-10) | 2 files, +75, −12 |
| [`89df029`](https://github.com/6731503083-pablo/mfu-alumni-network/commit/89df029) | 9 Nov 13:41 | Add happy-path demo and seed scripts | 7 files, +631, −1 |
| [`7ac1d4d`](https://github.com/6731503083-pablo/mfu-alumni-network/commit/7ac1d4d) | 9 Nov 14:00 | Add web app with demo sign-in | 13 files, +1512, −22 |
| [`67079bf`](https://github.com/6731503083-pablo/mfu-alumni-network/commit/67079bf) | 9 Nov 14:02 | Limit demo sign-in to fixed roles and demo data | 8 files, +85, −17 |
| [`fe38bc8`](https://github.com/6731503083-pablo/mfu-alumni-network/commit/fe38bc8) | 9 Nov 14:12 | Integrate Team 17's public internship API | 14 files, +591, −3 |
| [`e3c6492`](https://github.com/6731503083-pablo/mfu-alumni-network/commit/e3c6492) | 9 Nov 14:14 | Add Team 17 internship integration evidence | 4 files, +118 |
| [`bd8c24b`](https://github.com/6731503083-pablo/mfu-alumni-network/commit/bd8c24b) | 9 Nov 14:20 | Add test evidence and clear filters on sign-out | 17 files, +574, −2 |
| [`76a8ec0`](https://github.com/6731503083-pablo/mfu-alumni-network/commit/76a8ec0) | 9 Nov 14:31 | Send security headers on every response and redirect plain HTTP | 6 files, +472, −7 |
| [`c3a0ba0`](https://github.com/6731503083-pablo/mfu-alumni-network/commit/c3a0ba0) | 9 Nov 14:35 | Add security and PDPA evidence | 7 files, +465, −182 |

`git log` shows anything newer. This repo is the backend, so every commit is by Phyo Wai Yan Lin Zaw.
The commits from 9 November were made through Claude Code (see below).

## AI usage

### The tool

We used **Claude Code**, Anthropic's AI coding assistant, inside VS Code. It reads and edits files,
runs commands (tests, git, Cloudflare's `wrangler`) and can drive a web browser. A person gives every
instruction and sees every action. Commands that touch secrets need a person's approval: twice on
9 November, uploading a secret was blocked until we approved it.

### What the AI did, and what people decided

| Work | What Claude Code did | What people decided or did |
|---|---|---|
| PRD, data design, presentation | Not recorded | The team wrote them |
| Week 06 integration, A5 (September) | Not recorded | Agreed the contract with Team 17, and submitted the evidence |
| Mentoring API (3 November) | Wrote the routes, the database migration, the tests and the `/docs` page from the PRD and the data design, test first | Asked for the PRD's API, and kept the work to the Alumni project |
| Web app (9 November) | Built it from the presentation's screens and colours, and tested it in a browser at laptop and phone widths | Decided the evaluation needs a working web app, not just an API |
| Team 17 internships (9 November) | Read Team 17's handover, then wrote the integration, its tests and its evidence | Chose Team 17 as our only integration partner, because they're in our pod |
| Deployment (9 November) | Ran `wrangler`, git and GitHub commands | Created the secrets and approved each upload. Chose a public repo on the university GitHub account |
| Testing and security evidence (9 November) | Ran the tests, browser checks and live checks, and wrote [TESTING.md](TESTING.md), [SECURITY.md](SECURITY.md), this page and [ARCHITECTURE.md](ARCHITECTURE.md) | A team member re-checks the web app by hand (H1 to H10 in the [manual log](evidence/tests/manual-test-log.md)). We decided which gaps to fix now and which to explain |

### How we checked the AI's work

We don't take the AI's word that something works. Every claim in this repo points to a test, a live
run or a screenshot:

- **297 automated tests**, run inside the real Workers runtime against a real D1 database.
- **Failed, then fixed:** each security fix's test was run against the code before the fix, to prove
  the test catches the bug ([three runs](TESTING.md#failed-tests-that-led-to-fixes)).
- **Live checks:** the 35-check demo, 40 security and PDPA checks, and a Team 17 call with their
  request ID.
- **Browser checks** with screenshots, labelled as AI-driven, plus a sheet for a person to re-check by
  hand.
- **`npm run typecheck`** and **`npm audit`**.

### Rules the AI must follow

Claude Code reads [`CLAUDE.md`](CLAUDE.md) at the start of every session. It holds the project's rules
that must never break, for example:

- Capacity and request limits are checked in one SQL statement, never read-then-write.
- Contact details only leave the database through a consent check.
- The reveal log is append-only.
- An empty secret refuses requests.
- The web app never turns API text into HTML.

Tests enforce most of these rules, so if the AI breaks one, a test fails. Claude Code also keeps short
notes between sessions, such as "free services only", "use the university GitHub account" and "keep
this group project separate from individual assignments".

### What the AI got wrong, and how we caught it

| Problem in AI-written work | Caught by | Fixed in |
|---|---|---|
| A contact detail the alumni agreed to share **after** connecting was shown without a reveal-log row (BR-10) | A security review of the code | `bd95c01`, [failed, then fixed](evidence/tests/red-green-reveal-log.txt) |
| Anyone with the demo passcode could get an admin token able to turn off **any** profile | A security review of the code | `67079bf`, [failed, then fixed](evidence/tests/red-green-demo-admin.txt) |
| Seven web app bugs: a message left over from the last person, a stray "null", filters kept after sign-out, a cramped phone layout, "Remote, Remote", no loading message, and PDPA wording that claimed more than we can | Browser testing ([manual log](evidence/tests/manual-test-log.md), M13 to M23) | `7ac1d4d`, `fe38bc8` and `bd8c24b` |
| No security headers on API answers, and plain HTTP served | Collecting the security evidence | `76a8ec0`, [failed, then fixed](evidence/tests/red-green-security-headers.txt) |
| TESTING.md said Ko Min had no history, but he was already connected to an alumni | The live security run's output | `c3a0ba0` |

### What we learned

1. **Review AI-written code for security separately.** Two real bugs passed every test until a review
   went looking for them.
2. **An AI driving a browser isn't a person testing.** We label those checks and have a person
   re-check.
3. **Never paste secrets into an AI chat.** Three live secrets were shared that way on 9 November.
   They'll be replaced after the evaluation.
4. **Ask for evidence, not claims.** "It works" means nothing until a test or a live run shows it.
5. **Check legal wording against the source.** The AI first wrote that PDPA "requires" our reveal
   log, which is more than we can claim.
