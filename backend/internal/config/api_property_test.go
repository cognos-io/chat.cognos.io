package config

import (
	"strings"
	"testing"

	"pgregory.net/rapid"
)

// Property: a well-formed COGNOS_<SECTION>_<REST> env key maps to
// "<section>.<rest>" — the FIRST underscore after the prefix is the section
// delimiter and every later underscore survives verbatim (api_key,
// trial_seed_rappen, …). This is the contract the koanf struct tags rely on.
func TestEnvKeyToConfigPathRoundTripProperty(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		section := rapid.StringMatching(`[a-z][a-z0-9]{0,15}`).Draw(t, "section")
		rest := rapid.StringMatching(`[a-z][a-z0-9_]{0,30}`).Draw(t, "rest")

		envKey := "COGNOS_" + strings.ToUpper(section) + "_" + strings.ToUpper(rest)
		got := envKeyToConfigPath(envKey)
		want := section + "." + rest

		if got != want {
			t.Fatalf("envKeyToConfigPath(%q) = %q, want %q", envKey, got, want)
		}
	})
}

// Property: keys without the COGNOS_ prefix are always ignored (mapped to ""),
// no matter what they contain — foreign env vars can never leak into config.
func TestEnvKeyToConfigPathIgnoresForeignKeysProperty(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		key := rapid.String().Draw(t, "key")
		if strings.HasPrefix(key, "COGNOS_") {
			key = "X" + key
		}
		if got := envKeyToConfigPath(key); got != "" {
			t.Fatalf("envKeyToConfigPath(%q) = %q, want \"\" for a non-COGNOS key", key, got)
		}
	})
}

// Property: for any COGNOS_-prefixed key, the output is lowercase and contains
// at most one dot (inserted at the first underscore) — the shape koanf's flat
// paths expect.
func TestEnvKeyToConfigPathShapeProperty(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		suffix := rapid.StringMatching(`[A-Z0-9_]{0,40}`).Draw(t, "suffix")
		got := envKeyToConfigPath("COGNOS_" + suffix)

		if got != strings.ToLower(got) {
			t.Fatalf("envKeyToConfigPath output %q is not lowercase", got)
		}
		if strings.Count(got, ".") > 1 {
			t.Fatalf("envKeyToConfigPath output %q has more than one section delimiter", got)
		}
	})
}
