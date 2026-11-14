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

Open a course page → click the toolbar icon → check the preview and title → choose course and module
→ tick the declaration → **Import** → follow the link to the new source. If you highlighted text
first, only the selection is captured (toggle available).

## What it does and does not read

| Read | Never read |
| --- | --- |
| Visible text of the current tab (main content area), page title, address | Passwords and any form field values, cookies, storage, network traffic |
| Your selection, if any | Hidden elements, scripts, frames and embedded media |
| | Navigation, sidebars, footers; blocks that look like grades or class lists |
| | Any other tab; anything before you click the icon |

Permissions: `activeTab` (the tab you clicked on, for that click), `scripting` (to run the reader in
that tab), `storage` (server address and token in this browser). No host permissions, no background
script, no remote code.

## Pages it refuses

- A quiz or exam in progress (address patterns such as `/quizzes/…/take`, answer fields inside a quiz
  form, a running timer, "Submit Quiz", proctoring tools). Nothing from the page is shown or sent.
- Grades and people/roster pages.
- Browser pages, extension stores, local files and the built-in PDF viewer (upload the PDF instead).

The Klierly server repeats the assessment check on every import. The checks are heuristics: they
can miss an unusual quiz layout or flag a harmless page. You remain responsible for importing only
what you are permitted to use. A syllabus that merely mentions exams gets at most a caution.

## Known limits

- Many LMS pages show content inside frames; frames are not read by design. Use copy/paste or upload.
- If a site or your institution blocks extensions on a page, the extension says so and stops.
  It does not try to get around restrictions.
- Tested on Chromium with synthetic pages only (see `../TEST_REPORT.md`).

## Tests

`npm test` (guard, text cleaning, manifest minimality). End-to-end tests against the real web app
live in `../web/e2e/extension.spec.ts` and run with `cd ../web && npm run test:e2e`.

## Before publishing to a store (not done)

Re-read, at that time, the Chrome Web Store program policies (Limited Use, single purpose, permission
justification, privacy disclosure form), Microsoft's add-on policies, Instructure's API/terms as they
apply to page content, and the target universities' rules. Provide a hosted privacy policy, remove
the `?tabId=` test seam or gate it, and have the academic-integrity guard reviewed independently.
