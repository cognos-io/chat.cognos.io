# Image Generation — Product & Architecture Spec

**Status:** Draft  
**Scope:** Product and technical specification, not implementation  
**Related docs:**

- `docs/security-model.md`
- `docs/business_processes/message-encryption.md`
- `docs/business_processes/completion-pipeline.md`
- `docs/specs/backend-model-selector.md`

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
    - Provider image bytes are encrypted before writing to object storage or any other durable
      store.
    - PocketBase message data stores only encrypted assistant message payloads.
    - The assistant message payload can reference encrypted image attachment objects.
    - Plain provider image URLs, base64 image payloads, and prompts are not logged.
    - If object storage write or message persistence fails, no plaintext image artefact remains.

### 6.7 Conversation rendering

- **Description**: Render generated images inside the conversation using the existing UI Angular
  image component.
- **User Story**: As a user, I want generated images to appear in the conversation so that my prompt
  and result stay together.
- **Priority**: P0
- **Acceptance Criteria**:
    - Assistant image messages render through the existing image conversation component.
    - The client fetches encrypted image content and decrypts it client-side before display.
    - Normal text messages continue to render unchanged.
    - A failed image fetch/decrypt shows a non-sensitive error state.
    - Deleted or expired image messages no longer expose their image attachment through first-party
    APIs.

## 7. Technical Design

### 7.1 Model catalogue

Add a backend model field:

```go
SupportsImageGeneration bool `json:"supports_image_generation"`
```

Frontend mapping:

```ts
supportsImageGeneration: boolean
```

Do not overload `content_types` for this. `content_types` is currently tied to message/input media
shape and future image input support. Image generation is an output/tool capability.

Recommended PocketBase field on `ai_models`:

```txt
supports_image_generation bool default false
```

Requesty import/seed data must map the upstream `supports_image_generation` value into this field.
Manual operator changes remain possible through the catalogue collection.

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
      "storage_key": "attachments/<opaque-billing-prefix>/<attachment-id>.enc",
      "width": 1024,
      "height": 1024,
      "encryption": {
        "scheme": "conversation-attachment-v1"
      }
    }
  ]
}
```

The plaintext database row still contains only operational fields already required for messages,
such as conversation, parent message, and expiry. Attachment display metadata belongs inside the
encrypted message payload unless the server must query it.

### 7.4 Attachment encryption

Generated images are larger than normal message JSON, so store them outside PocketBase as encrypted
objects.

Required flow:

1. Backend sends the prompt to the selected image-capable provider.
2. Provider returns image bytes or a temporary provider URL.
3. If a temporary URL is returned, backend downloads the bytes immediately and does not persist the
   URL.
4. Backend encrypts the image bytes in memory before durable write.
5. Backend writes only ciphertext to object storage.
6. Backend encrypts and persists the assistant message data with the attachment reference.
7. Backend returns a response containing message/attachment references, not plaintext image bytes.

Recommended encryption pattern:

- generate a random per-attachment symmetric key;
- encrypt image bytes with an authenticated symmetric cipher;
- include the per-attachment decrypt material only inside the encrypted assistant message payload,
  or wrap it with conversation key material using the same conversation access model;
- never store the decrypt material in plaintext columns or object metadata.

### 7.5 Failure handling

- If provider generation fails before any message is persisted, return an upstream error and persist
  nothing.
- If the user message has already been persisted and provider generation fails, delete the user
  message as the text completion pipeline does.
- If encryption or object storage fails after provider success, return an internal error and ensure
  no plaintext image remains. Encrypted orphan objects may be cleaned up asynchronously.
- If assistant message persistence fails after encrypted object storage succeeds, delete the user
  message and schedule encrypted object cleanup.

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

If a provider does not report image generation cost, the model catalogue needs an operator-managed
image generation price before the model can be enabled for paid users.

## 8. Non-Functional Requirements

- **Performance**: A successful image generation request must add no more than 2 seconds of Cognos
  overhead after the provider returns the image bytes for encryption, object upload, and message
  persistence for one generated image up to the MVP size limit.
- **Security**: Generated image bytes, provider URLs, prompts, and decrypted attachment metadata
  must not be logged. Durable storage may contain only ciphertext and minimal operational metadata.
- **Scalability**: Image files must be stored in object storage, not PocketBase/SQLite. The database
  stores encrypted message payloads and opaque object references only.
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

| Risk                                                                | Impact | Likelihood | Mitigation                                                                                                          |
| ------------------------------------------------------------------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| Provider returns temporary plaintext image URLs instead of bytes    | High   | Medium     | Download immediately, never persist URL, encrypt bytes before storage, add log tests for URL leakage                |
| Image input and image generation capabilities get conflated         | Medium | Medium     | Use `supports_image_generation` as a separate field; reserve image input/vision capability for a later spec         |
| Large image bytes are accidentally stored in PocketBase             | High   | Low        | Store only encrypted object references in message payloads; add tests that message data never contains image base64 |
| Billing undercharges image generation when provider cost is missing | Medium | Medium     | Require configured image generation pricing before enabling a model without provider-reported costs                 |
| UI auto-switches models and surprises users                         | Medium | Low        | Make “do not auto-switch” an acceptance criterion and cover it in E2E                                               |

## 12. Test Plan

### Browser E2E

- User enables image generation with a supported model, sends a prompt, and sees an image message.
- User enables image generation with an unsupported selected model and sees an alert; send is
  blocked.
- User switches from an unsupported model to a supported model mid-conversation and can send.
- User disables image generation and can send a normal text completion with the same model.
- Image-capable model badges/labels are visible when image generation is enabled.

### Backend integration tests

- `GET /api/v1/models` includes `supports_image_generation` for every model.
- Image generation request with unsupported model returns an error before gateway invocation.
- Image generation request with privacy-tier-ineligible model returns the existing eligibility error
  before gateway invocation.
- Successful image generation persists encrypted assistant message data and encrypted object
  content.
- Provider failure after user message persistence deletes the user message.
- Object storage or message persistence failure leaves no plaintext image artefacts.

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
- Object storage receives encrypted bytes only.
- Analytics and billing events contain model/cost/count metadata only, never content.

## 13. Open Decisions Before Implementation

- Final request field name: `image_generation`, `tool_mode`, or a more general future-proof tool
  shape.
- Exact attachment encryption primitive and metadata format, aligned with existing frontend crypto
  utilities.
- MVP image size/count limits per request.
- Whether generated images must support expiry deletion exactly tied to message expiry in the first
  slice.
- How provider-specific image options such as aspect ratio or size are exposed, if at all, in the
  MVP.
