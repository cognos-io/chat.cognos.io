package migrations

import (
	"testing"
)

func TestOAuthSchema(t *testing.T) {
	app := bootMigratedApp(t)

	t.Run("OAuth2 enabled with display_name mapping", func(t *testing.T) {
		users := mustCollection(t, app, "users")
		if !users.OAuth2.Enabled {
			t.Fatal("users.OAuth2.Enabled = false, want true")
		}
		if got, want := users.OAuth2.MappedFields.Name, "display_name"; got != want {
			t.Fatalf("MappedFields.Name = %q, want %q", got, want)
		}
		if users.OAuth2.MappedFields.AvatarURL != "" {
			t.Fatalf("MappedFields.AvatarURL = %q, want empty", users.OAuth2.MappedFields.AvatarURL)
		}
		assertHasFields(t, users, "has_cognos_password")
		field := users.Fields.GetByName("has_cognos_password")
		if field != nil && !field.GetHidden() {
			t.Error("users.has_cognos_password must be hidden from the API")
		}
	})

	for _, name := range []string{
		"oauth_link_intents",
		"oauth_step_up_challenges",
		"oauth_step_up_sessions",
	} {
		t.Run(name+" is locked", func(t *testing.T) {
			c := mustCollection(t, app, name)
			if c.ListRule != nil || c.ViewRule != nil || c.CreateRule != nil ||
				c.UpdateRule != nil || c.DeleteRule != nil {
				t.Fatalf("%s API rules must all be null (locked)", name)
			}
		})
	}
}
