package billing

import (
	"strings"
	"testing"

	"pgregory.net/rapid"
)

// Property: parsing valid plan strings is stable under whitespace and returns
// the canonical enum value. The example tests cover the exact aliases; this
// pins the normalisation contract across arbitrary padding.
func TestParsePlanTypeValidRoundTripProperties(t *testing.T) {
	t.Parallel()

	type planCase struct {
		raw  string
		want PlanType
	}

	rapid.Check(t, func(t *rapid.T) {
		tc := rapid.SampledFrom([]planCase{
			{raw: string(PlanTypeTrial), want: PlanTypeTrial},
			{raw: string(PlanTypePayG), want: PlanTypePayG},
			{raw: string(PlanTypeUnlimited), want: PlanTypeUnlimited},
			{raw: "flat_rate", want: PlanTypeUnlimited},
			{raw: string(PlanTypeInactive), want: PlanTypeInactive},
		}).Draw(t, "plan")
		prefix := rapid.SampledFrom([]string{"", " ", "\t", "\n", " \t"}).Draw(t, "prefix")
		suffix := rapid.SampledFrom([]string{"", " ", "\t", "\n", "\t "}).Draw(t, "suffix")

		got, err := ParsePlanType(prefix + tc.raw + suffix)
		if err != nil {
			t.Fatalf("ParsePlanType(%q) returned error: %v", prefix+tc.raw+suffix, err)
		}
		if got != tc.want {
			t.Fatalf("ParsePlanType(%q) = %q, want %q", prefix+tc.raw+suffix, got, tc.want)
		}
		if strings.TrimSpace(prefix+tc.raw+suffix) != tc.raw {
			t.Fatalf("test generator produced unexpected padding around %q", tc.raw)
		}
	})
}

// Property: obviously invalid plan strings stay invalid after harmless
// surrounding whitespace is removed. This keeps the parser strict while still
// accepting the documented aliases.
func TestParsePlanTypeRejectsUnknownProperties(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		raw := rapid.SampledFrom([]string{
			"", "trialx", "pay", "flat", "unknown", "in active", "unlimited!", "inactive-plan",
		}).Draw(t, "raw")
		prefix := rapid.SampledFrom([]string{"", " ", "\t"}).Draw(t, "prefix")
		suffix := rapid.SampledFrom([]string{"", " ", "\n"}).Draw(t, "suffix")

		if got, err := ParsePlanType(prefix + raw + suffix); err == nil {
			t.Fatalf("ParsePlanType(%q) = %q, want error", prefix+raw+suffix, got)
		}
	})
}
