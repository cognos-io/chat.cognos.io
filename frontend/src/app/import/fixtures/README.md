# Import fixtures (OP-034)

Synthetic, content-free ChatGPT and Claude export shapes used by unit and e2e
tests. Titles and message bodies are placeholders only — never real customer
data.

| File                         | Source                       | Covers                                                               |
| ---------------------------- | ---------------------------- | -------------------------------------------------------------------- |
| `chatgpt-conversations.json` | ChatGPT `conversations.json` | linear path with system root + tool hop; sibling branch split        |
| `claude-conversations.json`  | Claude `conversations.json`  | linear `text` + `content` blocks; content-only messages; attachments |

Refresh these when OpenAI or Anthropic change export shapes, then re-run
`import-parser.spec.ts` and the conversation-import browser suites.
