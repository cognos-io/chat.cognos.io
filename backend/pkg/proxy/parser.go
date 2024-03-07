package proxy

import (
	"fmt"
	"strings"

	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
)

const (
	// ModelNameSeparator is the separator used to
	// separate the model provider and name
	ModelNameSeparator = "/"
)

// ParseModelName parses the model name and returns an
// error if the model name is invalid.
func ParseModelName(config *config.APIConfig, modelName string) (Upstream, error) {
	modelParts := strings.Split(modelName, ModelNameSeparator)
	if len(modelParts) != 2 {
		return nil, fmt.Errorf("invalid model name: %s", modelName)
	}

	provider := modelParts[0]
	model := modelParts[1]

	switch provider {
	case "openai":
		return NewOpenAI(config, model)
	case "together":
	case "anthropic":
	case "google":
	case "grok":
	case "x":
	default:
		return nil, fmt.Errorf("invalid model provider: %s", provider)
	}

	return nil, fmt.Errorf("unable to process model name: %s", modelName)
}
