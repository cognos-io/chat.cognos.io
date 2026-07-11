# Account-holder profile: Marie Keller

> **Quick Summary:** Marie is an **Account holder** who uses ChatGPT for work summaries but keeps
> therapy notes out of AI entirely; she wants persisted encrypted **Conversations** for personal
> thinking without re-reading trust copy every evening.

---

## 📋 Metadata

- **ID:** `PER-001`
- **Name:** Marie Keller
- **Type:** Human
- **Domain role:** Account holder _(UX research profile — not a Cognos **Persona** instruction set)_
- **Primary Interface:** Web UI (composer, Conversation list, privacy-tier control)
- **Technical Proficiency:** Intermediate

---

## 🎯 Core Objectives

- **Primary Goal:** Journal and think through personal decisions in persisted encrypted
  **Conversations** on her MacBook and phone — same **Messages**, no “safe topics only” rule.
- **Secondary Goal:** Set privacy tier `ch_only`, enable **Disappearing messages** on personal
  **Conversations**, and stop thinking about trust boundaries unless she switches
  **Temporary conversation** mode or privacy tier.

---

## 🛑 Critical Friction Points

- **Friction 1:** Saves the **Emergency Kit** to Desktop and never backs it up — new phone three
  months later, **Vault** stays locked, she cannot **Unlock**, churns.
- **Friction 2:** Reads “private AI” as “Cognos never sees my words” — first **Completion** feels
  like betrayal when she learns plaintext is processed in-flight by Cognos and the **Provider**.
- **Friction 3:** Finishes **Account Key** ceremony at 22:30, lands on an empty **Conversation**
  list, opens ChatGPT for tonight’s question anyway.

---

## 🧠 Collaboration Profile

### 👤 Human-to-System Needs

- **Information Density:** Low for trust copy (one sentence + “learn more”); High for controls she
  can act on (privacy tier, **Temporary conversation**, **Disappearing messages**, **Lock**).
- **Communication Style:** Evening, one-handed on phone; skippable; no profession questions — she
  will lie or bounce if asked.

### 🤖 AI Agent Context (Prompt Injection Guardrails)

- **Input Style:** Short plain sentences; separate encrypted at rest from plaintext during a
  **Completion**; never say end-to-end or zero-knowledge.
- **Ambiguity Tolerance:** Low — if she asks “can you see this?”, explain storage vs in-flight
  processing before suggesting she paste sensitive text into a **Completion**.
- **Handling Errors:** One recovery step per error (re-save **Emergency Kit**, verify email, retry
  **Completion**); never quote her **Message** back in the explanation.

---

## ⚡ Quick-Reference Matrix

| Action/Trigger      | Default Response / Preferred Behavior                                         |
| :------------------ | :---------------------------------------------------------------------------- |
| **System Error**    | Alert + retry; keep composer text; never a spinner with no message            |
| **Task Delegation** | Offer “start a private **Conversation**” starter — prefill only, no auto-send |
| **Success State**   | Recent **Conversations** list; habit nudge dismissible forever                |
