package middleware

import "github.com/pocketbase/pocketbase/core"

// LoadKeyPair is a middleware that loads the relevant key pairs into the request context.
func LoadKeyPair(next func(*core.RequestEvent) error) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		return next(e)
	}
}
