package auth

import "github.com/pocketbase/pocketbase/core"

type User struct {
	ID      string
	IsAdmin bool
}

func IsAuthenticated(e *core.RequestEvent) bool {
	return e.Auth != nil
}

// ExtractUser extracts the user from the request context.
// Will return nil if the user is not authenticated.
func ExtractUser(e *core.RequestEvent) *User {
	if !IsAuthenticated(e) {
		return nil
	}

	return &User{
		ID:      e.Auth.Id,
		IsAdmin: e.Auth.IsSuperuser(),
	}
}
