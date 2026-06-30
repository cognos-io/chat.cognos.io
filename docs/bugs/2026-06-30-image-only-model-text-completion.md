# Bug: image-only model can be sent through text completion after image tool is disabled

Date: 2026-06-30
Status: fixed
Severity: medium

## Summary

A user can select `gemini-2-5-flash-image`, generate an image, disable the image generation tool,
and then send a normal text prompt while the image model remains selected. The frontend routes the
request to the text completion endpoint, and the backend forwards the image model to the text
completion gateway path. Because this Gemini model is image-generation-only in practice, the
provider errors.

## Reproduction

1. Enable the **Generate image** composer tool.
2. Switch to `gemini-2-5-flash-image`.
3. Send an image prompt and receive an image.
4. Disable the **Generate image** tool.
5. Leave `gemini-2-5-flash-image` selected.
6. Send a text prompt.

## Expected

The app should prevent an image-only model from being used for a normal text completion. The user
should see a clear model/tool mismatch warning before any provider request is made.

## Actual

The composer permits sending, routes to `/api/v1/conversations/{conversationID}/complete`, and the
backend forwards `vertex/gemini-2.5-flash-image@europe-central2` via the text completion gateway
path. The request then fails at the model/provider layer.

## Evidence

- The composer only blocks when an enabled tool is unsupported:
  `frontend/src/app/components/chat/message-form/message-form.component.ts:1341` checks
  `!this.composerTools.selectedModelUnsupported()`.
- `selectedModelUnsupported` only means "image tool on + model lacks image generation":
  `frontend/src/app/services/composer-tools.service.ts:31`.
- Sending copies the image tool state into the request:
  `frontend/src/app/components/chat/message-form/message-form.component.ts:1909`.
- `MessageService` routes to image generation only when `messageRequest.imageGeneration` is true:
  `frontend/src/app/services/message.service.ts:1240`.
- With the tool off, persisted chats use `completeConversationStream`:
  `frontend/src/app/services/message.service.ts:1293`.
- The backend completion handler validates active/eligible model but has no text-generation
  capability guard: `backend/internal/handler/complete.go:309`.
- The completion handler forwards the selected provider model to the text completion gateway:
  `backend/internal/handler/complete.go:563` and `backend/internal/handler/complete.go:572`.
- The catalogue currently marks every active model as text-capable in API metadata:
  `backend/internal/catalogue/pocketbase_repo.go:98` sets
  `ContentTypes: []ContentType{ContentTypeText}`.
- The Gemini image model is explicitly enabled for image generation and mapped to
  `vertex/gemini-2.5-flash-image@europe-central2`:
  `backend/db/migrations/1760000049_enable_gemini_image_model.go:59` and `:61`.
- The image endpoint does guard the opposite direction, rejecting non-image models before gateway
  work: `backend/internal/handler/image.go:152`.

## Root cause

The model catalogue distinguishes "can generate images" (`supports_image_generation`) but does not
distinguish "can answer text completions" from "image-only". As a result, disabling the image tool
removes the only frontend route guard and leaves the selected image model eligible for text
completion.

There is also a stale/incorrect acceptance criterion in `docs/specs/image-generation.md:504` saying:
"User disables image generation and can send a normal text completion with the same model." That is
only valid for multimodal models that support both text completion and image generation, not for
image-only models.

## Proposed fix direction

Do not infer text support from `supports_image_generation` or from `content_types: ['text']`.

Add an explicit capability such as `supports_text_completion` or an output-mode enum, then:

1. Mark `gemini-2-5-flash-image` as image-generation-only.
2. Expose enough capability metadata from `/api/v1/models` for the frontend to block sends when the
   image tool is off and the selected model is image-only.
3. Add a backend guard in the text completion handler to reject image-only models before
   billing/persistence/provider calls.
4. Update the image generation spec/test plan to distinguish image-only from models that support
   both text and image generation.
5. Add regression coverage for: image tool off + image-only selected => no frontend send and backend
   rejects direct `/complete` calls.

## Resolution

Added an explicit `supports_text_completion` capability rather than inferring text support from
`supports_image_generation` / `content_types`.

- Catalogue: new `SupportsTextCompletion` field on `catalogue.Model`, read from the new
  `supports_text_completion` column (`backend/internal/catalogue/models.go`,
  `pocketbase_repo.go`). It defaults false on a new record, so a freshly curated image-only model is
  safe by default.
- Migration `1760000064_ai_models_text_completion.go` adds the column and seeds it true for every
  model that is _not_ an image-generation model (same discriminator as the compaction-eligibility
  seed), leaving the image-only `gemini-2-5-flash-image` false.
- Backend guard: the shared completion handler now rejects a model with
  `!SupportsTextCompletion` with a 400 ("This model can't be used for text completion") before any
  billing, persistence or provider call (`backend/internal/handler/complete.go`). This covers both
  `/api/v1/completions` and `/api/v1/conversations/{id}/complete`.
- API metadata: `/api/v1/models` exposes `supports_text_completion`, consumed by the frontend.
- Frontend: `ComposerToolsService.selectedModelTextIncompatible` is true when the image tool is off
  and the selected model is image-only. It blocks `canSendMessage` and the composer tools panel
  shows a warning offering to turn Generate image back on.
- Spec `docs/specs/image-generation.md` updated to distinguish image-only models from
  text+image models.
- Regression coverage: `e2e/tests/completions-api.spec.ts` (rejects image-only model on both the
  non-persisted and persisted paths, asserts nothing is persisted), the
  `/api/v1/models` assertion in `e2e/tests/image-generation-api.spec.ts`, and unit tests in
  `composer-tools.service.spec.ts`.
