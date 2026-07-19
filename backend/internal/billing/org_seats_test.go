package billing

import (
	"testing"

	"pgregory.net/rapid"
)

func TestBilledOrgSeatQuantity(t *testing.T) {
	cases := []struct {
		members int64
		want    int64
	}{
		{0, 3},
		{1, 3},
		{2, 3},
		{3, 3},
		{4, 4},
		{10, 10},
	}
	for _, tc := range cases {
		if got := BilledOrgSeatQuantity(tc.members); got != tc.want {
			t.Errorf("BilledOrgSeatQuantity(%d) = %d, want %d", tc.members, got, tc.want)
		}
	}
}

func TestClampOrgSeatQuantity(t *testing.T) {
	if got := ClampOrgSeatQuantity(1); got != 3 {
		t.Errorf("ClampOrgSeatQuantity(1) = %d, want 3", got)
	}
	if got := ClampOrgSeatQuantity(5); got != 5 {
		t.Errorf("ClampOrgSeatQuantity(5) = %d, want 5", got)
	}
}

func TestBilledOrgSeatQuantityProperty(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		members := rapid.Int64Range(0, 100).Draw(t, "members")
		got := BilledOrgSeatQuantity(members)
		if got < MinOrgSeatQuantity {
			t.Fatalf("BilledOrgSeatQuantity(%d) = %d, want >= %d", members, got, MinOrgSeatQuantity)
		}
		if members < MinOrgSeatQuantity && got != MinOrgSeatQuantity {
			t.Fatalf("BilledOrgSeatQuantity(%d) = %d, want %d", members, got, MinOrgSeatQuantity)
		}
		if members >= MinOrgSeatQuantity && got != members {
			t.Fatalf("BilledOrgSeatQuantity(%d) = %d, want %d", members, got, members)
		}
	})
}
