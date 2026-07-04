package handler

import (
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/catalogue"
)

// The full web-search gate matrix: request opt-in state (nil/true/false) ×
// model capability (supported/not) × provider (requesty/other). The tool is
// enabled only when the request does not opt out AND the model is a
// search-capable, Requesty-routed one; every other cell drops it silently.
func TestWebSearchEnabledForModelMatrix(t *testing.T) {
	t.Parallel()

	trueP, falseP := true, false
	optIn := map[string]*bool{"omitted(nil)": nil, "explicit true": &trueP, "explicit false": &falseP}
	providers := []string{requestyProviderID, "infomaniak"}
	capable := []bool{true, false}

	for optName, opt := range optIn {
		for _, provider := range providers {
			for _, supports := range capable {
				model := catalogue.Model{ProviderID: provider, SupportsWebSearch: supports}
				// Enabled only when not opted out, capable, and Requesty.
				want := (opt == nil || *opt) && supports && provider == requestyProviderID
				got := webSearchEnabledForModel(opt, model)
				if got != want {
					t.Errorf("webSearch=%s provider=%s supports=%v: gate = %v, want %v",
						optName, provider, supports, got, want)
				}
			}
		}
	}
}
