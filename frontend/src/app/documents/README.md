# `documents/` — client-side document generation

How Cognos turns assistant messages into real DOCX/PDF/Markdown files
**without any bytes ever touching a server**. Product rationale lives in
the [document-generation process](../../../../docs/business_processes/document-generation.md).
This file is the developer map.

## Architecture in one diagram

```txt
main thread                          │  web worker (document-render.worker.ts)
                                     │
DocumentExportService                │
  ├─ hydrate redaction tokens        │
  ├─ decrypt generated images        │
  └─ DocumentWorkerClient.render() ──┼─▶ markdownToDocIR(markdown)   (marked.lexer)
       ▲ requestId ↔ Promise         │      │ append image blocks
       │ transferable buffers        │      ▼
  saveBlob(bytes, name, mime) ◀──────┼── DocumentRenderer facade
                                     │      ├─ docx-renderer   (lazy import('docx'))
                                     │      ├─ pdf-renderer    (lazy import('pdfmake…'))
                                     │      └─ markdown-renderer (TextEncoder, main thread)
```

Everything below `document-export.service.ts` / `document-worker.client.ts`
is **framework-free** (no Angular imports) — callable from the worker, the
service, and vitest alike.

## The pieces

| File                                | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document.types.ts`                 | The shared contract: `DocIR` (neutral block/inline tree), `DocImage`, `RenderOptions`, `DocumentRenderer`, worker protocol, `DocumentRenderError` taxonomy                                                                                                                                                                                                                                                                                                                                                                                      |
| `markdown/markdown-to-docir.ts`     | The **total** mapper: `marked.lexer` tokens → DocIR. Never throws — hostile/unknown input degrades (HTML stripped, `javascript:` links unwrapped, remote images → alt text, KaTeX/footnotes stay literal)                                                                                                                                                                                                                                                                                                                                       |
| `document-source.ts`                | Pure helpers: `documentFilename` (sanitisation + reserved names + 80-char cap), `sanitizeDocumentHref` (http/https only), `documentMimeType`                                                                                                                                                                                                                                                                                                                                                                                                    |
| `renderers/doc-styles.ts`           | Type scale (Title 26pt → Caption 9pt), A4 + 1" margins, metadata-hygiene constants (`creator: 'Cognos'`, day-rounded dates)                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `renderers/docx-renderer.ts`        | DocIR → OOXML via `docx@9`. Post-processes the packed zip with `fflate` to day-round `docProps/core.xml` timestamps (the library hardcodes `new Date()` with no override)                                                                                                                                                                                                                                                                                                                                                                       |
| `renderers/pdf-renderer.ts`         | DocIR → PDF via `pdfmake@0.3`. Needs **three** dynamic imports (`pdfmake.js`, `vfs_fonts.js`, `standard-fonts/Courier.js`) — Courier backs the Code style                                                                                                                                                                                                                                                                                                                                                                                       |
| `sheets/sheet-spec.types.ts`        | XLSX-only, non-DocIR source type: zod schema for the `<cog-doc format="xlsx">` body JSON (§6.3), sheet-name sanitisation, and `parseSheetSpec` (total — caps + schema errors as machine-readable strings, never throws)                                                                                                                                                                                                                                                                                                                         |
| `sheets/formula-validator.ts`       | Hand-rolled formula checker (`hyperformula` is GPLv3, excluded): a security blocklist (WEBSERVICE/HYPERLINK/EXEC/…/DDE-pipe) that downgrades a hit to literal text, plus an advisory A1/range reference checker. No evaluation, ever                                                                                                                                                                                                                                                                                                            |
| `sheets/sheet-renderer.ts`          | SheetSpec → .xlsx via `write-excel-file/browser` (no root package export — only `/browser`, `/node`, `/universal`, `/utility`). Formulas are real `<f>` OOXML elements (`type: 'Formula'`, verified against the library's own cell-writer) — no fflate zip surgery needed, unlike docx. write-excel-file also emits **no** `docProps/core.xml` or `docProps/app.xml` at all (verified with a real-bytes render), so there is nothing to scrub for metadata hygiene either — a fact worth re-checking if the library is ever upgraded or swapped |
| `workers/document-render.worker.ts` | Thin worker wrapper: lex → DocIR → render → transfer bytes back for docx/pdf; a separate `render-sheet` request parses/validates/renders xlsx and returns `{ bytes, warnings }`                                                                                                                                                                                                                                                                                                                                                                 |
| `document-worker.client.ts`         | Main-thread client: lazy Worker creation, requestId↔Promise correlation, cancel                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `document-export.service.ts`        | The only Angular piece: hydration, image decryption, filename derivation, delivery via `saveBlob`. `renderCogDoc` is the shared render-to-bytes seam behind both `downloadCogDoc` (+ `saveBlob`) and `saveCogDocToLibrary` (+ `AttachmentProcessingService.saveToLibrary`) — the latter never touches the composer's attachment selection                                                                                                                                                                                                       |
| `cog-doc/cog-doc-parser.ts`         | Streaming-aware `<cog-doc>` block detection + message segmentation (fail-open: truncated/invalid blocks degrade to visible markdown)                                                                                                                                                                                                                                                                                                                                                                                                            |
| `cog-doc/cog-doc.types.ts`          | zod spec-header schema (`.strip()` = unknown keys ignored, forward compatible), `CogDocBlock`, `MessageSegment`                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `cog-doc/cog-doc-instruction.ts`    | The byte-stable system-prompt contract injected when the composer "Create documents" tool is on. **Changing one byte busts provider prompt caching** — treat edits as deliberate cache events                                                                                                                                                                                                                                                                                                                                                   |

UI consumers: `components/chat/document-card/` (streaming/ready/invalid
card) and the message toolbar "Download as…" action in
`message-list-item.component.ts`.

## The two flows

1. **Download as…** — any assistant message → hydrated markdown → DocIR →
   renderer. No model involvement.
2. **`<cog-doc>` blocks** — the model emits the document inside its reply
   (contract in `cog-doc-instruction.ts`); `segmentMessageContent` splits
   the message into markdown/document segments per repaint (single-scan
   fast path when no sentinel present); the card renders/downloads from
   the block's spec header + body. The raw block persists inside the
   encrypted message — reload re-parses, so documents are **views of
   Message content rather than separately stored artifacts. If the Account
   holder explicitly chooses **Save to Library**, the rendered bytes are sealed
   and stored as an Account-owned Attachment.

**Round-trip editing** is conversational: the contract requires the model
to re-emit the _complete updated document_ as a new block on any revision
request (pinned in `cog-doc-instruction.spec.ts`). Each message carries its
own card — history is the version trail.

## Adding a format / swapping a library

The renderer facade is the extension seam:

1. New format: add a renderer implementing `DocumentRenderer`
   (`render(doc, images, opts): Promise<Uint8Array>`), register it in the
   worker's format switch, extend `DocFormat` + `documentMimeType` +
   `documentFilename`'s extension map, and (if model-creatable) the zod
   spec schema + instruction. Non-DocIR formats (XLSX) get their own
   source type and renderer — DocIR is for prose documents only.
2. Swapping a library (e.g. `pdfmake` → `typst.ts`): rewrite only the
   renderer file behind the same interface. Vitest specs assert on the
   **facade's captured calls via an injected fake loader**, never the real
   library, so tests describe intent and survive the swap; real-bytes
   validation lives in the Playwright e2e (`frontend/e2e/document-*.spec.ts`).

## Rules that must survive any change

- **Renderers perform zero network I/O.** Fonts/libraries are bundled
  same-origin chunks; images arrive as decrypted bytes. A generated file
  must never trigger a fetch to model-chosen input.
- **No user identity in file metadata** — `Cognos` + day-rounded dates
  only. The docx zip rewrite is load-bearing; don't remove it.
- **Fail open.** Mapper and parser are total functions. The user must
  always be able to read the content as text when rendering can't happen.
- **Heavy libs never enter the initial bundle** — dynamic `import()`
  inside the worker only (Angular budget: 5 MB error).
- **No GPLv3/copyleft dependencies.**
