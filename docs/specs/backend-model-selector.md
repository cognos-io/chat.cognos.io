# Cognos Model Selection & Security Rework — Architecture Specification & Implementation Roadmap

**Version:** 1.2 **Status:** In progress **Stack:** Go (backend), Angular (frontend),
PocketBase/SQLite (primary store), DuckDB + Parquet/S3 (analytics)

> **Authoritative auth/unlock model → `docs/security-model.md`.** This spec
> predates the `account_key_v2` cutover. In the implemented model the
> **password authenticates sign-in**, the **Account Key alone unlocks encrypted
> data**, and **losing the Account Key means encrypted data is unrecoverable**
> (the password is resettable and never derives a data key). Where this document
> says "password + Account Key" for unlock, read it as: sign in with the
> password, then unlock with the Account Key.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture Overview](#2-system-architecture-overview)
3. [Technology Stack & Dependencies](#3-technology-stack--dependencies)
4. [Module Definitions](#4-module-definitions)
   - 4.1 [Model Catalogue](#41-model-catalogue)
   - 4.2 [Internal LLM Gateway Abstraction](#42-internal-llm-gateway-abstraction)
   - 4.3 [Encryption & Message Storage](#43-encryption--message-storage)
   - 4.4 [Billing & Balance](#44-billing--balance)
   - 4.5 [Analytics & Usage Events](#45-analytics--usage-events)
   - 4.6 [Multi-modal Attachment Support](#46-multi-modal-attachment-support)
5. [Database Schemas](#5-database-schemas)
   - 5.1 [PocketBase / SQLite Tables](#51-pocketbase--sqlite-tables)
   - 5.2 [Analytics Schema (DuckDB / Parquet)](#52-analytics-schema-duckdb--parquet)
6. [API Endpoints](#6-api-endpoints)
7. [Data Flow — Step by Step](#7-data-flow--step-by-step)
8. [Go Package Structure](#8-go-package-structure)
9. [Implementation Roadmap](#9-implementation-roadmap)
10. [Environment Variables & Configuration](#10-environment-variables--configuration)
11. [Testing Requirements](#11-testing-requirements)
12. [Security & Privacy Rules](#12-security--privacy-rules)
13. [Confirmed Decisions & Amendments (June 2026)](#13-confirmed-decisions--amendments-june-2026)
14. [Current Codebase Index (Relevant Files)](#14-current-codebase-index-relevant-files)
15. [Documentation Changes Required](#15-documentation-changes-required)

---

## 1. Project Overview

### What is Cognos?

Cognos is an encrypted AI chat application. It works on the same privacy principle as ProtonMail:

- Each Account holder generates a **public/private key pair** on their device.
- The **public key** is stored on the server.
- The **private key is encrypted client-side** and may be backed up to the server to support
  cross-device access.
- Unlocking a new device requires the Account holder's **Account Key** (after signing in with the
  account password): the password authenticates, while the Account Key alone unlocks the encrypted
  key material. Trusted devices may cache a **locally wrapped unlock blob** until the Account holder
  locks the account, logs out, or clears browser storage.
- Each conversation has its own **conversation-scoped key material** so the product is built for
  future sharing from the start.
- The backend encrypts persisted chat content with the **conversation's public encryption
  material**, while participant access to the decrypting key material is wrapped per participant.
- The Account holder's device downloads encrypted messages and **decrypts them locally** after
  unwrapping the conversation key material it is allowed to access.

The result: the server stores only ciphertext. Even if the database is compromised, Account holder
conversations cannot be read.

### What this document covers

This document specifies the **backend and frontend rearchitecture** of Cognos. The primary goals
of this work are:

1. Introduce a **model selection system** that allows Account holders to choose AI models based on
   their privacy preferences.
2. Introduce a **Cognos-owned LLM gateway abstraction** so providers can be added or swapped
   without changing handler code. Bifrost is the first planned adapter, not the only possible
   implementation.
3. Implement a **billing system** supporting pay-as-you-go (PAYG) and flat-rate subscriptions,
   with balances and plan changes managed manually for now.
4. Implement an **analytics pipeline** that captures token usage and costs with no Account
   holder-identifiable content.
5. Lay groundwork for **multi-modal support** (images, documents, audio) arriving in 3–6 months.

### What this document does NOT cover

- Authentication/session issuance beyond the key-management changes in this document — assumed to
  be already working in the existing codebase.
- Payment processing (Stripe, Paddle, or similar) — a separate integration task.
- Deployment / infrastructure provisioning — a separate DevOps task.

---

## 2. System Architecture Overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│  Angular Frontend                                                    │
│  - Unlocks encrypted private key locally                            │
│  - Unwraps conversation key material for accessible conversations   │
│  - May cache a wrapped unlock blob locally on trusted devices       │
│  - Decrypts incoming ciphertext locally                             │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ HTTPS
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Go Backend (this codebase)                                          │
│                                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  ┌───────────┐ │
│  │  Chat       │  │  Billing     │  │  Analytics │  │  Models   │ │
│  │  Handler    │  │  Service     │  │  Emitter   │  │  Registry │ │
│  └──────┬──────┘  └──────┬───────┘  └─────┬──────┘  └─────┬─────┘ │
│         │                │                 │                │        │
│         └────────────────┴─────────────────┴────────────────┘        │
│                          │                                            │
│                ┌─────────▼─────────┐                                  │
│                │  Gateway Client   │                                  │
│                │  (internal iface) │                                  │
│                └─────────┬─────────┘                                  │
│                          │                                            │
│                ┌─────────▼─────────┐                                  │
│                │ Gateway Adapter   │                                  │
│                │ (Bifrost first    │                                  │
│                │ candidate, swappable)                               │
│                └─────────┬─────────┘                                  │
└──────────────────────────┼──────────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   Infomaniak (CH)    Mistral (EU)    Anthropic / OpenAI / Google
   DeepInfra          (+ others)      (Tier 3 only)


┌─────────────────────────────────────────────────────────────────────┐
│  Storage Layer                                                       │
│                                                                      │
│  PocketBase / SQLite          DuckDB → Parquet → S3                 │
│  ┌────────────────────────┐   ┌──────────────────────────────────┐  │
│  │ users                  │   │ usage_events                     │  │
│  │ conversations          │   │ (anonymous, no content)          │  │
│  │ conversation_participants│ │ billing_user_id, model_id        │  │
│  │ conversation_access_keys│ │ tokens, cache, provider cost      │  │
│  │ messages (ciphertext)   │ │ cost_chf, plan_type               │  │
│  │ user_billing            │ └──────────────────────────────────┘  │
│  │ balance_transactions    │                                        │
│  └────────────────────────┘                                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Key design principles

| Principle                                        | Implementation                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| No plaintext Account holder content at rest      | All message content encrypted before persistence                               |
| Build for sharing now                            | Conversation-scoped key material with per-participant wrapped access           |
| Preserve operational chat behavior               | Threading and expiry stay first-class in the schema and API                    |
| No Account holder-identifiable data in analytics | Analytics events use opaque `billing_user_id` only                             |
| Single swappable gateway abstraction             | Cognos-owned gateway interface; Bifrost is an adapter choice, not the contract |
| Easy model onboarding                            | Model catalogue defined in Go code, no database required                       |
| Extensible to multi-modal                        | Attachment array in encrypted payload; content type fields in usage analytics  |

---

## 3. Technology Stack & Dependencies

### Core dependencies (Go modules)

Add the required dependencies to `go.mod` as each phase lands. Exact versions should be pinned
after initial `go get`.

| Dependency             | Purpose                                         | Import path                              |
| ---------------------- | ----------------------------------------------- | ---------------------------------------- |
| PocketBase             | Primary database + auth                         | `github.com/pocketbase/pocketbase`       |
| DuckDB Go driver       | Analytics writes                                | `github.com/marcboeker/go-duckdb`        |
| AWS SDK v2 (S3)        | Parquet upload to S3                            | `github.com/aws/aws-sdk-go-v2`           |
| Apache Arrow / Parquet | Write Parquet files                             | `github.com/apache/arrow/go/v17/parquet` |
| golang.org/x/crypto    | NaCl / X25519 / symmetric authenticated crypto  | `golang.org/x/crypto`                    |
| Google UUID            | UUID v7 generation                              | `github.com/google/uuid`                 |
| Bifrost core           | Optional first adapter behind the gateway iface | `github.com/maximhq/bifrost/core`        |

> **Note for lead engineer:** Do not let the external adapter define the internal contract.
> Confirm the Bifrost import path from `github.com/maximhq/bifrost` only when implementing the
> Bifrost adapter.

### External services

| Service               | Purpose                       | Notes                                                                                      |
| --------------------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| Infomaniak AI         | Tier 1 provider (Switzerland) | OpenAI-compatible API. Requires product ID in URL.                                         |
| Mistral API           | Tier 2 provider (Europe)      | Standard OpenAI-compatible.                                                                |
| Anthropic API         | Tier 3 provider               | Native Anthropic format; gateway adapter normalises it.                                    |
| OpenAI API            | Tier 3 provider               | Reference format.                                                                          |
| Google Gemini         | Tier 3 provider (optional)    | Supported via a future adapter.                                                            |
| DeepInfra             | Tier 2 provider               | No data retention. Confirm DPA before enabling.                                            |
| S3-compatible storage | Parquet analytics files       | Use Infomaniak kDrive S3 or equivalent CH-based provider to keep analytics data sovereign. |

### Development tools

| Tool            | Purpose                                                    |
| --------------- | ---------------------------------------------------------- |
| `air`           | Hot reload during development                              |
| `golangci-lint` | Linting                                                    |
| `mockery`       | Interface mocking for tests                                |
| `migrate`       | Database migration runner (if needed alongside PocketBase) |

---

## 4. Module Definitions

This section defines each module in detail. Implement one module at a time in the order shown in the
roadmap (Section 9).

---

### 4.1 Model Catalogue

**Purpose:** Defines which AI models are available, their privacy tier eligibility, pricing, and
provider routing configuration. This is the single source of truth for model information across the
entire backend.

**Location in codebase:** `internal/catalogue/models.go`

**Important:** This is a **code-defined catalogue**, not a database table. Adding a new model means
adding a new entry to the Go slice and redeploying. This is intentional — it gives full control over
which models are live, and avoids a database-driven admin UI at this stage.

#### Privacy tiers

There are exactly three tiers, ordered from most to least restrictive:

| Tier ID   | Name                   | Description                                                                |
| --------- | ---------------------- | -------------------------------------------------------------------------- |
| `ch_only` | Switzerland only       | Models running exclusively on Swiss infrastructure. No data retention.     |
| `eu`      | Europe                 | Models running in EU/EEA or Switzerland. No data retention.                |
| `global`  | Global (Business APIs) | Major commercial APIs. No data retention, but data may transit outside EU. |

An Account holder on `ch_only` can only use models with `ch_only` in their tiers list. An Account
holder on `eu` can use models tagged `eu` or `ch_only`. An Account holder on `global` can use any
model. The tiers are **cumulative downward** — more permissive tiers include all more restrictive
options.

#### Model struct definition

```go
// internal/catalogue/models.go

package catalogue

// PrivacyTier represents an Account holder's chosen privacy level.
// Tiers are hierarchical: ch_only ⊂ eu ⊂ global.
type PrivacyTier string

const (
    TierSwitzerlandOnly PrivacyTier = "ch_only"
    TierEurope          PrivacyTier = "eu"
    TierGlobal          PrivacyTier = "global"
)

// ContentType represents the kinds of input/output a model supports.
type ContentType string

const (
    ContentTypeText     ContentType = "text"
    ContentTypeImage    ContentType = "image"     // image input (vision)
    ContentTypeAudio    ContentType = "audio"     // audio input (transcription)
    ContentTypeDocument ContentType = "document"  // document/PDF input
)

// Model describes a single AI model available in Cognos.
type Model struct {
    // ID is the unique identifier used internally and in API requests.
    // Use kebab-case. Example: "llama-3-3-infomaniak"
    ID string

    // DisplayName is shown to the Account holder in the UI.
    DisplayName string

    // Description is a short Account holder-facing description (1–2 sentences).
    Description string

    // Provider is the internal provider key used by Bifrost.
    // Must match the Bifrost provider configuration.
    Provider string

    // ProviderModelID is the exact model string to pass to the provider API.
    // Example: "llama-3.3-70b-instruct" for Infomaniak.
    ProviderModelID string

    // BaseURL is the API endpoint for this provider.
    // Include trailing slash if required by the provider.
    BaseURL string

    // EligibleTiers lists which privacy tiers may use this model.
    // A model available to ch_only Account holders should list [TierSwitzerlandOnly].
    // A model available to eu and ch_only should list both.
    EligibleTiers []PrivacyTier

    // SupportedContentTypes lists what this model can process.
    // All models must support ContentTypeText.
    SupportedContentTypes []ContentType

    // InputPricePer1MTokens is the provider's cost in USD per 1 million input tokens.
    InputPricePer1MTokens float64

    // OutputPricePer1MTokens is the provider's cost in USD per 1 million output tokens.
    OutputPricePer1MTokens float64

    // DataRegion describes where this model's data is processed.
    // Use ISO 3166-1 alpha-2 country codes or region names: "CH", "EU", "US", "global".
    DataRegion string

    // DataRetention indicates whether the provider retains request/response data.
    // This should be false for ALL models in Cognos.
    // If a provider cannot confirm false, do not add the model.
    DataRetention bool

    // IsActive controls whether this model appears in the API.
    // Set to false to disable a model without removing it from code.
    IsActive bool
}

// ModelsAvailableForTier returns all active models eligible for the given tier.
// The returned slice preserves the order defined in AllModels.
func ModelsAvailableForTier(tier PrivacyTier) []Model {
    var result []Model
    for _, m := range AllModels {
        if !m.IsActive {
            continue
        }
        for _, t := range m.EligibleTiers {
            if t == tier {
                result = append(result, m)
                break
            }
        }
    }
    return result
}

// GetModelByID returns a model by its ID, and a bool indicating whether it was found.
func GetModelByID(id string) (Model, bool) {
    for _, m := range AllModels {
        if m.ID == id {
            return m, true
        }
    }
    return Model{}, false
}

// AllModels is the complete model catalogue.
// To add a new model: append a new Model{} entry to this slice.
// To disable a model: set IsActive: false.
// Never delete entries — set IsActive: false instead, to preserve history.
var AllModels = []Model{
    {
        ID:              "llama-3-3-infomaniak",
        DisplayName:     "Llama 3.3 70B",
        Description:     "Meta's Llama 3.3 model, hosted exclusively in Switzerland by Infomaniak. No data retention.",
        Provider:        "infomaniak",
        ProviderModelID: "llama-3.3-70b-instruct",
        // IMPORTANT: Replace {PRODUCT_ID} with the actual Infomaniak product ID from environment config.
        // Do not hardcode the product ID here — read it from config at startup.
        BaseURL:                "https://api.infomaniak.com/2/ai/{PRODUCT_ID}/openai/v1",
        EligibleTiers:          []PrivacyTier{TierSwitzerlandOnly, TierEurope, TierGlobal},
        SupportedContentTypes:  []ContentType{ContentTypeText},
        InputPricePer1MTokens:  0.20,
        OutputPricePer1MTokens: 0.20,
        DataRegion:             "CH",
        DataRetention:          false,
        IsActive:               true,
    },
    {
        ID:              "mistral-large-2",
        DisplayName:     "Mistral Large 2",
        Description:     "Mistral's flagship model, hosted in Europe. No data retention.",
        Provider:        "mistral",
        ProviderModelID: "mistral-large-latest",
        BaseURL:         "https://api.mistral.ai/v1",
        EligibleTiers:          []PrivacyTier{TierEurope, TierGlobal},
        SupportedContentTypes:  []ContentType{ContentTypeText},
        InputPricePer1MTokens:  2.00,
        OutputPricePer1MTokens: 6.00,
        DataRegion:             "EU",
        DataRetention:          false,
        IsActive:               true,
    },
    {
        ID:              "claude-sonnet-4",
        DisplayName:     "Claude Sonnet 4",
        Description:     "Anthropic's Claude Sonnet 4. Business API — no data retention, but data may transit globally.",
        Provider:        "anthropic",
        ProviderModelID: "claude-sonnet-4-20250514",
        BaseURL:         "https://api.anthropic.com",
        EligibleTiers:          []PrivacyTier{TierGlobal},
        SupportedContentTypes:  []ContentType{ContentTypeText},
        InputPricePer1MTokens:  3.00,
        OutputPricePer1MTokens: 15.00,
        DataRegion:             "global",
        DataRetention:          false,
        IsActive:               true,
    },
    {
        ID:              "gpt-4o",
        DisplayName:     "GPT-4o",
        Description:     "OpenAI's GPT-4o. Business API — no data retention, but data may transit globally.",
        Provider:        "openai",
        ProviderModelID: "gpt-4o",
        BaseURL:         "https://api.openai.com/v1",
        EligibleTiers:          []PrivacyTier{TierGlobal},
        SupportedContentTypes:  []ContentType{ContentTypeText},
        InputPricePer1MTokens:  2.50,
        OutputPricePer1MTokens: 10.00,
        DataRegion:             "global",
        DataRetention:          false,
        IsActive:               true,
    },
    // Add new models below this line. Follow the pattern above exactly.
    // Checklist before adding a model:
    // [ ] Confirm provider has a signed DPA with no data retention
    // [ ] Confirm data region is accurate
    // [ ] Confirm the ProviderModelID string matches the provider's API exactly
    // [ ] Set IsActive: false initially, test in staging, then set true for production
}
```

---

### 4.2 Internal LLM Gateway Abstraction

**Purpose:** Cognos must own the internal gateway contract. Provider routing, usage extraction,
retry behaviour, and cost metadata must be exposed through a Cognos interface so the rest of the
backend does not depend on Bifrost, the OpenAI SDK shape, or any other vendor package.

**Primary location in codebase:** `internal/gateway/`

#### Architectural rule

Handlers and services depend on a Cognos interface. Provider-specific logic lives behind adapters.

```go
// internal/gateway/client.go
package gateway

import "context"

type Message struct {
    Role    string
    Content string
    Name    string
}

type CompletionRequest struct {
    ModelID         string
    ProviderID      string
    ProviderModelID string
    Messages        []Message
    MaxOutputTokens int
}

type Usage struct {
    InputTokens              int64
    OutputTokens             int64
    CacheCreationInputTokens int64
    CacheReadInputTokens     int64
    ProviderCostUSD          *float64
}

type CompletionResponse struct {
    Content string
    Usage   Usage
}

type Client interface {
    Complete(ctx context.Context, req CompletionRequest) (*CompletionResponse, error)
}
```

#### Initial adapter strategy

Phase 1 should introduce:

- `internal/gateway/client.go` — the Cognos-owned interface
- `internal/gateway/bifrost.go` — optional first adapter implementation
- `internal/gateway/mock_client.go` — deterministic test double for handler/service tests

#### Why this order?

- Keeps handler and billing code stable if Bifrost is replaced later.
- Lets us write red/green tests against the contract first.
- Makes it practical to support provider-specific behaviour where usage metadata differs.
- Avoids a second architectural migration when we add or swap providers.

#### Bifrost status

Bifrost remains the first planned adapter because it is Go-native and supports the providers we
care about, but it is an implementation detail behind the gateway interface — not the product
contract.

---

### 4.3 Encryption & Message Storage

**Purpose:** Build the message system for future conversation sharing now, without changing the
privacy posture. Persisted chat content must be encrypted with **conversation-scoped key
material**, not directly against one Account holder's long-term key.

**Primary locations in codebase:** `internal/crypto/`, `internal/store/messages.go`,
`internal/store/conversations.go`

#### Conversation-scoped encryption model

Cognos should treat each conversation as its own cryptographic domain.

**Required properties:**

- the backend can encrypt newly persisted messages without needing a participant's private key
- participants can decrypt conversation history locally on their devices
- sharing a conversation later does not require re-encrypting every message for every participant
- removing a participant rotates future access

#### Preferred implementation for this codebase

Because the backend must encrypt assistant responses before persistence, the simplest compatible
implementation is:

1. each conversation has **conversation key material**
2. the backend stores the **conversation public key** and uses it to encrypt message/title
   ciphertext at write time
3. the conversation's decrypting secret key material is **wrapped per participant** using that
   Participant's Account holder public key
4. the client unwraps the Conversation key material locally after unlocking the Account holder's
   private key

This preserves the current server-side write capability while making the access model participant
based rather than single-user based.

#### Sharing semantics

- **Add participant:** wrap the current conversation decrypting key material for the new
  participant and persist a new access record
- **Remove participant:** rotate the conversation key material and re-wrap it only for remaining
  participants
- **Conversation title:** encrypt with the same conversation-scoped key material as messages
- **Attachments:** store attachment payloads encrypted under conversation-scoped key material, with
  the attachment reference stored in message ciphertext

#### Key backup and device unlock model

The accepted account-level key-management model remains the **1Password-style Account Key model**.

- Users authenticate with their normal **account password**.
- Each Account holder also has a generated high-entropy **Account Key** used when unlocking new
  devices.
- The server may store an **encrypted private-key backup**, but must never store or receive the
  plaintext private key.
- A new device requires both the **account password** and **Account Key** to unlock the encrypted
  private key locally.
- Do **not** derive any vault or unlock key from `sha256(email + password)`.
- Use **Argon2id** with a random per-user salt for password-based derivation.
- **Email changes must not affect cryptographic state.**
- **Password changes must re-wrap stored unlock material, not re-encrypt all messages.**

#### Message payload structure

Before encryption, the backend constructs this JSON payload. **This is never stored in plaintext:**

```go
// internal/crypto/payload.go
package crypto

type MessagePayload struct {
    Content         string       `json:"content"`
    Role            string       `json:"role"`
    ConversationID  string       `json:"conversation_id,omitempty"`
    ParentMessageID string       `json:"parent_message_id,omitempty"`
    ModelID         string       `json:"model_id,omitempty"`
    Provider        string       `json:"provider,omitempty"`
    PrivacyTier     string       `json:"privacy_tier,omitempty"`
    ContentType     string       `json:"content_type"`
    InputTokens     int64        `json:"input_tokens,omitempty"`
    OutputTokens    int64        `json:"output_tokens,omitempty"`
    CacheCreationInputTokens int64 `json:"cache_creation_input_tokens,omitempty"`
    CacheReadInputTokens     int64 `json:"cache_read_input_tokens,omitempty"`
    ProviderCostUSD *float64     `json:"provider_cost_usd,omitempty"`
    Attachments     []Attachment `json:"attachments"`
}

type Attachment struct {
    Type       string `json:"type"`
    StorageKey string `json:"storage_key"`
    MIMEType   string `json:"mime_type"`
    SizeBytes  int64  `json:"size_bytes"`
}
```

#### Plaintext operational metadata that must be preserved

The following fields may remain plaintext in PocketBase because they are required for server-side
behaviour and do not reveal message content on their own:

- `conversation_id`
- `parent_message_id`
- `role`
- `sequence`
- `created_at`
- `expires_at`

Everything else sensitive belongs inside ciphertext.

#### Frontend decryption model

The Angular client must:

1. unlock the Account holder's private key locally
2. fetch the participant's wrapped conversation key material for the conversation
3. unwrap it locally
4. decrypt message/title ciphertext locally

This keeps decryption on the client while allowing the backend to keep encrypting newly generated
assistant messages safely.

---

### 4.4 Billing & Balance

**Purpose:** Track Account holder balances for PAYG Account holders and record all transactions.
Provide the service layer that deducts balance after each completion. In this phase, balances and
plan changes are managed manually by the operator — payment processing is explicitly out of scope.

**Location in codebase:** `internal/billing/service.go`

#### Plans

| Plan        | Monthly fee       | Usage billing                                 | Overage                       |
| ----------- | ----------------- | --------------------------------------------- | ----------------------------- |
| `payg`      | CHF 5.00 base fee | Per token, deducted from balance in real time | Blocked when balance = 0      |
| `flat_rate` | CHF 35.00         | Unlimited within fair use                     | Absorbed silently by business |

#### Cost calculation

Providers charge in USD per 1 million tokens. The backend converts to CHF at the time of each
request using a cached exchange rate (refreshed daily).

If the upstream provider returns an authoritative **provider-reported cost**, store it and use it.
Otherwise derive cost from catalogue pricing.

```text
if provider_cost_usd is present:
    cost_usd = provider_cost_usd
else:
    cost_usd = (input_tokens / 1_000_000 * input_price_per_1m)
             + (output_tokens / 1_000_000 * output_price_per_1m)

cost_chf = cost_usd * usd_to_chf_rate
cost_rappen = round(cost_chf * 100)  // Store as integer to avoid float drift
```

#### Balance storage rules

- Balance is stored as an **integer number of Rappen** (1 CHF = 100 Rappen).
- Never store as a float. This prevents rounding errors accumulating across thousands of
  transactions.
- Example: CHF 15.23 balance = `1523` in the database.
- When displaying to Account holders, divide by 100.

#### Billing service interface

```go
// internal/billing/service.go

package billing

import (
    "context"
    "fmt"
    "time"
)

// PlanType represents an Account holder's subscription plan.
type PlanType string

const (
    PlanPAYG      PlanType = "payg"
    PlanFlatRate  PlanType = "flat_rate"
)

// DeductRequest contains the information needed to perform a billing deduction.
type DeductRequest struct {
    UserID       string
    EventID      string  // The analytics event ID, for audit trail linkage
    CostRappen   int64   // Cost in Rappen (already converted from USD)
    ModelID      string  // For the transaction description shown to the Account holder
    InputTokens  int64
    OutputTokens int64
}

// Service handles all billing operations.
type Service struct {
    db     Database   // Interface to PocketBase/SQLite — see section 5.1
    fxRate FXRateProvider
}

// DeductBalance deducts the cost from a PAYG Account holder's balance.
// For flat_rate Account holders, this records the usage but does NOT deduct.
// Returns an error only if the operation itself fails — insufficient balance
// is handled by pre-checking with CanAfford().
func (s *Service) DeductBalance(ctx context.Context, req DeductRequest) error {
    plan, balance, err := s.db.GetUserBilling(ctx, req.UserID)
    if err != nil {
        return fmt.Errorf("billing: failed to get user billing for %s: %w", req.UserID, err)
    }

    if plan == PlanFlatRate {
        // Flat-rate Account holders: record transaction for internal tracking only.
        // Do not modify balance.
        return s.db.InsertTransaction(ctx, Transaction{
            UserID:      req.UserID,
            Type:        "usage",
            AmountRappen: 0, // No deduction
            EventID:     req.EventID,
            Description: fmt.Sprintf("%s — %d tokens (flat rate)", req.ModelID, req.InputTokens+req.OutputTokens),
            BalanceAfter: balance,
            OccurredAt:  time.Now().UTC(),
        })
    }

    // PAYG: deduct balance.
    newBalance := balance - req.CostRappen
    if err := s.db.DeductAndRecord(ctx, req.UserID, req.CostRappen, Transaction{
        UserID:       req.UserID,
        Type:         "usage",
        AmountRappen: -req.CostRappen,
        EventID:      req.EventID,
        Description:  fmt.Sprintf("%s — %d tokens", req.ModelID, req.InputTokens+req.OutputTokens),
        BalanceAfter: newBalance,
        OccurredAt:   time.Now().UTC(),
    }); err != nil {
        return fmt.Errorf("billing: failed to deduct balance for %s: %w", req.UserID, err)
    }

    return nil
}

// CanAfford checks whether a PAYG Account holder has sufficient balance for an estimated cost.
// Always returns true for flat_rate Account holders.
// estimatedCostRappen should be a conservative estimate (e.g. max context window cost).
func (s *Service) CanAfford(ctx context.Context, userID string, estimatedCostRappen int64) (bool, error) {
    plan, balance, err := s.db.GetUserBilling(ctx, userID)
    if err != nil {
        return false, err
    }
    if plan == PlanFlatRate {
        return true, nil
    }
    return balance >= estimatedCostRappen, nil
}
```

---

### 4.5 Analytics & Usage Events

**Purpose:** Record anonymised token usage and cost data for internal reporting, model cost
analysis, and flat-rate overage monitoring. This data must contain
**no Account holder-identifiable content** — no message text, no conversation IDs, no email
addresses.

**Location in codebase:** `internal/analytics/emitter.go`

#### Privacy design

The only Account holder-adjacent field in an analytics event is `billing_user_id`. This is an
**opaque internal identifier** that:

- Exists in the `user_billing` table in PocketBase.
- Has no direct join path to the `users` table from the analytics database.
- Allows `SUM(cost_chf) GROUP BY billing_user_id` for invoicing.
- Does **not** allow anyone reading the analytics database alone to identify an Account holder.

The analytics database is stored separately from PocketBase. These are two distinct data stores with
no shared connection string.

#### Analytics event struct

```go
// internal/analytics/event.go

package analytics

import "time"

// UsageEvent is written to DuckDB / Parquet after every successful completion.
// It must never contain: message content, conversation IDs, Account holder IDs, email addresses,
// public keys, or any field that could link back to encrypted chat content.
type UsageEvent struct {
    // EventID is a UUID generated per completion. Also stored in balance_transactions
    // as a one-directional audit link.
    EventID string `parquet:"event_id"`

    // OccurredAt is the UTC timestamp of the completion.
    OccurredAt time.Time `parquet:"occurred_at"`

    // BillingPeriod is "YYYY-MM" format. Used for monthly aggregation queries.
    // Example: "2025-09"
    BillingPeriod string `parquet:"billing_period"`

    // BillingUserID is the opaque Account holder billing ID from user_billing.id.
    // This is NOT users.id — it is a separate table's primary key.
    BillingUserID string `parquet:"billing_user_id"`

    // PlanType is "payg" or "flat_rate".
    PlanType string `parquet:"plan_type"`

    // ModelID is the Cognos model ID. Example: "claude-sonnet-4"
    ModelID string `parquet:"model_id"`

    // Provider is the provider name. Example: "anthropic"
    Provider string `parquet:"provider"`

    // PrivacyTier is the Account holder's tier at time of request. Example: "eu"
    PrivacyTier string `parquet:"privacy_tier"`

    // ContentType is "text", "image", "audio", or "document".
    ContentType string `parquet:"content_type"`

    // InputTokens is the number of prompt tokens consumed.
    InputTokens int64 `parquet:"input_tokens"`

    // OutputTokens is the number of completion tokens generated.
    OutputTokens int64 `parquet:"output_tokens"`

    // CacheCreationInputTokens is the number of cache-write tokens reported by the provider.
    CacheCreationInputTokens int64 `parquet:"cache_creation_input_tokens"`

    // CacheReadInputTokens is the number of cache-read tokens reported by the provider.
    CacheReadInputTokens int64 `parquet:"cache_read_input_tokens"`

    // ProviderCostUSD is the provider-reported cost when supplied.
    // Zero means unavailable unless UsedProviderCost is true.
    ProviderCostUSD float64 `parquet:"provider_cost_usd"`

    // UsedProviderCost indicates whether CostUSD came from the upstream provider directly.
    UsedProviderCost bool `parquet:"used_provider_cost"`

    // CostUSD is the final cost used for billing in USD.
    CostUSD float64 `parquet:"cost_usd"`

    // CostCHF is CostUSD converted at the FX rate captured at request time.
    CostCHF float64 `parquet:"cost_chf"`

    // FXRateUSDCHF is the USD→CHF rate used for this conversion. Stored for auditability.
    FXRateUSDCHF float64 `parquet:"fx_rate_usd_chf"`

    // LatencyMS is the time in milliseconds from sending the request to the gateway client
    // to receiving the complete response.
    LatencyMS int64 `parquet:"latency_ms"`

    // --- Multi-modal fields (zero-value until Phase 4) ---

    // ImageCount is the number of images in the request (for image-capable models).
    ImageCount int `parquet:"image_count"`

    // AudioSeconds is the duration of audio input in seconds (for audio models).
    AudioSeconds float64 `parquet:"audio_seconds"`

    // DocumentPageCount is the number of document pages processed.
    DocumentPageCount int `parquet:"document_page_count"`
}
```

#### Analytics storage: DuckDB → Parquet → S3

**Why this stack:**

- **DuckDB** is an embedded database (like SQLite) — no server to run or maintain.
- **Parquet** is a columnar file format ideal for analytics queries.
- **S3-compatible object storage** provides durable, cheap, queryable storage.
- When you outgrow this, ClickHouse can ingest Parquet files natively with zero data migration.
- Use Infomaniak's S3-compatible object storage to keep analytics data sovereign in Switzerland.

**Write strategy:** Accumulate events in an in-memory DuckDB table, then flush to a Parquet file on
S3 every hour (or when buffer reaches 1,000 events, whichever comes first). This minimises S3 API
calls while ensuring data is never more than 1 hour stale.

**Query example (nightly flat-rate overage check):**

```sql
SELECT
    billing_user_id,
    billing_period,
    SUM(cost_chf) AS total_cost_chf,
    COUNT(*) AS request_count
FROM read_parquet('s3://cognos-analytics/events/2025/09/*.parquet')
WHERE
    plan_type = 'flat_rate'
    AND billing_period = '2025-09'
GROUP BY billing_user_id, billing_period
HAVING SUM(cost_chf) > 10.50  -- Alert threshold: 30% of CHF 35 subscription price
ORDER BY total_cost_chf DESC;
```

---

### 4.6 Multi-modal Attachment Support

**Note:** This module is not implemented in Phase 1–3. The groundwork is laid in the data structures
above (the `Attachments []Attachment` field in `MessagePayload`, and the `image_count`,
`audio_seconds`, `document_page_count` fields in `UsageEvent`). This section defines what Phase 4
must implement.

#### Scope of Phase 4

| Feature             | Description                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Image uploads       | User uploads an image; it is stored encrypted in object storage; the image is sent to a vision-capable model alongside the text prompt.      |
| Image generation    | User requests an image; the generated image is stored encrypted in object storage; a reference is included in the assistant message payload. |
| Document uploads    | User uploads a PDF/DOCX; text is extracted server-side, then encrypted and sent to the model.                                                |
| Audio transcription | User uploads an audio file; it is transcribed (e.g. via Whisper on Infomaniak), then the transcript is included in the chat.                 |

#### Storage approach for attachments

Attachments are stored in encrypted form in object storage (same S3 bucket as Parquet, different
prefix). They are encrypted under conversation-scoped key material. The message payload contains
only a `storage_key` reference — the file itself is never in the database.

```text
s3://cognos-storage/
  attachments/
    {user_billing_id}/         ← NOT user_id, to avoid linking
      {attachment_id}.enc      ← Encrypted file content
  analytics/
    events/
      {year}/
        {month}/
          {timestamp}.parquet
```

> **Important:** Use `billing_user_id` (not `users.id`) as the S3 path prefix for attachments. This
> maintains the separation between chat identity and billing identity.

---

## 5. Database Schemas

### 5.1 PocketBase / SQLite Tables

PocketBase manages its own SQLite file. Collections (tables) are defined via PocketBase's admin UI
or migration files. Below are the required collections and their fields.

#### Table: `users` (existing — additions only)

Add the following fields to the existing users collection:

| Field                | Type | Notes                                                                      |
| -------------------- | ---- | -------------------------------------------------------------------------- |
| `public_key`         | Text | Base64-encoded X25519 public key. Set on registration, never updated.      |
| `privacy_tier`       | Text | One of: `ch_only`, `eu`, `global`. Default: `eu`.                          |
| `preferred_model_id` | Text | The Account holder's last selected model ID. Used to pre-select in the UI. |

#### Table: `conversations` (new)

| Field              | Type              | Nullable | Notes                                                                             |
| ------------------ | ----------------- | -------- | --------------------------------------------------------------------------------- |
| `id`               | Text (PK)         | No       | UUID. Generated by backend.                                                       |
| `creator_user_id`  | Text (FK → users) | No       | Creator of the conversation. Not the same thing as the full participant list.     |
| `created_at`       | DateTime          | No       | UTC.                                                                              |
| `updated_at`       | DateTime          | No       | Updated on each new message.                                                      |
| `title_ciphertext` | Text              | Yes      | Optional encrypted conversation title. Same conversation key domain as messages.  |
| `key_version`      | Integer           | No       | Monotonically increasing. Increment when participant removal forces key rotation. |

#### Table: `conversation_participants` (new)

| Field             | Type                      | Nullable | Notes                                                                       |
| ----------------- | ------------------------- | -------- | --------------------------------------------------------------------------- |
| `id`              | Text (PK)                 | No       | UUID.                                                                       |
| `conversation_id` | Text (FK → conversations) | No       |                                                                             |
| `user_id`         | Text (FK → users)         | No       |                                                                             |
| `role`            | Text                      | No       | `owner`, `editor`, or `viewer` (final permission model may start narrower). |
| `added_at`        | DateTime                  | No       | UTC.                                                                        |
| `removed_at`      | DateTime                  | Yes      | Null while active. Set when access is revoked.                              |

#### Table: `conversation_access_keys` (new)

| Field                    | Type                      | Nullable | Notes                                                              |
| ------------------------ | ------------------------- | -------- | ------------------------------------------------------------------ |
| `id`                     | Text (PK)                 | No       | UUID.                                                              |
| `conversation_id`        | Text (FK → conversations) | No       |                                                                    |
| `user_id`                | Text (FK → users)         | No       | Participant receiving access.                                      |
| `key_version`            | Integer                   | No       | Matches `conversations.key_version`.                               |
| `wrapped_key_ciphertext` | Text                      | No       | Conversation decrypting key material wrapped for that participant. |
| `created_at`             | DateTime                  | No       | UTC.                                                               |

#### Table: `messages` (new)

| Field               | Type                      | Nullable | Notes                                                                                                      |
| ------------------- | ------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `id`                | Text (PK)                 | No       | UUID. Generated by backend.                                                                                |
| `conversation_id`   | Text (FK → conversations) | No       |                                                                                                            |
| `parent_message_id` | Text (FK → messages)      | Yes      | Preserve threading. Null for root messages.                                                                |
| `created_at`        | DateTime                  | No       | UTC, second precision only (no milliseconds — avoids timing fingerprinting).                               |
| `expires_at`        | DateTime                  | Yes      | Preserve expiring-message behaviour. Null means non-expiring.                                              |
| `role`              | Text                      | No       | `user` or `assistant`. Stored plaintext — knowing whether a message is from a user or AI is not sensitive. |
| `ciphertext`        | Text                      | No       | Base64-encoded encrypted `MessagePayload`. See Section 4.3.                                                |
| `sequence`          | Integer                   | No       | Message order within the conversation. Monotonically increasing.                                           |

> **Do not add** model_id, token counts, or other sensitive metadata fields to this table.
> Preserve only the minimal plaintext operational metadata needed for ordering, threading, expiry,
> and routing.

#### Table: `user_billing` (new)

| Field             | Type                      | Nullable | Notes                                                        |
| ----------------- | ------------------------- | -------- | ------------------------------------------------------------ |
| `id`              | Text (PK)                 | No       | UUID. This is the `billing_user_id` used in analytics.       |
| `user_id`         | Text (FK → users, unique) | No       | One billing record per user.                                 |
| `plan_type`       | Text                      | No       | `payg` or `flat_rate`.                                       |
| `plan_started_at` | DateTime                  | No       | When the current plan began.                                 |
| `plan_ends_at`    | DateTime                  | Yes      | Null = ongoing. Set when a plan is cancelled or switched.    |
| `balance_rappen`  | Integer                   | No       | PAYG only. Current balance in Rappen. 0 for flat_rate users. |

#### Table: `balance_transactions` (new)

Every change to a PAYG balance is recorded here as an immutable ledger entry. Never update or delete
rows.

| Field                  | Type              | Nullable | Notes                                                                                 |
| ---------------------- | ----------------- | -------- | ------------------------------------------------------------------------------------- |
| `id`                   | Text (PK)         | No       | UUID.                                                                                 |
| `user_id`              | Text (FK → users) | No       |                                                                                       |
| `occurred_at`          | DateTime          | No       | UTC.                                                                                  |
| `type`                 | Text              | No       | `topup` or `usage`.                                                                   |
| `amount_rappen`        | Integer           | No       | Positive for top-up, negative for usage deduction.                                    |
| `balance_after_rappen` | Integer           | No       | Snapshot of balance after this transaction. Enables easy audit.                       |
| `event_id`             | Text              | Yes      | For `usage` rows: the analytics `event_id`. Null for top-ups.                         |
| `description`          | Text              | No       | Human-readable. Example: `"claude-sonnet-4 — 1,203 tokens"` or `"Top-up via Stripe"`. |

---

### 5.2 Analytics Schema (DuckDB / Parquet)

DuckDB does not need a migration file — the schema is inferred from the Parquet files. However, the
Go analytics emitter must write all fields consistently.

The logical schema is:

```sql
CREATE TABLE usage_events (
    event_id            VARCHAR NOT NULL,
    occurred_at         TIMESTAMPTZ NOT NULL,
    billing_period      VARCHAR NOT NULL,     -- "YYYY-MM"
    billing_user_id     VARCHAR NOT NULL,
    plan_type           VARCHAR NOT NULL,     -- "payg" | "flat_rate"
    model_id            VARCHAR NOT NULL,
    provider            VARCHAR NOT NULL,
    privacy_tier        VARCHAR NOT NULL,
    content_type        VARCHAR NOT NULL,     -- "text" | "image" | "audio" | "document"
    input_tokens        BIGINT NOT NULL,
    output_tokens       BIGINT NOT NULL,
    cache_creation_input_tokens BIGINT NOT NULL DEFAULT 0,
    cache_read_input_tokens     BIGINT NOT NULL DEFAULT 0,
    provider_cost_usd   DOUBLE NOT NULL DEFAULT 0,
    used_provider_cost  BOOLEAN NOT NULL DEFAULT FALSE,
    cost_usd            DOUBLE NOT NULL,
    cost_chf            DOUBLE NOT NULL,
    fx_rate_usd_chf     DOUBLE NOT NULL,
    latency_ms          BIGINT NOT NULL,
    -- Multi-modal (zero until Phase 4)
    image_count         INTEGER NOT NULL DEFAULT 0,
    audio_seconds       DOUBLE NOT NULL DEFAULT 0.0,
    document_page_count INTEGER NOT NULL DEFAULT 0
);
```

**Parquet file naming convention:**

```text
s3://cognos-analytics/events/{YYYY}/{MM}/{YYYYMMDD-HHmmss}-{random4chars}.parquet
```

Example: `s3://cognos-analytics/events/2025/09/20250915-143022-a7f2.parquet`

This partitioning means DuckDB can use partition pruning when querying a specific month, which keeps
queries fast as data grows.

---

## 6. API Endpoints

All endpoints are prefixed with `/api/v1/`. Authentication is assumed to be handled by existing
middleware (JWT or PocketBase session token in `Authorization: Bearer` header).

### Models

#### `GET /api/v1/models`

Returns the list of models available for the authenticated Account holder's privacy tier.

**Response:**

```json
{
  "privacy_tier": "eu",
  "models": [
    {
      "id": "llama-3-3-infomaniak",
      "display_name": "Llama 3.3 70B",
      "description": "Meta's Llama 3.3 model, hosted exclusively in Switzerland by Infomaniak.",
      "provider": "infomaniak",
      "data_region": "CH",
      "supported_content_types": ["text"],
      "input_price_per_1m_tokens": 0.2,
      "output_price_per_1m_tokens": 0.2
    },
    {
      "id": "mistral-large-2",
      "display_name": "Mistral Large 2",
      "description": "Mistral's flagship model, hosted in Europe.",
      "provider": "mistral",
      "data_region": "EU",
      "supported_content_types": ["text"],
      "input_price_per_1m_tokens": 2.0,
      "output_price_per_1m_tokens": 6.0
    }
  ]
}
```

**Do not include:** `ProviderModelID`, `BaseURL`, API keys, or any internal routing fields.

---

### Conversations

#### `POST /api/v1/conversations`

Creates a new conversation and its initial participant/access-key records.

**Request body:**

```json
{
  "title_ciphertext": "base64encodedciphertexthere...",
  "wrapped_conversation_key": "base64encodedciphertexthere..."
}
```

**Response:**

```json
{
  "conversation_id": "conv_abc123",
  "created_at": "2025-09-15T14:30:22Z",
  "key_version": 1
}
```

---

#### `GET /api/v1/conversations`

Returns all Conversations accessible to the authenticated Account holder (metadata only — no message
ciphertext).

**Response:**

```json
{
  "conversations": [
    {
      "id": "conv_abc123",
      "created_at": "2025-09-15T14:30:22Z",
      "updated_at": "2025-09-15T15:01:44Z",
      "message_count": 12,
      "key_version": 1
    }
  ]
}
```

---

#### `GET /api/v1/conversations/{id}/messages`

Returns all messages in a conversation. The client decrypts each `ciphertext` locally after
unwrapping its conversation access key.

**Response:**

```json
{
  "conversation_id": "conv_abc123",
  "messages": [
    {
      "id": "msg_001",
      "sequence": 1,
      "parent_message_id": null,
      "role": "user",
      "created_at": "2025-09-15T14:30:22Z",
      "expires_at": null,
      "ciphertext": "base64encodedciphertexthere..."
    },
    {
      "id": "msg_002",
      "sequence": 2,
      "parent_message_id": "msg_001",
      "role": "assistant",
      "created_at": "2025-09-15T14:30:25Z",
      "expires_at": null,
      "ciphertext": "base64encodedciphertexthere..."
    }
  ]
}
```

---

### Chat Completions

#### `POST /api/v1/conversations/{id}/complete`

Sends a user message and receives an AI response. This is the core endpoint.

**Request body:**

```json
{
  "model_id": "llama-3-3-infomaniak",
  "parent_message_id": "msg_002",
  "messages": [
    {
      "role": "user",
      "content": "Hello, how does NaCl encryption work?"
    }
  ]
}
```

> **Security note:** The `messages` array contains **plaintext** message history sent from the
> client. The client decrypts its local message history and sends plaintext to the backend for the
> AI call. The backend immediately encrypts everything after the AI responds — it never persists
> plaintext. This is the accepted tradeoff in the Cognos privacy model (the server sees plaintext
> in-flight, but never at rest).

**Success response:**

```json
{
  "user_message_id": "msg_003",
  "assistant_message": {
    "id": "msg_004",
    "parent_message_id": "msg_003",
    "content": "NaCl box uses X25519 key exchange and authenticated encryption...",
    "model_id": "llama-3-3-infomaniak",
    "created_at": "2025-09-15T14:30:25Z"
  },
  "expires_at": null,
  "usage": {
    "input_tokens": 412,
    "output_tokens": 891,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cost_usd": 0.00026,
    "cost_chf": 0.00024,
    "cost_rappen": 0,
    "used_provider_cost": false
  }
}
```

Note: usage metadata is returned in plaintext for immediate UI use and also stored inside the
assistant message ciphertext for the permanent record.

**Error responses:**

| HTTP code                  | Condition                                                       |
| -------------------------- | --------------------------------------------------------------- |
| `402 Payment Required`     | Trial exhausted or inactive billing state                       |
| `403 Forbidden`            | Requested model not available for Account holder's privacy tier |
| `404 Not Found`            | Conversation not found or Account holder lacks access           |
| `422 Unprocessable Entity` | `model_id` not recognised                                       |
| `503 Service Unavailable`  | Gateway/provider call failed after retries                      |

---

### Billing

#### `GET /api/v1/billing`

Returns the Account holder's current billing status.

**Response (PAYG):**

```json
{
  "plan_type": "payg",
  "balance_chf": 12.34,
  "plan_started_at": "2025-08-01T00:00:00Z"
}
```

**Response (flat rate):**

```json
{
  "plan_type": "flat_rate",
  "plan_started_at": "2025-09-01T00:00:00Z",
  "plan_ends_at": null
}
```

---

#### `GET /api/v1/billing/transactions`

Returns the last 50 transactions for the authenticated Account holder.

**Response:**

```json
{
  "transactions": [
    {
      "id": "txn_xyz",
      "occurred_at": "2025-09-15T14:30:25Z",
      "type": "usage",
      "amount_chf": -0.02,
      "balance_after_chf": 12.34,
      "description": "llama-3-3-infomaniak — 1,303 tokens"
    }
  ]
}
```

---

## 7. Data Flow — Step by Step

This section describes exactly what happens, in order, when an Account holder sends a message.
Engineers should implement this sequence precisely — no steps should be skipped or reordered.

```text
Client (Angular)                    Go Backend                    External
     │                                   │                            │
     │  POST /complete                   │                            │
     │  {model_id, messages[plaintext]}  │                            │
     │──────────────────────────────────►│                            │
     │                                   │                            │
     │                          1. Authenticate Account holder                  │
     │                          2. Resolve conversation access        │
     │                             and current key_version            │
     │                          3. Validate model_id exists           │
     │                          4. Validate model is eligible         │
     │                             for Account holder's privacy_tier            │
     │                          5. [trial / inactive contract] Check  │
     │                             billing gate before provider call   │
     │                             → 402 if trial exhausted/inactive  │
     │                          6. Record start timestamp             │
     │                                   │                            │
     │                                   │  Gateway.Complete()        │
     │                                   │───────────────────────────►│
     │                                   │                            │
     │                                   │◄───────────────────────────│
     │                                   │  response text,            │
     │                                   │  usage, provider cost      │
     │                                   │                            │
     │                          7. Calculate latency_ms               │
     │                          8. Calculate final cost_usd/chf       │
     │                          9. Generate event_id (UUID)           │
     │                         10. Encrypt and persist user message    │
     │                             with conversation public key        │
     │                             + parent_message_id + expires_at    │
     │                         11. Encrypt and persist assistant msg   │
     │                             with conversation public key        │
     │                         12. Record billing transaction          │
     │                             / deduct balance as required        │
     │                         13. Emit usage event                   │
     │                         14. Update conversation.updated_at     │
     │                                   │                            │
     │  200 OK                           │                            │
     │  {assistant_message, usage}       │                            │
     │◄──────────────────────────────────│                            │
     │                                   │                            │
     │  Client decrypts ciphertext       │                            │
     │  after unwrapping conversation    │                            │
     │  key material locally             │                            │
```

### Critical rules for step ordering

- **Balance checks happen before the provider call.** Never call the provider and then discover the
  Account holder is out of balance.
- **Conversation access is resolved before persistence.** An Account holder must not be able to
  write into a conversation they cannot read.
- **Threading and expiry are part of the persistence contract.** `parent_message_id` and
  `expires_at` must survive the rewrite.
- **Billing and message persistence must not silently drift apart.** If a provider call succeeds but
  local persistence fails, surface the failure loudly and investigate immediately.
- **Analytics emission is best-effort.** If the analytics write fails, log it and continue.
- **Never persist the plaintext messages array** sent in the request body. It is used only for the
  gateway call and discarded immediately after.

---

## 8. Go Package Structure

```text
cognos-backend/
├── main.go                          # Entry point. Initialises all services, starts PocketBase.
├── go.mod
├── go.sum
│
├── internal/
│   ├── catalogue/
│   │   ├── models.go                # AllModels slice, Model struct, PrivacyTier consts
│   │   └── models_test.go           # Unit tests: tier filtering, model lookup
│   │
│   ├── gateway/
│   │   ├── client.go                # Cognos-owned gateway interface and request/response types
│   │   ├── bifrost.go               # Optional Bifrost adapter
│   │   ├── bifrost_test.go          # Guarded adapter tests (require API keys in env)
│   │   └── mock_client.go           # Mock for unit/integration tests
│   │
│   ├── crypto/
│   │   ├── payload.go               # MessagePayload, Attachment structs
│   │   ├── encrypt.go               # EncryptPayload()
│   │   └── encrypt_test.go          # Round-trip encryption tests
│   │
│   ├── billing/
│   │   ├── service.go               # DeductBalance(), CanAfford(), FX conversion
│   │   ├── service_test.go
│   │   └── fx_rate.go               # Daily FX rate cache (SNB or ECB feed)
│   │
│   ├── analytics/
│   │   ├── event.go                 # UsageEvent struct
│   │   ├── emitter.go               # DuckDB buffer, Parquet flush, S3 upload
│   │   └── emitter_test.go
│   │
│   ├── store/
│   │   ├── interface.go             # Database interface (for mocking)
│   │   ├── messages.go              # PocketBase message read/write
│   │   ├── conversations.go         # PocketBase conversation read/write
│   │   ├── participants.go          # Conversation participants + wrapped access keys
│   │   └── billing.go               # PocketBase billing read/write
│   │
│   ├── handler/
│   │   ├── models.go                # GET /api/v1/models
│   │   ├── conversations.go         # GET/POST /api/v1/conversations
│   │   ├── complete.go              # POST /api/v1/conversations/{id}/complete
│   │   ├── billing.go               # GET /api/v1/billing, /transactions
│   │   └── middleware.go            # Auth, privacy tier resolution
│   │
│   └── config/
│       └── config.go                # Config struct, env var loading
│
└── jobs/
    └── overage_check.go             # Nightly DuckDB query for flat-rate overage alerting
```

### Package dependency rules

- `handler` may import `catalogue`, `gateway`, `crypto`, `billing`, `analytics`, `store`.
- `gateway` may import `catalogue` only.
- `crypto` must not import any other internal package.
- `billing` may import `store` only.
- `analytics` must not import `store`, `crypto`, `billing`, or `gateway`.
- `catalogue` must not import any other internal package.

These rules prevent circular imports and keep each package independently testable.

---

## 9. Implementation Roadmap

Work must be completed in phase order. Do not begin a phase until all items in the previous phase
are complete and reviewed.

Each phase ends with a **review checkpoint** — the lead engineer must review the output before the
next phase begins.

### Roadmap amendments after codebase review

The current repository already contains a working PocketBase app, a legacy provider proxy,
conversation-key storage, server-backed key material, and first-party API routes. The implementation
plan below must be read with these mandatory amendments:

1. **Rewrite around the first-party API surface.** Do not preserve the old compatibility shape as
   the product contract.
2. **Keep model selection backend-driven.** The backend catalogue remains the source of truth.
3. **Build for sharing now.** Conversation-scoped key material with per-participant wrapping is the
   target architecture, even before shared-conversation UX ships.
4. **Preserve threading and expiry.** The new message schema must keep `parent_message_id` and
   `expires_at` semantics.
5. **Introduce the gateway interface first.** Bifrost may be the first adapter, but handler code
   must depend only on the Cognos gateway contract.
6. **Ship full billing records now.** Follow `docs/specs/billing.md` as the billing contract:
   trial/inactive paths may block, while PAYG is post-paid and should not be blocked for funds.
   `user_billing`, `balance_transactions`, and usage accounting remain in scope now.
7. **Add browser E2E from the start.** Keep it high level and Account holder-flow oriented.

Success criteria for the overall rework:

1. Backend model availability is driven solely by the backend catalogue.
2. Chat completions go through first-party Cognos endpoints only.
3. Message content is stored as ciphertext only while preserving threading and expiry.
4. Conversation encryption is participant based and ready for future sharing.
5. Billing and analytics record token/cache/provider-cost metadata without plaintext content.
6. Cross-device unlock requires the Account Key (after password sign-in).
7. Product copy accurately describes the security model.

---

### Phase 1 — Safety rails, catalogue, and gateway contract

**Goal:** Lock in tests and interfaces before changing persistence or provider wiring.

**Tasks:**

| #   | Task                                                                                  | Package / Area |
| --- | ------------------------------------------------------------------------------------- | -------------- |
| 1.1 | Record backend and frontend baseline failures/successes in the checklist              | docs           |
| 1.2 | Define the gateway interface and deterministic test double                            | `gateway`      |
| 1.3 | Tighten catalogue tests around privacy-tier eligibility and active-model behaviour    | `catalogue`    |
| 1.4 | Keep `/api/v1/models` backend-driven and covered by integration tests                 | `handler`      |
| 1.5 | Add high-level browser E2E scaffolding for login → load models → send message → reply | frontend/e2e   |

**Review checkpoint 1:** The internal contracts are pinned by tests before architecture changes.

---

### Phase 2 — Conversation sharing foundations and message rewrite

**Goal:** Move to conversation-scoped encryption with preserved threading/expiry semantics.

**Tasks:**

| #   | Task                                                                                  | Package / Area |
| --- | ------------------------------------------------------------------------------------- | -------------- |
| 2.1 | Finalise conversation/access-key schema (`conversations`, participants, wrapped keys) | `store`        |
| 2.2 | Finalise `messages` schema with `parent_message_id`, `expires_at`, `sequence`         | `store`        |
| 2.3 | Implement message/title encryption using conversation-scoped key material             | `crypto`       |
| 2.4 | Update conversation/message handlers to enforce access by participant membership      | `handler`      |
| 2.5 | Add integration tests proving ciphertext-only persistence with thread/expiry intact   | backend tests  |
| 2.6 | Add browser E2E for conversation creation, send/reply flow, and history reload        | frontend/e2e   |

**Review checkpoint 2:** The system is sharing-ready at the crypto/schema layer without losing
existing chat behaviour.

---

### Phase 3 — Gateway adapter, billing, and analytics

**Goal:** Route real provider traffic through the gateway interface and fully record usage.

**Tasks:**

| #   | Task                                                                                                   | Package / Area        |
| --- | ------------------------------------------------------------------------------------------------------ | --------------------- |
| 3.1 | Implement the first real gateway adapter (Bifrost or equivalent behind the interface)                  | `gateway`             |
| 3.2 | Capture input/output/cache tokens and provider cost when available                                     | `gateway` / `billing` |
| 3.3 | Add `user_billing` and `balance_transactions` schema and repositories                                  | `store`               |
| 3.4 | Implement trial/inactive affordability checks plus PAYG/unlimited usage recording per billing contract | `billing`             |
| 3.5 | Emit anonymised analytics events with token/cache/provider-cost fields                                 | `analytics`           |
| 3.6 | Add integration tests for trial/inactive gating, PAYG/unlimited usage, and analytics payloads          | backend tests         |
| 3.7 | Extend browser E2E to cover billing-restriction and model-eligibility UX at a high level               | frontend/e2e          |

_Current implementation status:_ PocketBase-backed `user_billing` and `balance_transactions`
repositories are now wired by default in the API app, with transactional trial-balance updates on
usage writes, legacy `flat_rate` rows normalized to `unlimited` on read, and automatic trial
billing bootstrap for newly created Account holders using the configured/default seed amount.

**Review checkpoint 3:** Real provider calls, billing, and analytics all flow through the same
contract and are covered by tests.

---

### Phase 4 — Multi-modal support

**Goal:** Add image upload, image generation, document upload, and audio transcription.

**Tasks:** (high level — a separate detailed spec will be written for Phase 4)

| #   | Task                                                                 |
| --- | -------------------------------------------------------------------- |
| 4.1 | Implement encrypted attachment upload endpoint                       |
| 4.2 | Implement attachment retrieval and decryption (client-side)          |
| 4.3 | Update `complete` handler to include attachments in provider request |
| 4.4 | Add vision model(s) to catalogue                                     |
| 4.5 | Add audio transcription endpoint (Whisper via approved provider)     |
| 4.6 | Update analytics event emission for multi-modal fields               |

---

## 10. Environment Variables & Configuration

All configuration is via environment variables. No secrets in code or config files committed to
version control.

Create a `.env` file locally (gitignored). Use a secrets manager in production.

```bash
# ── Server ──────────────────────────────────────────────
APP_ENV=development                # "development" or "production"
APP_PORT=8090                      # Port for Go/PocketBase to listen on

# ── Infomaniak (Tier 1 — Switzerland) ───────────────────
INFOMANIAK_API_KEY=your_key_here
INFOMANIAK_PRODUCT_ID=your_product_id_here
# Product ID is found in the Infomaniak developer portal after creating an AI Service product.

# ── Mistral (Tier 2 — Europe) ───────────────────────────
MISTRAL_API_KEY=your_key_here

# ── Anthropic (Tier 3) ──────────────────────────────────
ANTHROPIC_API_KEY=your_key_here

# ── OpenAI (Tier 3) ─────────────────────────────────────
OPENAI_API_KEY=your_key_here

# ── Analytics — S3-compatible storage ───────────────────
ANALYTICS_S3_ENDPOINT=https://s3.infomaniak.com   # Or equivalent CH S3
ANALYTICS_S3_BUCKET=cognos-analytics
ANALYTICS_S3_ACCESS_KEY=your_key_here
ANALYTICS_S3_SECRET_KEY=your_key_here
ANALYTICS_S3_REGION=us-east-1                     # Most S3-compatible providers accept this

# ── Attachment storage ───────────────────────────────────
# (Used in Phase 4 only — configure before Phase 4 begins)
ATTACHMENTS_S3_ENDPOINT=https://s3.infomaniak.com
ATTACHMENTS_S3_BUCKET=cognos-storage
ATTACHMENTS_S3_ACCESS_KEY=your_key_here
ATTACHMENTS_S3_SECRET_KEY=your_key_here

# ── FX Rate ─────────────────────────────────────────────
FX_RATE_REFRESH_HOURS=24           # How often to refresh the USD→CHF rate
FX_RATE_FALLBACK_USD_CHF=0.92      # Used if the live fetch fails. Update quarterly.

# ── Billing ─────────────────────────────────────────────
BILLING_BASE_FEE_PAYG_RAPPEN=500          # CHF 5.00 base fee in Rappen
BILLING_MONTHLY_FLAT_RATE_RAPPEN=3500     # CHF 35.00 flat rate in Rappen
FLAT_RATE_ALERT_THRESHOLD_CHF=10.50       # Internal alert if usage exceeds this (30% of flat rate)

# ── Analytics flush settings ────────────────────────────
ANALYTICS_FLUSH_INTERVAL_MINUTES=60      # Flush DuckDB buffer to Parquet every N minutes
ANALYTICS_FLUSH_MAX_EVENTS=1000          # Also flush if buffer reaches this many events
```

```go
// internal/config/config.go

package config

import (
    "fmt"
    "os"
    "strconv"
)

type Config struct {
    AppEnv    string
    AppPort   string

    InfmaniakAPIKey   string
    InfmaniakProductID string
    MistralAPIKey     string
    AnthropicAPIKey   string
    OpenAIAPIKey      string

    AnalyticsS3Endpoint  string
    AnalyticsS3Bucket    string
    AnalyticsS3AccessKey string
    AnalyticsS3SecretKey string
    AnalyticsS3Region    string

    FXRateRefreshHours    int
    FXRateFallbackUSDCHF  float64

    BillingBaseFeeRappen       int64
    BillingFlatRateRappen      int64
    FlatRateAlertThresholdCHF  float64

    AnalyticsFlushIntervalMinutes int
    AnalyticsFlushMaxEvents       int
}

// Load reads all required environment variables.
// Returns an error listing all missing required variables.
func Load() (*Config, error) {
    var missing []string

    required := func(key string) string {
        v := os.Getenv(key)
        if v == "" {
            missing = append(missing, key)
        }
        return v
    }

    optional := func(key, fallback string) string {
        v := os.Getenv(key)
        if v == "" {
            return fallback
        }
        return v
    }

    cfg := &Config{
        AppEnv:  optional("APP_ENV", "development"),
        AppPort: optional("APP_PORT", "8090"),

        InfmaniakAPIKey:    required("INFOMANIAK_API_KEY"),
        InfmaniakProductID: required("INFOMANIAK_PRODUCT_ID"),
        MistralAPIKey:      os.Getenv("MISTRAL_API_KEY"),   // Optional: only needed if Mistral models active
        AnthropicAPIKey:    os.Getenv("ANTHROPIC_API_KEY"), // Optional: only needed if Anthropic models active
        OpenAIAPIKey:       os.Getenv("OPENAI_API_KEY"),    // Optional: only needed if OpenAI models active

        AnalyticsS3Endpoint:  required("ANALYTICS_S3_ENDPOINT"),
        AnalyticsS3Bucket:    required("ANALYTICS_S3_BUCKET"),
        AnalyticsS3AccessKey: required("ANALYTICS_S3_ACCESS_KEY"),
        AnalyticsS3SecretKey: required("ANALYTICS_S3_SECRET_KEY"),
        AnalyticsS3Region:    optional("ANALYTICS_S3_REGION", "us-east-1"),
    }

    if len(missing) > 0 {
        return nil, fmt.Errorf("missing required environment variables: %v", missing)
    }

    // Parse numeric values with defaults
    cfg.FXRateRefreshHours, _ = strconv.Atoi(optional("FX_RATE_REFRESH_HOURS", "24"))
    cfg.FXRateFallbackUSDCHF, _ = strconv.ParseFloat(optional("FX_RATE_FALLBACK_USD_CHF", "0.92"), 64)
    cfg.BillingBaseFeeRappen, _ = parseInt64(optional("BILLING_BASE_FEE_PAYG_RAPPEN", "500"))
    cfg.BillingFlatRateRappen, _ = parseInt64(optional("BILLING_MONTHLY_FLAT_RATE_RAPPEN", "3500"))
    cfg.FlatRateAlertThresholdCHF, _ = strconv.ParseFloat(optional("FLAT_RATE_ALERT_THRESHOLD_CHF", "10.50"), 64)
    cfg.AnalyticsFlushIntervalMinutes, _ = strconv.Atoi(optional("ANALYTICS_FLUSH_INTERVAL_MINUTES", "60"))
    cfg.AnalyticsFlushMaxEvents, _ = strconv.Atoi(optional("ANALYTICS_FLUSH_MAX_EVENTS", "1000"))

    return cfg, nil
}

func parseInt64(s string) (int64, error) {
    return strconv.ParseInt(s, 10, 64)
}
```

---

## 11. Testing Requirements

The detailed branch test plan lives in:

- `docs/specs/backend-model-selector-test-plan.md`

### Testing strategy

- Use **red/green TDD** for each slice.
- Default to **integration tests** for backend request flows.
- Use **unit tests** for security/privacy logic, billing calculation, and catalogue eligibility.
- Add **high-level browser E2E** for Account holder-critical flows.
- Keep browser E2E focused on behaviour, not styling.

### Unit tests

| Area        | Required tests                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| `catalogue` | Tier filtering, inactive exclusion, lookup by ID, eligibility across all tiers                                 |
| `gateway`   | Adapter-independent contract tests using a mock client                                                         |
| `crypto`    | Conversation-key wrapping/unwrapping, ciphertext round trip, invalid key handling, payload fidelity            |
| `billing`   | PAYG deduction, flat-rate no-deduction, insufficient balance, provider-cost precedence, FX conversion accuracy |
| `analytics` | UsageEvent serialisation, cache/provider-cost field handling, flush thresholds                                 |

### Backend integration tests

Backend integration tests should exercise the full first-party HTTP flow with PocketBase and mocked
or guarded external adapters.

| Test                      | What to verify                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| Models API                | Returns active models with eligibility metadata for the authenticated Account holder              |
| Conversation/message flow | Create conversation → send message → persist ciphertext only → list messages with thread metadata |
| Threading and expiry      | `parent_message_id` and `expires_at` survive persistence and retrieval                            |
| Access control            | Non-participants cannot read or write a conversation                                              |
| PAYG balance deduction    | Balance decrements by the correct amount across sequential requests                               |
| Flat-rate accounting      | Usage is recorded without deducting balance                                                       |
| Analytics payload privacy | No plaintext content, email, or conversation IDs leak into analytics events                       |

### Guarded adapter tests

Real provider adapter tests remain valuable but must be optional and explicitly gated.

```bash
RUN_INTEGRATION_TESTS=true go test ./... -tags=integration
```

Guard all provider tests with `RUN_INTEGRATION_TESTS=true`.

### Browser E2E

At minimum, add high-level browser E2E for:

1. authenticated Account holder loads models from the backend
2. authenticated Account holder creates/selects a Conversation
3. authenticated Account holder sends a message and receives a reply
4. conversation history reload still renders decrypted messages
5. trial/inactive billing-restriction flow blocks sending before any completion request is made
6. unavailable-model flow blocks sending before any completion request is made

Do **not** assert on CSS classes or visual minutiae in these tests.

### Linting

Run `golangci-lint run` before every pull request. Zero lint errors permitted.

---

## 12. Security & Privacy Rules

These are non-negotiable. Any PR that violates these rules must be rejected.

| Rule                                                    | Detail                                                                                                                                                                                        |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No plaintext content in database**                    | The `messages` table must never contain readable message text. `ciphertext` column only.                                                                                                      |
| **No Account holder-identifiable content in analytics** | `usage_events` must never contain: Account holder ID, email, Conversation ID, message content, IP address.                                                                                    |
| **Billing user ID isolation**                           | `billing_user_id` (from `user_billing.id`) is used in analytics — NOT `users.id`. These must never be joined from within the analytics database.                                              |
| **No plaintext private key accepted**                   | No endpoint may accept or log a plaintext private key. Encrypted private-key backup ciphertext is allowed, but if a plaintext private key appears in any log treat it as a security incident. |
| **No logging of request content**                       | The `messages` array from the `/complete` request body must never be written to application logs.                                                                                             |
| **Balance as integer**                                  | Balance must be stored as integer Rappen. Float balance storage is forbidden.                                                                                                                 |
| **Atomic balance deduction**                            | Balance deduction and transaction insertion must be a single atomic database operation. Never deduct and then insert separately.                                                              |
| **Provider API keys in env only**                       | No API keys in code, config files, or version control.                                                                                                                                        |
| **Data retention false for all models**                 | Before adding any model to `AllModels`, confirm in writing that the provider has zero data retention.                                                                                         |

---

## 13. Confirmed Decisions & Amendments (June 2026)

This section is the authoritative record of decisions confirmed during planning. Where it conflicts
with earlier wording in this document, **this section wins**.

### 13.1 Scope and architecture decisions

1. **Full rewrite, not a partial adaptation.**
   - Replace the current chat architecture where it blocks the new model, billing, and sharing work.
   - Keep the first-party Cognos API surface as the product contract.
2. **Backend model catalogue is the source of truth.**
   - Models are code-defined.
   - The initial seed is **Infomaniak only**.
   - Additional providers remain out of scope until explicitly approved.
3. **Build for conversation sharing now.**
   - Conversation encryption is conversation-scoped, not single-user scoped.
   - Participant access is represented by wrapped conversation key material.
   - Participant removal requires key rotation for future access.
4. **Preserve threading and expiring-message behaviour.**
   - `parent_message_id` and `expires_at` remain first-class concerns in the schema, handlers, and
     tests.
5. **Own the gateway contract internally.**
   - Handler/service code depends on a Cognos gateway interface.
   - Bifrost is an adapter choice behind that interface, not the contract itself.
6. **Record usage for billing rigorously.**
   - Capture input, output, and cache token counts when available.
   - Capture provider-reported cost when available.
   - Otherwise derive cost from catalogue pricing and the FX rate captured at request time.
7. **Billing records ship now, payments later.**
   - `user_billing` and `balance_transactions` are in scope now.
   - Balances and plan changes are manually administered in this phase.

### 13.2 Key-management decision

Cognos will use a **1Password-style Account Key model**.

- Users keep a normal **account password** for authentication.
- Users also receive a generated high-entropy **Account Key** used to unlock new devices.
- The server may store an **encrypted private-key backup** to support cross-device access.
- The server must never store or receive the **plaintext private key**.
- A **trusted device** may cache locally wrapped unlock material so the Account holder does not need
  to repeatedly enter the Account Key.
- A **new device** signs in with the account password, then requires the **Account Key** to unlock
  the encrypted key material. The password authenticates; the Account Key alone unlocks.
- The Account Key is the deliberate security/usability tradeoff chosen for Cognos.
- We are explicitly **not** using the old wording “private key never leaves your device”.

### 13.3 Password, email, and unlock derivation decisions

- Do **not** use `sha256(email + password)` as a vault or unlock key.
- Use **Argon2id** with a random per-user salt for password-based derivation.
- The Account holder's **email must not be part of cryptographic identity** in a way that makes
  email changes destructive.
- **Password changes** are a pure auth operation — under `account_key_v2` the password is not a
  key input, so a change re-wraps nothing and never re-encrypts messages.
- If the Account holder loses the **Account Key**, encrypted data recovery is impossible (the
  password is resettable and only authenticates). This is an accepted consequence of the chosen
  privacy posture.

### 13.4 Current-state findings that affect implementation

- The product-facing backend completion surface now uses first-party Cognos routes; the legacy
  `/v1/chat/completions` compatibility route has been removed.
- The frontend chat path now uses first-party Cognos APIs instead of the browser `openai` SDK.
- The frontend model list is now backend-driven rather than hard-coded as the primary source of
  truth.
- Current key backup and conversation-key storage live in
  `frontend/src/app/services/vault.service.ts`,
  `frontend/src/app/services/conversation.service.ts`, and related PocketBase collections.
- Existing NaCl usage remains the foundation, with Account Key unlock plus wrapped trusted-device
  storage layered on top.

## 14. Current Codebase Index (Relevant Files)

This is a practical lookup index for the rework.

### Backend

| File                                                                   | Why it matters                                                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `backend/cmd/api/main.go`                                              | PocketBase bootstrap, provider client wiring, migrations, and hook registration.                  |
| `backend/cmd/api/routes.go`                                            | Current first-party route registration and rate limiting.                                         |
| `backend/pkg/compat/openai/openai.go`                                  | Remaining compatibility helpers/history; the product-facing `/v1/chat/completions` route is gone. |
| `backend/pkg/proxy/repo.go`                                            | Current provider dispatch abstraction used by the compatibility layer.                            |
| `backend/internal/chat/repo.go`                                        | Current message encryption/persistence path. Useful for migration and replacement.                |
| `backend/internal/chat/messaging.go`                                   | Current plaintext message payload shape mirrored by the frontend.                                 |
| `backend/internal/chat/conversation.go`                                | Current conversation repository and conversation public-key lookup.                               |
| `backend/internal/crypto/encrypt.go`                                   | Existing NaCl helpers. Keep primitives if still suitable.                                         |
| `backend/internal/auth/repo.go`                                        | Current public-key and key-pair record lookups.                                                   |
| `backend/internal/config/api.go`                                       | Existing koanf config pattern to extend or replace.                                               |
| `backend/db/migrations/1711007996_created_models.go`                   | Legacy `models` collection migration likely to be retired from the new design.                    |
| `backend/db/migrations/1710601610_updated_user_key_pairs.go`           | Existing user key-pair storage schema that informs the Account Key redesign.                      |
| `backend/db/migrations/1710600702_updated_conversation_secret_keys.go` | Existing conversation secret-key storage schema.                                                  |

### Frontend

| File                                                                                       | Why it matters                                                                            |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `frontend/src/app/interfaces/model.ts`                                                     | Frontend model schema definitions and fallback/loading model state.                       |
| `frontend/src/app/services/model.service.ts`                                               | Current backend-driven model state and selection logic.                                   |
| `frontend/src/app/services/message.service.ts`                                             | Current message send/decrypt path over first-party Cognos APIs.                           |
| `frontend/src/app/services/vault.service.ts`                                               | Current Account Key unlock flow and server-backed secret-key storage.                     |
| `frontend/src/app/services/trusted-unlock.service.ts`                                      | Current wrapped trusted-device unlock storage implementation.                             |
| `frontend/src/app/services/conversation.service.ts`                                        | Current conversation key creation, storage, fetch, and decryption flow.                   |
| `frontend/src/app/services/crypto.service.ts`                                              | Current TweetNaCl client crypto helpers, including sealed-box decryption.                 |
| `frontend/src/app/interfaces/message.ts`                                                   | Frontend message payload schema mirrored from the backend.                                |
| `frontend/src/app/types/pocketbase-types.ts`                                               | Generated PocketBase collection typings that will need regeneration after schema changes. |
| `frontend/src/app/components/chat/message-form/model-selector/model-selector.component.ts` | Existing UI entrypoint for model selection.                                               |

### Documentation

| File                                   | Why it matters                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `README.md`                            | Must be updated to reflect the final security wording and architecture.                            |
| `backend/README.md`                    | Should reflect the new backend model catalogue, first-party API path, and Account Key helper flow. |
| `docs/specs/backend-model-selector.md` | This document; keep as the planning source of truth until implementation docs are split out.       |

## 15. Documentation Changes Required

Documentation is part of the deliverable for this rework.

### 15.1 Product wording updates

Remove or rewrite claims that imply the strict old model:

- Remove: **“private key never leaves your device”**
- Replace with wording closer to:
    - **“Your private key is encrypted client-side before backup. Cognos never stores the plaintext
      private key.”**
    - **“Sign in with your password, then enter your Account Key to unlock your encrypted key
      material on a new device.”**
    - **“Trusted devices can stay unlocked locally on this browser until you log out or clear
      browser storage.”**

### 15.2 README updates

Update `README.md` so it accurately describes:

- the backend-driven model catalogue
- the first-party Cognos API (not OpenAI compatibility)
- encrypted message storage
- the Account Key cross-device model
- the fact that billing/analytics record usage and cost metadata without storing plaintext content

### 15.3 New security model document

Write a new document under `docs/` dedicated to the security model. Recommended path:

- `docs/security-model.md`

That document should cover at minimum:

1. threat model and trust boundaries
2. what the server can and cannot see
3. plaintext vs ciphertext at rest
4. how private-key backup works
5. Account Key onboarding and recovery expectations
6. trusted-device unlock behaviour
7. password change, email change, logout, and lost-device behaviour
8. what is and is not logged
9. billing/analytics privacy boundaries

### 15.4 Frontend and backend doc follow-up

After implementation, add focused docs for:

- backend model catalogue operations and provider approval workflow
- frontend model-selector data flow
- billing and usage event pipeline
- any consciously deferred crypto/security TODOs discovered during implementation
- the maintained red/green branch test plan (`docs/specs/backend-model-selector-test-plan.md`)
