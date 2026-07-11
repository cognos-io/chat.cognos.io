# Account-holder profile: Thomas Berner

> **Quick Summary:** Thomas is an **Account holder** and solo employment lawyer in Bern who pastes
> client email into **Completions** to draft settlement letters; one unredacted IBAN reaching a
> **Provider** ends the relationship permanently.

---

## 📋 Metadata

- **ID:** `PER-002`
- **Name:** Thomas Berner
- **Type:** Human
- **Domain role:** Account holder _(UX research profile — not a Cognos **Persona** instruction set)_
- **Primary Interface:** Web UI (composer with **Redaction** review, **Library**, **Bookmarks**)
- **Technical Proficiency:** Intermediate

---

## 🎯 Core Objectives

- **Primary Goal:** Turn inbound client email plus bullet notes into a first-draft settlement letter
  in under ten minutes via one **Completion**, with Redaction mode `better` on and privacy tier
  `ch_only` locked.
- **Secondary Goal:** Return to the same matter across six weeks — **Bookmarks** on clause wording,
  **conversation search** by client codename, **Compaction** when the **active branch** grows —
  without plaintext **Attachments** at rest on Cognos servers.

---

## 🛑 Critical Friction Points

- **Friction 1:** Misses an AHV number because **Redaction** favours precision over recall —
  discovers it only when skimming the composer preview before send.
- **Friction 2:** Meant to add his paralegal as a **Participant** but creates a **Public share** in
  `include-sensitive` mode; panics when readers can **Hydrate** **Placeholders** without signing in.
- **Friction 3:** **Trial credit** exhausted mid-matter; read-only gate blocks the next
  **Completion** the night before a client deadline.

---

## 🧠 Collaboration Profile

### 👤 Human-to-System Needs

- **Information Density:** High before send — **Redaction** severity list (`critical` → `low`),
  **Placeholder** preview, **Model** privacy-tier label, estimated **Usage** on long pastes.
- **Communication Style:** Desktop, morning blocks; wants confirm dialogs on **Public share** mode
  and **Participant** role (Admin/Editor/Viewer); ignores **Web search** and image generation.

### 🤖 AI Agent Context (Prompt Injection Guardrails)

- **Input Style:** Bullet findings with **Placeholder** tokens only (`[[PII_EMAIL_…]]`); never
  restate client names, IBANs, or AHV values in coaching text.
- **Ambiguity Tolerance:** Low — if **Redaction** is off or privacy tier is `global`, warn before he
  pastes the next email; do not infer matter identity from **Conversation** title “Müller
  settlement”.
- **Handling Errors:** Block send on **Redaction** failure; never suggest disabling **Redaction** or
  lowering privacy tier to fix a failed **Completion**.

---

## ⚡ Quick-Reference Matrix

| Action/Trigger      | Default Response / Preferred Behavior                                                            |
| :------------------ | :----------------------------------------------------------------------------------------------- |
| **System Error**    | Block send; preserve **Attachment** refs + composer; show privacy-tier or **Redaction** conflict |
| **Task Delegation** | Route tone/format tweaks to his encrypted custom **Persona** — not paste into another tool       |
| **Success State**   | **Answer** in encrypted **Messages**; **Usage** line visible; he copies out manually             |
