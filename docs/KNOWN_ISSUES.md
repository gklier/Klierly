# Known issues

## Intermittent React hydration error on the Materials page (production builds)

**Symptom.** Occasionally the browser console shows `Minified React error #418` (a hydration mismatch) when the
Materials page loads. The page recovers: React re-renders it in the browser and the final page is identical to what
the server sent. Nothing is lost and every control works, but it is a defect: the page does extra work, and the
error shows in the console.

**How often.** Rarely in normal use. It appeared once in roughly every five or six full CI runs, always on the
Materials page, and it can be provoked on purpose (see below) at about one load in sixty while documents are being
imported. It has only ever been seen in the production build; ten rounds of the same stress against the development
server, including under CPU load, produced none.

**What has been ruled out (each tested by measuring the error rate before and after):**

| Suspect | Result |
| --- | --- |
| The import panel's polling calling `router.refresh()` every 1.5 s | Disabling *all* client refreshes did not remove it (9 errors in 40 rounds vs 4 in 30 with them). Polling now refreshes only when the pending count changes, which is cheaper, but is **not** the fix |
| Next.js streaming page metadata into a hidden `<div>` | Forcing blocking metadata (`htmlLimitedBots`) changed nothing (8 in 40). Reverted |
| A section of the page streamed in late | The failing page was one complete document with no pending Suspense boundaries |
| A real difference between the server's HTML and the client's render | After removing known-benign React markers, the two were identical, so the mismatch is transient during hydration |

**What is not known.** Which component's first client render differs from the server's. Production React reports only the
code. A readable diff needs the development build, which does not reproduce it. Unverified ideas: a framework-level race
in Next 15.5 / React 19 with this page's many forms and server actions (the issue may disappear on the next Next.js major
version, which is already on the roadmap); or one of the page's client components rendering something time-dependent on its first pass.

**Reproduce it.**
```bash
cd web && npm run build && npm start        # in another terminal; the worker must be running
EMAIL=you@example.com PASSWORD='…' BASE=http://localhost:3000 node scripts/repro-hydration.mjs 10
```
The script creates throwaway courses in that account, uploads the sample files, reloads rapidly while they are processing,
and prints any console errors. The per-account import limit allows about twelve rounds per server restart.

**How the test suite treats it.** `web/e2e/journey.spec.ts` prints a `KNOWN ISSUE` warning for each occurrence and fails
the run if there are more than two in one run or if any *other* console error appears. Treat a run with the warning as
passed-with-a-defect, not as clean.
