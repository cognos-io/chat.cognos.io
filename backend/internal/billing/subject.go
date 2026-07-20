package billing

// SubjectKind discriminates who pays for a request: a personal Account
// (user_billing) or an Organisation (org_billing). The Paddle webhook slice
// reuses the same discriminator to route subscription events.
type SubjectKind string

const (
	SubjectUser SubjectKind = "user"
	SubjectOrg  SubjectKind = "org"
)

// Subject identifies the billing subject a request settles against. The
// acting Account is always recorded separately on the ledger row (user_id)
// for audit — the Subject only decides whose plan gates the request and whose
// cycle the usage accrues to.
type Subject struct {
	Kind SubjectKind
	ID   string
}

// UserSubject is the personal billing subject for a user.
func UserSubject(userID string) Subject {
	return Subject{Kind: SubjectUser, ID: userID}
}

// OrgSubject is the pooled billing subject for an Organisation.
func OrgSubject(orgID string) Subject {
	return Subject{Kind: SubjectOrg, ID: orgID}
}

// OrganisationID returns the Organisation id when the subject is an org, and
// the empty string for a personal subject — exactly the value a ledger row's
// `organisation` column wants.
func (s Subject) OrganisationID() string {
	if s.Kind == SubjectOrg {
		return s.ID
	}
	return ""
}

// ResolvedState is the outcome of resolving a request's billing context: the
// subject that pays, its billing state, and (for org subjects) the
// Organisation's name so restriction copy can name it. OrganisationName is
// operational metadata, never content.
type ResolvedState struct {
	Subject          Subject
	State            State
	OrganisationName string
}

// ContextStateRepo resolves the billing subject from a conversation's scope:
// conversation → project → organisation. Implemented by PocketBaseRepo;
// deliberately a separate interface from StateRepo so existing StateRepo
// stubs (and any deployment without orgs) keep the personal path untouched.
type ContextStateRepo interface {
	StateForContext(userID, conversationID string) (ResolvedState, error)
}

// ResolveState is the seam gate call sites use. When the repo can resolve a
// conversation's billing context it does so; a plain StateRepo always
// resolves the personal subject, preserving pre-org behaviour byte for byte.
// The returned Subject is valid even when the error is ErrStateNotFound so
// callers always know who was resolved.
func ResolveState(repo StateRepo, userID, conversationID string) (ResolvedState, error) {
	if resolver, ok := repo.(ContextStateRepo); ok {
		return resolver.StateForContext(userID, conversationID)
	}
	state, err := repo.StateForUser(userID)
	return ResolvedState{Subject: UserSubject(userID), State: state}, err
}
