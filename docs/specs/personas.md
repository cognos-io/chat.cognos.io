# Personas

Personas are reusable instructions that change how Cognos replies.

A persona is not an autonomous agent. It is the selected system prompt for a completion.

## Goals

- Let Cognos ship useful default personas.
- Let Account holders create private Custom Personas.
- Keep Custom Persona contents encrypted at rest.
- Let Account holders switch Custom Persona at any point in a Conversation.
- Keep the backend simple: it receives a prompt, uses it once, and does not store it.

## Non-goals

- Tool use or actions on the Account holder's behalf.
- Sharing Custom Personas between Account holders.
- Project-scoped personas. That comes later.
- Server-side editing or inspection of custom persona contents.

## Persona types

### Cognos-provided personas

Cognos-provided personas are public and bundled with the frontend.

Source files live in:

```txt
frontend/src/app/personas/cognos/
```

Each file is markdown with frontmatter:

```md
---
description: Short, practical answers with minimal preamble.
id: cognos:direct
name: Direct
---

Answer directly. Use plain language...
```

The markdown body is the system prompt.

### Custom Personas

Custom Personas are private to one Account holder.

The browser encrypts the full persona payload before sending it to the server:

```json
{
  "version": "1",
  "name": "Private coach",
  "description": "Helps me prepare for hard conversations",
  "system_prompt": "You are..."
}
```

Name, description, and system prompt are all encrypted. Names and descriptions can leak sensitive
intent.

## Storage

PocketBase collection: `personas`

Plaintext fields:

```txt
id
user
data
created
updated
```

Field meanings:

- `user`: owner id
- `data`: base64 encrypted persona payload

The collection must not contain plaintext fields like:

```txt
name
description
slug
system_prompt
```

## Completion API

Completion requests include the selected persona id and plaintext prompt:

```json
{
  "model_id": "llama-3-3-infomaniak",
  "persona_id": "cognos:simple-assistant",
  "system_prompt": "You are a helpful assistant.",
  "messages": [{ "role": "user", "content": "Hello" }]
}
```

Why send `system_prompt`? Custom personas are encrypted at rest, so the backend cannot load the
prompt from storage. The browser decrypts the selected persona and sends the prompt for this one
completion.

Backend rules:

- require `persona_id`
- require `system_prompt`
- reject over-large system prompts
- strip any `system` role messages from `messages`
- prepend exactly one system message from `system_prompt`
- do not store `system_prompt`
- do not log `system_prompt`

## Conversation behavior

Personas are selected per completion, not fixed per conversation.

Account holders can change Custom Persona at any time. Each assistant message stores the
`persona_id` used for that response inside the encrypted message metadata.

## Security and privacy

Custom persona plaintext may contain sensitive data. Treat it like message content.

Rules:

- encrypt custom personas before storage
- never store plaintext persona names, descriptions, or prompts
- never log custom persona plaintext
- only the owning Account holder can list, create, update, or delete their Custom Persona records
- the backend may hold `system_prompt` in memory only long enough to call the model provider

## Future: project personas

Project personas should reuse the same encrypted payload shape.

Differences:

- scope is project, not Account holder
- payload is encrypted with the project key
- any Participant with the project key can decrypt and use it
- access rules must follow project membership

Do not add project personas until projects exist.

## Tests

Required coverage:

- browser e2e: create custom persona and assert POST body contains encrypted `data`, not plaintext
- browser e2e: selected persona sends `persona_id` and `system_prompt` in completion request
- backend tests: completion rejects missing `persona_id`
- backend tests: completion rejects missing `system_prompt`
- backend tests: completion strips caller-supplied system messages
- migration tests: `personas` collection has `user` and `data`, not plaintext fields
