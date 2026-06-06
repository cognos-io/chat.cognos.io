# Cognos Model Selection & Security Rework — Architecture Specification & Implementation Roadmap

**Version:** 1.1 **Status:** In progress **Stack:** Go (backend), Angular (frontend),
PocketBase/SQLite (primary store), DuckDB + Parquet/S3 (analytics)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture Overview](#2-system-architecture-overview)
3. [Technology Stack & Dependencies](#3-technology-stack--dependencies)
4. [Module Definitions](#4-module-definitions)
   - 4.1 [Model Catalogue](#41-model-catalogue)
   - 4.2 [Bifrost LLM Gateway](#42-bifrost-llm-gateway)
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

- Each user generates a **public/private key pair** on their device.
- The **public key** is stored on the server.
- The **private key is encrypted client-side** and may be backed up to the server to support
  cross-device access.
- Unlocking a new device requires the user's **account password + Account Key**. Trusted devices
  may cache a locally wrapped unlock blob in **IndexedDB** until the user locks the account, logs
  out, or clears browser storage.
- When a user sends a message, the server uses the user's public key to
  **encrypt the message ciphertext** before persisting it.
- When the AI generates a response, the server uses the public key to **encrypt the response**
  before persisting it.
- The user's device downloads encrypted messages and **decrypts them locally** using the private
  key.

The result: the server stores only ciphertext. Even if the database is compromised, user
conversations cannot be read.

### What this document covers

This document specifies the **backend and frontend rearchitecture** of Cognos. The primary goals
of this work are:

1. Introduce a **model selection system** that allows users to choose AI models based on their
   privacy preferences.
2. Integrate **Bifrost** as a unified LLM gateway so the backend can route requests to multiple
   providers through a single interface.
3. Implement a **billing system** supporting pay-as-you-go (PAYG) and flat-rate subscriptions.
4. Implement an **analytics pipeline** that captures token usage and costs with no user-identifiable
   content.
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
│  - May cache wrapped unlock material in IndexedDB on trusted devices│
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
│                   ┌──────▼──────┐                                    │
│                   │   Bifrost   │  (embedded Go package)             │
│                   │ LLM Gateway │                                    │
│                   └──────┬──────┘                                    │
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
│  ┌─────────────────────┐      ┌──────────────────────────────────┐  │
│  │ users               │      │ usage_events                     │  │
│  │ conversations        │      │ (anonymous, no content)          │  │
│  │ messages (ciphertext)│      │ billing_user_id, model_id        │  │
│  │ user_billing         │      │ tokens, cost_chf, plan_type      │  │
│  │ balance_transactions │      └──────────────────────────────────┘  │
│  └─────────────────────┘                                             │
└─────────────────────────────────────────────────────────────────────┘
```

### Key design principles

| Principle                              | Implementation                                                         |
| -------------------------------------- | ---------------------------------------------------------------------- |
| No plaintext user content on server    | All message content encrypted before persistence                       |
| No user-identifiable data in analytics | Analytics events use opaque `billing_user_id` only                     |
| Single gateway for all LLM providers   | Bifrost handles all provider routing                                   |
| Easy model onboarding                  | Model catalogue defined in Go code, no database required               |
| Extensible to multi-modal              | Attachment array in encrypted payload; content_type field in analytics |

---

## 3. Technology Stack & Dependencies

### Core dependencies (Go modules)

Add all of the following to `go.mod`. Exact versions should be pinned after initial `go get`.

| Dependency             | Purpose                  | Import path                              |
| ---------------------- | ------------------------ | ---------------------------------------- |
| Bifrost core           | LLM gateway              | `github.com/maximhq/bifrost/core`        |
| PocketBase             | Primary database + auth  | `github.com/pocketbase/pocketbase`       |
| DuckDB Go driver       | Analytics writes         | `github.com/marcboeker/go-duckdb`        |
| AWS SDK v2 (S3)        | Parquet upload to S3     | `github.com/aws/aws-sdk-go-v2`           |
| Apache Arrow / Parquet | Write Parquet files      | `github.com/apache/arrow/go/v17/parquet` |
| golang.org/x/crypto    | NaCl / X25519 encryption | `golang.org/x/crypto`                    |
| Google UUID            | UUID v7 generation       | `github.com/google/uuid`                 |

> **Note for lead engineer:** Confirm the exact Bifrost import path from
> `github.com/maximhq/bifrost` before starting. The Go SDK and the HTTP gateway are separate
> packages within that repo. You want the Go SDK (`/core`) for embedding, not the HTTP binary.

### External services

| Service               | Purpose                       | Notes                                                                                      |
| --------------------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| Infomaniak AI         | Tier 1 provider (Switzerland) | OpenAI-compatible API. Requires product ID in URL.                                         |
| Mistral API           | Tier 2 provider (Europe)      | Standard OpenAI-compatible.                                                                |
| Anthropic API         | Tier 3 provider               | Native Anthropic format; Bifrost translates.                                               |
| OpenAI API            | Tier 3 provider               | Reference format.                                                                          |
| Google Gemini         | Tier 3 provider (optional)    | Via Bifrost.                                                                               |
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

A user on `ch_only` can only use models with `ch_only` in their tiers list. A user on `eu` can use
models tagged `eu` or `ch_only`. A user on `global` can use any model. The tiers are
**cumulative downward** — more permissive tiers include all more restrictive options.

#### Model struct definition

```go
// internal/catalogue/models.go

package catalogue

// PrivacyTier represents a user's chosen privacy level.
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

    // DisplayName is shown to the user in the UI.
    DisplayName string

    // Description is a short user-facing description (1–2 sentences).
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
    // A model available to ch_only users should list [TierSwitzerlandOnly].
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

### 4.2 Bifrost LLM Gateway

**Purpose:** Bifrost is an open-source Go LLM gateway (Apache 2.0 licence) that provides a unified
interface to 23+ AI providers. We embed it as a Go package — we do not run it as a separate HTTP
server. This means all provider routing happens in-process within our Go backend.

**Repository:** `github.com/maximhq/bifrost`
**Licence:** Apache 2.0 — fully open source, no enterprise paywall.
**Location in codebase:** `internal/gateway/bifrost.go`

#### Why Bifrost?

- Written in Go — matches our stack, no Python sidecar needed.
- Supports all required providers: Infomaniak (OpenAI-compatible), Mistral, Anthropic, OpenAI,
  DeepInfra.
- Normalises all provider responses to a single struct — our code never handles provider-specific
  response formats.
- Provides token counts in every response — essential for billing.
- < 11 µs overhead per request.
- Fallback and retry logic built in.

#### Bifrost initialisation

```go
// internal/gateway/bifrost.go

package gateway

import (
    "context"
    "fmt"

    bifrost "github.com/maximhq/bifrost/core"
    "github.com/maximhq/bifrost/core/schemas"
    "your-module/internal/catalogue"
    "your-module/internal/config"
)

// Client wraps the Bifrost instance and exposes a single Complete() method.
type Client struct {
    bf *bifrost.Bifrost
}

// NewClient initialises Bifrost with all configured providers.
// Call this once at application startup.
func NewClient(cfg *config.Config) (*Client, error) {
    // Each provider is configured with its API key and base URL.
    // Bifrost handles authentication headers automatically.

    providers := []schemas.ModelProvider{
        {
            // Infomaniak: OpenAI-compatible, Swiss-hosted.
            // The base URL includes the product ID from config.
            Key:     schemas.OpenAI, // Infomaniak uses OpenAI-compatible format
            APIKey:  cfg.InfmaniakAPIKey,
            BaseURL: fmt.Sprintf("https://api.infomaniak.com/2/ai/%s/openai/v1", cfg.InfmaniakProductID),
        },
        {
            Key:    schemas.Mistral,
            APIKey: cfg.MistralAPIKey,
        },
        {
            Key:    schemas.Anthropic,
            APIKey: cfg.AnthropicAPIKey,
        },
        {
            Key:    schemas.OpenAI,
            APIKey: cfg.OpenAIAPIKey,
        },
    }

    // Filter to only providers that have API keys configured.
    // This allows running in a restricted mode (e.g. ch_only only) without panicking.
    var configuredProviders []schemas.ModelProvider
    for _, p := range providers {
        if p.APIKey != "" {
            configuredProviders = append(configuredProviders, p)
        }
    }

    bf, err := bifrost.New(bifrost.Config{
        Providers: configuredProviders,
    })
    if err != nil {
        return nil, fmt.Errorf("failed to initialise bifrost: %w", err)
    }

    return &Client{bf: bf}, nil
}

// CompletionRequest contains everything Bifrost needs to make a completion call.
type CompletionRequest struct {
    Model    catalogue.Model
    Messages []schemas.Message // Full conversation history (plaintext, received from client)
}

// CompletionResponse contains the model's response and billing-relevant metadata.
type CompletionResponse struct {
    Content      string // The AI's response text (plaintext)
    InputTokens  int64
    OutputTokens int64
    ModelID      string // Echo back the model ID used
}

// Complete sends a completion request to the appropriate provider via Bifrost.
// The caller is responsible for all encryption and persistence after this returns.
func (c *Client) Complete(ctx context.Context, req CompletionRequest) (*CompletionResponse, error) {
    result, err := c.bf.Chat(ctx, schemas.ChatRequest{
        Model:    req.Model.ProviderModelID,
        Provider: providerKey(req.Model.Provider),
        Messages: req.Messages,
    })
    if err != nil {
        return nil, fmt.Errorf("bifrost completion failed for model %s: %w", req.Model.ID, err)
    }

    if len(result.Choices) == 0 {
        return nil, fmt.Errorf("bifrost returned empty choices for model %s", req.Model.ID)
    }

    return &CompletionResponse{
        Content:      result.Choices[0].Message.Content,
        InputTokens:  int64(result.Usage.PromptTokens),
        OutputTokens: int64(result.Usage.CompletionTokens),
        ModelID:      req.Model.ID,
    }, nil
}

// providerKey maps our internal provider string to Bifrost's provider enum.
// This function must be updated when new providers are added to the catalogue.
func providerKey(provider string) schemas.ModelProviderKey {
    switch provider {
    case "infomaniak":
        return schemas.OpenAI // Infomaniak is OpenAI-compatible
    case "mistral":
        return schemas.Mistral
    case "anthropic":
        return schemas.Anthropic
    case "openai":
        return schemas.OpenAI
    default:
        panic(fmt.Sprintf("unknown provider: %s — add it to gateway.providerKey()", provider))
    }
}
```

> **Note for engineers:** The exact Bifrost API (struct names, method signatures) should be verified
> against the current README at `github.com/maximhq/bifrost`. The code above reflects the intended
> usage pattern — treat it as a blueprint, not guaranteed-compiling code until you have confirmed
> the actual SDK interface.

---

### 4.3 Encryption & Message Storage

**Purpose:** After receiving a completion from Bifrost, the backend encrypts the full message
payload (content + metadata) using the user's public key, then persists only the ciphertext.
Plaintext private keys never touch the server, but encrypted private-key backups may be stored
server-side to support cross-device access.

**Location in codebase:** `internal/crypto/encrypt.go`, `internal/store/messages.go`

#### Encryption scheme

Cognos uses **X25519 key exchange + XSalsa20-Poly1305 encryption** (NaCl box), which is:

- Well-audited and widely used (same as Signal, ProtonMail internally).
- Available in Go via `golang.org/x/crypto/nacl/box`.
- Asymmetric: encrypts with public key, decrypts with private key.

The frontend generates key pairs using the Web Crypto API or a compatible library (TweetNaCl.js is
standard). The public key is stored in the `users` table as base64. The private key is encrypted
client-side and may be backed up to the server as ciphertext to support cross-device access.

#### Key backup and device unlock model

The accepted key-management model for Cognos is a **1Password-style Account Key model**.

- Users authenticate with their normal **account password**.
- Each user also has a generated high-entropy **Account Key** used when unlocking new devices.
- The server may store an **encrypted private-key backup**, but must never store or receive the
  plaintext private key.
- A new device requires both the **account password** and **Account Key** to unlock the encrypted
  private key locally.
- Trusted devices may cache a **locally wrapped unlock blob** in **IndexedDB** so users are not
  repeatedly prompted. The current implementation wraps the local unlock key with a browser-local
  non-extractable WebCrypto AES-GCM key before persistence. Do **not** use `localStorage` for key
  material.
- Do **not** derive any vault or unlock key from `sha256(email + password)`.
- Use **Argon2id** with a random per-user salt for password-based derivation.
- **Email changes must not affect cryptographic state.**
- **Password changes must re-wrap stored unlock material, not re-encrypt all messages.**

#### Message payload structure

Before encryption, the backend constructs this JSON payload. **This is never stored in plaintext:**

```go
// internal/crypto/payload.go

package crypto

// MessagePayload is the struct that gets JSON-encoded and then encrypted.
// All fields here will be invisible to anyone without the user's private key.
type MessagePayload struct {
    // Content is the actual message text (user's message or AI response).
    Content string `json:"content"`

    // Role is "user" or "assistant".
    Role string `json:"role"`

    // ModelID is the Cognos internal model ID used for this message.
    // Example: "claude-sonnet-4"
    // For user messages, this is the model that will respond.
    // For assistant messages, this is the model that generated the response.
    ModelID string `json:"model_id"`

    // Provider is the provider used. Example: "anthropic"
    Provider string `json:"provider"`

    // PrivacyTier is the user's tier at time of message. Example: "ch_only"
    PrivacyTier string `json:"privacy_tier"`

    // ContentType is "text", "image", "audio", or "document".
    // Always "text" for now; used when multi-modal is added.
    ContentType string `json:"content_type"`

    // InputTokens is the number of input tokens consumed (assistant messages only).
    // Zero for user messages.
    InputTokens int64 `json:"input_tokens,omitempty"`

    // OutputTokens is the number of output tokens generated (assistant messages only).
    // Zero for user messages.
    OutputTokens int64 `json:"output_tokens,omitempty"`

    // Attachments will be populated when multi-modal support is added.
    // For now, always an empty slice.
    Attachments []Attachment `json:"attachments"`
}

// Attachment represents a file attached to a message.
// Not used until Phase 4 (multi-modal), but included now so the
// encrypted payload format is stable and does not need migration.
type Attachment struct {
    // Type is "image_upload", "image_generated", "audio", or "document".
    Type string `json:"type"`

    // StorageKey is the object storage key for the encrypted file.
    // Example: "attachments/att_abc123.enc"
    StorageKey string `json:"storage_key"`

    // MIMEType is the file's MIME type. Example: "image/webp"
    MIMEType string `json:"mime_type"`

    // SizeBytes is the file size in bytes.
    SizeBytes int64 `json:"size_bytes"`
}
```

#### Encryption implementation

```go
// internal/crypto/encrypt.go

package crypto

import (
    "crypto/rand"
    "encoding/base64"
    "encoding/json"
    "fmt"
    "io"

    "golang.org/x/crypto/nacl/box"
)

// EncryptPayload takes a MessagePayload and the recipient's base64-encoded public key,
// and returns a base64-encoded ciphertext string suitable for storing in the database.
//
// The server generates an ephemeral key pair for each message.
// The ephemeral public key is prepended to the ciphertext so the client can decrypt.
func EncryptPayload(payload *MessagePayload, recipientPublicKeyB64 string) (string, error) {
    // Decode the recipient's public key from base64.
    recipientPubKeyBytes, err := base64.StdEncoding.DecodeString(recipientPublicKeyB64)
    if err != nil {
        return "", fmt.Errorf("invalid recipient public key: %w", err)
    }
    if len(recipientPubKeyBytes) != 32 {
        return "", fmt.Errorf("recipient public key must be 32 bytes, got %d", len(recipientPubKeyBytes))
    }
    var recipientPublicKey [32]byte
    copy(recipientPublicKey[:], recipientPubKeyBytes)

    // Generate an ephemeral key pair for this message.
    // The ephemeral private key is discarded after encryption (forward secrecy per message).
    ephemeralPublicKey, ephemeralPrivateKey, err := box.GenerateKey(rand.Reader)
    if err != nil {
        return "", fmt.Errorf("failed to generate ephemeral key: %w", err)
    }

    // JSON-encode the payload.
    plaintext, err := json.Marshal(payload)
    if err != nil {
        return "", fmt.Errorf("failed to marshal payload: %w", err)
    }

    // Generate a random nonce.
    var nonce [24]byte
    if _, err := io.ReadFull(rand.Reader, nonce[:]); err != nil {
        return "", fmt.Errorf("failed to generate nonce: %w", err)
    }

    // Encrypt using NaCl box (X25519 + XSalsa20-Poly1305).
    encrypted := box.Seal(nonce[:], plaintext, &nonce, &recipientPublicKey, ephemeralPrivateKey)

    // Prepend the ephemeral public key so the client can reconstruct the shared secret.
    // Final format: ephemeralPublicKey (32 bytes) + nonce (24 bytes) + ciphertext
    result := append(ephemeralPublicKey[:], encrypted...)

    return base64.StdEncoding.EncodeToString(result), nil
}
```

> **Frontend note:** The Angular client must decrypt using the matching NaCl box open operation:
> extract the ephemeral public key (first 32 bytes), extract the nonce (next 24 bytes), then call
> `box.open()` with the user's private key and the ephemeral public key. TweetNaCl.js is the
> recommended library.

---

### 4.4 Billing & Balance

**Purpose:** Track user balances for PAYG users and record all transactions. Provide the service
layer that deducts balance after each completion.

**Location in codebase:** `internal/billing/service.go`

#### Plans

| Plan        | Monthly fee       | Usage billing                                 | Overage                       |
| ----------- | ----------------- | --------------------------------------------- | ----------------------------- |
| `payg`      | CHF 5.00 base fee | Per token, deducted from balance in real time | Blocked when balance = 0      |
| `flat_rate` | CHF 35.00         | Unlimited within fair use                     | Absorbed silently by business |

#### Cost calculation

Providers charge in USD per 1 million tokens. The backend converts to CHF at the time of each
request using a cached exchange rate (refreshed daily). The formula is:

```text
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
- When displaying to users, divide by 100.

#### Billing service interface

```go
// internal/billing/service.go

package billing

import (
    "context"
    "fmt"
    "time"
)

// PlanType represents a user's subscription plan.
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
    ModelID      string  // For the transaction description shown to the user
    InputTokens  int64
    OutputTokens int64
}

// Service handles all billing operations.
type Service struct {
    db     Database   // Interface to PocketBase/SQLite — see section 5.1
    fxRate FXRateProvider
}

// DeductBalance deducts the cost from a PAYG user's balance.
// For flat_rate users, this records the usage but does NOT deduct.
// Returns an error only if the operation itself fails — insufficient balance
// is handled by pre-checking with CanAfford().
func (s *Service) DeductBalance(ctx context.Context, req DeductRequest) error {
    plan, balance, err := s.db.GetUserBilling(ctx, req.UserID)
    if err != nil {
        return fmt.Errorf("billing: failed to get user billing for %s: %w", req.UserID, err)
    }

    if plan == PlanFlatRate {
        // Flat-rate users: record transaction for internal tracking only.
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

// CanAfford checks whether a PAYG user has sufficient balance for an estimated cost.
// Always returns true for flat_rate users.
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
analysis, and flat-rate overage monitoring. This data must contain **no user-identifiable content**
— no message text, no conversation IDs, no email addresses.

**Location in codebase:** `internal/analytics/emitter.go`

#### Privacy design

The only user-adjacent field in an analytics event is `billing_user_id`. This is an
**opaque internal identifier** that:

- Exists in the `user_billing` table in PocketBase.
- Has no direct join path to the `users` table from the analytics database.
- Allows `SUM(cost_chf) GROUP BY billing_user_id` for invoicing.
- Does **not** allow anyone reading the analytics database alone to identify a user.

The analytics database is stored separately from PocketBase. These are two distinct data stores with
no shared connection string.

#### Analytics event struct

```go
// internal/analytics/event.go

package analytics

import "time"

// UsageEvent is written to DuckDB / Parquet after every successful completion.
// It must never contain: message content, conversation IDs, user IDs, email addresses,
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

    // BillingUserID is the opaque user billing ID from user_billing.id.
    // This is NOT users.id — it is a separate table's primary key.
    BillingUserID string `parquet:"billing_user_id"`

    // PlanType is "payg" or "flat_rate".
    PlanType string `parquet:"plan_type"`

    // ModelID is the Cognos model ID. Example: "claude-sonnet-4"
    ModelID string `parquet:"model_id"`

    // Provider is the provider name. Example: "anthropic"
    Provider string `parquet:"provider"`

    // PrivacyTier is the user's tier at time of request. Example: "eu"
    PrivacyTier string `parquet:"privacy_tier"`

    // ContentType is "text", "image", "audio", or "document".
    ContentType string `parquet:"content_type"`

    // InputTokens is the number of prompt tokens consumed.
    InputTokens int64 `parquet:"input_tokens"`

    // OutputTokens is the number of completion tokens generated.
    OutputTokens int64 `parquet:"output_tokens"`

    // CostUSD is the calculated cost in USD at the provider's listed price.
    CostUSD float64 `parquet:"cost_usd"`

    // CostCHF is CostUSD converted at the FX rate captured at request time.
    CostCHF float64 `parquet:"cost_chf"`

    // FXRateUSDCHF is the USD→CHF rate used for this conversion. Stored for auditability.
    FXRateUSDCHF float64 `parquet:"fx_rate_usd_chf"`

    // LatencyMS is the time in milliseconds from sending the request to Bifrost
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
prefix). The encryption key is derived from the user's public key. The message payload contains only
a `storage_key` reference — the file itself is never in the database.

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

| Field                | Type | Notes                                                                 |
| -------------------- | ---- | --------------------------------------------------------------------- |
| `public_key`         | Text | Base64-encoded X25519 public key. Set on registration, never updated. |
| `privacy_tier`       | Text | One of: `ch_only`, `eu`, `global`. Default: `eu`.                     |
| `preferred_model_id` | Text | The user's last selected model ID. Used to pre-select in the UI.      |

#### Table: `conversations` (new)

| Field              | Type              | Nullable | Notes                                                               |
| ------------------ | ----------------- | -------- | ------------------------------------------------------------------- |
| `id`               | Text (PK)         | No       | UUID. Generated by backend.                                         |
| `user_id`          | Text (FK → users) | No       |                                                                     |
| `created_at`       | DateTime          | No       | UTC.                                                                |
| `updated_at`       | DateTime          | No       | Updated on each new message.                                        |
| `title_ciphertext` | Text              | Yes      | Optional encrypted conversation title. Same encryption as messages. |

#### Table: `messages` (new)

| Field             | Type                      | Nullable | Notes                                                                                                      |
| ----------------- | ------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `id`              | Text (PK)                 | No       | UUID. Generated by backend.                                                                                |
| `conversation_id` | Text (FK → conversations) | No       |                                                                                                            |
| `created_at`      | DateTime                  | No       | UTC, second precision only (no milliseconds — avoids timing fingerprinting).                               |
| `role`            | Text                      | No       | `user` or `assistant`. Stored plaintext — knowing whether a message is from a user or AI is not sensitive. |
| `ciphertext`      | Text                      | No       | Base64-encoded encrypted `MessagePayload`. See Section 4.3.                                                |
| `sequence`        | Integer                   | No       | Message order within the conversation. Monotonically increasing.                                           |

> **Do not add** model_id, token counts, or any other metadata fields to this table. All metadata is
> inside `ciphertext`. The only plaintext fields are those needed for server-side operations
> (ordering, routing).

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

Returns the list of models available for the authenticated user's privacy tier.

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

Creates a new conversation.

**Request body:**

```json
{
  "model_id": "llama-3-3-infomaniak"
}
```

**Response:**

```json
{
  "conversation_id": "conv_abc123",
  "created_at": "2025-09-15T14:30:22Z"
}
```

---

#### `GET /api/v1/conversations`

Returns all conversations for the authenticated user (metadata only — no ciphertext).

**Response:**

```json
{
  "conversations": [
    {
      "id": "conv_abc123",
      "created_at": "2025-09-15T14:30:22Z",
      "updated_at": "2025-09-15T15:01:44Z",
      "message_count": 12
    }
  ]
}
```

---

#### `GET /api/v1/conversations/{id}/messages`

Returns all messages in a conversation. The client decrypts each `ciphertext` locally.

**Response:**

```json
{
  "conversation_id": "conv_abc123",
  "messages": [
    {
      "id": "msg_001",
      "sequence": 1,
      "role": "user",
      "created_at": "2025-09-15T14:30:22Z",
      "ciphertext": "base64encodedciphertexthere..."
    },
    {
      "id": "msg_002",
      "sequence": 2,
      "role": "assistant",
      "created_at": "2025-09-15T14:30:25Z",
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
  "message_id": "msg_003",
  "sequence": 3,
  "role": "assistant",
  "created_at": "2025-09-15T14:30:25Z",
  "ciphertext": "base64encodedciphertexthere...",
  "model_id": "llama-3-3-infomaniak",
  "input_tokens": 412,
  "output_tokens": 891
}
```

Note: `model_id`, `input_tokens`, and `output_tokens` are returned in the response plaintext so the
UI can display them immediately without decrypting. They are also inside the ciphertext for the
permanent record.

**Error responses:**

| HTTP code                  | Condition                                              |
| -------------------------- | ------------------------------------------------------ |
| `402 Payment Required`     | PAYG user has insufficient balance                     |
| `403 Forbidden`            | Requested model not available for user's privacy tier  |
| `404 Not Found`            | Conversation not found or does not belong to this user |
| `422 Unprocessable Entity` | `model_id` not recognised                              |
| `503 Service Unavailable`  | Bifrost/provider call failed after retries             |

---

### Billing

#### `GET /api/v1/billing`

Returns the user's current billing status.

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

Returns the last 50 transactions for the authenticated user.

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

This section describes exactly what happens, in order, when a user sends a message. Engineers should
implement this sequence precisely — no steps should be skipped or reordered.

```text
Client (Angular)                    Go Backend                    External
     │                                   │                            │
     │  POST /complete                   │                            │
     │  {model_id, messages[plaintext]}  │                            │
     │──────────────────────────────────►│                            │
     │                                   │                            │
     │                          1. Authenticate user                  │
     │                          2. Validate model_id exists           │
     │                          3. Validate model is eligible         │
     │                             for user's privacy_tier            │
     │                          4. [PAYG only] Check CanAfford()      │
     │                             → 402 if insufficient balance      │
     │                                   │                            │
     │                          5. Record start timestamp             │
     │                                   │                            │
     │                                   │  Bifrost.Complete()        │
     │                                   │───────────────────────────►│
     │                                   │                            │
     │                                   │◄───────────────────────────│
     │                                   │  response text,            │
     │                                   │  input_tokens,             │
     │                                   │  output_tokens             │
     │                                   │                            │
     │                          6. Calculate latency_ms               │
     │                          7. Calculate cost_usd, cost_chf       │
     │                          8. Generate event_id (UUID)           │
     │                                   │                            │
     │                          ┌────────┴────────┐                   │
     │                          │ Steps 9-11 run  │                   │
     │                          │ in parallel     │                   │
     │                          └────────┬────────┘                   │
     │                                   │                            │
     │                          9. Encrypt user message payload       │
     │                             → persist to messages table        │
     │                                   │                            │
     │                         10. Encrypt assistant message payload  │
     │                             → persist to messages table        │
     │                                   │                            │
     │                         11. [PAYG] DeductBalance()             │
     │                             → persist to balance_transactions  │
     │                             [flat_rate] RecordUsage()          │
     │                                   │                            │
     │                         12. EmitUsageEvent()                   │
     │                             → write to DuckDB buffer           │
     │                                   │                            │
     │                         13. Update conversation.updated_at     │
     │                                   │                            │
     │  200 OK                           │                            │
     │  {ciphertext, model_id,           │                            │
     │   input_tokens, output_tokens}    │                            │
     │◄──────────────────────────────────│                            │
     │                                   │                            │
     │  Client decrypts ciphertext       │                            │
     │  locally using private key        │                            │
```

### Critical rules for step ordering

- **Step 4 (balance check) must happen before step 5 (calling Bifrost).** Never call the provider
  and then find out the user can't afford it.
- **Steps 9–11 must all succeed.** If any of these fail, log the error and still return the response
  to the user — do not retry the provider call. Losing a billing record is less bad than charging a
  user twice.
- **Step 12 (analytics) is best-effort.** If the DuckDB write fails, log the error but do not affect
  the response. Analytics are internal and non-critical.
- **Never persist the plaintext messages array** sent in the request body. It is used only for the
  Bifrost call and discarded immediately after.

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
│   │   ├── bifrost.go               # Bifrost client wrapper
│   │   ├── bifrost_test.go          # Integration tests (require API keys in env)
│   │   └── mock_client.go           # Mock for unit tests
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

The current repository already contains a working PocketBase app, a legacy OpenAI-compatible proxy,
server-backed key storage, and hard-coded frontend models. The implementation plan below must be
read with these mandatory amendments:

1. **Rewrite, do not adapt in place.** Replace the existing OpenAI-compatible chat path with the
   first-party REST API described in Section 6.
2. **Move frontend model selection to the backend catalogue.** Remove the hard-coded frontend model
   list as the source of truth.
3. **Keep NaCl primitives, change the key-management model.** Existing NaCl usage is close enough
   to keep, but the storage and unlock model must be rewritten to the Account Key design described
   in Section 13.
4. **Start with Infomaniak only.** Seed only the approved Infomaniak model initially. Do not expose
   Mistral, Anthropic, OpenAI, or other providers until explicitly approved.
5. **Remove OpenAI compatibility once the new path is live.** `backend/pkg/compat/openai` and the
   frontend `openai` browser SDK path are migration targets, not long-term architecture.

Success criteria for the overall rework:

1. Backend model availability is driven solely by the backend catalogue → verify: frontend renders
   models from `/api/v1/models` with no hard-coded list required.
2. Chat completions go through first-party Cognos endpoints only → verify: no UI path depends on
   the OpenAI browser SDK or `/v1/chat/completions` compatibility route.
3. Message content is stored as ciphertext only and billing/analytics never store plaintext →
   verify: database inspection and integration tests.
4. Cross-device unlock requires account password + Account Key, while trusted devices avoid repeated
   prompts → verify: new-device unlock flow and trusted-device relaunch flow.
5. Product copy accurately describes the security model → verify: README and new security doc
   updated before merge.

---

### Phase 1 — Foundation

**Goal:** Model catalogue, Bifrost integration, and a working completion endpoint with no billing or
analytics.

**Dependencies before starting:**

- [ ] Go module initialised (`go mod init`)
- [ ] PocketBase running locally
- [ ] At least one provider API key (recommend Infomaniak for CH-only testing)
- [ ] Bifrost Go SDK confirmed importable (`go get github.com/maximhq/bifrost/core`)

**Tasks:**

| #    | Task                                                                                 | Package     | Notes                                                                  |
| ---- | ------------------------------------------------------------------------------------ | ----------- | ---------------------------------------------------------------------- |
| 1.1  | Define `Config` struct and env loading                                               | `config`    | See Section 10 for all required env vars                               |
| 1.2  | Implement `AllModels` catalogue with the initial Infomaniak model only               | `catalogue` | Do not seed unapproved providers in the first cut                      |
| 1.3  | Implement `ModelsAvailableForTier()` and `GetModelByID()`                            | `catalogue` |                                                                        |
| 1.4  | Write unit tests for catalogue filtering                                             | `catalogue` | 100% coverage required                                                 |
| 1.5  | Implement Bifrost `Client` with `NewClient()` and `Complete()`                       | `gateway`   |                                                                        |
| 1.6  | Implement `GET /api/v1/models` handler                                               | `handler`   | Returns all active models plus eligibility metadata                    |
| 1.7  | Create PocketBase collections: `conversations`, `messages`                           | `store`     | Via PocketBase admin UI or migration                                   |
| 1.8  | Implement basic `POST /api/v1/conversations/{id}/complete`                           | `handler`   | No encryption, no billing yet — returns plaintext response for testing |
| 1.9  | Write integration test for complete endpoint                                         | `handler`   | Use Infomaniak API key                                                 |
| 1.10 | Remove or disable the legacy OpenAI compatibility route once replacement is verified | `handler`   | Avoid dual long-term APIs                                              |

**Review checkpoint 1:** Lead engineer verifies a completion request reaches Infomaniak and returns
a valid response. Model filtering works correctly for all three tiers.

---

### Phase 2 — Encryption & Message Storage

**Goal:** All message content encrypted before persistence. Existing completion endpoint updated.

**Dependencies before starting:**

- [ ] Phase 1 review passed
- [ ] Frontend team has confirmed the public key format (base64 X25519) and TweetNaCl.js integration

**Tasks:**

| #   | Task                                                                  | Package   | Notes                                                               |
| --- | --------------------------------------------------------------------- | --------- | ------------------------------------------------------------------- |
| 2.1 | Implement `MessagePayload` and `Attachment` structs                   | `crypto`  |                                                                     |
| 2.2 | Implement `EncryptPayload()`                                          | `crypto`  |                                                                     |
| 2.3 | Write round-trip encryption tests                                     | `crypto`  | Encrypt then decrypt (using NaCl box.Open), verify payload equality |
| 2.4 | Add `public_key` field to users collection                            | `store`   | Update registration flow to accept and store public key             |
| 2.5 | Update `complete` handler to encrypt both user and assistant messages | `handler` | Follow the exact step order in Section 7                            |
| 2.6 | Implement `GET /api/v1/conversations/{id}/messages`                   | `handler` | Returns ciphertext array                                            |
| 2.7 | End-to-end test: encrypt on backend, decrypt using NaCl in a test     | `crypto`  |                                                                     |

**Review checkpoint 2:** Lead engineer verifies that messages in SQLite are ciphertext only.
Decryption works correctly using a test private key. No plaintext appears in the database.

---

### Phase 3 — Billing & Analytics

**Goal:** PAYG balance deduction, flat-rate recording, and analytics event emission working end to
end.

**Dependencies before starting:**

- [ ] Phase 2 review passed
- [ ] S3-compatible bucket created (Infomaniak kDrive S3 recommended)
- [ ] FX rate source decided (SNB API or ECB) and API confirmed accessible

**Tasks:**

| #    | Task                                                                            | Package     | Notes                                                                 |
| ---- | ------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------- |
| 3.1  | Create PocketBase collections: `user_billing`, `balance_transactions`           | `store`     |                                                                       |
| 3.2  | Implement `fx_rate.go` — daily cached USD→CHF rate                              | `billing`   | Fail safe: if fetch fails, use previous cached rate. Log the failure. |
| 3.3  | Implement `BillingService` with `CanAfford()` and `DeductBalance()`             | `billing`   |                                                                       |
| 3.4  | Write unit tests for billing service                                            | `billing`   | Test PAYG deduction, flat-rate no-deduction, insufficient balance     |
| 3.5  | Implement `UsageEvent` struct                                                   | `analytics` |                                                                       |
| 3.6  | Implement `Emitter` with in-memory DuckDB buffer and hourly Parquet flush       | `analytics` |                                                                       |
| 3.7  | Implement S3 upload of Parquet files                                            | `analytics` | Use Infomaniak S3-compatible endpoint                                 |
| 3.8  | Wire billing and analytics into `complete` handler                              | `handler`   | Follow exact step order in Section 7                                  |
| 3.9  | Implement `GET /api/v1/billing` and `GET /api/v1/billing/transactions`          | `handler`   |                                                                       |
| 3.10 | Implement nightly overage check job                                             | `jobs`      | Can be a cron-triggered function or standalone binary                 |
| 3.11 | Write integration test: send 5 completions, verify balance decrements correctly | `handler`   |                                                                       |

**Review checkpoint 3:** Lead engineer verifies that PAYG balance decrements accurately match
calculated costs. Analytics Parquet file can be queried via DuckDB CLI. Flat-rate users are not
charged.

---

### Phase 4 — Multi-modal Support

**Goal:** Add image upload, image generation, document upload, and audio transcription.

**Dependencies before starting:**

- [ ] Phase 3 review passed and stable in production
- [ ] Multi-modal capable model added to catalogue (e.g. a vision model on Infomaniak or via Tier 3)
- [ ] Object storage bucket configured for encrypted attachment storage
- [ ] Frontend spec for multi-modal UI completed separately

**Tasks:** (high-level — a separate detailed spec will be written for Phase 4)

| #   | Task                                                                 |
| --- | -------------------------------------------------------------------- |
| 4.1 | Implement encrypted attachment upload endpoint                       |
| 4.2 | Implement attachment retrieval and decryption (client-side)          |
| 4.3 | Update `complete` handler to include attachments in provider request |
| 4.4 | Add vision model(s) to catalogue                                     |
| 4.5 | Add audio transcription endpoint (Whisper via Infomaniak)            |
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

### Unit tests

Every package must have unit tests. Minimum coverage: **80%** per package. Packages with pure
business logic (`billing`, `catalogue`, `crypto`) must reach **100%**.

| Package     | Required tests                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `catalogue` | Tier filtering (all combinations), model lookup by ID, inactive model exclusion                                                  |
| `crypto`    | Encrypt → decrypt round trip, invalid public key handling, payload JSON fidelity                                                 |
| `billing`   | PAYG deduction correct to the Rappen, flat-rate no deduction, insufficient balance returns correct error, FX conversion accuracy |
| `analytics` | UsageEvent struct serialises to Parquet without data loss, buffer flush triggers at correct thresholds                           |

### Integration tests

Integration tests require real environment variables (API keys). They must be runnable with:

```bash
RUN_INTEGRATION_TESTS=true go test ./... -tags=integration
```

Guard all integration tests with:

```go
func TestSomething(t *testing.T) {
    if os.Getenv("RUN_INTEGRATION_TESTS") != "true" {
        t.Skip("set RUN_INTEGRATION_TESTS=true to run")
    }
    // ...
}
```

| Test                   | What to verify                                                               |
| ---------------------- | ---------------------------------------------------------------------------- |
| Infomaniak completion  | Sends a real request, receives a real response with token counts             |
| Full complete flow     | User message → Bifrost → encrypt both messages → check DB is ciphertext only |
| PAYG balance deduction | Balance decrements by correct amount across 10 sequential requests           |
| Analytics flush        | After 60 events, a Parquet file appears in S3 with correct row count         |

### Linting

Run `golangci-lint run` before every pull request. Zero lint errors permitted.

---

## 12. Security & Privacy Rules

These are non-negotiable. Any PR that violates these rules must be rejected.

| Rule                                          | Detail                                                                                                                                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No plaintext content in database**          | The `messages` table must never contain readable message text. `ciphertext` column only.                                                                                                      |
| **No user-identifiable content in analytics** | `usage_events` must never contain: user ID, email, conversation ID, message content, IP address.                                                                                              |
| **Billing user ID isolation**                 | `billing_user_id` (from `user_billing.id`) is used in analytics — NOT `users.id`. These must never be joined from within the analytics database.                                              |
| **No plaintext private key accepted**         | No endpoint may accept or log a plaintext private key. Encrypted private-key backup ciphertext is allowed, but if a plaintext private key appears in any log treat it as a security incident. |
| **No logging of request content**             | The `messages` array from the `/complete` request body must never be written to application logs.                                                                                             |
| **Balance as integer**                        | Balance must be stored as integer Rappen. Float balance storage is forbidden.                                                                                                                 |
| **Atomic balance deduction**                  | Balance deduction and transaction insertion must be a single atomic database operation. Never deduct and then insert separately.                                                              |
| **Provider API keys in env only**             | No API keys in code, config files, or version control.                                                                                                                                        |
| **Data retention false for all models**       | Before adding any model to `AllModels`, confirm in writing that the provider has zero data retention.                                                                                         |

---

## 13. Confirmed Decisions & Amendments (June 2026)

This section is the authoritative record of decisions confirmed during planning. Where it conflicts
with earlier wording in this document, **this section wins**.

### 13.1 Scope and architecture decisions

1. **Full rewrite, not a partial adaptation.**
   - Replace the current PocketBase/OpenAI-compatible model-selection and chat path.
   - Replace the frontend hard-coded model list with backend-driven data.
2. **Use first-party Cognos REST endpoints.**
   - Do not keep OpenAI compatibility as a product-facing API.
   - The frontend should talk to Cognos endpoints directly.
3. **Backend model catalogue is the source of truth.**
   - Models are code-defined.
   - The initial seed is **Infomaniak only**.
   - Additional providers remain out of scope until explicitly approved.
4. **Return all active models to the frontend.**
   - `/api/v1/models` should return all active models.
   - Include enough metadata for the UI to distinguish usable vs unavailable models (for example
     `is_eligible` and an optional reason).
5. **Record usage for billing rigorously.**
   - Capture input, output, and cache token counts when available.
   - Capture provider-reported cost when available.
   - Otherwise derive cost from catalogue pricing and the FX rate captured at request time.

### 13.2 Key-management decision

Cognos will use a **1Password-style Account Key model**.

- Users keep a normal **account password** for authentication.
- Users also receive a generated high-entropy **Account Key** used to unlock new devices.
- The server may store an **encrypted private-key backup** to support cross-device access.
- The server must never store or receive the **plaintext private key**.
- A **trusted device** may cache locally wrapped unlock material in **IndexedDB** so the user does
  not need to repeatedly enter the Account Key.
- A **new device** must require both the account password and Account Key.
- The Account Key is the deliberate security/usability tradeoff chosen for Cognos.
- We are explicitly **not** using the old wording “private key never leaves your device”.

### 13.3 Password, email, and unlock derivation decisions

- Do **not** use `sha256(email + password)` as a vault or unlock key.
- Use **Argon2id** with a random per-user salt for password-based derivation.
- The user's **email must not be part of cryptographic identity** in a way that makes email
  changes destructive.
- **Password changes** should re-wrap unlock material, not force message re-encryption.
- If the user loses both the password and Account Key, encrypted data recovery may be impossible.
  This is an accepted consequence of the chosen privacy posture.

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
| `frontend/src/app/interfaces/model.ts`                                                     | Current hard-coded model catalogue and fallback model definitions.                        |
| `frontend/src/app/services/model.service.ts`                                               | Current backend-driven model state and selection logic.                                   |
| `frontend/src/app/services/message.service.ts`                                             | Current message send/decrypt path over first-party Cognos APIs.                           |
| `frontend/src/app/services/vault.service.ts`                                               | Current Account Key unlock flow and server-backed secret-key storage.                     |
| `frontend/src/app/services/trusted-unlock.service.ts`                                      | Current wrapped trusted-device unlock storage in IndexedDB using WebCrypto.               |
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
    - **“New devices require your password and Account Key to unlock your encrypted key material.”**
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
