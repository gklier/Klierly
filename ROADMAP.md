# Roadmap

Klierly aims to turn permitted course material into a study routine that is easier to follow and inspect. This is a direction of travel, not a commitment to dates or a promise that every idea will ship.

## Available in the preview

- Private courses, import and paste, search, and source excerpts with page, slide or timestamp references.
- Reviewable suggestions for modules, learning objectives and dates; manual corrections and coverage checks.
- Exam-aware daily plans, practice drills, timed mock exams, mistake review and progress heuristics.
- Optional AI question and note generation, validated structure and arithmetic, source references, and separately labelled general explanations.
- A synthetic statistics sample with 35 checked questions that needs no AI provider.
- Extension-based Canvas-style discovery, selective import, page capture, captions, progress and stop/resume.
- Optional class summary sharing, subject to administrator membership approval, class enablement, student consent and moderation.
- Approved accounts, passkey-only sign-in, revocable expiring extension tokens, administrator controls and targeted fresh verification for sensitive actions.
- Managed-AI reservation and budget controls, constrained provider destinations, bounded uploads and parsing, isolated services, and Cloudflare Tunnel deployment support.

## Next: make the pilot dependable

1. **Onboarding and browser compatibility.** Improve enrollment instructions, passkey-provider guidance, recovery and second-device setup. Investigate the reported Firefox login friction.
2. **Real-course validation.** Test import on permitted Canvas pages and supported lecture players, then adjust selectors and file handling. Automated LMS coverage is synthetic; it does not prove every institution's site works.
3. **Learning quality.** Evaluate real-provider question quality and explanations with students. Validation of citations, structure and arithmetic is not a substitute for subject review.
4. **Operations.** Complete a restore drill, add dependable uptime/error monitoring, document retention and backup practices, and test upgrade recovery.
5. **Accessibility and usability.** Improve the daily workflow, error messages, keyboard navigation and mobile-browser experience from pilot feedback.

## Then: validate a sustainable product

Measure whether students return, what helps them learn, and the real per-user AI and hosting costs. Explore paid hosted convenience and bounded AI allowances only after the costs, demand and support obligations are understood. Billing, subscriptions and published prices do not exist yet.

See [product direction](docs/PRODUCT_DIRECTION.md) for commercial options and [source terms](SOURCE_TERMS.md) for the current licensing position. Optional [Buy Me a Coffee support](https://www.buymeacoffee.com/gklier) helps fund development without promising access or features.

## Explorations, not shipped features

| Idea | What needs to happen first |
| --- | --- |
| Official Canvas OAuth | Institutional developer-key approval and access-policy review |
| OCR for scanned material | Accuracy, resource and privacy evaluation |
| More LMS platforms | Real permission-aware workflows and adapter coverage |
| Bulk account data export | A defined portable format and access review |
| Native mobile applications | Evidence that the browser workflow needs native support |
| Instructor and institutional tools | Product discovery, privacy requirements and appropriate agreements |
| Paid hosting and plans | Real costs, willingness to pay, billing and customer terms |

## Boundaries that stay visible

Only import material you are allowed to use. Do not use Klierly to capture active assessments or complete graded work. Institution and instructor rules still apply. Original files are private; optional summary sharing is a narrower, separately controlled feature.

Before broader paid access, review privacy and service terms, copyright handling, extension-store policies, institutional rules and real-model quality. Keep dependency and platform updates current. No security review, test count or readiness score is a guarantee.

Technical decisions: [architecture](ARCHITECTURE.md), [design decisions](docs/DECISIONS.md), [LMS access model](docs/LMS_ACCESS.md), [known issues](docs/KNOWN_ISSUES.md), [security operations](docs/SECURITY_OPERATIONS.md).
