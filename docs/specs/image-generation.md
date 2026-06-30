# Image Generation — Product & Architecture Spec

**Status:** Implemented — see
[`business_processes/image-generation.md`](../business_processes/image-generation.md) for how the
shipped flow works. This spec is kept as the design record (rationale + decision log).  
**Scope:** Product and technical specification  
**Related docs:**

- `docs/security-model.md`
- `docs/business_processes/message-encryption.md`
- `docs/business_processes/completion-pipeline.md`
- `docs/specs/backend-model-selector.md`

## 0. Decision Log

Resolved after reviewing the live backend and frontend code:

- **Storage backend**: Encrypted image bytes are stored in a **PocketBase protected file
  field**, not external object storage (no object store exists today). Protected files are not
  publicly addressable; access is enforced through PocketBase access rules tied to conversation
  participation, plus short-lived file tokens. Even though the bytes are already ciphertext, the
  user stays in complete control of who can fetch their files. S3 can back PocketBase storage
  later via configuration without code changes.
- **Encryption model**: Reuse the existing message scheme exactly. The server holds only a
  conversation **public** key and encrypts with an anonymous sealed box (`box.SealAnonymous`); it
  cannot decrypt. Clients decrypt with the conversation secret key. There is no new
  `conversation-attachment-v1` scheme and no server-side decryption (see §7.4).
- **Two transports, selected per model**: The provider spike (against live Requesty) established
  that image generation is **not one path**. Requesty exposes two, chosen by model:
    - **Images API** (`POST /v1/images/generations`) for OpenAI `gpt-image-*`. Returns
      `data[].b64_json`. Proven end-to-end.
    - **Chat Completions** (`POST /v1/chat/completions`) for Google Gemini `*-flash-image-*` (the
      ZDR/EU-eligible models). The image returns inline at
      `choices[].message.images[].image_url.url` as a `data:` URI.

This is the single biggest correction to the original draft, which assumed one chat-completion
content block. See §7.7 for the gateway design and §7.1/§6.2 for the catalogue field this requires.

- **Bifrost does not model chat image output**: Bifrost (through v1.5.22) has no typed field for
  `message.images[]` on chat responses, so the Gemini image would be dropped. The gateway enables
  Bifrost's per-request `SendBackRawResponse` flag **only** for image-via-chat requests and parses
  the data URI out of the raw provider JSON. The flag is never set for text completions, so raw
  provider plaintext is not captured on the common path. Upgrading Bifrost does not remove this
  need.
- **ZDR drove Route B**: the EU-resident, zero-retention image model is Gemini-class, which only
  generates via chat completions — so the chat transport is required, not optional, for ZDR users.
- **Build sequence**: Update this spec first, then ship the model-capability slice (UI/API, no
  crypto) alongside the provider spike, then the encrypted-persistence MVP. (Spike: done — gateway
  image generation, image-flagged billing, and attachment encryption are implemented and tested;
  the gpt-image path is proven against live Requesty, the Gemini chat path is pending a live run.)

## 1. Overview

Cognos will support image generation inside encrypted conversations. Users explicitly enable an
image generation tool from the chat UI, choose a model that supports image generation, and receive
generated images as assistant conversation content.

The privacy rule is unchanged from text messages: generated content may be processed in plaintext
transiently while the request is active, but it must be encrypted before any durable persistence.
Generated image bytes must never be stored as plaintext in PocketBase, object storage, logs,
analytics, or billing records.

Image generation support is model-specific. A model may support normal text chat without supporting
image generation. The model catalogue must expose this capability so the UI can warn users and help
them switch models without silently changing their selected model.

## 2. Target Audience

Primary users:

- Cognos chat users who want to generate images from text prompts while keeping conversation history
  encrypted at rest.
- Users who switch models mid-conversation and need clear capability feedback before using image
  generation.
- Privacy-conscious users who expect generated images to follow the same no-plaintext-at-rest rules
  as chat messages.

Secondary users:

- Operators maintaining the model catalogue and deciding which Requesty-backed models are safe to
  expose.
- Future multimodal feature work that will add image input separately.

## 3. Problem Statement

Cognos currently supports encrypted text conversations, but image generation is not available as a
first-class user action. Some integrated models, including some available through Requesty, support
image generation and others do not. Without explicit model capability metadata, users can select a
model, enable image generation, and only discover incompatibility after a failed request.

Current workaround: users leave Cognos or manually use a separate image tool. This breaks the
conversation flow and stores generated images outside Cognos' encrypted conversation model.

Cost of not solving it:

- users cannot keep generated images in the same encrypted conversation history as the prompt that
  created them;
- unsupported-model failures feel arbitrary;
- model capability rules get duplicated or hard-coded in the frontend;
- future image input work risks conflating input vision support with output image generation.

## 4. Goals

- Let users explicitly enable image generation from the chat composer.
- Expose model-level image generation capability through the backend model catalogue.
- Warn users when image generation is enabled but the selected model is unsuitable.
- Make suitable models visually identifiable when image generation is enabled.
- Allow users to switch models mid-conversation before sending an image generation request.
- Persist generated images only as encrypted objects, with encrypted message metadata pointing to
  them.
- Reuse the existing conversation encryption model and the existing UI Angular image conversation
  component.
- Keep image input/vision support out of this slice.

## 5. Non-goals

- Image input, image analysis, or vision prompts. That is a separate feature.
- Image editing, inpainting, variations, masks, or uploaded reference images.
- Auto-switching the user's selected model when image generation is enabled.
- Public image galleries, share pages, or CDN-hosted plaintext images.
- Server-side thumbnailing or metadata extraction from plaintext generated images after storage.
- Reworking the full multimodal attachment architecture beyond what image generation needs.

## 6. Core Features

### 6.1 Image generation tool toggle

- **Description**: Add an explicit composer control that enables image generation for the next
  request.
- **User Story**: As a user, I want to enable image generation intentionally so that Cognos treats
  my next prompt as an image request instead of a normal text answer.
- **Priority**: P0
- **Acceptance Criteria**:
    - The composer has an accessible image generation control.
    - The control is off by default for a new chat session.
    - When enabled, the send action is treated as an image generation request.
    - Turning the control off returns the composer to normal text completion behaviour.
    - The selected model is not changed automatically when the control is enabled.

### 6.2 Model capability flag

- **Description**: Mark each active model with whether it supports image generation.
- **User Story**: As a user, I want Cognos to show which models can generate images so that I can
  choose a compatible model before sending.
- **Priority**: P0
- **Acceptance Criteria**:
    - The backend model catalogue includes `supports_image_generation` for every active model.
    - The frontend model type exposes this as `supportsImageGeneration`.
    - Requesty-backed catalogue seed/import logic preserves provider metadata such as
    `supports_image_generation` when available.
    - `supports_image_generation` is distinct from image input support and does not imply vision.
    - Text-only models continue to appear in the catalogue with `supports_image_generation: false`.
    - For models where `supports_image_generation` is true, the catalogue also records the
      **transport** the backend must use (`images_api` or `chat_completions`, see §7.1). This is a
      backend routing concern; the frontend does not need it.

### 6.3 Unsupported-model alerting

- **Description**: Warn and block image generation when the user enables the tool with an
  unsupported selected model.
- **User Story**: As a user, I want a clear warning when my current model cannot generate images so
  that I can switch models intentionally.
- **Priority**: P0
- **Acceptance Criteria**:
    - If image generation is enabled and the selected model does not support it, the UI shows an
    accessible alert.
    - The alert explains that the current model cannot generate images.
    - The alert points the user to switch to a suitable model.
    - The app does not auto-switch the selected model.
    - The image generation request cannot be submitted while the selected model is unsupported.

### 6.4 Suitable-model highlighting

- **Description**: Make compatible models easy to identify while image generation is enabled.
- **User Story**: As a user, I want image-capable models highlighted so that switching models is
  quick and unsurprising.
- **Priority**: P0
- **Acceptance Criteria**:
    - When image generation is enabled, the model selector visually distinguishes models that
      support
    image generation.
    - Unsupported models remain visible unless an explicit filter is added later.
    - The current privacy-tier eligibility behaviour still applies.
    - Ineligible models are not made selectable just because they support image generation.
    - Model labels/badges are translated through the existing i18n flow.

### 6.5 Backend capability enforcement

- **Description**: Validate image generation capability server-side before calling the provider.
- **User Story**: As a security-conscious operator, I want the backend to enforce model capability
  so that clients cannot bypass UI checks.
- **Priority**: P0
- **Acceptance Criteria**:
    - Image generation requests fail before the gateway call when `supports_image_generation` is
    false.
    - Unsupported requests do not create user or assistant messages.
    - Unsupported requests do not record usage ledger entries.
    - Unsupported requests return a user-safe validation/business error without logging the prompt.
    - The handler validates privacy-tier eligibility and billing access before any paid provider
    request, as the text completion pipeline does.

### 6.6 Encrypted generated image persistence

- **Description**: Store generated images as encrypted attachments referenced by encrypted assistant
  message data.
- **User Story**: As a user, I want generated images stored in my conversation without plaintext
  persistence so that images receive the same privacy treatment as messages.
- **Priority**: P0
- **Acceptance Criteria**:
    - Provider image bytes are encrypted before writing to the PocketBase protected file field or
      any other durable store.
    - PocketBase message data stores only encrypted assistant message payloads.
    - The assistant message payload can reference encrypted image attachment objects.
    - Attachment files are **protected**: not publicly addressable, and readable only by
      conversation participants through PocketBase access rules and short-lived file tokens.
    - Plain provider image URLs, base64 image payloads, and prompts are not logged.
    - If the attachment write or message persistence fails, no plaintext image artefact remains.

### 6.7 Conversation rendering

- **Description**: Render generated images inside the conversation using the existing UI Angular
  image component.
- **User Story**: As a user, I want generated images to appear in the conversation so that my prompt
  and result stay together.
- **Priority**: P0
- **Acceptance Criteria**:
    - Assistant image messages render through the existing image conversation component
      (`CognosImageGridComponent` / `CognosImageThumbComponent`), which already accept plain
      string URLs.
    - The client requests a short-lived file token, fetches the protected encrypted file, decrypts
      it client-side, and renders it as a `blob:` URL (revoking the URL when no longer displayed).
    - A single image is stored once: the in-conversation "thumbnail" is that same image rendered
      small, and "download full resolution" saves the same decrypted blob. There is no separately
      stored thumbnail artefact.
    - While generation is in flight the composer/message shows an explicit "generating image"
      loading state (image generation does not token-stream like text).
    - Normal text messages continue to render unchanged.
    - A failed image fetch/decrypt shows a non-sensitive error state.
    - Deleted or expired image messages no longer expose their image attachment through first-party
    APIs.

## 7. Technical Design

### 7.1 Model catalogue

Add two backend model fields — the capability flag (user-facing) and the transport (backend
routing, since the spike proved image generation uses two different provider APIs):

```go
SupportsImageGeneration bool   `json:"supports_image_generation"`
// ImageGenerationTransport is "images_api" or "chat_completions". Only meaningful
// when SupportsImageGeneration is true. Backend-only; never sent to the frontend.
ImageGenerationTransport string `json:"-"`
```

Frontend mapping (capability only — the transport is not exposed):

```ts
supportsImageGeneration: boolean
```

Do not overload `content_types` for this. `content_types` is currently tied to message/input media
shape and future image input support. Image generation is an output/tool capability.

Recommended PocketBase fields on `ai_models`:

```txt
supports_image_generation  bool   default false
image_generation_transport select images_api | chat_completions   (only set when the above is true)
```

The transport maps to `gateway.ImageTransport`: OpenAI `gpt-image-*` models use `images_api`;
Google Gemini `*-flash-image-*` models use `chat_completions`. Requesty import/seed data must set
both fields. Manual operator changes remain possible through the catalogue collection.

### 7.2 Request shape

The existing completion endpoint can be extended rather than adding a separate endpoint for the MVP.
The request must include an explicit image generation flag/mode, for example:

```json
{
  "messages": [{ "role": "user", "content": "A watercolor fox in a library" }],
  "model_id": "vertex-gemini-2-5-flash-image-europe-west4",
  "image_generation": true,
  "persona_id": "default",
  "system_prompt": ""
}
```

The exact field name can be chosen during implementation, but it must be explicit and testable. The
backend must not infer image generation from prompt text alone.

The client sends only the boolean flag and the `model_id`; the backend resolves which transport to
use (§7.1, §7.7) from the catalogue. The transport is never client-supplied — a client cannot ask
to route a model differently.

### 7.3 Response and message payload shape

Assistant message data must support image attachments without storing image bytes in the database.
A decrypted assistant message payload can have a shape similar to:

```json
{
  "role": "assistant",
  "model_id": "vertex-gemini-2-5-flash-image-europe-west4",
  "created_at": "2026-06-20T12:00:00Z",
  "content": "",
  "attachments": [
    {
      "id": "att_...",
      "kind": "generated_image",
      "mime_type": "image/png",
      "attachment_record_id": "<pocketbase-record-id>",
      "file_name": "<attachment-id>.enc",
      "width": 1024,
      "height": 1024,
      "sealed_key": "<base64 SealAnonymous(conversationPublicKey, fileSymKey)>"
    }
  ]
}
```

`attachment_record_id` / `file_name` point at the protected PocketBase file; `sealed_key` carries
the per-file symmetric key sealed to the conversation public key (see §7.4). Both live only inside
the encrypted message payload.

The plaintext database row still contains only operational fields already required for messages,
such as conversation, parent message, and expiry. Attachment display metadata belongs inside the
encrypted message payload unless the server must query it. The protected file itself is held on a
PocketBase file field (on the message record or a dedicated `message_attachments` collection),
whose access rules mirror the existing message participant rules so deletion cascades and access
control come for free.

### 7.4 Attachment encryption

Generated images are far larger than message JSON (the `messages.data` column is capped at 1 MB),
so the ciphertext lives in a PocketBase **protected file field** rather than inline in `data`. The
encryption reuses the existing message scheme — the server encrypts to the conversation **public**
key and never decrypts; only clients holding the conversation secret key decrypt.

Required flow:

1. Backend sends the prompt to the selected image-capable provider over the model's transport
   (§7.7).
2. The gateway returns decoded image bytes regardless of transport: the Images API yields
   `data[].b64_json` and the chat path yields a `data:` URI from `message.images[]` (both decoded to
   bytes inside the gateway, see §7.7). If any provider returns a temporary URL instead, the backend
   downloads the bytes immediately and never persists the URL.
3. Backend generates a random per-file symmetric key and encrypts the image bytes in memory with
   NaCl `secretbox` (`secretBox` on the client side).
4. Backend seals that symmetric key to the conversation public key with `box.SealAnonymous`, and
   places the sealed key inside the assistant `MessageRecordData` payload (`sealed_key` in §7.3).
5. Backend writes only the `secretbox` ciphertext to the protected file field.
6. Backend encrypts and persists the assistant message data (which now references the attachment
   and carries the sealed key).
7. Backend returns a response containing message/attachment references, not plaintext image bytes.

Why this shape:

- It matches `chat.EncryptMessageData` / `box.SealAnonymous` exactly — no new scheme, no new key
  custody, and the client already has `openSecretBox` plus sealed-box open.
- The symmetric key is needed because sealed boxes carry per-message overhead and the image is
  large; sealing only the small key keeps the heavy ciphertext as one `secretbox` blob.
- Neither the symmetric key nor the plaintext is ever stored in a plaintext column, file metadata,
  or logs. The server can encrypt but, lacking the conversation secret key, cannot decrypt.

### 7.5 Failure handling

- If provider generation fails before any message is persisted, return an upstream error and persist
  nothing.
- If the user message has already been persisted and provider generation fails, delete the user
  message as the text completion pipeline does.
- If encryption or the protected file write fails after provider success, return an internal error
  and ensure no plaintext image remains. Encrypted orphan files may be cleaned up asynchronously.
- If assistant message persistence fails after the encrypted file write succeeds, delete the user
  message and schedule encrypted file cleanup. (If the file is a field on the message record, this
  cascades automatically.)

### 7.6 Billing and analytics

Image generation usage must not store prompt text, generated image content, provider image URLs, or
plaintext attachment metadata.

Usage/analytics records must capture only operational billing fields such as:

- request ID/event ID;
- billing user ID, not raw user ID;
- model ID and provider ID;
- content type or operation type: `image_generation`;
- generated image count;
- provider-reported cost when available;
- final billed cost in USD/CHF/rappen;
- latency and success/failure class.

**Cost source differs by transport** (a spike finding):

- **Images API** (`gpt-image-*`): the response carries **no cost** — only token counts
  (`ImageUsage` has no `Cost` field). So provider-reported cost is unavailable on this path and the
  model **must** have an operator-managed price (per image, or via image token rates) before it can
  be enabled for paid users.
- **Chat Completions** (Gemini): the response **may** carry `usage.Cost.TotalCost`. When present,
  prefer it and apply the existing margin, exactly as the text pipeline does; otherwise fall back to
  the operator-managed price. (Whether Gemini-via-Requesty actually reports cost is confirmed by the
  live integration run.)

The gateway already maps these: the Images API path leaves `ProviderCostUSD` nil; the chat path
sets it from `usage.Cost.TotalCost` when available. `BillingService.CalculateCost` already prefers
`ProviderCostUSD` when non-nil and falls back to token pricing.

The current `billing_ledger` meters purely on input/output tokens and has no operation-type or
image-count column. This slice already adds `operation_type` (`image_generation`) and
`generated_image_count` to the in-memory usage record (`billing.UsageRecord`); the remaining work is
the matching ledger columns/migration and a per-image pricing branch in `CalculateCost` for models
without a provider-reported cost.

### 7.7 Gateway/provider path (implemented in the spike)

The gateway exposes one method, `Client.GenerateImage(ctx, ImageRequest) (ImageResponse, error)`,
which dispatches on `ImageRequest.Transport`. Both transports return decoded image **bytes** plus a
`Usage`, so the caller (and §7.4 persistence) is transport-agnostic.

**Images API transport** (`images_api`, default — OpenAI `gpt-image-*`):

- Calls Bifrost's dedicated `ImageGenerationRequest` (`POST /v1/images/generations`).
- Requests `response_format=b64_json` so the bytes return **inline** — we never receive or persist a
  temporary provider URL.
- Reads `data[].b64_json`; usage carries token counts only (no provider cost — see §7.6).

**Chat Completions transport** (`chat_completions` — Google Gemini `*-flash-image-*`, the ZDR path):

- Calls Bifrost's `ChatCompletionRequest` (`POST /v1/chat/completions`) with the prompt as a single
  user message.
- Bifrost's typed chat response has **no field** for generated images (true through v1.5.22), so the
  gateway sets Bifrost's `SendBackRawResponse` flag **per request** (via the
  `BifrostContextKeySendBackRawResponse` context key — never globally, so raw provider plaintext is
  not captured on the text-completion path) and parses the image out of the raw provider JSON at
  `choices[].message.images[].image_url.url` (a `data:image/...;base64,...` URI, decoded to bytes).
- Usage is read from the typed response and includes `ProviderCostUSD` when Bifrost reports
  `usage.Cost.TotalCost`.

Both paths log only structured, non-sensitive error fields (status/type/code) — never the prompt,
the free-text provider message (which can echo the prompt), or any image bytes.

Verification status: the Images API path is proven against live Requesty
(`azure/openai/gpt-image-1`, returns a ~2.2 MB PNG). The chat path has unit coverage against a
stubbed raw response and a gated integration test (`REQUESTY_IMAGE_TRANSPORT=chat_completions`)
pending a live run for final confirmation of the response shape and whether cost is reported.

## 8. Non-Functional Requirements

- **Performance**: A successful image generation request must add no more than 2 seconds of Cognos
  overhead after the provider returns the image bytes for encryption, protected-file write, and
  message persistence for one generated image up to the MVP size limit.
- **Security**: Generated image bytes, provider URLs, prompts, and decrypted attachment metadata
  must not be logged. Durable storage may contain only ciphertext and minimal operational metadata.
- **Scalability**: Image bytes must be stored in a PocketBase protected file field (filesystem
  now, S3-backed via configuration later), never inline in the `messages.data` column or any other
  SQLite text column. The database stores encrypted message payloads and opaque file references
  only.
- **Reliability**: Failed image generation requests must not leave plaintext artefacts or unanswered
  user messages in the conversation. Encrypted orphan cleanup is acceptable as a background task.
- **Accessibility**: The image generation control, unsupported-model alert, model badges, image
  loading state, and image failure state must be keyboard-accessible and screen-reader-readable.
- **Internationalisation**: All user-visible strings must be translated for every supported
  frontend locale.

## 9. Success Metrics

| Metric                               | Target                                                                                                     | Measurement Method                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Unsupported image request prevention | 100% of unsupported selected-model sends are blocked before provider call                                  | Backend integration tests plus frontend E2E           |
| Plaintext persistence regression     | 0 plaintext generated-image bytes, provider URLs, or prompts found in DB/object metadata/log test fixtures | Security-focused integration tests and log assertions |
| Successful render path               | 95% of successful provider image responses render as conversation image messages in test/beta sessions     | Product analytics event without content plus beta QA  |
| Model capability clarity             | 90% of beta users can identify an image-capable model without help                                         | Beta feedback prompt or usability checklist           |

## 10. Timeline & Milestones

| Phase                          | Duration | Deliverables                                                                                                    |
| ------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------- |
| Spec and test plan             | 1–2 days | Finalised spec, backend/frontend/API E2E test cases, encryption checklist                                       |
| Model capability slice         | 2–3 days | `supports_image_generation` catalogue field, API response, frontend model mapping, model-selector UI states     |
| Encrypted image generation MVP | 4–6 days | Gateway image generation path, encrypted object persistence, assistant message attachment payload, UI rendering |
| Hardening                      | 2–3 days | Failure cleanup, billing/analytics fields, i18n pass, security regression tests                                 |

## 11. Risks & Mitigations

| Risk                                                                                     | Impact | Likelihood | Mitigation                                                                                                                                      |
| ---------------------------------------------------------------------------------------- | ------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider returns temporary plaintext image URLs instead of bytes                         | High   | Medium     | Download immediately, never persist URL, encrypt bytes before storage, add log tests for URL leakage                                            |
| Image input and image generation capabilities get conflated                              | Medium | Medium     | Use `supports_image_generation` as a separate field; reserve image input/vision capability for a later spec                                     |
| Large image bytes land in the `messages.data` column instead of the protected file field | High   | Low        | Store bytes only in the protected file field; keep payloads to references + sealed key; add tests that message data never contains image base64 |
| Billing undercharges image generation when provider cost is missing                      | Medium | Medium     | Require configured image generation pricing before enabling a model without provider-reported costs                                             |
| UI auto-switches models and surprises users                                              | Medium | Low        | Make “do not auto-switch” an acceptance criterion and cover it in E2E                                                                           |

## 12. Test Plan

### Browser E2E

- User enables image generation with a supported model, sends a prompt, and sees an image message.
- User enables image generation with an unsupported selected model and sees an alert; send is
  blocked.
- User switches from an unsupported model to a supported model mid-conversation and can send.
- User disables image generation and can send a normal text completion with the same model — but
  only when that model supports text completion. An image-generation-only model (e.g.
  `gemini-2-5-flash-image`) is _not_ sendable as a text completion: with the image tool off the
  composer blocks the send and offers to re-enable image generation or switch model.
- Image-capable model badges/labels are visible when image generation is enabled.

> The model↔tool coupling — filtering the picker by the current task, auto-switching the model when
> the image tool is toggled, and remembering the user's model per task — is specified in
> [tool-aware-model-selection.md](./tool-aware-model-selection.md).

### Backend integration tests

- `GET /api/v1/models` includes `supports_image_generation` and `supports_text_completion` for every
  model (the image-only model reports `supports_text_completion: false`).
- Image generation request with unsupported model returns an error before gateway invocation.
- Text completion request (`/completions` and `/conversations/{id}/complete`) with an
  image-generation-only model returns a 400 before any persistence or gateway invocation.
- Image generation request with privacy-tier-ineligible model returns the existing eligibility error
  before gateway invocation.
- Successful image generation persists encrypted assistant message data and an encrypted protected
  file.
- Provider failure after user message persistence deletes the user message.
- Protected file write or message persistence failure leaves no plaintext image artefacts.
- A chat-transport (Gemini) image is parsed from the raw provider response and persisted encrypted,
  with no raw provider JSON or `data:` URI written to logs or the database.

### Frontend unit tests

- Model schema parses `supports_image_generation` into `supportsImageGeneration`.
- Composer image generation toggle state is explicit and defaults off.
- Unsupported-model alert state appears only when the toggle is on and the selected model lacks
  support.
- Model selector highlights suitable models without hiding unsupported models by default.
- Existing image conversation component receives decrypted image data/reference in the expected
  format.

### Security regression tests

- Logs do not include prompt text, provider image URLs, base64 image content, or decrypted image
  metadata.
- PocketBase message rows do not contain plaintext image bytes or provider URLs.
- The protected file field receives encrypted bytes only.
- A non-participant cannot fetch another user's attachment file even with a guessed record ID/file
  name (protected-file access rules enforced).
- Analytics and billing events contain model/cost/count metadata only, never content.

## 13. Open Decisions Before Implementation

Resolved (see §0 Decision Log): storage backend (PocketBase protected file field), encryption
model (sealed box to conversation public key, no new scheme), build sequence (spec → capability
slice + spike → MVP). The provider path is now resolved and implemented — **two transports
(`images_api` / `chat_completions`) selected per model** (§7.7), with the Images API proven against
live Requesty and the Gemini chat path pending a live run.

Still open:

- Final request field name: `image_generation`, `tool_mode`, or a more general future-proof tool
  shape.
- Attachment file location: a file field on the `messages` record vs a dedicated
  `message_attachments` collection (affects cascade-delete and access-rule wiring).
- MVP image size/count limits per request.
- Whether generated images must support expiry deletion exactly tied to message expiry in the first
  slice.
- How provider-specific image options such as aspect ratio or size are exposed, if at all, in the
  MVP. (The chat transport supports an optional `image_config` with `aspect_ratio`/`image_size`;
  the Images API supports `size`/`quality`/`output_format`. Neither is wired in the spike.)
- Whether image generation uses the existing `/complete` endpoint with a flag (MVP per §7.2) or a
  dedicated route, given it does not token-stream.
- Confirm whether the Gemini chat transport reports `usage.Cost.TotalCost`; if not, an
  operator-managed per-image price is required for those models too (§7.6).
