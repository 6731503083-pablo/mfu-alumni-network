# Manual test log: web app

**Date:** 9 November 2026 · **Build:** `main`, deployed to <https://alumni-network-integration.phyo2lay.workers.dev/app>

**Who ran these:** Claude Code (an AI coding assistant) drove a real Chromium browser through the web
app with Playwright, step by step, on behalf of Phyo Wai Yan Lin Zaw. Each result below is what the
browser showed, and the screenshots are from those runs. Checks M01 to M18 ran on a local server
(`npm run dev`), and the rest ran on the live site. A human re-check sheet for the team is at the
end.

**Result:** 25 checks. 18 passed on the first try. 7 failed, were fixed, and passed when run again.

| ID | What we checked | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| M01 | Open `/app` on a laptop screen | Sign-in page: demo accounts by role, passcode field visible without scrolling | As expected, after the accounts were put in two columns | Pass | [m01](../screenshots/m01-signin.png) |
| M02 | Sign in with a wrong passcode (live) | Stays on sign-in, says the passcode is wrong | "That passcode is wrong. Ask the presenter for the demo passcode." | Pass | [m02](../screenshots/m02-wrong-passcode.png) |
| M03 | Sign in as student Su Myat | Directory of alumni taking mentees, with no contact details | 5 alumni listed, no email or LINE anywhere | Pass | [m03](../screenshots/m03-directory.png) |
| M04 | Search the job title in Burmese: အင်ဂျင်နီယာ | Only alumni with that word in their job title | 1 result: Kyaw Zin Htet, ဆော့ဖ်ဝဲ အင်ဂျင်နီယာ | Pass | |
| M05 | Open Kyaw Zin Htet's profile before any request | Email, LINE and LinkedIn marked "Not shared yet", plus a request form | As expected | Pass | [m05](../screenshots/m05-profile-before-connection.png) |
| M06 | Send a request with a real message | Panel changes to "Request sent", showing the message and Cancel | As expected | Pass | |
| M07 | Sign in as alumni Kyaw Zin Htet, open Requests to me | Su Myat's request under "Waiting for your answer", with Accept and Decline | As expected, with "You're mentoring 0 of up to 3 students" | Pass | [m07](../screenshots/m07-alumni-requests.png) |
| M08 | Press Accept | Request moves to Connected, toast says what was shared | "Connected with Su Myat. You shared your email." and 1 of 3 | Pass | [m08](../screenshots/m08-accepted.png) |
| M09 | Open My profile | Every field filled in, consent switches, and the date consent was recorded | As expected: "Your consent was last recorded on 9 Nov 2026, 13:40, for purpose version v1." | Pass | [m09](../screenshots/m09-profile-editor.png) |
| M10 | Switch on LinkedIn sharing with no LinkedIn link, then save | Not saved, with an error under that switch | "Add this contact detail before agreeing to share it" under the LinkedIn switch | Pass | |
| M11 | Add a LINE ID, switch its sharing on, turn LinkedIn off, save | Saved | "Changes saved." | Pass | |
| M12 | Sign in as Su Myat, open Kyaw Zin Htet's profile | Email and LINE "Shared with you", LinkedIn "Kept private". The reveal log gains a LINE row | As expected. The local D1 shows `contact_email` (at accept) and `contact_line` (at first view) | Pass | [m12](../screenshots/m12-contact-shared-with-leaked-toast.png) |
| M13 | Sign out, then sign in as someone else | No message left over from the last person | **Fail:** Kyaw's "Changes saved." toast appeared on Su Myat's screen (visible in m12). **Fixed:** signing out clears the toast. **Re-run on live:** no toast | Fail, fixed, Pass | [m12](../screenshots/m12-contact-shared-with-leaked-toast.png) |
| M14 | Sign in as Admin, open the directory | Every active profile, including ones not taking mentees, each with Turn off profile | **Fail:** an extra text "null" under the results. **Fixed:** empty parts are no longer added to the page. **Re-run on live:** 7 rows, no "null" | Fail, fixed, Pass | [m14](../screenshots/m14-admin-directory.png) |
| M15 | Student uses Find a mentor for this, signs out, Admin signs in | Admin sees the full directory | **Fail:** Admin saw 1 alumni, because the student's interest filter was still applied. **Fixed:** signing out clears the filters. **Re-run on live:** 7 alumni, no interests ticked | Fail, fixed, Pass | [m14](../screenshots/m14-admin-directory.png) |
| M16 | Sign in as "A new alumni" and press Create profile with an empty form | Errors on name, graduation year and school, with focus on Name | "Required when creating your profile" under all three, focus on Name | Pass | |
| M17 | Fill in name, year, school and email, then Create profile | Profile created, and the top bar shows the new name | "Thiri Aung (demo) (alumni)" in the top bar | Pass | |
| M18 | Use the directory at phone width (390 px) | No sideways scrolling, links reachable, results visible | **Fail:** no sideways scroll, but the links were squeezed beside the title and the filters pushed results off screen. **Fixed:** links get their own row and filters fold away on phones. **Re-run:** as expected | Fail, fixed, Pass | [m18](../screenshots/m18-phone-width.png) |
| M19 | Open Internships (live) | Team 17's open internships, labelled as demo listings, with their request ID | 6 listings and "Live from Team 17 Internship Management at 14:13. Their request ID is …" | Pass | [live](../team17-internships-live.png) |
| M20 | Read a remote listing | Location shown once | **Fail:** "Remote, Remote". **Fixed:** shown once when the location is the work mode. **Re-run:** "Remote" | Fail, fixed, Pass | |
| M21 | Open Internships while Team 17 is slow (about 3 s on a cold start) | The page shows it's loading | **Fail:** the results box was blank for about 3 seconds. **Fixed:** "Loading internships from Team 17…". **Re-run:** message shown, then the listings | Fail, fixed, Pass | |
| M22 | Find a mentor for this on Product Design Intern | Directory filtered to UX/UI Design | 1 alumni: Ei Mon Thant, Product Designer. Toast: "Showing alumni interested in UX/UI Design." | Pass | [live](../team17-find-a-mentor-live.png) |
| M23 | Read the consent footnote a connected student sees | Accurate about what's kept | **Fail:** it said Thailand's PDPA "requires" the log, which is more than we can claim. **Fixed:** "A record is kept of what was shared with you and when." | Fail, fixed, Pass | |
| M24 | Watch the browser console through all of the above | No errors apart from expected 400 and 404 responses, and no Content-Security-Policy violations | Only the expected 404 (no profile yet) and 400 (validation) | Pass | |
| M25 | Demo sign-in rules on the live API (curl) | Wrong passcode 401. A student ID asking for admin, or a real-looking ID, 400. Demo admin 200 | 401, 400, 400 and 200 | Pass | |

## Human re-check before the evaluation

To be done by a team member, by hand, on the live site on 10 November before 13:00. Fill in the last
two columns.

| # | Check | Expected | Tester | Pass or fail |
|---|---|---|---|---|
| H1 | Sign in as Su Myat with the passcode | Directory loads | | |
| H2 | Search the job title "พยาบาล" | Nattaya Srisuk only | | |
| H3 | Send Kyaw Zin Htet a request | "Request sent" | | |
| H4 | Sign in as Kyaw Zin Htet and accept | "Connected with Su Myat…" | | |
| H5 | Sign in as Su Myat and open Kyaw Zin Htet | Contact details "Shared with you" | | |
| H6 | As Kyaw Zin Htet, switch email sharing off. As Su Myat, reload the profile | Email now "Kept private" | | |
| H7 | Open Internships | Team 17's listings and a request ID | | |
| H8 | Find a mentor for this on any listing | Directory filtered to that field | | |
| H9 | Sign in as Admin and turn off a demo profile | It leaves the directory | | |
| H10 | Open the site on a phone | Usable without sideways scrolling | | |
