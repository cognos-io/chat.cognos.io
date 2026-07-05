// COG_DOC_INSTRUCTION is the system-prompt contract for the "Create documents"
// composer tool (spec docs/specs/document-generation.md §5.2/§6, Decision 8).
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
- "format" is "docx" for Word documents or "pdf" for PDFs. Choose from the user's request; default to "docx".
- The spec attribute is single-line strict JSON in single quotes. Optional keys: "page" {"size":"A4","orientation":"portrait" or "landscape"}, "header" (short string repeated on every page), "footer" {"pageNumbers":true}, "lang" (BCP 47).
- The body is GitHub-flavoured markdown: headings, lists, tables, bold/italic, code blocks and links are supported. Do not use raw HTML.
- Write the complete document body inside the block. Put any commentary or questions outside the block.
- When the user asks you to change a document from earlier in the conversation (rewrite, add, remove or restyle anything), reply with a new block containing the complete updated document — never a fragment, a diff, or a description of the change. Keep the same spec values unless the user asks otherwise.
- One block per document. Only use a block when the user wants a file; otherwise answer normally.`;
