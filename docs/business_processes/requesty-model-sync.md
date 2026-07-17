---
description: How Requesty's available Models are mirrored without overwriting local operator controls
name: requesty-model-sync
---

# Requesty Model Sync

Models change often: new ones appear, old ones retire, prices move and context
windows grow. The backend mirrors the Models exposed by Requesty's authenticated
model API and refreshes Provider-owned metadata without overwriting local
operator intent.

## Ownership and precedence

| Requesty-owned and synchronised                      | Local/operator-owned and preserved                  |
| ---------------------------------------------------- | --------------------------------------------------- |
| `provider_available`                                 | `enabled`, `whitelisted`                            |
| pricing, context and maximum output                  | existing name, description, display name and tags   |
| vision, tool, computer-use and web-search capability | existing privacy tier and hosting fields            |
| initial description and release date for new Models  | corrected release dates and reasoning overrides     |

A Model is exposed only when `enabled`, `whitelisted`, and
`provider_available` are all true. Therefore:

- disabling a Model locally always wins, even while Requesty exposes it;
- removing or disabling it in Requesty makes it unavailable without erasing
  the local `enabled` value;
- re-enabling it in Requesty restores availability only when the local controls
  still permit it.

New Models start enabled and whitelisted. Requesty `geolocation == "eu"` gives
them the `eu` privacy tier; every other or missing value defaults to `global`.
Existing residency remains curated and is never rewritten by the sync.
`supports_web_search` remains stricter: it survives only when geolocation is
exactly `eu`. See [web-search](./web-search.md).

## How it runs

```mermaid
sequenceDiagram
  autonumber
  participant J as Sync (job/CLI)
  participant R as Requesty /v1/models
  participant DB

  J->>R: GET /v1/models (Bearer key)
  R-->>J: models + supports_reasoning, prices, context
  J->>DB: load ai_models where provider = requesty
  loop each upstream Model
    J->>DB: create if unknown; otherwise refresh synced fields
  end
  loop each local Requesty Model
    J->>DB: update provider_available from upstream presence
  end
```

- **Matching**: our `provider_model_id` (e.g. `azure/o4-mini@swedencentral`) is
  matched to a Requesty id by stripping the `@region` suffix and lowercasing, so
  the same model matches across regions.
- **Reasoning tiers** come from Requesty's normalised vocabulary (it maps
  `off/low/medium/high` to OpenAI effort strings or Anthropic/Google thinking
  budgets internally), so one uniform set works on every reasoning model.
- **Two entry points, one implementation** (`internal/catalogue/requestysync`):
  a background job (runs ~once on boot, then every ~6h; never blocks startup or
  fails requests if Requesty is down) and a `sync-requesty-models` CLI
  subcommand (wrapped by `scripts/sync-requesty-models.sh`) for ad-hoc/CI runs.

## Invariants

1. **Separate intent from availability.** Requesty updates
   `provider_available`; operators own `enabled` and `whitelisted`.
2. **Conservative discovery.** Unknown residency becomes `global`, and Models
   without a valid context window are not created.
3. **No clobbering corrections.** Existing curation, release dates and
   reasoning-effort overrides win.
4. **Safe to run anytime.** The sync is idempotent, tolerant of a missing
   Requesty Provider or unavailable API, and guards large absence responses.

See [reasoning-visibility](./reasoning-visibility.md) for how the synced effort
tiers surface in the composer.
