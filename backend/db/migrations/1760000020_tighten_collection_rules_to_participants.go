package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Lock the PocketBase /api/collections/* surface on the chat collections.
// Pre-migration these collections used a `creator = @request.auth.id`
// fallback rule that no longer matched the participant-based access model
// implemented in /api/v1/*. The natural rewrite — replacing the rule with
// a participants subquery — runs into the limitation that PocketBase
// evaluates each `@collection.X.*` clause as an independent existence
// check (verified experimentally), so we cannot express
// "exists a participants row matching conversation AND user AND
// removed_at = ”" inside a single rule.
//
// Instead of half-strict rules that leak access across conversations to
// revoked participants, we lock the collection routes entirely. Every
// production path uses /api/v1/*, which calls the PocketBase app
// directly (bypassing collection rules) after authorising via the
// participants repo. Direct /api/collections/* access on these tables
// now returns 403 for everyone, including the conversation creator.
//
// participants itself is also locked — only /api/v1/conversations/{id}/
// participants writes to it.
func init() {
	m.Register(func(app core.App) error {
		for _, name := range []string{
			"conversations",
			"conversation_public_keys",
			"conversation_secret_keys",
			"messages",
		} {
			if err := lockAllCollectionRules(app, name); err != nil {
				return err
			}
		}
		return nil
	}, func(app core.App) error {
		if err := setRules(app, "conversations", legacyConversationsRules); err != nil {
			return err
		}
		if err := setRules(app, "conversation_public_keys", legacyPublicKeysRules); err != nil {
			return err
		}
		if err := setRules(app, "conversation_secret_keys", legacySecretKeysRules); err != nil {
			return err
		}
		if err := setRules(app, "messages", legacyMessagesRules); err != nil {
			return err
		}
		return nil
	})
}

// Stash the legacy rule strings so the down-migration can restore them.
// Kept as one block to make audit-trail review easy.
var (
	legacyConversationsRules = collectionRuleSet{
		List:   `@request.auth.id != "" && creator = @request.auth.id`,
		View:   `@request.auth.id != "" && creator = @request.auth.id`,
		Create: `@request.auth.id != "" && @request.body.creator = @request.auth.id && @request.body.data:isset = true && @request.body.id:isset = false && @request.body.created:isset = false && @request.body.updated:isset = false`,
		Update: `@request.auth.id != "" && creator = @request.auth.id`,
		Delete: `@request.auth.id != "" && creator = @request.auth.id`,
	}
	legacyPublicKeysRules = collectionRuleSet{
		List:   `@request.auth.id != "" && conversation.creator = @request.auth.id`,
		Create: `@request.auth.id != "" && @request.body.id:isset = false && @request.body.public_key:isset = true && @request.body.public_key_signature:isset = true && @request.body.conversation:isset = true && @request.body.updated:isset = false && @request.body.created:isset = false && conversation.creator = @request.auth.id`,
		Update: `@request.auth.id != "" && conversation.creator = @request.auth.id && @request.body.id:isset = false && @request.body.created:isset = false && @request.body.updated:isset = false && @request.body.conversation:isset = false && @request.body.public_key:isset = false && @request.body.public_key_signature:isset = true`,
	}
	legacySecretKeysRules = collectionRuleSet{
		List:   `@request.auth.id != "" && user = @request.auth.id && conversation.creator = @request.auth.id`,
		Create: `@request.auth.id != "" && @request.body.id:isset = false && @request.body.secret_key:isset = true && @request.body.conversation:isset = true && @request.body.updated:isset = false && @request.body.created:isset = false && @request.body.user = @request.auth.id && conversation.creator = @request.auth.id`,
	}
	legacyMessagesRules = collectionRuleSet{
		List:   `@request.auth.id != "" && conversation = @request.query.conversation && conversation.creator = @request.auth.id`,
		Update: `@request.auth.id != "" && conversation.creator = @request.auth.id && @request.body.id:isset = false && @request.body.data:isset = false && @request.body.conversation:isset = false && @request.body.parent_message:isset = false && @request.body.created:isset = false && @request.body.updated:isset = false`,
		Delete: `@request.auth.id != "" && conversation.creator = @request.auth.id`,
	}
)

type collectionRuleSet struct {
	List, View, Create, Update, Delete string
}

// lockAllCollectionRules sets every rule on the collection to nil. With
// no rule present, the PocketBase /api/collections/<name>/* routes reject
// every request — only admin-bypassed access (i.e. the in-process app
// calls used by /api/v1 handlers) can read or write the rows.
func lockAllCollectionRules(app core.App, name string) error {
	collection, err := app.FindCollectionByNameOrId(name)
	if err != nil {
		return err
	}
	collection.ListRule = nil
	collection.ViewRule = nil
	collection.CreateRule = nil
	collection.UpdateRule = nil
	collection.DeleteRule = nil
	return app.Save(collection)
}

// setRules applies only the non-empty fields of `rules` to the collection.
// Used by the down-migration to restore the historical rule strings.
func setRules(app core.App, name string, rules collectionRuleSet) error {
	collection, err := app.FindCollectionByNameOrId(name)
	if err != nil {
		return err
	}
	if rules.List != "" {
		collection.ListRule = types.Pointer(rules.List)
	}
	if rules.View != "" {
		collection.ViewRule = types.Pointer(rules.View)
	}
	if rules.Create != "" {
		collection.CreateRule = types.Pointer(rules.Create)
	}
	if rules.Update != "" {
		collection.UpdateRule = types.Pointer(rules.Update)
	}
	if rules.Delete != "" {
		collection.DeleteRule = types.Pointer(rules.Delete)
	}
	return app.Save(collection)
}
