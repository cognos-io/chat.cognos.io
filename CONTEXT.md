# Cognos

Encrypted AI chat where message content is stored as ciphertext the server cannot read, and
decryption happens client-side. One bounded context for the whole product.

## Language

### Account

A single person's Cognos identity — the entity that signs in, owns encrypted data, and holds an
Account Key. One Account maps to one PocketBase user record.

_Avoid:_ User (when speaking about the domain; fine in code as the persistence name)

### Account holder

The human behind an Account. Use when describing actions (signs in, saves the Emergency Kit, picks
a Plan). Use **Account** for state and ownership (the Account's Library, privacy tier).

_Avoid:_ user (domain prose), customer, end user

### Account Key

The high-entropy secret generated once at signup, shown to the Account holder, and never stored
server-side. Alone it decrypts the Account's encrypted private-key backup and unlocks data on a new
device. Losing it is unrecoverable.

_Avoid:_ secret key, master key, recovery key (Emergency Kit is the artefact that holds the Account
Key, not a separate secret)

### Emergency Kit

The one-time downloadable file (`cognos-emergency-kit.txt`) an Account holder saves at signup
containing their Account Key. Not a separate secret — the delivery format for the Account Key.

_Avoid:_ recovery kit; do not confuse with **MFA recovery codes** (one-time backup codes for
multi-factor authentication, unrelated to decryption)

### Account password

The Account holder's chosen sign-in credential. Used for authentication only — resetting it by email
never affects encrypted data.

_Avoid:_ passphrase (implies it protects data), master password (conflicts with Account Key)

### Account key pair

The Account's long-lived asymmetric encryption identity — one public key and one private key,
created once at signup. The private key is wrapped under the Account Key and backed up server-side;
the public key is stored in plaintext. Root of all per-conversation and per-project key wrapping.

_Avoid:_ user key pair (in domain language; fine as the PocketBase collection name)

### Vault

The client-side cryptographic session on a device — decrypted Account key-pair material held in
memory, plus any local persistence (e.g. split-key unlock cache). Locked until the Account holder
enters their Account Key; cleared on lock or logout.

_Avoid:_ using Vault as a synonym for Account key pair or for server-side storage

### Unlock

Opening the **Vault** on a device by entering the **Account Key** (or recovering via split-key
session cache). Required before the client can decrypt Conversations, Attachments, or Bookmarks.

### Lock

Clearing the **Vault** on the current device while keeping the auth session active. The Account
holder must **Unlock** again with their Account Key; does not require signing in again.

_Avoid:_ auto-lock (not implemented)

### Logout

Ending the auth session and clearing the **Vault** — revokes server-side wrap keys and rotates the
auth token. Requires **Account password** to sign in again, then **Unlock** with the Account Key.

_Avoid:_ sign out (UI only)

### Conversation

An encrypted thread of messages with its own key material, expiry policy, and participant list. An
Account may own or participate in many Conversations.

_Avoid:_ chat (when naming the data entity), thread, session

### Conversation key

The per-Conversation asymmetric encryption material (public key + secret key) used to seal Messages
and Conversation metadata. Each Participant holds a wrapped secret key for their active **Key
version**.

_Avoid:_ conversation keypair, encryption key (too generic)

### Key version

The generation counter on a Conversation's key material. Bumps on participant removal or credential
refresh; revoked Participants cannot decrypt Messages encrypted after rotation.

### Key rotation

Replacing encryption material at a new generation so access is forward-only — optional revocation in
the same operation. Always qualify the scope: **Conversation key rotation**,
**Project key rotation** (planned), **Redaction key rotation**. Unqualified "key rotation" is
ambiguous.

_Avoid:_ re-keying (informal); do not use for **Account Key change** (re-wrap only, different op)

### Conversation key rotation

A **Key rotation** on a Conversation: bumps **Key version**, optionally revokes Participants, and
re-wraps the new secret key for those who remain. The only way to cut revoked Participants off from
future Messages.

### Account Key change

Replacing the Account Key and re-wrapping the Account key-pair backup under the new secret.
Historical ciphertext is unchanged. Not a **Key rotation** — no generation counter, no forward-only
access boundary.

### Message

One persisted entry in a Conversation's history — either from a participant (user message) or from
the AI (assistant message). Message content is encrypted at rest; roles are `user` or `assistant`.

_Avoid:_ turn, prompt (the plaintext sent to the provider), reply (fine in UI only)

### Message graph

Every Message in a Conversation, linked by `parent_message` — including sibling branches created by
edit or regenerate. Distinct from the single path the UI shows.

### Active branch

The single path through the **Message graph** the UI displays and Completions use for context.
**Compaction** and the **Minimap** operate on the active branch, not sibling branches.

_Avoid:_ thread, fork (reserved for duplicating to a new Conversation)

### Participant

An Account's membership in a Conversation. Each Participant has a role — **Admin**, **Editor**, or
**Viewer** — that controls what they can do. Revoked participants keep a historical row but lose
access immediately.

_Avoid:_ member, collaborator (informal only), sharer (an action, not the relationship)

### Completion

A single request–response cycle with an AI provider. A persisting Completion writes Messages to a
Conversation; a stateless Completion does not persist anything.

_Avoid:_ generation, inference, chat request

### Temporary conversation

A client-only chat mode with no persisted Conversation record. Completions use the stateless API;
Messages exist in browser memory until the Account saves them into a real Conversation.

_Avoid:_ temporary (alone), ephemeral chat (ambiguous with Disappearing messages)

### Disappearing messages

An auto-expiry retention policy on a persisted Conversation. Each Message receives an `expires`
timestamp; a server job deletes Messages past that instant.

_Avoid:_ temporary messages, self-destruct (marketing-only)

### Privacy tier

The Account's chosen ceiling on where a Model may host plaintext during Completions. Tiers are
`ch_only` (Switzerland), `eu` (European Union), and `global` (any approved region) — ranked from
most to least restrictive. An Account may only use Models at or below their tier.

_Avoid:_ security level, data zone, hosting preference

### Model

A curated catalogue entry an Account selects for Completions — identified by `model_id`, with a
display name, privacy tier, pricing, and capabilities. Defined in code, not user-created.

_Avoid:_ LLM (implementation jargon in domain docs)

### Provider

The third-party AI service that processes plaintext during a Completion. Recorded on the assistant
Message at completion time (`served_provider_name`). Distinct from the Model the Account selected.

_Avoid:_ using Provider and Model interchangeably

### Persona

A named set of instructions that becomes the system prompt for a Completion. Not an autonomous agent
— it only shapes how the AI replies. **Cognos Personas** are bundled defaults; **custom Personas**
belong to one Account and are encrypted at rest.

_Avoid:_ agent, character, bot, preset

### Redaction

Client-side detection of sensitive values in text before a Completion, replacing them with stable
**Placeholders**, and storing encrypted mappings so authorised viewers can **Hydrate** them back.
Providers and persisted Messages receive redacted content by default.

_Avoid:_ PII redaction (as primary term), masking, anonymisation

### Redaction key

Per-Conversation key material used only to seal redaction mapping entries — independent of the
**Conversation key** so **redacted-only** Public shares cannot decrypt mappings. Wrapped for
Participants who may Hydrate.

_Avoid:_ PII key, mapping key

### Placeholder

A stable token (e.g. `[[PII_IBAN_Q7K9M2]]`) substituted for a sensitive value before send. Stored
in the Message and sent to the Provider in place of the original.

### Hydration

Client-side replacement of Placeholders with their original values for a viewer who holds the
redaction key. Viewers without access see Placeholders only.

### Public share

A link-based, unauthenticated view of a Conversation created by an Admin Participant. Modes are
**redacted-only** (Placeholders visible, no redaction key) or **include-sensitive** (reader can
Hydrate sensitive values). Distinct from adding a Participant.

_Avoid:_ public link (UI only), export

### Attachment

One encrypted file in an Account's **Library**, uploaded client-side and sealed to the Account key
pair. Referenced from Messages; owned by the Account, not the Conversation.

### Library

The Account-scoped collection of Attachments, reusable across Conversations.

_Avoid:_ upload (the action), file (too generic)

### Project

A shared encrypted workspace that groups Conversations, Attachments, and memory for multiple
Accounts. The collaboration boundary above a single Conversation. _(Planned — not yet shipped.)_

_Avoid:_ workspace, folder, team

### Plan

Which billing product an Account is on — **Pay-As-You-Go** (metered Usage) or **Unlimited**
(fair-use). The Account's visible choice; prices live in billing docs and may change.

_Avoid:_ tier (reserved for privacy tier), package, license

### Subscription

The active Paddle billing relationship that keeps an Account on a Plan. Managed by Paddle; Cognos
mirrors state from webhooks.

### Usage

Metered Completion cost accrued against an Account, recorded in the ledger. Primary billing concern
on Pay-As-You-Go; tracked but not blocked on Unlimited.

### Trial credit

Complimentary starting balance for new Accounts. When exhausted, the Account enters a read-only
state until they subscribe.

### Catalogue

The operator-curated set of Models available to Accounts — eligibility, pricing, and capabilities.
Defined in code and enriched from provider metadata; exposed via the models API.

_Avoid:_ registry, directory, marketplace

### Bookmark

An Account-scoped encrypted record of a text span within a Message — quote plus surrounding
context for re-anchoring. Distinct from selecting a whole Message; browsable from the bookmarks
page and jumpable back to the source.

_Avoid:_ highlight (the UI effect), saved message, clip

### Compaction

An encrypted summary of an older Message prefix on a Conversation's active branch, substituted
for those Messages when building Completion context. Original Messages remain in history; Compaction
only changes what the Model sees. Created automatically in the background when context fills up.

_Avoid:_ summarisation (the mechanism), pruning (implies deletion), truncation

### Reasoning

A Model's thinking output for a Completion — distinct from the **Answer**. Streamed separately,
encrypted at rest inside the assistant Message; optional and not produced by every Model.

_Avoid:_ thinking (UI label only), chain-of-thought / CoT (provider jargon)

### Minimap

A desktop navigation rail for long Conversations — one tick per user turn on the **active branch**,
with scroll-to-Message on click. Navigation only; does not change branch state or server data.

_Avoid:_ timeline, outline, table of contents

### Answer

The user-facing response text in an assistant Message — distinct from **Reasoning**. What the
Account holder reads as the Model's reply.

_Avoid:_ content (too generic), reply (UI only)

### Web search

An optional Model capability where the **Provider** searches the web during a Completion and
returns encrypted citations in the Answer. Cognos does not run search itself; unsupported Models
silently omit the tool. Distinct from **conversation search** (client-side index over decrypted
Messages).

_Avoid:_ grounding (provider detail), browsing, internet access

## Flagged ambiguities

Terms that appear ambiguously in code or older docs. The **Language** section is canonical; the
right column is what to use in new specs and copy.

| Appears as                             | Use instead                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| `User`, `user_id`, "the user"          | **Account** / **Account holder** (domain); `User` fine in code                             |
| `chat`, `temporaryChat`                | **Conversation** (entity) or **Chat** (UI only)                                            |
| `temporary` alone                      | **Temporary conversation** or **Disappearing messages** — never unqualified                |
| `recovery key`                         | **Account Key** (Emergency Kit is the artefact, not a separate secret)                     |
| `user key pair`, `user_key_pairs`      | **Account key pair** (domain); collection name unchanged in code                           |
| `user personas`                        | **custom Personas**                                                                        |
| `provider` and `model` interchangeably | **Model** = catalogue choice; **Provider** = who processed the Completion                  |
| `tier` alone                           | **Privacy tier** (data residency) vs **Plan** (billing) — always qualify                   |
| `member`, `collaborator`               | **Participant** (Conversation) or **project participant** (Project, when shipped)          |
| `public link`                          | **Public share** (domain); "link" fine in UI                                               |
| `key rotation` alone                   | Qualify scope (**Conversation** / **Project** / **Redaction**); not **Account Key change** |

## Example dialogue

> **Dev:** A user shared a temporary chat with redacted IBANs — can viewers see the real values?
>
> **Expert:** First — it's an **Account holder**, not a user. If they used a **Temporary
> conversation**, nothing is persisted until they save it as a **Conversation**. If they created a
> **Public share** in **redacted-only** mode, readers see **Placeholders** only; they'd need
> **include-sensitive** mode and the redaction key to **Hydrate**. The **Redaction** ran before the
> **Completion** left the browser — the **Provider** never got the raw IBAN. And "temporary chat" in
> the UI might mean **Disappearing messages** instead — check whether a **Conversation** record
> exists.
