# Klierly Capture (browser extension)

Saves the visible text of a course page you choose to **your own** Klierly server — after showing
you exactly what will be sent and only when you click Import. Private, unpacked use only for now.
Not affiliated with or endorsed by any LMS or university, and not an official Canvas integration.

## Install (Chrome or Edge)

1. Open `chrome://extensions` (Edge: `edge://extensions`) and switch on **Developer mode**.
2. **Load unpacked** → select this `extension/` folder. (`npm run package` also writes `dist/klierly-extension.zip`.)
3. In Klierly: **Settings → Browser extension → Create pairing token** and copy it (shown once).
4. Click the extension icon → **Settings**: enter the server address (`http://localhost:3000` locally;
   `https://…` anywhere else) and the token → **Save**. It reports the account it connected to.

## Use

- **Discover this course** — on a Canvas course page, click the icon → *Discover this course*. Allow
  access to that site when Chrome asks, scan, choose a module range or single items, review what will
  be imported and what is skipped (with reasons), tick the declaration, import. Stop any time; resume
  later. Scan again another day: imported items are marked, unchanged ones are not duplicated, changed
  pages are replaced.
- **Capture this page** — click the icon on any page, check the preview, choose course and module,
  tick the declaration, Import. Highlight text first to capture only the selection.
- **Import captions** — on a page with a lecture video, click the icon → *Import its captions or
  transcript*. Embedded players need a one-time permission for the video site.

## What it does and does not read

| Read | Never read |
| --- | --- |
| Visible text of the current tab (main content area), page title, address | Passwords and any form field values, cookies, storage, network traffic |
| Your selection, if any | Hidden elements, scripts, frames and embedded media |
| | Navigation, sidebars, footers; blocks that look like grades or class lists |
| | Any other tab; anything before you click the icon |

Permissions at install: `activeTab`, `scripting`, `storage` — nothing else. Access to a course site
or a video site is **optional**, asked per site through Chrome's own prompt at the moment you start
discovery or caption reading, and removable. No background script, no remote code, no Canvas API,
no LMS tokens, no cookies. Access model and open questions: `../docs/LMS_ACCESS.md`.

## Pages it refuses

- A quiz or exam in progress (address patterns such as `/quizzes/…/take`, answer fields inside a quiz
  form, a running timer, "Submit Quiz", proctoring tools). Nothing from the page is shown or sent.
- Grades and people/roster pages.
- Browser pages, extension stores, local files and the built-in PDF viewer (upload the PDF instead).

The Klierly server repeats the assessment check on every import. The checks are heuristics: they
can miss an unusual quiz layout or flag a harmless page. You remain responsible for importing only
what you are permitted to use. A syllabus that merely mentions exams gets at most a caution.

## Known limits

- **Not yet run against a real Canvas site by automated tests.** The Canvas adapter is tested on a
  synthetic mock; selectors may need adjusting.
- Files are read through the download link the page shows. If the LMS serves files from another
  address and the browser refuses, the item is reported and you upload it yourself.
- Captions: only what a player exposes as standard text tracks or a visible transcript panel.
  Players that draw captions themselves expose nothing; use the player's own transcript download.
- Quizzes, assignments, discussions, grades, people pages, locked items and external tools are never imported.
- If a site or your institution blocks extensions on a page, the extension says so and stops.
  It does not try to get around restrictions.
- Tested on Chromium with synthetic pages only (see `../TEST_REPORT.md`).

## Tests

`npm test` (guard, cleaning, Canvas adapter, captions, manifest minimality). End-to-end tests against the
real web app live in `../web/e2e/extension.spec.ts` and `../web/e2e/discovery.spec.ts` and run with `cd ../web && npm run test:e2e`.

## Before publishing to a store (not done)

Re-read, at that time, the Chrome Web Store program policies (Limited Use, single purpose, permission
justification, privacy disclosure form), Microsoft's add-on policies, Instructure's API/terms as they
apply to page content, and the target universities' rules. Provide a hosted privacy policy, remove
the `?tabId=` test seam or gate it, and have the academic-integrity guard reviewed independently.
