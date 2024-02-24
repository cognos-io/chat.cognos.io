package auth

import (
	"github.com/labstack/echo/v5"
	"github.com/pocketbase/pocketbase/apis"
)

type User struct {
	IsAdmin bool
}

// ExtractUser extracts the user from the request context.
// Will return nil if the user is not authenticated.
// https://pocketbase.io/docs/go-routing/#retrieving-the-current-auth-state
func ExtractUser(c echo.Context) *User {
	info := apis.RequestInfo(c)
	admin := info.Admin       // nil if not authenticated as admin
	record := info.AuthRecord // nil if not authenticated as regular auth record

	isUnauthenticated := admin == nil && record == nil
	if isUnauthenticated {
		return nil
	}

	isAdmin := admin != nil

	return &User{
		IsAdmin: isAdmin,
	}
}
