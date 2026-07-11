# Persona: [Name or Archetype Role]

> **Quick Summary:** A single sentence defining who this persona is, their primary driver, and their
> relationship to the system.

---

## 📋 Metadata

- **ID:** `PER-00X`
- **Name:** [Human name, or codename for an AI Agent]
- **Type:** [Human | AI Agent]
- **Primary Interface:** [e.g., CLI, Web UI, API, Slackbot]
- **Technical Proficiency:** [Expert | Intermediate | Non-Technical]

---

## 🎯 Core Objectives

_What does success look like for this persona? Keep this to 2–3 items maximum._

- **Primary Goal:** [Clear, actionable outcome they want to achieve]
- **Secondary Goal:** [Supporting preference, e.g., speed, data density, low cognitive load]

---

## 🛑 Critical Friction Points

_What triggers failure, frustration, or workflow abandonment?_

- **Friction 1:** [e.g., Missing API error documentation / Slow UI transitions]
- **Friction 2:** [e.g., Ambiguous natural language prompts / Too many confirmation dialogs]

---

## 🧠 Collaboration Profile

_How this persona interacts with other entities in the system._

### 👤 Human-to-System Needs

- **Information Density:** [High (wants raw data) | Low (wants curated insights)]
- **Communication Style:** [e.g., Direct, asynchronous, visual]

### 🤖 AI Agent Context (Prompt Injection Guardrails)

- **Input Style:** [e.g., Strictly structured JSON, conversational Markdown]
- **Ambiguity Tolerance:** [Low (needs explicit schemas) | High (can infer intent)]
- **Handling Errors:** [e.g., Fails fast and logs error | Attempts auto-healing 3x]

---

## ⚡ Quick-Reference Matrix

| Action/Trigger      | Default Response / Preferred Behavior     |
| :------------------ | :---------------------------------------- |
| **System Error**    | [e.g., Aborts instantly and pings a human |
| **Task Delegation** | [e.g., Hands off via git commit           |
| **Success State**   | [e.g., Expects silent completion          |
