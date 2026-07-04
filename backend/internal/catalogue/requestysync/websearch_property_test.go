package requestysync

import (
	"testing"

	"pgregory.net/rapid"
)

// Explicit case/whitespace variants around the "eu" sentinel: the match is
// exact and byte-for-byte, so any capitalisation or surrounding whitespace
// forces the capability off (the field is Requesty's own EU claim — we never
// widen it).
func TestSupportsWebSearchForIsByteExactEU(t *testing.T) {
	t.Parallel()

	offVariants := []string{"EU", "Eu", "eU", " eu", "eu ", " eu ", "eu\n", "europe", "eu-central", "\teu"}
	for _, geo := range offVariants {
		if supportsWebSearchFor(RequestyModel{SupportsWebSearch: true, Geolocation: geo}) {
			t.Errorf("supportsWebSearchFor(geolocation=%q) = true, want false (exact %q match only)", geo, "eu")
		}
	}
	if !supportsWebSearchFor(RequestyModel{SupportsWebSearch: true, Geolocation: "eu"}) {
		t.Fatal("supportsWebSearchFor(geolocation=\"eu\") = false, want true")
	}
}

// Property: the predicate is exactly (SupportsWebSearch AND geolocation == "eu")
// over arbitrary flags and geolocation strings — so whenever it returns true the
// geolocation is byte-equal "eu", and it never invents EU residency Requesty did
// not claim.
func TestSupportsWebSearchForPredicateProperty(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		supports := rapid.Bool().Draw(t, "supports")
		geo := rapid.OneOf(
			rapid.Just("eu"),
			rapid.Just(""),
			rapid.SampledFrom([]string{"EU", "Eu", "global", "us", "uk", "ap", " eu "}),
			rapid.String(),
		).Draw(t, "geo")

		got := supportsWebSearchFor(RequestyModel{SupportsWebSearch: supports, Geolocation: geo})
		want := supports && geo == "eu"
		if got != want {
			t.Fatalf("supportsWebSearchFor(supports=%v, geo=%q) = %v, want %v", supports, geo, got, want)
		}
		if got && geo != "eu" {
			t.Fatalf("predicate true but geolocation %q is not byte-equal \"eu\"", geo)
		}
	})
}
