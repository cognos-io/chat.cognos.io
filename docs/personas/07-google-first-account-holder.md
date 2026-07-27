# Account-holder profile: Elena Rossi

> **Quick Summary:** Elena is a Google-first **Account holder** in Lugano who wants one-tap sign-in
> on mobile Safari, but must understand that Google confirms her identity while her **Account Key**
> alone **Unlocks** her encrypted data.

---

## 📋 Metadata

- **ID:** `PER-007`
- **Name:** Elena Rossi
- **Type:** Human
- **Domain role:** Account holder _(UX research profile — not a Cognos **Persona** instruction set)_
- **Primary Interface:** Mobile Web UI (Safari on iPhone; occasional MacBook)
- **Technical Proficiency:** Non-Technical

---

## 🎯 Core Objectives

- **Primary Goal:** Choose **Continue with Google**, save the **Emergency Kit** in her password
  manager, and start her first encrypted **Conversation** in under three minutes.
- **Secondary Goal:** Return on a new browser with the same Google identity, then **Unlock** with
  her **Account Key** without confusing the two security steps.

---

## 🛑 Critical Friction Points

- **Friction 1:** Assumes Google can recover her encrypted data because Google signs her in; she
  skips the **Emergency Kit** and later discovers that Google cannot replace the **Account Key**.
- **Friction 2:** Safari blocks or closes the Google popup and leaves her on the sign-in page with
  no clear next action; she taps repeatedly and expects duplicate Accounts.
- **Friction 3:** Her email already belongs to a password Account. She reads the collision message
  as data loss instead of a safety boundary requiring password sign-in before she connects Google.

---

## 🧠 Collaboration Profile

### 👤 Human-to-System Needs

- **Information Density:** Low — one action per screen, with “Google signs you in; your Account Key
  unlocks your data” visible before the Emergency Kit step.
- **Communication Style:** One-handed mobile use, often between train connections; large tap
  targets, visible focus, no technical OAuth terminology, and a single retry action after popup
  failure.

### 🤖 AI Agent Context (Prompt Injection Guardrails)

- **Input Style:** Short, plain sentences. Always distinguish identity confirmation from
  decryption.
- **Ambiguity Tolerance:** Low — never imply Google, Cognos support, or an Account password can
  recover a lost Account Key.
- **Handling Errors:** Preserve the current screen and say what happened without exposing provider
  codes, tokens, email-existence details, or technical stack traces.

---

## ⚡ Quick-Reference Matrix

| Action/Trigger      | Default Response / Preferred Behavior                                               |
| :------------------ | :---------------------------------------------------------------------------------- |
| **System Error**    | One calm retry; explain how to allow the Google popup in Safari                     |
| **Task Delegation** | Google confirms identity; Cognos creates the Account; Elena saves the Emergency Kit |
| **Success State**   | Same Google identity signs in; Account Key Unlocks; first Conversation is ready     |
