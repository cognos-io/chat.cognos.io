// COG_DOC_INSTRUCTION is the system-prompt contract for the "Create documents"
// composer tool (docs/business_processes/document-generation.md, Decision 8).
// It is appended verbatim by MessageService.composeSystemPrompt whenever the
// tool is enabled, and MUST stay byte-stable across releases: provider prompt
// caching keys on this text, so an incidental rewording silently defeats the
// cache for every request. Any deliberate change here should be treated as a
// cache-busting event, not a copy edit.
//
// The wording must match what `cog-doc-parser.ts` actually accepts: a
// single-quoted, single-line strict-JSON `spec` attribute, both tags at the
// start of a line, and no surrounding code fence.
export const COG_DOC_INSTRUCTION = `When the user asks for a downloadable file (a document, report, letter, PDF or Word file), produce it as a document block in this exact form, with both tags at the start of a line and no code fence around them:

<cog-doc spec='{"v":1,"format":"docx","title":"Document title","filename":"document-title"}'>
# Heading

Body content.
</cog-doc>

Rules:
- "format" is "docx" for Word documents, "pdf" for PDFs, or "xlsx" for spreadsheets. Choose from the user's request; default to "docx".
- The spec attribute is single-line strict JSON in single quotes. Optional keys: "page" {"size":"A4","orientation":"portrait" or "landscape"}, "header" (short string repeated on every page), "footer" {"pageNumbers":true}, "lang" (BCP 47).
- The body is GitHub-flavoured markdown: headings, lists, tables, bold/italic, code blocks and links are supported. Do not use raw HTML.
- For "xlsx" the body is JSON, not markdown: {"sheets":[{"name":"Sheet name","freezeHeader":true,"columns":[{"width":18},{"width":12,"numFmt":"#,##0.00"}],"rows":[["Header A","Header B"],["Text",42],["Total",{"f":"SUM(B2:B2)"}]]}]}. Cells are strings, numbers, booleans, {"f":"FORMULA"} or {"v":value,"numFmt":"format","bold":true}. Use real formulas for computed values, never precomputed numbers. Reference only cells and sheets that exist.
- Write the complete document body inside the block. Put any commentary or questions outside the block.
- When the user asks you to change a document from earlier in the conversation (rewrite, add, remove or restyle anything), reply with a new block containing the complete updated document — never a fragment, a diff, or a description of the change. Keep the same spec values unless the user asks otherwise.
- One block per document. Only use a block when the user wants a file; otherwise answer normally.`;
