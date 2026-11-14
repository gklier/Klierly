# Managed AI ("Klierly AI")

**Status: built and tested against a mock provider. No real provider is configured, no credits
have been bought, and no real inference has run.** Until the operator sets the three variables
below, students see "AI is not set up" unless they connect their own provider.

## Turning it on (operator)

Set on the server (never in the browser or extension), then restart:

```
MANAGED_AI_BASE_URL=   # any OpenAI-compatible endpoint, ending before /chat/completions
MANAGED_AI_API_KEY=
MANAGED_AI_MODEL=      # an inexpensive model
```
Optional: `MANAGED_AI_MODEL_STRONG`, quotas, prices and `ADMIN_EMAILS` — see `.env.example`.
Choosing and funding a provider is a founder decision; it starts real spending.

## How it behaves

- **Resolution**: a student's own provider (BYOK), if connected, is used and billed to them.
  Otherwise the managed provider. Otherwise AI features explain that AI is not set up.
- **Model tiering**: the routine model handles study notes, topic suggestions and the first attempt
  at questions. The stronger model is used only for the retry after drafts failed validation.
- **Quotas** (all enforced before a request is sent): per student per day (requests), per student
  per month (tokens), all students per day (requests), all students per month (estimated dollars).
- **Rate limit**: 40 calls per minute per student, in addition to quotas.
- **Accounting**: every call records provider, tier, model, tokens, estimated cost, success. Never
  prompts, outputs or course text. Failed calls count against the quota.
- **Caching**: identical study-note requests are served from cache and cost nothing.
- **Abuse limits by design**: there is no free-form chat endpoint; prompts are built server-side
  for four fixed purposes; excerpts and response size are capped; registration is invite-only.
- **Feedback**: students see requests used today and share of the monthly allowance (Practice and
  Settings); the operator sees daily totals, per-student totals and estimated spend at `/admin`.

## Known limits

- Cost is an estimate from configured prices and provider-reported tokens; the invoice is truth.
  Without prices the dollar budget stop cannot trigger (the request and token caps still do).
- Quotas are checked before each call, not reserved, so parallel requests can overshoot slightly.
- No email verification yet, so a quota is per account, not per person. Keep invite-only.

## UF NaviGator Toolkit

Read on 2026-11-14 at <https://docs.ai.it.ufl.edu/docs/navigator_toolkit/intro/>. As summarised
from that page: the service "is available to UF students, faculty, and staff"; "Every UF student,
faculty, and staff receives a $100 per month credit to generate personal API keys"; access to
cloud-hosted models "requires team‑based approval and billing arrangements"; and restricted or
sensitive data is "not permitted with cloud models". The page does not say whether a personal key
may be used with a third-party or commercial application, and does not give an API endpoint.

Conclusion: NaviGator is **not** used as Klierly's managed provider and is not presented as
approved. It remains available only as a student's own, clearly experimental BYOK option, for the
student to use if UF's terms permit it. Using personal student credits to power a public or
commercial Klierly would need written confirmation from UF IT.
