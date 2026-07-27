package main

import (
	"testing"
	"time"

	"github.com/cognos-io/chat.cognos.io/backend/internal/oauth"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

func TestOAuthStoreLinkIntentConsumeOnce(t *testing.T) {
	t.Parallel()
	app := setupTestApp(t)
	defer app.Cleanup()

	userID := mustUserID(t, app, testUserEmail)
	store := oauth.NewStore(app)

	raw, err := store.CreateLinkIntent(userID, oauth.ProviderGoogle)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.ConsumeLinkIntent(userID, oauth.ProviderGoogle, raw); err != nil {
		t.Fatalf("first consume: %v", err)
	}
	if err := store.ConsumeLinkIntent(userID, oauth.ProviderGoogle, raw); err == nil {
		t.Fatal("second consume should fail")
	}
}

func TestOAuthStoreLinkIntentRejectsWrongUser(t *testing.T) {
	t.Parallel()
	app := setupTestApp(t)
	defer app.Cleanup()

	userID := mustUserID(t, app, testUserEmail)
	store := oauth.NewStore(app)
	raw, err := store.CreateLinkIntent(userID, oauth.ProviderGoogle)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.ConsumeLinkIntent("not-the-user", oauth.ProviderGoogle, raw); err == nil {
		t.Fatal("consume for wrong user should fail")
	}
}

func TestOAuthStoreStepUpRequiresConfirm(t *testing.T) {
	t.Parallel()
	app := setupTestApp(t)
	defer app.Cleanup()

	userID := mustUserID(t, app, testUserEmail)
	store := oauth.NewStore(app)
	challenge, err := store.CreateStepUpChallenge(userID, oauth.ProviderGoogle)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CompleteStepUpChallenge(userID, oauth.ProviderGoogle, challenge); err == nil {
		t.Fatal("complete without confirm should fail")
	}
	if err := store.ConfirmStepUpChallenge(userID, oauth.ProviderGoogle, challenge); err != nil {
		t.Fatal(err)
	}
	stepUp, err := store.CompleteStepUpChallenge(userID, oauth.ProviderGoogle, challenge)
	if err != nil {
		t.Fatal(err)
	}
	if stepUp == "" {
		t.Fatal("empty step-up id")
	}
	if err := store.ConsumeStepUpSession(userID, stepUp); err != nil {
		t.Fatal(err)
	}
	if err := store.ConsumeStepUpSession(userID, stepUp); err == nil {
		t.Fatal("step-up session must be single-use")
	}
}

func TestOAuthStoreStepUpRejectsCrossUserSession(t *testing.T) {
	t.Parallel()
	app := setupTestApp(t)
	defer app.Cleanup()

	userID := mustUserID(t, app, testUserEmail)
	otherID := mustUserID(t, app, "test2@example.com")
	store := oauth.NewStore(app)

	challenge, err := store.CreateStepUpChallenge(userID, oauth.ProviderGoogle)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.ConfirmStepUpChallenge(userID, oauth.ProviderGoogle, challenge); err != nil {
		t.Fatal(err)
	}
	stepUp, err := store.CompleteStepUpChallenge(userID, oauth.ProviderGoogle, challenge)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.ConsumeStepUpSession(otherID, stepUp); err == nil {
		t.Fatal("cross-user step-up session consume must fail")
	}
	// Original owner can still consume (session was not burnt by the reject).
	if err := store.ConsumeStepUpSession(userID, stepUp); err != nil {
		t.Fatalf("owner consume after cross-user reject: %v", err)
	}
}

func TestOAuthStoreStepUpRejectsExpiredChallenge(t *testing.T) {
	t.Parallel()
	app := setupTestApp(t)
	defer app.Cleanup()

	userID := mustUserID(t, app, testUserEmail)
	store := oauth.NewStore(app)
	challenge, err := store.CreateStepUpChallenge(userID, oauth.ProviderGoogle)
	if err != nil {
		t.Fatal(err)
	}
	expireOAuthRecordByHash(t, app, "oauth_step_up_challenges", "challenge_hash", challenge)

	if err := store.ConfirmStepUpChallenge(userID, oauth.ProviderGoogle, challenge); err == nil {
		t.Fatal("confirm on expired challenge must fail")
	}
}

func TestOAuthStoreStepUpRejectsExpiredSession(t *testing.T) {
	t.Parallel()
	app := setupTestApp(t)
	defer app.Cleanup()

	userID := mustUserID(t, app, testUserEmail)
	store := oauth.NewStore(app)
	challenge, err := store.CreateStepUpChallenge(userID, oauth.ProviderGoogle)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.ConfirmStepUpChallenge(userID, oauth.ProviderGoogle, challenge); err != nil {
		t.Fatal(err)
	}
	stepUp, err := store.CompleteStepUpChallenge(userID, oauth.ProviderGoogle, challenge)
	if err != nil {
		t.Fatal(err)
	}
	expireOAuthRecordByHash(t, app, "oauth_step_up_sessions", "session_hash", stepUp)

	if err := store.ConsumeStepUpSession(userID, stepUp); err == nil {
		t.Fatal("consume on expired session must fail")
	}
}

func expireOAuthRecordByHash(
	t testing.TB,
	app core.App,
	collection, hashField, rawToken string,
) {
	t.Helper()
	record, err := app.FindFirstRecordByData(collection, hashField, oauth.Hash(rawToken))
	if err != nil {
		t.Fatal(err)
	}
	record.Set("expires_at", types.NowDateTime().Add(-time.Minute))
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
}
