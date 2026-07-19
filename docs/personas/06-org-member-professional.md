# Account-holder profile: Nils Baumann

> **Quick Summary:** Nils is an associate **Account holder** who accepts an Organisation invite link
> into Sophie's firm **Organisation**, works inside org-owned **Projects** billed to the firm, and
> won't trust the **Workspace switcher** until he's certain his personal **Conversations** stay his
> and stay separately billed.

---

## 📋 Metadata

- **ID:** `PER-006`
- **Name:** Nils Baumann
- **Type:** Human
- **Domain role:** Account holder _(UX research profile — not a Cognos **Persona** instruction
  set)_
- **Primary Interface:** Web UI (**Workspace switcher**, org-owned **Project** composer, Personal
  **Conversation** list)
- **Technical Proficiency:** Intermediate

---

## 🎯 Core Objectives

- **Primary Goal:** Open the invite link Sophie sent, land already unlocked in the firm's
  **Organisation** workspace — same **Account**, same **Vault**, no second Emergency Kit — then
  start drafting in an org-owned **Project** billed to the firm within minutes.
- **Secondary Goal:** Keep his own drafting and journaling **Conversations** in his Personal
  workspace on his personal **Plan**, switch **Workspace** (Personal ⇄ Organisation) without losing
  track of which context is billed, and trust that leaving the firm someday only revokes his **Org
  membership** — never his personal **Account** or its **Conversations**.

---

## 🛑 Critical Friction Points

- **Friction 1:** Starts a new **Conversation** without checking which **Workspace** he's in —
  drafts a client memo in his Personal workspace (billed to him personally, and possibly above his
  personal privacy tier) or pastes personal notes into the firm's org-owned **Project** (billed to
  the firm, visible on the Admin usage dashboard).
- **Friction 2:** Mid-draft on a client **Answer** when the firm's Paddle subscription lapses to
  `past_due` — the org **Project** goes read-only for every member with no warning before the block,
  and he can't tell whether it's something he did.
- **Friction 3:** Assumes opening the invite link creates a second, separate Cognos **Account**
  for "work" — confused when **Unlock** still uses the same **Account Key** and **Vault** he's had
  for months.
- **Friction 4:** Fears that leaving the firm, or being offboarded, deletes or locks his personal
  **Account** too — needs to know upfront that offboarding only revokes **Org membership** and
  org-**Project** participation, never his personal **Conversations**, **Attachments**, or
  **Bookmarks**.

---

## 🧠 Collaboration Profile

### 👤 Human-to-System Needs

- **Information Density:** High on the one control that matters — a persistent, unambiguous
  **Workspace** label (Personal vs. the firm's **Organisation** name) on every **Conversation** and
  **Project**; low everywhere else.
- **Communication Style:** Mixed office and remote hours; wants a single confirm the first time he
  switches **Workspace**, then silence — no separate login or **Unlock** ceremony when moving
  between them.

### 🤖 AI Agent Context (Prompt Injection Guardrails)

- **Input Style:** Workspace-scoped only — a **Completion** request always carries which context
  (Personal or Organisation) it started in; never infer billing scope from **Conversation** title or
  content.
- **Ambiguity Tolerance:** Low — if org billing is `past_due`, block writes to org **Projects** and
  say so; never silently reroute an org-**Project** **Completion** to his personal balance to "keep
  him unblocked."
- **Handling Errors:** On a **Workspace**-switch failure, keep his draft in the composer and retry
  the switch — never lose typed text; on offboarding, confirm his personal **Account** and
  **Conversations** are untouched before confirming anything else.

---

## ⚡ Quick-Reference Matrix

| Action/Trigger      | Default Response / Preferred Behavior                                                                            |
| :------------------ | :--------------------------------------------------------------------------------------------------------------- |
| **System Error**    | Org **Project** read-only (billing lapsed) shows the reason inline; Personal workspace keeps working             |
| **Task Delegation** | Invite-token accept links this **Account** to the **Organisation** — no new **Account**, no second Emergency Kit |
| **Success State**   | **Workspace** label visible on every **Conversation**/**Project**; switch is one click, no re-**Unlock**         |
