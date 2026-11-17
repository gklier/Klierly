# Internal contracts

These are the explicit interfaces between the three parts of Klierly:
`web/` (Next.js app, owns the database), `worker/` (Python FastAPI: file
parsing + numerical validation, stateless, no database access) and
`extension/` (MV3 browser extension).

## 1. Worker HTTP API (`worker/`, default `http://127.0.0.1:8001`)

Stateless. Never persists or logs document contents. Every route except
`GET /health` requires the header `X-Worker-Token: <WORKER_TOKEN env>`
(401 otherwise). Errors are always
`{"detail": {"code": "<machine_code>", "message": "<plain language>"}}`.

### `GET /health`
`200 {"status":"ok","version":"<semver>","parsers":["pdf","docx",...]}`

### `POST /parse` (multipart/form-data)
Fields: `file` (required), `filename` (optional override).
The type is decided from the extension **and** verified against content
sniffing (magic bytes / zip members); a mismatch is `415 type_mismatch`.

Supported: `.pdf .docx .pptx .txt .md .markdown .html .htm .csv .xlsx .srt .vtt`

`200`:
```json
{
  "parser": "pdf",
  "confidence": 0.93,
  "warnings": ["Page 4 has no extractable text (possibly a scanned image)."],
  "title": "Module 2 – Multiple Regression",
  "segments": [
    {
      "kind": "text",
      "text": "plain text, paragraphs separated by \n\n",
      "heading": "nearest heading or slide title, or null",
      "page": 1,
      "slide": null,
      "t_start_ms": null,
      "t_end_ms": null
    }
  ]
}
```
Rules:
- `kind` is `"text"` or `"table"`. Tables are normalized to pipe-delimited
  rows (`a | b | c`, one row per line, header row first).
- PDF: one or more segments per page, `page` is 1-based. `confidence` is
  the share of pages with meaningful extractable text, reduced when the text
  looks garbled. Scanned/empty pages produce a warning, not fake text. No OCR.
- PPTX: one segment per slide (`slide` 1-based, `heading` = slide title);
  speaker notes become a separate segment with heading `"<title> (speaker notes)"`.
- DOCX / Markdown / HTML / TXT: split on headings; `heading` is the nearest
  heading. HTML is reduced to visible text; script/style/nav/form content and
  hidden elements are dropped. No HTML is returned.
- CSV / XLSX: `kind: "table"`; up to 200 rows per segment, header repeated in
  each segment; XLSX uses `heading` = sheet name. A leading text segment
  summarizes column names and row count.
- SRT / VTT: cues merged into segments of roughly 45 seconds with
  `t_start_ms` / `t_end_ms`.
- Text is NFC-normalized, control characters removed, runs of blank lines
  collapsed. Empty segments are dropped.

Errors: `413 too_large` (over `MAX_UPLOAD_MB`, default 25),
`415 unsupported_type`, `415 type_mismatch`, `422 encrypted`,
`422 empty_document` (nothing extractable), `422 parse_failed`.

### `POST /parse-text` (JSON)
`{"text": "...", "format": "plain" | "markdown" | "html", "title": "optional"}`
→ same response shape as `/parse` (`parser` = `"paste-plain"` etc.).
Used for pasted text and browser-extension captures.

### `GET /numeric/functions`
`200 {"functions":[{"name":"t_statistic","description":"...","args":{"estimate":"number", ...},"returns":"..."}]}`

### `POST /numeric/compute` (JSON)
`{"fn": "<name>", "args": {...}}` → `200 {"value": <finite float>, "detail": {...}}`

Errors: `400 unknown_function`, `400 invalid_args` (missing/extra/wrong
type/out of domain), `400 non_finite_result`.

Functions (names are part of the contract; unknown args are rejected):

| fn | args | value |
|---|---|---|
| `expression` | `expr` (string: numbers, `+ - * / ** ( )`, names from `vars`, functions `sqrt exp ln log10 abs min max round`), `vars` (object name→number, optional) | evaluated safely via AST whitelist, never `eval` |
| `regression_predict` | `intercept`, `coefficients` [n], `values` [n] | intercept + Σ bᵢxᵢ |
| `t_statistic` | `estimate`, `std_error`, `hypothesized` (default 0) | (est − h0)/se |
| `p_value_t` | `t`, `df`, `tails` (1 or 2, default 2) | p-value from Student t |
| `p_value_f` | `f`, `df1`, `df2` | upper-tail F p-value |
| `p_value_z` | `z`, `tails` (default 2) | normal p-value |
| `t_critical` | `df`, `confidence` (default 0.95) | two-sided critical t |
| `confidence_interval_t` | `estimate`, `std_error`, `df`, `confidence` (default 0.95), `bound` (`lower` \| `upper` \| `margin`) | requested bound; detail has all three |
| `r_squared` | `sse`, `sst` | 1 − SSE/SST |
| `adjusted_r_squared` | `r2`, `n`, `k` | 1 − (1−R²)(n−1)/(n−k−1) |
| `f_statistic` | `r2`, `n`, `k` | (R²/k)/((1−R²)/(n−k−1)) |
| `rmse` | `sse`, `n`, `k` | sqrt(SSE/(n−k−1)) |
| `aic_ols` | `sse`, `n`, `k` | n·ln(SSE/n) + 2(k+1) |
| `bic_ols` | `sse`, `n`, `k` | n·ln(SSE/n) + (k+1)·ln(n) |
| `mean` | `values` | arithmetic mean |
| `sample_std_dev` | `values` | n−1 standard deviation |
| `correlation` | `x`, `y` | Pearson r |
| `simple_regression` | `x`, `y`, `output` (`slope` \| `intercept` \| `r2`) | least squares |
| `mad` | `actual`, `forecast` | mean absolute deviation of errors |
| `mse` | `actual`, `forecast` | mean squared error |
| `mape` | `actual`, `forecast` | mean absolute percentage error, in percent |
| `moving_average_forecast` | `series`, `window` | mean of last `window` values |
| `exponential_smoothing_forecast` | `series`, `alpha`, `initial` (optional, default first value) | next-period forecast, F₁ = initial, Fₜ₊₁ = αYₜ + (1−α)Fₜ |
| `linear_trend_forecast` | `intercept`, `slope`, `t` | intercept + slope·t |
| `seasonal_forecast` | `trend_value`, `seasonal_index`, `model` (`multiplicative` \| `additive`) | trend × index or trend + index |

### `POST /numeric/ols` (JSON)
`{"columns": {"name": [numbers...]}, "y": "name", "x": ["name", ...]}` →
`{"n":..,"k":..,"r2":..,"adj_r2":..,"rmse":..,"f":..,"f_p":..,"sse":..,"sst":..,
"terms":[{"name":"Intercept","estimate":..,"std_error":..,"t":..,"p":..}, ...]}`
Implemented with numpy/scipy; tests compare against statsmodels.

## 2. Extension ↔ web API (`/api/ext/*`)

Auth: `Authorization: Bearer <pairing token>`. The token is created by the
signed-in user in **Settings → Browser extension**, shown once, stored hashed
on the server, revocable, and only valid for `/api/ext/*`. The extension
stores it in `chrome.storage.local`. It is never the user's password, session
cookie or an LMS credential.

CORS: the web app answers `OPTIONS` preflights and allows origins matching
`chrome-extension://*` / `moz-extension://*` with headers
`Authorization, Content-Type`. Because of this the extension needs **no host
permission** for the app.

Errors: `{"error": {"code": "...", "message": "..."}}`.

### `GET /api/ext/courses`
`200 {"user":{"email":"..."},"courses":[{"id":"uuid","name":"...","modules":[{"id":"uuid","name":"..."}]}]}`
`401 invalid_token`.

### `POST /api/ext/import`
```json
{
  "courseId": "uuid",
  "moduleId": "uuid or null",
  "title": "page title (editable in preview)",
  "url": "https://… page URL (stored as source link)",
  "text": "captured visible text, plain",
  "selectionOnly": false,
  "permissionConfirmed": true,
  "signals": {"assessmentSuspected": false, "reasons": []}
}
```
`201 {"documentId":"uuid","jobId":"uuid","viewUrl":"http://…/courses/<id>/materials/<docId>"}`

Errors: `400 permission_required` (declaration missing),
`400 empty_capture`, `413 too_large` (text over 400 000 chars),
`422 assessment_blocked` (server-side re-check of URL/title/text looks like an
active graded assessment), `404 course_not_found`, `401 invalid_token`,
`429 rate_limited`.

The import goes through exactly the same ingestion pipeline as file upload
and paste (ImportJob → worker `/parse-text` → chunking → index).

### `POST /api/ext/class`
```json
{ "lms": "canvas", "host": "ufl.instructure.com", "externalCourseId": "123456",
  "label": "page title, reduced to the course name", "courseId": "uuid or null", "termsAccepted": true }
```
`200 {"classId":"uuid","label":"…","sharingEnabled":true,"linked":true}`. Records that this student says they are
in the class (it cannot be verified) and links their Klierly course when `courseId` is given and theirs.
Errors: `400 bad_class`, `400 terms_required`, `404 course_not_found`, `401 invalid_token`, `429 rate_limited`.
