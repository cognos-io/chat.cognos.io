---
description: Sensitive values are detected and swapped for stable placeholder tokens in the browser before any completion request leaves the device; originals live only in a separately-keyed, server-opaque mapping
name: pii-redaction
---

# Redaction

Before a prompt ever leaves the browser, Cognos scans the text for common
high-confidence sensitive values — IBANs, emails, phone numbers, credit cards,
API/private keys, and national IDs (Swiss AHV, UK NINo, German Steuer-IdNr, and
friends) — and replaces each one with a **placeholder token** like
`[[PII_IBAN_Q7K9M2]]`. The backend and the AI provider only ever see the
placeholder; the original value is stored in a **separate encrypted mapping** the
server cannot read. See the [security model](../security-model.md) for the trust boundary and
[open points](../open-points.md#data-documents-and-sharing) for known gaps.

This is a **data-minimisation layer on top of** the encryption model, not a
replacement for it. Detection is best-effort and tuned for precision (it favours
missing a value over corrupting normal prose), so it is not a guarantee that
every sensitive value is caught.

## The rule

- **Redact before send.** Detection and token substitution happen in the browser
  before the completion request is built — for normal send, title generation,
  edited-message forks, regeneration context, Temporary conversations, and the text
  extracted from Attachments.
- **Tokens are model-safe and non-reversible.** Format `[[PII_<TYPE>_<RANDOM>]]`;
  the random suffix comes from Web Crypto and is **never** derived from the
  original value (no reversible encoding, no deterministic hash). The same
  normalised value maps to one token within a conversation.
- **Originals live only in the sealed mapping.** A token→original entry is sealed
  to a **redaction key that is independent of the conversation key** — so handing
  out the conversation key (a normal share) never grants the ability to
  un-redact. The server stores only the plaintext token string plus the sealed
  original; it can associate a token with a conversation/user/project but cannot
  read the value.
- **Hydration is display-only.** A viewer who holds the redaction key sees the
  originals restored at render time; stored message content stays redacted.
  Unknown tokens render as-is.
- **Never logged.** Raw detected values and decrypted mappings never go to
  console, backend logs, analytics, or billing events.

## Detection modes

Account holders choose the detection depth in account settings:

| Mode                | What happens                                                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Off**             | No automatic detection. New prompts can leave the browser with sensitive values intact.                                                                    |
| **Simple (fast)**   | Fast local detector set. Good for common high-confidence values. Default.                                                                                  |
| **Better (slower)** | Adds local context, health, DOB, passport, driving-licence, account-style detectors, and local `compromise` name/organisation/place hints in a Web Worker. |
| **Comprehensive**   | Disabled for now. Labelled as sending data to Cognos servers; not implemented.                                                                             |

Important: `better` is still **local-only**. It does not send message text to Cognos servers.

## What the Account holder sees

- The composer groups detections by severity: `critical`, `high`, `medium`, `low`.
- Higher severity appears first.
- The Account holder can still deselect an item.
- The Account holder can choose "Never redact this" on a detected value; the sealed owner-scoped
  exception is managed from `/account/memory` and only affects future messages.
- If they send with a deselected detected value, the warning names the highest severity.
- If everything stays selected, sending is not interrupted.

```mermaid
flowchart LR
  D[raw draft in browser] --> R{detect sensitive values}
  R -- none --> S[send unchanged]
  R -- found --> T["swap for [[PII_…]] tokens"]
  T --> M["seal token→original<br/>under redaction key<br/>(independent of conv. key)"]
  T --> P["send redacted prompt<br/>backend + provider see tokens only"]
  P --> ST[("store redacted<br/>message content")]
  M --> ST
  ST -. "load + hydrate for key holder" .-> V[render originals to authorised viewer]
```

## What the server / provider can and cannot see

| Party        | Sees                                                    | Never sees                                                              |
| ------------ | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| AI provider  | placeholder tokens in the prompt                        | the original sensitive value                                            |
| Backend      | redacted message content, the plaintext token string    | the original value (sealed under redaction key)                         |
| Public share | redacted content by default (placeholders stay as bars) | originals — unless it is an explicit **include-sensitive-values** share |

## Quality checks

When changing detectors, update the small synthetic corpus first:

- `frontend/src/app/redaction/corpus/baseline-v2.json`
- `frontend/src/app/redaction/redaction-corpus.spec.ts`

The corpus test checks precision and recall for the shipped v2 detector set.
Add near-miss negatives whenever a detector starts matching a new shape.

No production text belongs in the corpus. Use fake examples only.

## Leak checks

There are two high-level no-leak tests:

- Browser e2e: typed prompt values reach `/complete` as placeholders, not raw values.
- API e2e: persisted message rows expose neither raw values nor redaction placeholders.

If either test fails, treat it as a privacy regression.

## Storage & lock-down

Mappings and keys live in dedicated collections
(`conversation_redaction_keys`, `redaction_entries`, and the scoped
`user_redaction_entries` / `project_redaction_*` stores). All have **`null`
PocketBase API rules**; every read/write flows through `/api/v1` handlers that
authorise by active conversation participation (or user/project ownership), and
the lock-down is pinned by a test. Deleting a conversation cascade-deletes its
redaction keys and entries.

## Sharing modes

Public sharing reuses the fragment-gated link model. **Redacted-only** (the
default) carries the conversation key only, so sensitive values stay as
censorship bars and the public redaction endpoint returns `404`.
**Include-sensitive-values** (explicit opt-in) additionally gates the redaction
secret through the URL fragment — the server never holds anything that can
un-redact on its own. Switching modes mints a new token and URL; revoking a
share `404`s both.

## Known limitation

The redaction secret is currently wrapped for the **creating** Participant
only, so other Participants see Placeholders until participant-add re-wrapping
lands. This is a coverage limit, not a leak: no one ever receives a value they
should not, and provider exposure is unaffected. Redaction-key rotation is
coupled to [conversation-key-rotation](./conversation-key-rotation.md) and
inherits its limitation (rewraps forward, does not re-seal historical entries).
