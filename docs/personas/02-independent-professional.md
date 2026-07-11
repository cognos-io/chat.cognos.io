# Persona: Thomas Berner

> **Quick Summary:** Thomas is a solo employment lawyer in Bern who pastes client emails into AI to
> draft settlement letters; one unredacted IBAN or client name reaching a Provider ends the
> relationship permanently.

---

## 📋 Metadata

- **ID:** `PER-002`
- **Name:** Thomas Berner
- **Type:** Human
- **Primary Interface:** Web UI (composer with Redaction review, Library, Bookmarks)
- **Technical Proficiency:** Intermediate

---

## 🎯 Core Objectives

- **Primary Goal:** Turn inbound client email + his bullet notes into a first-draft settlement
  letter in under ten minutes, with `better` Redaction on and `ch_only` tier locked.
- **Secondary Goal:** Return to the same matter across six weeks — Bookmarks on clause wording,
  conversation search by client codename, Compaction when threads grow — without re-uploading files
  to Cognos at rest.

---

## 🛑 Critical Friction Points

- **Friction 1:** Misses an AHV number because Redaction favours precision over recall — discovers
  it only when re-reading the sent prompt preview too quickly.
- **Friction 2:** Meant to add his paralegal as a **Participant** but creates a **Public share** in
  `include-sensitive` mode; panics when the link works without login.
- **Friction 3:** Trial credit runs out mid-matter; read-only gate blocks send the night before a
  client deadline.

---

## 🧠 Collaboration Profile

### 👤 Human-to-System Needs

- **Information Density:** High before send — Redaction list sorted `critical` → `low`, Placeholder
  preview, Model tier badge, estimated Usage on long pastes.
- **Communication Style:** Desktop, morning blocks; wants confirm dialogs on share mode and
  participant role; ignores features he does not need (image gen, web search).

### 🤖 AI Agent Context (Prompt Injection Guardrails)

- **Input Style:** Bullet findings with Placeholder IDs only (`[[PII_EMAIL_…]]`); never restate
  client names, IBANs, or AHV values in coaching text.
- **Ambiguity Tolerance:** Low — if Redaction is off or tier is `global`, warn before he pastes the
  next email; do not infer matter identity from Conversation title “Müller settlement”.
- **Handling Errors:** Block send on Redaction failure; never suggest “turn Redaction off” or
  downgrade tier to fix a Model timeout.

---

## ⚡ Quick-Reference Matrix

| Action/Trigger      | Default Response / Preferred Behavior                                                         |
| :------------------ | :-------------------------------------------------------------------------------------------- |
| **System Error**    | Block send; preserve attachment + composer; show tier or Redaction conflict                   |
| **Task Delegation** | Route tone/format tweaks to his encrypted custom **Persona** — not Word paste to another tool |
| **Success State**   | Letter draft in encrypted history; Usage line visible; he copies out manually                 |
