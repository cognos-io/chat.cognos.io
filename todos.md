# Todos

## Organisations v1 production-readiness pass (2026-07-18)

- [x] Clarify member identity, roles, billing context, and invite clipboard failure states
- [x] Preserve blocked organisation messages as drafts and keep Personal usable during a lapse
- [x] Parse both flat completion and central write-gate 402 envelopes into the same member-facing
      billing explanation
- [x] Make offboarding recoverable with blocking key rotation and a last-Project-Admin guard
- [x] Enforce lapse read-only behaviour across direct Project, Conversation, memory, redaction,
      completion, image, and compaction content writes
- [x] Add content-free Activity log UI, pagination, CSV export, privacy copy, and persona screenshot
- [x] Add Owner-only Organisation dissolution with explicit Project-deletion confirmation,
      accessible dialog, subscription cancellation, retained audit/billing records, and Personal
      safety checks
- [x] Attribute provider-backed org compaction usage to the Organisation while retaining the acting
      Account and leaving personal balance untouched
- [x] Cover Owner and Member journeys in Playwright browser tests plus organisation, authorisation,
      lapse, dissolution, and compaction accounting in Playwright API tests
- [x] Complete six-locale, accessibility, design-token, lint, build, and screenshot review gates

## General

- [x] Marketing pages
- [x] Dockerfile
- [x] Creating documents (e.g. docx or pdf) - basic
- [x] Web search (pending launch gates — see docs/specs/web-search.md §11/§14)
- [x] Share modal
- [x] Bookmark messages or highlight text go to separate place for easy finding
- [x] property based testing
- [ ] move conversations between projects
- [ ] project collaboration (how do we do pricing? people need an account and messages come out of
      their own account?)
- [ ] power user mode - e.g. show token counts on message. Where is the current context. Surface any
      compactions to the user
- [x] Subresource integrity for javascript files
- [x] Continuous delivery to bunny.net cdn (frontend & web files)
- [ ] Continuous building of container image (backend)
- [ ] Use your own models. Set up a custom endpoint (e.g. ollama or a server over tailscale) and use
      to run your own models. responses are streamed back, encrypted and then posted to the backend
      so the application behaves as normal.
