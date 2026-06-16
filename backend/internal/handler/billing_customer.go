package handler

import "github.com/pocketbase/pocketbase/core"

// customerIDForUser resolves the caller's Paddle customer id. It reads the id
// persisted on the users record first; for subscriptions created before that
// was stored on the user, it falls back to the customer id captured on the
// subscription's webhook event (matched via the billing row) and back-fills the
// users record so later lookups are direct.
func customerIDForUser(app core.App, user *core.Record) string {
	if id := user.GetString("paddle_customer_id"); id != "" {
		return id
	}

	billingRec, err := app.FindFirstRecordByData(webhookUserBillingColl, "user_id", user.Id)
	if err != nil || billingRec == nil {
		return ""
	}
	subscriptionID := billingRec.GetString("paddle_subscription_id")
	if subscriptionID == "" {
		return ""
	}

	eventRec, err := app.FindFirstRecordByData(
		paddleEventsCollection, "paddle_subscription_id", subscriptionID,
	)
	if err != nil || eventRec == nil {
		return ""
	}
	id := eventRec.GetString("paddle_customer_id")
	if id != "" {
		user.Set("paddle_customer_id", id)
		_ = app.Save(user)
	}
	return id
}
