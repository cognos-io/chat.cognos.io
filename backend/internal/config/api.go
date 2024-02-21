package config

type APIConfig struct {
}

// MustLoadAPIConfig loads the API configuration or panics if an error occurs.
func MustLoadAPIConfig() *APIConfig {
	return &APIConfig{}
}
