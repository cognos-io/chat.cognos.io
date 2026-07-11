# Persona: Marie Keller

> **Quick Summary:** Marie uses ChatGPT for work summaries but keeps therapy notes and relationship
> problems out of AI entirely; she wants one private place for the rest without re-learning a
> security lecture every evening.

---

## 📋 Metadata

- **ID:** `PER-001`
- **Name:** Marie Keller
- **Type:** Human
- **Primary Interface:** Web UI (composer, Conversation list, privacy-tier control)
- **Technical Proficiency:** Intermediate

---

## 🎯 Core Objectives

- **Primary Goal:** Journal and think through personal decisions in persisted encrypted
  Conversations on her MacBook and phone — same threads, no “safe topics only” rule.
- **Secondary Goal:** Set `ch_only`, enable Disappearing messages on personal threads, and never
  think about Cognos security again unless she changes tier or persistence mode.

---

## 🛑 Critical Friction Points

- **Friction 1:** Downloads the Emergency Kit to Desktop, never moves it — new phone three months
  later, cannot Unlock, blames Cognos and churns.
- **Friction 2:** Reads “private AI” marketing as “Cognos never sees my words” — first Completion
  feels like betrayal when she learns about in-flight processing.
- **Friction 3:** Finishes Account Key ceremony at 22:30, lands on empty chat, opens ChatGPT for
  tonight’s question anyway.

---

## 🧠 Collaboration Profile

### 👤 Human-to-System Needs

- **Information Density:** Low for trust copy (one sentence + “learn more”); High for toggles she
  can act on (tier, Temporary conversation, Disappearing messages, Lock).
- **Communication Style:** Evening, one-handed on phone; skippable; no profession questions — she
  will lie or bounce if asked.

### 🤖 AI Agent Context (Prompt Injection Guardrails)

- **Input Style:** Short plain sentences; separate “encrypted on disk” from “read during a
  Completion”; never say end-to-end or zero-knowledge.
- **Ambiguity Tolerance:** Low — if she asks “can you see this?”, answer storage vs processing
  explicitly before suggesting she paste sensitive text.
- **Handling Errors:** One recovery step per error (re-download kit, verify email, retry send);
  never quote her Message back in the explanation.

---

## ⚡ Quick-Reference Matrix

| Action/Trigger      | Default Response / Preferred Behavior                               |
| :------------------ | :------------------------------------------------------------------ |
| **System Error**    | Alert + retry; keep composer text; never a spinner with no message  |
| **Task Delegation** | Offer “start a private thread” starter — prefill only, no auto-send |
| **Success State**   | Recent Conversations list; habit nudge dismissible forever          |
