package main

import (
	"testing"
)

// TestChatCollectionRulesAreLocked pins the migration-20 stance: the
// chat collections (conversations / public_keys / secret_keys / messages
// / participants) all have nil rules on every operation. The /api/v1
// handlers do the real authorisation by calling the PocketBase app
// directly, which bypasses these rules; locking them outright stops the
// /api/collections/* surface from leaking access via a half-strict
// participants subquery (PocketBase evaluates each @collection.X.*
// clause as an independent existence check, so the obvious "exists an
// active participant" rule is not expressible).
//
// If a future migration unlocks any of these rules, this test fires.
func TestChatCollectionRulesAreLocked(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)

	cases := []struct {
		collection string
		ops        []string
	}{
		{collection: "conversations", ops: []string{"list", "view", "create", "update", "delete"}},
		{collection: "conversation_public_keys", ops: []string{"list", "view", "create", "update", "delete"}},
		{collection: "conversation_secret_keys", ops: []string{"list", "view", "create", "update", "delete"}},
		{collection: "messages", ops: []string{"list", "view", "create", "update", "delete"}},
		{collection: "participants", ops: []string{"list", "view", "create", "update", "delete"}},
	}

	for _, tc := range cases {
		collection, err := app.FindCollectionByNameOrId(tc.collection)
		if err != nil {
			t.Fatalf("FindCollectionByNameOrId(%q) error = %v", tc.collection, err)
		}

		rulesByName := map[string]*string{
			"list":   collection.ListRule,
			"view":   collection.ViewRule,
			"create": collection.CreateRule,
			"update": collection.UpdateRule,
			"delete": collection.DeleteRule,
		}

		for _, op := range tc.ops {
			if rulesByName[op] != nil {
				t.Errorf("%s.%s rule = %q, want nil (locked)", tc.collection, op, *rulesByName[op])
			}
		}
	}
}
