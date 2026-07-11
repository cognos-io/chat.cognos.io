# Persona: Luca Ferretti

> **Quick Summary:** Luca is a freelance UX consultant with ~400 Claude Project threads he
> references for client positioning work; he will not switch until those threads live in Cognos
> without the raw export ever leaving his MacBook.

---

## 📋 Metadata

- **ID:** `PER-003`
- **Name:** Luca Ferretti
- **Type:** Human
- **Primary Interface:** Web UI (import wizard: source selector → local file → preview → confirm)
- **Technical Proficiency:** Intermediate

---

## 🎯 Core Objectives

- **Primary Goal:** Import Claude text exports — roughly 18 months of client research threads —
  encrypted client-side, then open three active client Conversations and continue them the same
  week.
- **Secondary Goal:** See exactly what did not import (PDFs, images, tool traces) before he
  confirms; accept split branches when Claude’s export is ambiguous rather than guess wrong parent
  links.

---

## 🛑 Critical Friction Points

- **Friction 1:** Anthropic changes export JSON — parser fails after 12 minutes “processing” with no
  schema version in the error.
- **Friction 2:** Assumes 40 attachment-heavy threads came across; learns weeks later the PDFs were
  never in Cognos.
- **Friction 3:** 180 MB export freezes Safari tab once; he will not retry until he sees
  compressed-size limits before file pick.

---

## 🧠 Collaboration Profile

### 👤 Human-to-System Needs

- **Information Density:** Medium — Claude-specific export steps, preview table (date, local title,
  message count, warnings column); counts only, no telemetry on filenames.
- **Communication Style:** Saturday morning, coffee, one sitting; progress bar required; cancel must
  feel safe — he will not import if plaintext might sit in IndexedDB.

### 🤖 AI Agent Context (Prompt Injection Guardrails)

- **Input Style:** Status enums only (`validated`, `parsed`, `encrypted`, `failed` + reason code);
  no Conversation titles or Message snippets in agent handoffs.
- **Ambiguity Tolerance:** Low — unknown ZIP entry or branch parent → split into labelled
  Conversations or fail; never merge sibling branches by inference.
- **Handling Errors:** Roll back partial writes; show “export not supported” with Anthropic help
  link — not a stack trace or JSON dump.

---

## ⚡ Quick-Reference Matrix

| Action/Trigger      | Default Response / Preferred Behavior                                   |
| :------------------ | :---------------------------------------------------------------------- |
| **System Error**    | Halt worker; show size/schema error; clear selected file from memory    |
| **Task Delegation** | Luca picks file → **Helix** parses locally → Luca confirms preview only |
| **Success State**   | Selected threads decrypt in UI; he sends first follow-up Message Monday |
