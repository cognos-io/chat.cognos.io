// Package requestysync enriches curated ai_models records with fresh metadata
// from Requesty's model API. It is deliberately enrich-only: it updates derived
// fields (reasoning support, pricing, context window) on models we already
// curate, and never touches curation/compliance fields (enabled, whitelisted,
// privacy_tier, hosting_*). Models change often, so this keeps the catalogue
// current without re-curating by hand.
package requestysync

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// DefaultBaseURL is Requesty's EU gateway, matching the gateway default.
const DefaultBaseURL = "https://router.eu.requesty.ai"

// RequestyModel is the subset of Requesty's /v1/models entry we consume. Prices
// are per-token USD (e.g. 0.0000011 == $1.10 / 1M tokens).
type RequestyModel struct {
	ID                      string  `json:"id"`
	SupportsReasoning       bool    `json:"supports_reasoning"`
	SupportsVision          bool    `json:"supports_vision"`
	SupportsToolCalling     bool    `json:"supports_tool_calling"`
	SupportsWebSearch       bool    `json:"supports_web_search"`
	SupportsComputerUse     bool    `json:"supports_computer_use"`
	SupportsImageGeneration bool    `json:"supports_image_generation"`
	InputPrice              float64 `json:"input_price"`
	OutputPrice             float64 `json:"output_price"`
	ContextWindow           int     `json:"context_window"`
	MaxOutputTokens         int     `json:"max_output_tokens"`
	// Geolocation is Requesty's flat data-residency field for where the model
	// is actually served (e.g. "eu", "us", "global"). It gates
	// supports_web_search (spec Decision 2): only exactly "eu" keeps the
	// capability, regardless of what SupportsWebSearch reports.
	Geolocation string `json:"geolocation"`
}

// Client fetches the Requesty model catalogue. It carries no secrets beyond the
// API key and never logs response bodies.
type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

func NewClient(baseURL, apiKey string) *Client {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" {
		base = DefaultBaseURL
	}
	return &Client{
		baseURL: base,
		apiKey:  strings.TrimSpace(apiKey),
		http:    &http.Client{Timeout: 20 * time.Second},
	}
}

// FetchModels returns the models Requesty exposes for our API key.
func (c *Client) FetchModels(ctx context.Context) ([]RequestyModel, error) {
	if c == nil || c.apiKey == "" {
		return nil, fmt.Errorf("requesty client is not configured")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/v1/models", nil)
	if err != nil {
		return nil, fmt.Errorf("build requesty models request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("requesty models request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		// Never echo the body — it may carry account detail.
		return nil, fmt.Errorf("requesty models request returned status %d", resp.StatusCode)
	}

	// Requesty returns OpenAI's list envelope ({"data":[...]}); tolerate a bare
	// array too.
	var envelope struct {
		Data []RequestyModel `json:"data"`
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read requesty models response: %w", err)
	}
	if err := json.Unmarshal(body, &envelope); err == nil && len(envelope.Data) > 0 {
		return envelope.Data, nil
	}

	var bare []RequestyModel
	if err := json.Unmarshal(body, &bare); err != nil {
		return nil, fmt.Errorf("decode requesty models response: %w", err)
	}
	return bare, nil
}
