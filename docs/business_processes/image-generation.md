---
description: How an encrypted image is generated, stored, retrieved, regenerated and exported
name: image-generation
---

# Image Generation

Account holders enable a **Generate image** tool in the composer and send a prompt. The
result is an image, persisted with the same no-plaintext-at-rest rule as
messages: the bytes are encrypted before any durable write and only the holder
of the conversation key can decrypt them.

`POST /api/v1/conversations/{id}/image` — `{ prompt, model_id, messages?, parent_message_id? }`.
Capability, privacy tier and billing are all enforced **before** the provider is
called (same gates as the [completion pipeline](./completion-pipeline.md)). `messages`
is the prior conversation context (redacted, same shape completions send) so a
chat-transport model keeps context; it is forwarded to the provider only, never
persisted.

## Two transports, chosen per model

The catalogue records `image_generation_transport` (backend-only) per model:

- **`images_api`** — OpenAI `gpt-image-*`. Bifrost's `/v1/images/generations`;
  returns `data[].b64_json`.
- **`chat_completions`** — Google Gemini `*-flash-image-*` (the ZDR/EU models).
  Sends the prior turns (`messages`) so the model keeps context. Bifrost's chat
  endpoint returns the image inline at `choices[].message.images[]`. Bifrost
  doesn't model that field, so the gateway enables raw-response capture **for
  this request only** and parses the data URI out of the raw JSON. It also reads
  `choices[].message.content`: if the model replies with **text and no image**
  (a refusal or clarifying question), that text is surfaced and saved as a normal
  assistant message instead of failing — see the diagram below.

The frontend only sees `supports_image_generation`; it never picks the transport.

```mermaid
sequenceDiagram
  autonumber
  participant FE
  participant H as /image handler
  participant DB
  participant GW as Gateway
  participant F as Protected file store

  FE->>H: prompt, model_id, parent_message_id?
  H->>H: capability + privacy_tier + billing gate
  alt generate (no parent)
    H->>DB: encrypt + INSERT user prompt message
  else regenerate (parent set)
    H->>DB: verify parent belongs to conversation
  end
  H->>GW: GenerateImage (transport per model, + history)
  GW-->>H: image bytes, OR text, OR neither (+ usage)
  alt image returned
    H->>H: random symmetric key, secretbox the bytes,<br/>seal the key to the conversation public key
    H->>F: write ciphertext (protected file on the message)
    H->>DB: encrypt + INSERT assistant message<br/>(carries the sealed key)
    H->>H: record usage as operation_type=image_generation
    H-->>FE: message refs + sealed key (never bytes)
  else text returned (no image)
    H->>DB: encrypt + INSERT assistant text message
    H->>H: record usage as operation_type=text
    H-->>FE: assistant_message.content (no attachment)
  else neither
    H->>DB: DELETE prompt message (cleanup; no-op on regenerate)
    H-->>FE: 503
  end
```

## Encryption (reuses the message scheme)

The server holds only the conversation **public** key — it encrypts, never
decrypts (see [message-encryption](./message-encryption.md)). For an image:

1. random per-file symmetric key → `secretbox` the bytes;
2. seal that key to the conversation public key (anonymous box);
3. store the ciphertext in the message's protected `attachment` file;
4. the sealed key + mime live inside the encrypted assistant message payload.

## Retrieval

`messages` is locked to custom routes, so the built-in protected-file endpoint
is unavailable. The client fetches bytes from
`GET /api/v1/conversations/{id}/messages/{messageId}/attachment` (same
participant check as the rest of the conversation API), then **decrypts
client-side**: unseal the per-file key with the conversation key, open the
secretbox, render as a `blob:` URL.

## Regenerate

Regenerating an image message re-runs image generation (not text completion)
with `parent_message_id` set: a new image is parented to the existing prompt as
a sibling branch, with no new user turn.

## Billing & export

- Usage is metered like any turn but flagged `operation_type=image_generation`
  with `generated_image_count`. Cost prefers the provider-reported value (the
  chat transport may report it); otherwise an operator per-image price.
- **Export** bundles images: a conversation with images downloads as a `.zip`
  (`conversation.json` + `images/<messageId>-<n>.png`), each referenced by path.
  Text-only exports stay a plain `.json`. Bytes are decrypted client-side first.
