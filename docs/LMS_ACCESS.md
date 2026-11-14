# How Klierly reads a course site, and what that does and does not rely on

## The decision

Klierly's extension reads **pages your own browser has rendered, in your own tab**. It does not
call the Canvas REST API, uses no developer key or access token, and never reads cookies.

Why not the API: Instructure's API policy (read 2026-11-14 at
<https://www.instructure.com/policies/canvas-api-policy>) is written for registered applications
with access tokens. As summarised from that page: rate limits are "enforced per user access
token"; applications "must outline what actions your application will take on the Customer's or
User's behalf"; using the APIs "on behalf of any third-party" is prohibited; and connecting through
technologies "not approved by Instructure" is prohibited. Calling the API from an extension with a
student's logged-in session would sit outside that model. The sanctioned route is OAuth with a
developer key issued by the institution, which Klierly does not have (see ROADMAP).

## What the extension does instead

| Step | Mechanism | Limit |
| --- | --- | --- |
| Permission | Chrome's own prompt for that one site (`optional_host_permissions`), asked when you start discovery; removable | Nothing is granted at install |
| Inventory | Reads the Modules page you can see: module names, item titles, types, links | No item content is read while scanning |
| Import | Opens each item you selected in your tab, one at a time, ~1.5 s apart, and reads the visible content with the same extractor and safety checks as single-page capture | Stays on the course site; you can stop at any time |
| Files | Uses the download link the page itself shows | If no link is shown, or the browser refuses the read, it says so and asks you to upload the file |
| Captions | Reads caption tracks / transcript panels a player exposes; embedded players need a separate per-site permission | Never the video or audio |

Never opened or imported: quizzes, assignments, discussions, grades, people pages, locked or
unreleased items, external tools. The server repeats the assessment check on every import.

## What is NOT established

- **Institutional permission.** Automated navigation of a course site, even at human pace in your
  own session, may still be restricted by your university's acceptable-use rules or by course
  policy. This has not been checked with UF. Verify before relying on it, and prefer manual upload
  where rules are unclear.
- **Real Canvas compatibility.** The Canvas adapter is written from knowledge of Canvas's page
  structure and tested only against a synthetic mock (`web/e2e/mock-canvas.ts`). Canvas has more
  than one Modules page implementation; selectors may need adjusting after the first real run.
- **File downloads on real Canvas.** Canvas often redirects downloads to a separate file host. If
  the browser blocks that cross-site read, the item is reported as not importable.
- **Video platforms.** Caption reading works for players that expose standard text tracks or a
  visible transcript panel. Players that draw captions themselves expose nothing to read.

## Adding another LMS

`extension/src/lms/` holds one adapter per platform with the same shape
(`matchCourse`, `readModulesPage`, `inspectResource`, `fetchFile`, `classify`, `externalId`).
Register it in `index.js`. The server side is LMS-neutral: it only sees a resource id, a module
name and content.
