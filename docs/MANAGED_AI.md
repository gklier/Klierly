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

## Where "AI with no key" comes from

Nowhere yet: managed AI is only a slot. Someone has to supply an OpenAI-compatible endpoint and key
for it, and that someone pays or hosts. The options, with their real constraints:

| Option | Cost | Notes |
| --- | --- | --- |
| **A paid API** (any OpenAI-compatible provider, including Google's paid Gemini API) | Per use; the monthly budget stop and quotas cap it | Best quality; cost scales with students. Founder decision |
| **Self-hosted on a small server** (Ollama exposes `http://<host>:11434/v1`, which works here unchanged) | Server cost only | See the limits below |
| **NaviGator** | UF credits | Not suitable for serving other students; see below |

**Oracle Always Free limits** (read 2026-11-14 at Oracle's Always Free Resources page): the Arm A1
allowance is **2 OCPUs and 12 GB of memory in total**, 200 GB of storage, and "idle Always Free
compute instances may be reclaimed" (7-day 95th-percentile CPU, network and, for A1, memory all
under 20%). *An earlier note in this project assumed 4 OCPUs and 24 GB; that was wrong for the
current page.* Consequences: Klierly's web app, worker and database already use part of 12 GB, so a
very large model (the roughly 120-billion-parameter open models) cannot run there and probably not on an ordinary
laptop either; a small quantised model (a few billion parameters) can, but slowly on 2 Arm cores,
and its output will fail Klierly's JSON, citation and arithmetic checks more often. Treat a
self-hosted small model as a free fallback, not as the main experience. If a bigger model is wanted,
run it somewhere with a GPU and point `MANAGED_AI_BASE_URL` at it.

## Google AI Studio (Gemini API)

Read on 2026-11-14 at Google's AI Studio documentation. It exposes an OpenAI-compatible endpoint, so it
works with Klierly's generic connection: base URL `https://generativelanguage.googleapis.com/v1beta/openai/`,
`Authorization: Bearer <Gemini API key>`, a model name copied from AI Studio (the model list changes, so
none is hard-coded). Google calls the OpenAI compatibility "still in beta"; its page does not say whether
`response_format` JSON mode is supported, and Klierly retries without it when a server rejects it.

**The free versus paid difference is the important part.** Per Google's terms: on the **unpaid** tier, Google
uses submitted content to improve its products and machine-learning technologies, human reviewers may read
it (disconnected from your account), and developers are told "Do not submit sensitive, confidential, or
personal information". On the **paid** tier Google does not use prompts or responses to improve its
products (it logs them for a limited time to detect abuse). The terms also require API developers to be
18 or over, describe the service as for professional or business purposes, and say that API clients made
available to users in the EEA may use only paid services. Limits apply per Google project, can change, and
are shown in AI Studio.

What that means for Klierly:

- **Your own key, for your own study:** works as the Google preset under Settings. On the free tier your
  course excerpts go to a service that may train on them and have people read them, which also conflicts
  with Klierly's promise not to train on student content. That is your decision to make; the Settings page
  says so next to the preset.
- **As the managed provider for other students:** use a **paid** Google project with billing and a budget
  cap, never the free tier. Set `MANAGED_AI_BASE_URL` to the address above, `MANAGED_AI_MODEL` to a
  low-cost model from AI Studio, and your own per-student quotas and dollar budget stop in `.env.example`.
  Check Google's current pricing yourself; this page does not quote any.

## UF NaviGator Toolkit

Read on 2026-11-14 at the NaviGator intro and quickstart pages. UF's quickstart shows
`POST https://api.ai.it.ufl.edu/v1/chat/completions` with `Authorization: Bearer <key>` and a
`model` plus `messages` body, and says OpenAI-compatible SDKs work — so Klierly's generic provider
connection fits. Keys are created by a signed-in UF user at <https://api.ai.it.ufl.edu/ui>, are
personal, are limited to the models chosen at creation (UF-hosted local models for personal keys,
for example `llama-3.1-8b-instruct` in the quickstart), and are shown once. UF's intro states that
every UF student, faculty and staff member receives a $100 monthly credit for personal keys, that
cloud-hosted models need team approval and billing, and that restricted or sensitive data is not
permitted with cloud models.

What the pages do **not** say: whether a personal key may be used with a third-party or commercial
application, or whether personal credits may serve other people. So:

- **For your own study**: enter your own key under Settings → AI connection → UF NaviGator (the preset
  fills the address and an example model). It is stored encrypted and never leaves the server.
- **Not as the managed provider** for other students, and not in a public or commercial deployment,
  unless UF confirms in writing that this is allowed.
- Never paste a key into chat, issues, commits or documents. UF's own guidance is to treat it like a password.
