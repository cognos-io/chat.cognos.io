package billing

import (
	"fmt"
	"strings"
)

func ParsePlanType(value string) (PlanType, error) {
	switch strings.TrimSpace(value) {
	case string(PlanTypeTrial):
		return PlanTypeTrial, nil
	case string(PlanTypePayG):
		return PlanTypePayG, nil
	case string(PlanTypeUnlimited), "flat_rate":
		return PlanTypeUnlimited, nil
	case string(PlanTypeInactive):
		return PlanTypeInactive, nil
	default:
		return "", fmt.Errorf("invalid billing plan type %q", value)
	}
}
