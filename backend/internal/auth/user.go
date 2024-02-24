package auth

import (
	"github.com/labstack/echo/v5"
	"github.com/pocketbase/pocketbase/apis"
)

type User struct {
	ID      string
	IsAdmin bool
}

// IsAdmin checks if the user authenticated in the given echo.Context is an admin.
// It returns true if the user is an admin, otherwise false.
func IsAdmin(c echo.Context) bool {
	info := apis.RequestInfo(c)
	admin := info.Admin // nil if not authenticated as admin

	return admin != nil
}

func IsAuthenticated(c echo.Context) bool {
	info := apis.RequestInfo(c)
	admin := info.Admin       // nil if not authenticated as admin
	record := info.AuthRecord // nil if not authenticated as regular auth record

	return admin != nil || record != nil
}

// ExtractUser extracts the user from the request context.
// Will return nil if the user is not authenticated.
// https://pocketbase.io/docs/go-routing/#retrieving-the-current-auth-state
func ExtractUser(c echo.Context) *User {
	if !IsAuthenticated(c) {
		return nil
	}

	info := apis.RequestInfo(c)
	admin := info.Admin       // nil if not authenticated as admin
	record := info.AuthRecord // nil if not authenticated as regular auth record

	isAdmin := admin != nil

	return &User{
		ID:      record.Id,
		IsAdmin: isAdmin,
	}
}
