package billing

import (
	"errors"
	"testing"
)

func TestSubjectOrganisationID(t *testing.T) {
	t.Parallel()

	if got := OrgSubject("org1").OrganisationID(); got != "org1" {
		t.Errorf("OrgSubject(org1).OrganisationID() = %q, want %q", got, "org1")
	}
	if got := UserSubject("user1").OrganisationID(); got != "" {
		t.Errorf("UserSubject(user1).OrganisationID() = %q, want empty", got)
	}
}

type stubStateRepo struct {
	state State
	err   error
}

func (r stubStateRepo) StateForUser(string) (State, error) {
	return r.state, r.err
}

// ResolveState is the seam the completion/image gates call: a plain StateRepo
// (like the stubs in handler tests) always resolves to the personal subject,
// preserving the pre-org behaviour byte for byte; only a repo that also
// implements ContextStateRepo can resolve an org subject.
func TestResolveStateFallsBackToPersonalForPlainStateRepo(t *testing.T) {
	t.Parallel()

	resolved, err := ResolveState(stubStateRepo{state: State{PlanType: PlanTypePayG}}, "user1", "conv1")
	if err != nil {
		t.Fatalf("ResolveState() error = %v", err)
	}
	if resolved.Subject != UserSubject("user1") {
		t.Errorf("ResolveState().Subject = %+v, want personal user1", resolved.Subject)
	}
	if resolved.State.PlanType != PlanTypePayG {
		t.Errorf("ResolveState().State.PlanType = %q, want %q", resolved.State.PlanType, PlanTypePayG)
	}
}

func TestResolveStatePropagatesStateNotFound(t *testing.T) {
	t.Parallel()

	resolved, err := ResolveState(stubStateRepo{err: ErrStateNotFound}, "user1", "")
	if !errors.Is(err, ErrStateNotFound) {
		t.Fatalf("ResolveState() error = %v, want ErrStateNotFound", err)
	}
	// The subject still identifies who was resolved so callers can attribute.
	if resolved.Subject != UserSubject("user1") {
		t.Errorf("ResolveState().Subject = %+v, want personal user1", resolved.Subject)
	}
}

type stubContextStateRepo struct {
	stubStateRepo
	resolved ResolvedState
}

func (r stubContextStateRepo) StateForContext(string, string) (ResolvedState, error) {
	return r.resolved, nil
}

func TestResolveStateUsesContextResolverWhenAvailable(t *testing.T) {
	t.Parallel()

	want := ResolvedState{
		Subject:          OrgSubject("org1"),
		State:            State{PlanType: PlanTypePayG},
		OrganisationName: "Acme GmbH",
	}
	resolved, err := ResolveState(stubContextStateRepo{resolved: want}, "user1", "conv1")
	if err != nil {
		t.Fatalf("ResolveState() error = %v", err)
	}
	if resolved != want {
		t.Errorf("ResolveState() = %+v, want %+v", resolved, want)
	}
}
