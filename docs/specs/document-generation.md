# Document Generation — client-side DOCX / PDF / XLSX

- **Version:** 0.5
- **Status:** Phases 0–3 implemented ("Download as…", model-created `<cog-doc>` documents with
  revision round-trips, XLSX, and save-to-library — §5.4 note on the xlsx library-save gap);
  Phases 4–5 designed, not built. Decisions 4–11 settled (§18). Developer map:
  `frontend/src/app/documents/README.md`.
- **Stack:** Angular frontend (Web Worker rendering pipeline), Go backend (Phase 4 tool loop only)
- **Scope:** Letting the model produce downloadable documents (DOCX, PDF, XLSX; PPTX deferred)
  inside encrypted conversations, with all file bytes produced, encrypted and delivered
  **client-side**. Includes the design groundwork for a browser-side agentic tool loop (Phase 4).
- **Related specs:** `attachments.md` (client-encrypted artifact pipeline, worker precedent),
  `image-generation.md` (generated-artifact persistence precedent), `web-search.md` (Responses
  API migration, provider-native tools), `tool-aware-model-selection.md` (composer tools ↔
  capability contexts), `pii-redaction.md` (hydration before render),
  `../security-model.md` (in-flight plaintext boundary)
- **Related code:**
    - `frontend/src/app/services/export.service.ts` — existing decrypt-in-browser → zip →
    object-URL download path (the delivery template)
    - `frontend/src/app/attachments/` — worker pipeline, lazy processor imports, library upload
    - `frontend/src/app/services/message.service.ts` — stream assembly, redaction hydration
    - `frontend/src/app/services/composer-tools.service.ts` — composer tool toggles
    - `frontend/src/app/utils/model-discovery.ts` — capability predicates / quick filters
    - `backend/internal/handler/complete.go`, `backend/internal/gateway/bifrost_client.go` —
    completion pipeline + Responses API gateway (Phase 4 touches only)
    - `frontend/src/_headers` — CSP (`script-src 'self' 'wasm-unsafe-eval'`, Trusted Types,
    no `worker-src` → same-origin workers only)

## 1. Overview & goals

Competitors produce downloadable Office documents by running model-written Python in
**server-side sandboxes** (ChatGPT Advanced Data Analysis / agent; Claude "Create files" runs a
full Ubuntu container per request). Cognos cannot copy that: a server-side sandbox would hold
decrypted conversation content in a long-lived plaintext filesystem — exactly what our model
promises never exists.

The privacy constraint turns out not to be a handicap. Two research findings shape this spec:

1. **The browser can do this well.** Anthropic's own document skills generate DOCX with
   `docx` (npm) and PPTX with `pptxgenjs` — browser-capable MIT JavaScript libraries — even
   though they run them server-side. Mature JS/WASM libraries cover every target format.
2. **The document can be a _view_ of the message, not a stored artifact.** The model's output
   is already text we encrypt and persist. If the model emits a structured **document source**
   (markdown body + small options header) inside its reply, the client can render the actual
   file bytes deterministically, on demand, in a Web Worker. The file bytes then never exist
   anywhere but the user's device — not even transiently on Cognos servers. That is a stronger
   property than image generation (where plaintext bytes transit the backend before sealing),
   and it needs **zero new server surface, zero new storage, zero new data model** for v1.

No mainstream competitor can generate documents client-side, and no open-source chat UI does it
well (Open WebUI's jsPDF export is chronically broken; LibreChat has it as an open feature
request). This is a differentiated, marketable capability that is _only_ natural in our
architecture.

### Goals

- Users can ask the model for a document and download a real, well-formed `.docx` / `.pdf` /
  `.xlsx` that opens cleanly in Word, LibreOffice, Pages and Google Docs.
- All file bytes are produced in the browser from the (already encrypted-at-rest) message
  content. No document bytes on Cognos servers, plaintext or otherwise, unless the user
  explicitly saves to their encrypted library.
- Any existing assistant message can be exported as DOCX/PDF/Markdown with one action — no
  model involvement, works retroactively on all history.
- Documents re-render from encrypted history on reload, follow branching/regeneration
  naturally, and expire with their message.
- Quality bar: named styles, headers/footers, page numbers, tables, embedded conversation
  images in DOCX/PDF; formulas and number formats in XLSX.
- Lay the architectural groundwork for a **browser-side agentic tool loop** (client-executed
  function tools over the Responses API) with document tools as its first passenger — designed
  here, shipped as a later phase.

### Non-goals (v1)

- **No model-written code execution.** V1/V2 render a declarative document source through a
  deterministic renderer. A sandboxed interpreter is Phase 5, gated on the requirements in §10.
- **No PPTX.** Industry-wide the weakest format (layout collisions even for ChatGPT agent);
  `pptxgenjs` makes it feasible later, but scope stays modest now.
- **No editing of user-uploaded documents** (fill-in templates, tracked changes). Creation only.
- **No native XLSX charts** — no open-source JS library writes them (SheetJS Pro only);
  fallback is chart-as-embedded-PNG, deferred.
- **No server-side rendering fallback.** If a browser can't render (ancient device), the raw
  markdown is still there; we never round-trip document bytes through the backend.
- **No collaborative/live document editing** (Canvas-style). The chat turn is the edit loop.

## 2. Landscape (research summary, 2026-07)

### 2.1 Competitors

| Product | Mechanism                                                                                                                                        | Notes                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| ChatGPT | Server-side Python sandbox (python-docx, openpyxl, reportlab); agent VM for xlsx/pptx                                                            | OpenAI itself called agent output "rudimentary in formatting"; Canvas/Deep Research export PDF/docx |
| Claude  | Server-side Ubuntu container per request; **Agent Skills** pin `docx` (npm) for DOCX, `pptxgenjs` for PPTX, openpyxl for XLSX, reportlab for PDF | Skills add guardrail prompts + output validation (XSD, LibreOffice recalc, visual render QA)        |
| Gemini  | No file generation — writes into Workspace-native Docs/Sheets/Slides                                                                             | Not a template for us                                                                               |

The Claude skills repo is the strongest library-choice signal available: for greenfield
_creation_ Anthropic picked the browser-capable JS libraries over the Python classics.

### 2.2 Client-side libraries (verified on npm, 2026-07-04)

| Format   | Pick                                                                                                                                                                                                                                                                                                                 | Why                                                                                                                                                                         | Watch out                                                                                                                                                                                                                                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOCX     | **`docx`** 9.x (MIT, ~113 KB gz, active, 14.7M weekly DL)                                                                                                                                                                                                                                                            | Real OOXML: named styles, first/even-page headers/footers, table merges, images incl. SVG, numbering, footnotes, TOC; `Packer.toBlob` is browser-first; Anthropic-validated | TOC is a Word _field_ — Word prompts "update fields" on open (page numbers aren't computed client-side). Set page size explicitly (defaults A4).                                                                                                                                                                        |
| PDF      | **`pdfmake`** 0.3.x (MIT, active; ~342 KB gz + ~850 KB font VFS)                                                                                                                                                                                                                                                     | Declarative JSON docDefinition: headers/footers with page numbers, TOC, tables, columns, page breaks — an ideal deterministic render target                                 | Ships Roboto by default; embed our brand fonts in the VFS. `typst.ts` (~10 MB lazy WASM) is the premium-typography upgrade, deferred.                                                                                                                                                                                   |
| XLSX     | **`write-excel-file`** 4.x (MIT, actively maintained, write-only, lighter)                                                                                                                                                                                                                                           | Schema-based writer: typed cells, formula strings, number formats, column widths, sticky (frozen) header rows — covers the §6.3 sheet spec                                  | Feature ceiling: no data validation, weaker conditional formatting than `exceljs` (unmaintained since Oct 2023 — the pre-scoped swap behind the facade if that ceiling ever binds). **Avoid SheetJS** (npm package frozen with known vulns; styling/charts are closed-source Pro). No OSS library writes native charts. |
| PPTX     | **`pptxgenjs`** 4.x (MIT, ~123 KB gz, zero deps) — deferred                                                                                                                                                                                                                                                          | Native _editable_ PowerPoint charts, slide masters                                                                                                                          | Generation-only; absolute positioning; quality risk is layout, not the library                                                                                                                                                                                                                                          |
| Rejected | `jsPDF` (imperative, weak fonts — source of Open WebUI's broken exports), `pdf-lib` (stalled since 2021; drawing API not a typesetter), `html-docx-js` (dead; emits an MHT altChunk only desktop Word renders), `docxtemplater` (images/tables are paid modules), Paged.js (print-dialog only, no programmatic Blob) |                                                                                                                                                                             |                                                                                                                                                                                                                                                                                                                         |

Total added payload for DOCX+PDF+XLSX ≈ **600 KB–1.5 MB gzipped, all MIT**, every byte
lazy-loaded per format inside a worker (initial bundle unchanged — the 5 MB `angular.json`
error budget is untouched).

**Pyodide** (Python-in-WASM, ~12 MB, 4–5 s cold start) was evaluated and rejected for this
feature: it only pays off as a general in-browser code interpreter (a possible Phase-5 vehicle),
not for document export that 100–250 KB JS libraries handle.

### 2.3 Sandboxing model-written code (why v1 avoids it)

If the model _writes code_ that touches decrypted conversation content, the code is
attacker-influenceable (prompt injection via web search results or attachments — the "lethal
trifecta"). Findings that shape Phase 5, recorded now:

- A sandboxed iframe **without** `allow-same-origin` still has full network access — opaque
  origin blocks storage/DOM, not `fetch`.
- **CSP alone is insufficient**: Claude Artifacts was exploited via WebRTC/TURN signalling
  (which CSP does not govern), exfiltrating data in TURN usernames despite HTTP egress blocks.
- A Web Worker with a patched `fetch` is not a security boundary. ShadowRealm remains unshipped
  (TC39 Stage 2.7). StackBlitz WebContainers require a commercial licence.
- The defensible design is a **WASM interpreter with zero host network bindings** —
  `quickjs-emscripten` (MIT, active) where the guest VM has no fetch/XHR/WebSocket/DOM unless
  explicitly injected. Egress is _architecturally absent_, not filtered. Only whitelisted host
  functions (`addParagraph`, `addSheet`, `emitFile`, …) are exposed.

V1 sidesteps all of this: a declarative source rendered by our own deterministic code executes
nothing the model wrote.

## 3. Principles

1. **The document is a render, not an upload.** File bytes are derived on demand from the
   encrypted message source. Nothing new is stored; nothing new transits the server. Save-to-
   library is an explicit user action through the existing encrypted attachments pipeline.
2. **Deterministic renderer, declarative source.** The model emits data; Cognos code turns it
   into bytes. The entire "model produced a corrupt file" failure class is eliminated by
   construction, and there is no code execution surface.
3. **Same trust boundary as messages.** The document _source_ is assistant message content:
   plaintext in flight (like every token today), sealed at rest, never logged. The document
   _bytes_ never exist server-side at all.
4. **Renderer performs zero network I/O.** Fonts and libraries are bundled assets; images come
   only from already-decrypted conversation attachments. A generated file must never trigger a
   fetch to a model-chosen URL (exfiltration vector).
5. **Fail open to text.** A malformed or truncated document block degrades to visible markdown
   — the user always gets the content, never a broken card or a crash.
6. **Works on every text model.** V1 uses plain structured emission (no tool-calling
   capability required), so Infomaniak/CH-tier users are not excluded. The Phase-4 tool loop is
   an enhancement gated on `supports_tool_calling`, not a prerequisite.

## 4. How it works (V1/V2 — no tool loop)

```mermaid
sequenceDiagram
    participant U as User
    participant C as Client (browser)
    participant B as Backend
    participant P as Provider (via Requesty)

    U->>C: "Turn this into a one-page PDF brief"
    C->>B: POST /complete (document tool on → system instructions include cog-doc contract)
    B->>P: Responses API request (no new tools; plain completion)
    P-->>B: text deltas containing a <cog-doc> block
    B-->>C: SSE deltas (backend is a pass-through; sees only text, as today)
    C->>C: stream parser detects block → shows "Creating document…" card
    B->>B: seal assistant MessageData (content incl. raw block) to conversation key
    C->>C: hydrate redaction tokens → render worker (lazy docx/pdfmake/exceljs) → Blob
    U->>C: Download → object-URL save (ExportService pattern). Bytes never left the browser.
```

Key properties:

- The backend is byte-for-byte the existing completion pipeline. It neither knows nor cares
  that the reply contains a document block. **V1/V2 ship with no backend changes.**
- On reload, the client decrypts the message, re-parses the block, re-renders on demand.
  Branch switches, regeneration, message expiry and conversation copy all inherit correct
  behaviour for free because the document is just message content.
- Iteration = conversation: "make the tone more formal" produces a new assistant message with
  a full replacement block (Claude-Artifacts-style), rendered as a new version.

## 5. Features

### 5.1 Export any assistant message (P0 — Phase 1)

As a user, I can download any assistant message — including all my existing history — as
DOCX, PDF or Markdown from the message actions menu.

Acceptance criteria:

- Message actions gain "Download as…" → DOCX / PDF / Markdown.
- Rendering input is the **hydrated** message markdown (redaction placeholders resolved
  client-side, exactly like display — `RedactedMarkdownComponent` precedent) so the file
  contains real values, since it stays on the user's device.
- Markdown → document mapping covers headings, paragraphs, bold/italic/code, lists (nested),
  tables, blockquotes, links, horizontal rules, and images already present in the message
  (generated images decrypt → embed).
- The file downloads via object URL (`ExportService.deliver` pattern); no network request
  carries plaintext.
- Filename derives from the conversation title or first heading, sanitised (no path
  separators/control chars), with correct extension.
- Works offline-after-load: libraries are same-origin assets, no CDN.

### 5.2 Model-created documents (P0 — Phase 2)

As a user, I can ask for "a PDF brief" / "a Word report" / "a spreadsheet of X" and get a
document card in the reply with a live preview of the content and a download button.

Acceptance criteria:

- A composer Tools row **"Create documents"** — **on by default** so models can do this
  unprompted; the row is an explicit per-conversation opt-out (mirroring web search mechanics
  in `ComposerToolsService`). When on, the system prompt gains the `<cog-doc>` output contract
  (§6) and a short instruction to use it only when the user asks for a document/file.
- When the toggle is **off**, the contract is simply absent and the reply is plain text. We do
  **not** surface a "turn on document creation" hint when the user asks for a file with the
  tool off — no detection heuristics in v1 (Decision 9).
- No `RequiredCapability` change and no model auto-switch: every text model can emit the
  block; quality varies by model, correctness of the file does not (Principle 2).
- The stream parser recognises an opening `<cog-doc …>` sentinel mid-stream and swaps the
  in-progress block for a **document card** (title, format icon, "Creating document…"
  progress) instead of raw text. Body content streams into a collapsed preview.
- On stream completion the client validates the block; valid → card shows Download (and
  Preview for PDF via existing `pdfjs-dist`); invalid/truncated → card is replaced by the raw
  markdown body with a translated "couldn't build the file" note (fail open, §3.5).
- DOCX and PDF ship in this phase; the raw block persists inside the encrypted message and
  re-renders after reload/branch switch.
- Backend request/response contract: **unchanged**.

### 5.3 XLSX (P1 — Phase 3)

As a user, I can get a real spreadsheet: typed cells, formulas, number formats, multiple
sheets, frozen header rows.

Acceptance criteria:

- `<cog-doc format="xlsx">` carries a JSON sheet spec (§6.3): sheets → rows → typed cells
  (`string | number | boolean | date | formula`), column widths, number formats (`#,##0.00`,
  `dd.mm.yyyy`, `%`), bold header row, freeze panes.
- Formulas are written as formula strings (recalculated by Excel/LibreOffice on open). A
  **hand-rolled reference validator** (not a full evaluator) checks that A1/range references
  point inside the emitted sheets and flags `#REF!`-class errors back into the card as a
  warning. `hyperformula` is **excluded — GPLv3** (Decision 11); full LibreOffice-recalc
  validation is impossible in a browser (the one competitor safety net we can't copy). Full
  subset _evaluation_ is deferred until real usage shows reference-checking isn't enough.
- Cell/row caps enforced at parse time (see §6.4) — the source must fit the existing 1 MB
  `messages.data` column with sealing overhead, minus the rest of the reply.

### 5.4 Save to library (P1 — Phase 3)

As a user, I can keep a generated document in my encrypted file library and reuse it in other
chats.

Acceptance criteria:

- Document card action "Save to library" runs the rendered bytes through the **existing**
  attachment worker pipeline (encrypt with per-artifact secretbox key, manifest sealed to the
  vault key, `POST /api/v1/attachments`) — the server sees only ciphertext, same as any
  upload. This _freezes_ bytes at the current renderer version (unlike live re-render).
- The saved file appears in `/account/library` with the generated filename; dedup by content
  hash applies as for uploads.
- No automatic saving. Downloads and saves are explicit user actions.

**Known gap (xlsx):** the attachment worker pipeline routes every save through the same processor
registry as a user upload (`frontend/src/app/attachments/processors/processor-registry.ts`), which
has **no XLSX processor** — spreadsheet text extraction was removed for launch (see the
"Spreadsheets are no longer accepted" pin test in `processor-registry.spec.ts`). A generated `.xlsx`
document therefore always fails closed with the translated `documentSaveFailed` message; docx and
pdf save successfully (mammoth/pdfjs extract text from the renderer's own valid output without
issue). Fixing this means either resurrecting XLSX text extraction (reverses a deliberate launch
decision) or adding a save path that bypasses text extraction for library saves — both are follow-up
decisions, not bundled into this change.

### 5.5 Browser tool loop — the agentic harness (P2 — Phase 4)

As a user on a tool-capable model, document creation becomes an explicit tool the model can
invoke (and correct) rather than an output format — and Cognos gains its first client-executed
tool loop, reusable for future tools (attachment reading, chart rendering, …).

This is the deliberate architectural step the product is leaning toward; §9 designs it. It
ships only after V2 proves the renderer, because the renderer is identical in both worlds —
the loop changes _who drives it_, not _what executes_.

## 6. Document source contract (`<cog-doc>`)

### 6.1 Shape

Tag-delimited (not fence-delimited: document bodies legitimately contain fenced code blocks,
and models are unreliable with 4-backtick outer fences). One block per document; a reply may
contain prose around it.

```text
<cog-doc spec='{"v":1,"format":"docx","title":"Quarterly Report","filename":"quarterly-report","page":{"size":"A4","orientation":"portrait"},"header":"Quarterly Report","footer":{"pageNumbers":true}}'>
# Executive summary
Body is GitHub-flavoured markdown…
</cog-doc>
```

- `spec` is a single-line strict-JSON attribute; unknown keys ignored (forward compat);
  missing/garbled `spec` → fail open.
- `format`: `docx | pdf | xlsx` (v1 set). `title`, `filename` (sanitised), `page`, `header`,
  `footer`, `lang` optional with sensible defaults.
- Body for `docx`/`pdf`: markdown (same subset as §5.1). Body for `xlsx`: JSON (§6.3).

### 6.2 Streaming rules

- The parser activates only on a complete opening tag at the start of a line; a truncated
  stream (stop, `max_output_tokens`) leaves an unclosed block → fail open on finalisation.
- Raw block text is what persists in `MessageData.content` — single source of truth; display
  and render layers both parse from it. No new `MessageData` fields.

### 6.3 XLSX body (JSON)

```json
{
  "sheets": [
    {
      "name": "Revenue",
      "freezeHeader": true,
      "columns": [{ "width": 18 }, { "width": 12, "numFmt": "#,##0.00" }],
      "rows": [
        ["Month", "Revenue CHF"],
        ["January", 42000],
        ["Total", { "f": "SUM(B2:B2)" }]
      ]
    }
  ]
}
```

Cells: scalar, `{ "f": "…" }` formula, or `{ "v": …, "numFmt": "…", "bold": true }`.

### 6.4 Caps (parse-time, translated errors)

- Source block ≤ 256 KB; XLSX ≤ 50 sheets, ≤ 10 000 rows and ≤ 100 000 cells total; formula
  strings ≤ 1 KB. (Token economics bind long before these do; the caps make failure modes
  deliberate.)
- Links in bodies sanitised to `http(s)` only; images referenced only by conversation
  attachment id, never URL (Principle 4).

## 7. Rendering pipeline (frontend)

- New **document render worker** (`frontend/src/app/documents/workers/…`, scaffolded via
  `pnpm ng generate web-worker`), following the attachment worker exactly: framework-free
  modules, lazy `await import('docx' | 'pdfmake' | 'write-excel-file')` per format so nothing
  enters the initial bundle. Same-origin worker via `new URL(…, import.meta.url)` — allowed by
  the current CSP (no `worker-src`; `blob:` workers would be blocked, we don't use them).
- **Every third-party generator sits behind a Cognos-owned facade** (one interface per format:
  `DocxRenderer`, `PdfRenderer`, `SheetRenderer`). The parsed document source is the facade's
  input; library types never leak past it. This is what makes a pinned or unmaintained
  dependency a swappable implementation detail (e.g. `write-excel-file` → `exceljs`, `pdfmake`
  → `typst.ts`) instead of a rewrite, and it is where caps, link sanitisation and metadata
  hygiene (§6.4, below) are enforced — once, regardless of library.
- Pipeline: parse block → validate spec (zod) → map markdown AST / sheet JSON to library
  calls → `Blob` → transfer to main thread → object URL (revoked after download).
- **Renderer metadata hygiene:** generated files carry no user-identifying metadata — core
  properties set to the document title only; creator/producer strings are a fixed
  `"Cognos"`; timestamps rounded to the day (a `.docx` is a zip of XML; its metadata is
  read by anyone the user sends it to).
- Brand fonts embedded in the pdfmake VFS from `packages/ui` typography; DOCX uses named
  styles mapped to `--cog-*` type scale equivalents so output looks like Cognos, not Times.
- If `typst.ts` (WASM) is adopted later for premium PDF, instantiate via the existing
  integrity-verified pattern (`vault.service.ts` `instantiateVerifiedWasm`, SHA-384 pinned) —
  `wasm-unsafe-eval` is already in the CSP.
- Trusted Types: none of the chosen libraries touch the DOM; the preview path reuses the
  existing markdown renderer and `pdfjs-dist` viewer, both already TT-compliant.

## 8. Data model

**None for Phases 1–3.** The document source lives in `MessageData.content` (sealed as
today); rendering is a pure client function of it. Save-to-library reuses `user_attachments`
unchanged. This is the load-bearing simplification of the whole design — treat any proposal
to add collections/columns as a red flag in review.

Phase 4 adds transient wire shapes only (§9.3); still no new storage.

## 9. Phase 4 — the browser agentic tool loop (design)

### 9.1 What it is

The Responses API supports **client-executed function tools**: the model returns
`function_call` items; the caller executes and submits `function_call_output`; the model
continues. Today Cognos has _no_ tool-execution loop anywhere (web search is provider-native
and invisible to us). This phase builds the first one, with the browser as the executor —
tools run against **decrypted data on the user's device**, which is the only place our model
allows them to run.

Document tools are the first registrants:

- `create_document(spec, body)` → renders via §7, returns `{ok, warnings[], pageCount|cellCount}`
- `update_document(docId, patch)` → targeted edits without re-emitting the whole body
- (future, same harness: `read_attachment`, `render_chart`, `search_conversation`, …)

The decisive privacy property: **tool _results_ sent back to the model are compact status
JSON, never file bytes.** The model already authored the content; the backend transiently
sees only what it already sees today (message-shaped text). Bytes stay in the browser.

### 9.2 Loop mechanics

```text
client → POST /complete { …, client_tools: [toolDefs] }
backend → provider: Responses request with function tools (strict schemas)
provider → backend → client: SSE `tool_call` event {call_id, name, arguments}
client: executes locally (render worker) — user-visible card shows activity
client → POST /complete/{requestID}/continue { tool_outputs: [{call_id, output}] }
… repeat ≤ N times …
provider: final text → backend persists ONE assistant message (final turn) as today
```

Design rules:

- **Stateless continuation.** The client replays the turn context plus accumulated
  `function_call`/`function_call_output` items each round; we do not depend on provider-side
  `previous_response_id` state (Requesty's documented surface is chat-completions-shaped;
  statefulness through the router is unverified — the Phase-4 spike settles it, §14 Q2).
  Reasoning items must be replayed alongside function calls or reasoning models 400.
- **Hard iteration cap** (default 4) and per-loop token budget; agentic loops re-bill the
  growing context every round (~4× single-shot is the published rule of thumb). Keep tool
  defs + instructions byte-stable for prompt caching; tool outputs are pruned to essentials.
- **Persistence** happens once, on the terminal round — intermediate rounds are transient.
  The user message is persisted on round 1 (existing behaviour); a loop abandoned mid-way
  (tab close) persists the last completed text, mirroring today's detached-context rule.
- **Billing:** each round is a metered completion through the existing gate; the pre-call
  estimate for round N includes accumulated tool traffic. No new `OperationType`; ledger
  gains a `tool_round_count` detail field (counts only, never tool payloads — same rule as
  `search_count`).
- **Server gate:** `client_tools` accepted only when `model.SupportsToolCalling` (flag already
  exists in the catalogue); silently dropped otherwise, like web search. The backend validates
  tool-def shape but never executes anything.
- **Composer/model selection:** the tool-loop variant introduces a real capability context;
  `tool-aware-model-selection.md` context keys extend naturally (`"documents"` only if/when
  the loop becomes required — V2's emission path keeps working on non-tool models forever).

### 9.3 Why not ship the loop first?

Because V2 delivers ~90 % of user value (single-shot generation with deterministic quality)
with zero backend change, and the loop's marginal value — the model reacting to render
warnings, multi-file tasks, targeted edits — depends on a renderer that exists and is proven.
Building the loop first would mean designing the harness against an imaginary tool.

## 10. Phase 5 (deferred, requirements recorded) — sandboxed code execution

Only if declarative rendering provably caps quality (bespoke layouts, data transformation
before tabulation) do we add model-written code, and only under all of:

- `quickjs-emscripten` (or equal) in a worker: guest VM with **no network/DOM/host bindings**
  except an explicitly injected, capability-style document API. Egress structurally absent —
  not an iframe, not CSP filtering (see §2.3 for why those fail).
- Pinned mini-API documented in the tool prompt (Claude-skills-style guardrails), memory/time
  budgets, deterministic seeds.
- Output still leaves only through `emitFile` into the same §7 pipeline (caps, metadata
  hygiene, link sanitisation apply to sandbox output identically).

Pyodide-in-worker (bridge withheld) is the alternative vehicle if Python fluency measurably
beats JS for spreadsheet work; its 12 MB / 4–5 s cost makes it a deliberate later decision.

## 11. Security & privacy

- **At rest:** unchanged. Document source is sealed message content; saved-library copies are
  client-encrypted attachments. No new plaintext columns, no document bytes server-side.
- **In flight:** the document _source_ is assistant output — visible to backend + provider
  transiently exactly like every message today (`security-model.md` §2–§4). The rendered
  _file_ never transits any network in plaintext. Phase 4 tool results are counts/status only.
- **Prompt injection → document content:** injected instructions (via attachments or web
  search results) could make the model emit a document containing attacker-chosen text or
  links. Mitigations: renderer executes nothing; links sanitised to `http(s)`; no remote
  resource fetch at render or open time (no tracking pixels — images are embedded bytes);
  the card previews content before the user downloads. Residual risk (user shares a
  misleading document) is the same as copy-pasting a poisoned reply — documented, not solved.
- **Metadata:** generated files carry no user identity (§7); filenames sanitised; logging
  discipline unchanged — never log document titles, sources, or bodies; counts only
  (`document_count`, format, byte size class).
- **Redaction:** hydration happens client-side immediately before render, so files contain
  real values while the provider only ever saw placeholders — same posture as display.
- `security-model.md` gains a short subsection stating the above (mirror the web-search one).

## 12. Billing

Nothing new for Phases 1–3: document source is ordinary output tokens, already metered; the
render is free client CPU. Phase 4 adds per-round metering as §9.2 — no surcharge, no floor
fee (there is no provider-side tool cost, unlike web search).

## 13. i18n

All six locales (en-GB, de-CH, fr, es-ES, pt-PT, it-CH), European variants, house register.
New keys (non-exhaustive): `chat.composer.tools.documents.title/.description` (plain-language:
"The model can create downloadable files like Word documents, PDFs and spreadsheets. Files are
built on your device."), `chat.messages.document.creating/.download/.preview/.saveToLibrary/`
`.renderFailed/.truncated/.formulaWarning`, `chat.messages.actions.downloadAs` (+ per-format
labels), model-selector strength pill for Phase 4 only. Plural forms where counts appear.

## 14. Open questions

1. **DOCX TOC UX:** accept Word's "update fields" prompt, or omit TOC support in v1 and
   revisit with typst-rendered PDF where TOCs compute properly?
2. **Requesty function-tool passthrough** (Phase 4): the _questions_ — do streamed
   `function_call` argument deltas and `function_call_output` continuation survive the
   Requesty Responses path per provider family; is `previous_response_id` usable through the
   router — are answered empirically by the Phase-4 live spike (same method as web-search
   Phase 0). Decided: the spike is the resolution mechanism; no loop code lands before it.

## 15. Milestones

| Phase | Deliverable                                                                                                                                                     | Status                                                                                                                               |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 0     | Spike: render worker + `docx`/`pdfmake` golden samples; open-in-Word/LibreOffice/Pages/Google-Docs matrix; bundle + CSP + Trusted Types verification            | ✅ folded into Phase 1 (golden bytes verified in e2e; **manual open-in-apps QA still to run**)                                       |
| 1     | "Download as…" (DOCX/PDF/MD) on any assistant message — hydration, image embedding, filename rules, i18n ×6                                                     | ✅ commits `89242715`…`654c1c64` (business process: `../business_processes/document-generation.md`)                                  |
| 2     | `<cog-doc>` contract + stream parser + document card + composer toggle + fail-open paths; mock-AI provider emits blocks; e2e                                    | ✅ commits `225968ce`…`60e24281` incl. revision round-trip contract + module README                                                  |
| 3     | XLSX sheet spec + caps + formula warnings; Save to library                                                                                                      | ✅ commits `e3d64ff3`…`9f4c8f92` (xlsx library-save hidden pending a sheet processor; incl. pre-existing mammoth CJS fix `125f07fe`) |
| 4     | Browser tool loop: Requesty spike → `client_tools`/`tool_call` SSE/`continue` endpoint → `create_document`/`update_document`; billing rounds; capability gating | ☐                                                                                                                                    |
| 5     | (Deferred) sandboxed code execution per §10; PPTX; typst.ts premium PDF                                                                                         | —                                                                                                                                    |

## 16. Testing

- **Vitest tables:** block parser (well-formed / unclosed / garbled spec / nested fences /
  multiple blocks / size-cap breach → fail open every time); spec zod validation; markdown→
  docx AST mapping incl. nested lists + tables + adjacent formatting; sheet-JSON → facade
  calls incl. every cell type and cap (tests target the facade, not the library, so a swap
  keeps them green); filename sanitisation; link sanitisation.
- **Golden-file structure tests:** unzip generated `.docx`/`.xlsx` (via `fflate`, already a
  dep) and assert OOXML structure (styles present, header/footer parts, formula strings);
  parse generated PDF with `pdfjs-dist` (already a dep) and assert page count + extracted
  text. The extraction libraries we already ship become the validators.
- **Browser e2e:** toggle on → mock-AI emits a doc block → card appears while streaming →
  download yields a file that `mammoth`/`pdfjs` can re-extract the expected text from;
  truncated-stream fixture degrades to markdown + notice; reload re-renders from encrypted
  history; export-any-message on a legacy fixture message.
- **API e2e:** Phases 1–3: assert the completion wire contract is byte-identical with the
  toggle on (only the system prompt differs) and nothing document-shaped is persisted outside
  the sealed blob. Phase 4: tool-def gating (non-capable model → dropped), continuation
  round-trip against the mock provider, single terminal persistence, ledger round counts.
- **Security regression:** render worker performs zero network requests (assert via test
  harness fetch spy); generated file metadata contains no email/user id; no document
  title/body strings in logs on failure paths; sealed message blob contains no plaintext
  marker leakage beyond the normal content channel.

## 17. Risks

| Risk                                                                                      | Mitigation                                                                                                                      |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Models emit sloppy/invalid blocks on weaker (Infomaniak) models                           | Contract is tiny + strict JSON spec attr; fail open to markdown; quality varies, file validity doesn't (deterministic renderer) |
| `write-excel-file` feature ceiling binds (data validation, richer conditional formatting) | Facade (§7) makes `exceljs` a pinned drop-in swap, not a rewrite; accepted trade for an actively maintained dependency          |
| Renderer version drift changes bytes of "the same" document                               | Documents are views (like markdown rendering); Save-to-library freezes bytes when permanence matters                            |
| Doc block bloats `messages.data` toward the 1 MB cap                                      | §6.4 caps + parse-time enforcement; XLSX JSON is the only realistic offender                                                    |
| Word's "update fields" prompt (TOC) confuses users                                        | Open question 2; worst case ship without TOC                                                                                    |
| Phase 4 loop cost surprises users                                                         | Iteration cap, budget, prompt caching, pre-call estimate covers accumulated rounds                                              |
| Prompt-injected content lands in a downloadable, shareable file                           | No code execution, link sanitisation, no remote fetches, preview-before-download; residual risk documented in security-model.md |
| Future sandbox phase built on iframe+CSP because it looks easier                          | §2.3/§10 record the Claude Artifacts WebRTC exfil precedent as a hard "no" — WASM-interpreter-only                              |

## 18. Resolved decisions

| #   | Decision             | Resolution                                                                                                                                                                                                                        |
| --- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Where bytes are made | Client-side only; deterministic render worker; no server rendering, no server sandbox                                                                                                                                             |
| 2   | Source of truth      | Document source inside `MessageData.content`; document = on-demand render; no new storage/data model in Phases 1–3                                                                                                                |
| 3   | Model interface v1   | Declarative `<cog-doc>` emission in a plain completion (works on all text models); client tool loop is Phase 4, code execution Phase 5                                                                                            |
| 4   | Libraries            | `docx` + `pdfmake` + `write-excel-file` (lighter, actively maintained — accepted over `exceljs` at the cost of conditional formatting/data validation); `pptxgenjs` deferred; SheetJS/jsPDF/pdf-lib/docxtemplater rejected (§2.2) |
| 5   | Facade rule          | Every third-party generator is wrapped in a Cognos-owned per-format facade (§7); library types never leak past it, so any library is swappable without a rewrite                                                                  |
| 6   | Persistence of files | Explicit Save-to-library via existing attachments pipeline; downloads via object URL; nothing automatic                                                                                                                           |
| 7   | Sandbox stance       | Deferred; when built, WASM interpreter with zero host network bindings — iframe/CSP/Worker-patching explicitly rejected                                                                                                           |
| 8   | Activation UX        | Tool is **on by default** (models may create documents unprompted); the composer Tools row is an explicit per-conversation opt-out — same mechanics as web search                                                                 |
| 9   | No enablement hint   | When the tool is off and the user asks for a file, the reply stays plain text — no "turn on document creation" detection/hint in v1                                                                                               |
| 10  | Requesty passthrough | Function-tool passthrough questions are settled empirically by the Phase-4 live spike (web-search Phase-0 method) before any loop code lands                                                                                      |
| 11  | Licence red line     | **No GPLv3 / copyleft dependencies** — `hyperformula` excluded; where no permissively-licensed alternative exists we exclude the capability or roll our own (e.g. hand-rolled formula reference validator, §5.3)                  |
