# Account-holder profile: Luca Ferretti

> **Quick Summary:** Luca is an **Account holder** and freelance UX consultant with ~400 Claude
> **Conversations** he still references; he will not switch until import encrypts them client-side
> and the raw export never uploads to Cognos.

---

## 📋 Metadata

- **ID:** `PER-003`
- **Name:** Luca Ferretti
- **Type:** Human
- **Domain role:** Account holder _(UX research profile — not a Cognos **Persona** instruction set)_
- **Primary Interface:** Web UI (import wizard: source selector → local file → preview → confirm)
- **Technical Proficiency:** Intermediate

---

## 🎯 Core Objectives

- **Primary Goal:** Import Claude text exports — roughly 18 months of client research
  **Conversations** — with parse and encrypt in-browser only, then resume three active
  **Conversations** via normal **Completions** the same week.
- **Secondary Goal:** See unsupported counts (**Attachments**, images, tool records) before confirm;
  accept sibling **Message graph** branches split into labelled **Conversations** rather than wrong
  `parent_message` links.

---

## 🛑 Critical Friction Points

- **Friction 1:** Anthropic changes export JSON — import fails after 12 minutes with no schema
  version in the error.
- **Friction 2:** Assumes 40 **Attachment**-heavy **Conversations** imported fully; learns weeks
  later PDFs were excluded by design.
- **Friction 3:** 180 MB export freezes Safari once; he will not retry until compressed-size limits
  appear before file pick.

---

## 🧠 Collaboration Profile

### 👤 Human-to-System Needs

- **Information Density:** Medium — Claude-specific export steps, preview table (date, local title,
  **Message** count, warnings); counts only, no telemetry on filenames.
- **Communication Style:** Saturday morning, one sitting; progress bar required; cancel must clear
  plaintext from memory — he will not import if export plaintext might persist in IndexedDB.

### 🤖 AI Agent Context (Prompt Injection Guardrails)

- **Input Style:** Status enums only (`validated`, `parsed`, `encrypted`, `failed` + reason code);
  no **Conversation** titles or **Message** snippets in agent handoffs.
- **Ambiguity Tolerance:** Low — unknown ZIP entry or ambiguous **active branch** → split into
  labelled **Conversations** or fail; never merge sibling branches by inference.
- **Handling Errors:** Roll back partial writes; show export-not-supported with source help link —
  not a stack trace or JSON dump.

---

## ⚡ Quick-Reference Matrix

| Action/Trigger      | Default Response / Preferred Behavior                                                   |
| :------------------ | :-------------------------------------------------------------------------------------- |
| **System Error**    | Halt worker; show size/schema error; clear selected file from memory                    |
| **Task Delegation** | **Account holder** picks file → **Helix** parses locally → confirms preview only        |
| **Success State**   | Selected **Conversations** decrypt after **Unlock**; first follow-up **Message** Monday |
