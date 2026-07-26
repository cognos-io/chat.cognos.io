package oauth

import (
	"database/sql"
	"errors"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

const (
	collLinkIntents      = "oauth_link_intents"
	collStepUpChallenges = "oauth_step_up_challenges"
	collStepUpSessions   = "oauth_step_up_sessions"
)

// ErrNotFound is returned when a looked-up OAuth proof does not exist or is no
// longer valid.
var ErrNotFound = errors.New("oauth: record not found")

// Store is the PocketBase-backed persistence layer for OAuth link intents and
// delete step-up proofs.
type Store struct {
	app core.App
}

// NewStore returns a Store bound to the given app.
func NewStore(app core.App) *Store { return &Store{app: app} }

func isNoRows(err error) bool {
	return errors.Is(err, sql.ErrNoRows)
}

// CreateLinkIntent mints a one-time intent proving the password factor passed
// for linking Google. Returns the raw token for the client to pass as createData.
func (s *Store) CreateLinkIntent(userID, provider string) (rawToken string, err error) {
	collection, err := s.app.FindCollectionByNameOrId(collLinkIntents)
	if err != nil {
		return "", err
	}
	rawToken = NewToken()
	record := core.NewRecord(collection)
	record.Set("user", userID)
	record.Set("intent_hash", Hash(rawToken))
	record.Set("provider", provider)
	record.Set("expires_at", types.NowDateTime().Add(LinkIntentTTL))
	if err := s.app.Save(record); err != nil {
		return "", err
	}
	return rawToken, nil
}

// ConsumeLinkIntent validates and consumes a raw link intent for the given user
// and provider. Returns ErrNotFound when invalid.
func (s *Store) ConsumeLinkIntent(userID, provider, rawToken string) error {
	record, err := s.findActiveByHash(collLinkIntents, "intent_hash", rawToken)
	if err != nil {
		return err
	}
	if record.GetString("user") != userID || record.GetString("provider") != provider {
		return ErrNotFound
	}
	record.Set("consumed_at", types.NowDateTime())
	return s.app.Save(record)
}

// CreateStepUpChallenge mints a challenge the client must confirm via a fresh
// Google OAuth (createData cognosStepUpChallenge).
func (s *Store) CreateStepUpChallenge(userID, provider string) (rawToken string, err error) {
	collection, err := s.app.FindCollectionByNameOrId(collStepUpChallenges)
	if err != nil {
		return "", err
	}
	rawToken = NewToken()
	record := core.NewRecord(collection)
	record.Set("user", userID)
	record.Set("challenge_hash", Hash(rawToken))
	record.Set("provider", provider)
	record.Set("expires_at", types.NowDateTime().Add(StepUpChallengeTTL))
	if err := s.app.Save(record); err != nil {
		return "", err
	}
	return rawToken, nil
}

// ConfirmStepUpChallenge marks a challenge confirmed after Google re-auth.
func (s *Store) ConfirmStepUpChallenge(userID, provider, rawToken string) error {
	record, err := s.findActiveByHash(collStepUpChallenges, "challenge_hash", rawToken)
	if err != nil {
		return err
	}
	if record.GetString("user") != userID || record.GetString("provider") != provider {
		return ErrNotFound
	}
	if !record.GetDateTime("confirmed_at").IsZero() {
		return nil // idempotent
	}
	record.Set("confirmed_at", types.NowDateTime())
	return s.app.Save(record)
}

// CompleteStepUpChallenge consumes a confirmed challenge and mints an
// oauthStepUpId for account delete.
func (s *Store) CompleteStepUpChallenge(userID, provider, rawChallenge string) (rawSession string, err error) {
	challenge, err := s.findActiveByHash(collStepUpChallenges, "challenge_hash", rawChallenge)
	if err != nil {
		return "", err
	}
	if challenge.GetString("user") != userID || challenge.GetString("provider") != provider {
		return "", ErrNotFound
	}
	if challenge.GetDateTime("confirmed_at").IsZero() {
		return "", ErrNotFound
	}

	collection, err := s.app.FindCollectionByNameOrId(collStepUpSessions)
	if err != nil {
		return "", err
	}
	rawSession = NewToken()
	session := core.NewRecord(collection)
	session.Set("user", userID)
	session.Set("session_hash", Hash(rawSession))
	session.Set("provider", provider)
	session.Set("expires_at", types.NowDateTime().Add(StepUpSessionTTL))
	if err := s.app.Save(session); err != nil {
		return "", err
	}

	challenge.Set("consumed_at", types.NowDateTime())
	if err := s.app.Save(challenge); err != nil {
		return "", err
	}
	return rawSession, nil
}

// ConsumeStepUpSession validates and consumes an oauthStepUpId for the user.
func (s *Store) ConsumeStepUpSession(userID, rawToken string) error {
	record, err := s.findActiveByHash(collStepUpSessions, "session_hash", rawToken)
	if err != nil {
		return err
	}
	if record.GetString("user") != userID {
		return ErrNotFound
	}
	record.Set("consumed_at", types.NowDateTime())
	return s.app.Save(record)
}

func (s *Store) findActiveByHash(collection, hashField, rawToken string) (*core.Record, error) {
	if rawToken == "" {
		return nil, ErrNotFound
	}
	record, err := s.app.FindFirstRecordByData(collection, hashField, Hash(rawToken))
	if err != nil {
		if isNoRows(err) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if !record.GetDateTime("consumed_at").IsZero() {
		return nil, ErrNotFound
	}
	if expires := record.GetDateTime("expires_at"); expires.IsZero() || expires.Before(types.NowDateTime()) {
		return nil, ErrNotFound
	}
	return record, nil
}
