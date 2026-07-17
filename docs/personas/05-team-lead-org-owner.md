# Account-holder profile: Sophie Vuille

> **Quick Summary:** Sophie is the founding partner **Account holder** who creates her firm's
> **Organisation**, holds the **Owner** role, and pays via Paddle — but only moves her tax advisory
> practice onto Cognos once one invoice, pooled **Usage**, and Admin-sees-metadata-only survive her
> own security review.

---

## 📋 Metadata

- **ID:** `PER-005`
- **Name:** Sophie Vuille
- **Type:** Human
- **Domain role:** Account holder _(UX research profile — not a Cognos **Persona** instruction
  set)_
- **Primary Interface:** Web UI (org billing settings, **Seat** invites, **Workspace switcher**,
  usage-and-cost dashboard)
- **Technical Proficiency:** Intermediate

---

## 🎯 Core Objectives

- **Primary Goal:** Create the **Organisation** for her 14-person tax advisory firm in Geneva,
  invite every associate via invite-token — no IT ticket, no SSO setup — and receive one Paddle
  invoice covering pooled **Usage** at the CHF 15/**Seat** floor.
- **Secondary Goal:** Confirm, before she commits the firm card, that as **Owner** she and any
  **Admin** only ever see per-member **Usage** and cost metadata — never **Conversation** content —
  and that offboarding a departing associate cleanly revokes their **Org membership** and
  **Project** access without touching anyone's personal **Account**.

---

## 🛑 Critical Friction Points

- **Friction 1:** Assumes she needs a domain-verified workspace or SSO before inviting anyone;
  stalls at the first **Seat** until she discovers invite-by-token works immediately for any
  associate's work email, Cognos **Account** or not.
- **Friction 2:** Her office manager asks about data residency and a signed DPA before she'll
  expense the card payment — **Organisation** creation stalls if privacy tier `ch_only` and the DPA
  aren't a five-minute answer, not a sales call.
- **Friction 3:** Reads "Admins see usage and costs" and assumes that means she or Cognos can read
  associates' client **Conversations** through the usage dashboard — nearly aborts onboarding until
  she confirms the dashboard shows model mix and spend only, never **Message** content.
- **Friction 4:** A pooled overage line lands on the one invoice at cycle close because two
  associates' **Usage** pushed total org spend past N × CHF 15 — she didn't see it coming mid-cycle
  and now doubts the "predictable" pitch.

---

## 🧠 Collaboration Profile

### 👤 Human-to-System Needs

- **Information Density:** Low to start — one sentence, "Admins see usage and cost, never
  conversations" — then High on the **Seat** and billing screens: active **Seat** count, per-member
  **Usage**, projected pooled overage before cycle close.
- **Communication Style:** Weekday admin sessions between client meetings; wants **Organisation**
  creation and the first invite done in one sitting; will not tolerate a setup wizard that mentions
  SSO, SCIM, or IT before **Seat** 1.

### 🤖 AI Agent Context (Prompt Injection Guardrails)

- **Input Style:** Plain confirmations only — **Seat** counts, invite status (`sent`, `accepted`,
  `revoked`), cycle spend against the CHF 15/**Seat** floor; never a per-associate **Conversation**
  title or **Message** snippet in her admin view.
- **Ambiguity Tolerance:** Low — if org billing lapses into `past_due`, say so plainly and name the
  read-only consequence for all members; never imply her personal balance or **Account** covers the
  gap.
- **Handling Errors:** Surface Paddle failures (declined card, `past_due`) as one actionable step —
  update payment method; never suggest disabling privacy tier `ch_only` or the org-**Project**
  access rule to unblock associates faster.

---

## ⚡ Quick-Reference Matrix

| Action/Trigger      | Default Response / Preferred Behavior                                                                          |
| :------------------ | :------------------------------------------------------------------------------------------------------------- |
| **System Error**    | Show Paddle/billing fault plainly; keep **Seat** invites queued, not silently dropped                          |
| **Task Delegation** | Invite by token to associate's work email; crypto wrap completes once they accept — no IT step                 |
| **Success State**   | One invoice, N **Seats** at the CHF 15 floor; usage-and-cost dashboard visible, **Conversation** content never |
