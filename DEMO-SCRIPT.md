# Alumni Network demo script

Final evaluation, 10 November 2026. About 7 minutes, plus questions. This is the presenter's
script: what to click and what to say at each step. The team's checklist and full runbook are in
[DEMO-DAY.md](DEMO-DAY.md).

Run every command from this folder, on Phyo Phyo Lay's laptop. The live site is
<https://alumni-network-integration.phyo2lay.workers.dev/app>.

## Before you start

- [ ] If anyone used the live site after 11:50, run `npm run demo:reset`.
- [ ] Open these tabs:
  - the web app, signed out
  - the repo
  - `ARCHITECTURE.md`
  - `SECURITY.md`
  - VS Code with `alumni-network/`
  - a terminal in `alumni-network/`
- [ ] Zoom the browser so the back row can read it.
**Switching people:** click **Sign out** at the top right. Signing in is one click on a name, with no
password.

## Opening (20 seconds)

> "This is the MFU Alumni Network. Students find alumni and ask them for mentoring. Alumni contact
> details stay hidden until the alumni accepts, and they only share what they choose. It runs on one
> Cloudflare Worker with a D1 database, and it's live."

## The flow

### 1. Sign in as Ko Min (student)

- **Do:** click **Ko Min**.
- **You see:** Find a mentor.
- **Say:** "MFU's Identity service hasn't published its login yet, so a demo sign-in stands in for it."

### 2. Search in Thai

- **Do:** type `พยาบาล` in **Job title**. There's no search button; the list updates as you type.
- **You see:** 1 alumni found, Nattaya Srisuk.
- **Say:** "Search works in Thai and Burmese." (FR-01)

### 3. Open Nattaya's profile

- **Do:** click **Nattaya Srisuk**.
- **You see:** her profile on the left. On the right, a panel with three steps: *Write to Nattaya
  Srisuk*, *Nattaya Srisuk answers* and *Contact details unlock*. Email, LINE and LinkedIn are locked.
- **Say:** "Ko Min can see which contact details exist, but not what they are. He only sees them after
  she accepts, and only the ones she shares." (BR-01)

### 4. Send a request

- **Do:** click the **Healthcare** draft and add one sentence of your own, such as "I'm in my third
  year." Then click **Send request**.
- **You see:** the toast "Request sent to Nattaya Srisuk." The panel moves to step 2, *Waiting for
  Nattaya Srisuk to answer*.
- **Say:** "The drafts come from her profile, so students know what to ask. The database allows one
  waiting request per alumni and five in total." (BR-05, BR-08)

### 5. Nattaya accepts

- **Do:** **Sign out**, then click **Nattaya Srisuk**. *Requests to me* opens. Click **Accept**.
- **You see:** "Connected with Ko Min. You shared your email and LINE."
- **Say:** "Accepting checks her mentee limit, creates the connection, records what was shared and
  queues an event, all in one transaction. D1 has no row locks, so the limit check and the accept are
  a single SQL statement. Two accepts at once can't go over." (FR-06)

### 6. Ko Min sees the contact details

- **Do:** **Sign out**, then **Ko Min**. Click **My requests**, then **See contact details**.
- **You see:** steps 1 and 2 ticked. Her email and LINE show. LinkedIn says *Kept private*.
- **Say:** "He sees only what she agreed to share. What he saw, and when, is now in the reveal log,
  which the database won't let anyone edit or delete." (BR-10)
- **Optional proof**, in the terminal:

  ```bash
  npx wrangler d1 execute alumni-network-db --remote \
    --command "SELECT viewer_id, field_name, revealed_at FROM contact_reveal_log ORDER BY id DESC LIMIT 3"
  ```

### 7. Nattaya stops sharing her email

- **Do:** **Sign out**, then **Nattaya Srisuk**. Open **My profile**. Under Email, untick **Share with
  students I accept**. Click **Save changes**.
- **You see:** "Changes saved."
- **Say:** "She can stop sharing at any time." (BR-03)

### 8. Ko Min looks again

- **Do:** **Sign out**, then **Ko Min**. Click **My requests**, then **See contact details**.
- **You see:** Email now says *Kept private*. LINE still shows.
- **Say:** "Consent is checked in SQL every time the profile loads, not once at accept."

### 9. Team 17's internships

- **Do:** click **Internships**. The first load takes about 3 seconds, so start talking.
- **You see:** Team 17's live listings, with their request ID at the bottom.
- **Say:** "This comes live from Team 17's Internship API, through our server. That request ID also
  shows in their logs." (Requirement 3)

### 10. From an internship to a mentor

- **Do:** on **Product Design Intern**, click **Find a mentor for this**.
- **You see:** Find a mentor, filtered to UX/UI Design, showing Ei Mon Thant.
- **Say:** "We map their internship categories to our mentor topics. The other way, Team 17 shows how
  many of our mentors there are for each field, through a public endpoint that only returns counts."

### 11. Admin

- **Do:** **Sign out**, then **Admin**. Look at the directory, then open any profile.
- **You see:** **Turn off profile** on every card. On a profile, the panel says *Admins never see
  contact details*.
- **Say:** "Admins see public fields only. Turning a profile off removes it from search, and nothing is
  deleted." Don't click it.

## Closing (10 seconds)

> "The suite has 349 automated tests, and 40 security checks run against the live site. The tests,
> the security write-up and the integration evidence are all in the repo."

## If they ask for a live change

### A visible change (about 20 seconds)

1. In VS Code, open `src/app.html` at line 713, the sign-in page's tagline. Change the text.
2. In the terminal:

   ```bash
   npm test           # 349 pass, about 2 seconds
   npm run typecheck  # no errors
   npm run deploy     # about 9 seconds
   ```

3. Sign out on the web app and reload. The new text is live.
4. Undo it:

   ```bash
   git checkout -- src/app.html && npm run deploy
   ```

### A rule change the tests catch (checked today)

1. In `src/routes/requests.ts`, line 9, change `MAX_PENDING_PER_STUDENT = 5` to `3`.
2. Run `npm test`. **3 tests fail**, each named after the rule:
   - "rejects a sixth pending request"
   - "holds the five-request cap when the last two arrive together"
   - "frees a slot when a pending request is cancelled"
3. Run `git checkout -- src/routes/requests.ts`, then `npm test` again. All pass.
4. Don't deploy this one.

## Questions you'll likely get (you're Backend)

| They ask | You say | Show |
|---|---|---|
| How do two accepts at once not go over the limit? | One SQL `UPDATE` checks room and accepts together, inside a transaction. A test fires a burst of accepts at once | `src/routes/requests.ts` lines 57 to 127, `test/requests.test.ts` line 397 |
| Where is consent checked? | In SQL. Search never selects contact columns. A connected student's view checks each switch on every load | `src/routes/alumni.ts` lines 22 to 24 and 85 to 87 |
| What if Team 17 is down? | A clear 503 or 504, and the app shows *Try again*. Tests fake each failure | `src/routes/partner-internships.ts` lines 91 to 108 |
| How do you know a webhook is real? | An HMAC signature of the body, compared in constant time | `src/routes/events-clubs.ts` lines 34 to 39, `src/lib/hmac.ts` |
| SQL injection? | Every value is bound. We never use `LIKE` on user text; we use `instr()`, because D1 rejects `LIKE` patterns over 50 bytes and a Burmese job title passes that fast | `SECURITY.md` |
| Why Cloudflare, not the PRD's Next.js and Supabase? | Our Week 06 integration was already live there, it never pauses on the free plan, and one deploy serves the API, the docs and the app | `ARCHITECTURE.md` |
| What isn't built? | Erasure, AI matching, sending queued events, and the OpenAPI file | `ARCHITECTURE.md` |
| How did you use AI? | Claude Code wrote most of the code. Tests, live checks and reviews checked it, and we list what it got wrong | `PROCESS.md` |

## If something breaks

| Problem | Do this |
|---|---|
| Internships can't reach Team 17 | Press *Try again* once. If it still fails, say "this is the designed failure", then show `evidence/team17-internships-live.png` |
| "You already have a request waiting" or "already connected" | Run `npm run demo:reset`, or use the backup pair: Su Myat finds Ei Mon Thant through **Internships** |
| A deploy broke something | Run `npx wrangler rollback` |
| The live site is down | Run `npm run dev`, then `BASE_URL=http://localhost:8787 npm run demo:seed`, and open <http://localhost:8787/app> |
| The page looks stuck | Sign out and sign in again |

## After the demo

- Run `npm run demo:reset` if anyone will demo again.
- After the evaluation, replace the two secrets still in use that were shared in an AI chat:

  ```bash
  npx wrangler secret put JWT_SECRET
  npx wrangler secret put EVENTS_CLUBS_WEBHOOK_SECRET
  ```

  Then update `.demo.vars` to match. The third, `DEMO_PASSCODE`, has been unused since 11 November:
  delete it with `npx wrangler secret delete DEMO_PASSCODE`.
