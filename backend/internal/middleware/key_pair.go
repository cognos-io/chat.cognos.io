package middleware

import "github.com/labstack/echo/v5"

// LoadKeyPair is a middleware that loads the relevant key pairs into the request context.
func LoadKeyPair(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		return next(c)
	}
}
