package main

import (
	"strings"
	"testing"
)

func TestCollectionRulesDoNotReferenceDeletedParticipants(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)

	for _, collectionName := range []string{
		"conversations",
		"conversation_public_keys",
		"conversation_secret_keys",
		"messages",
	} {
		collection, err := app.FindCollectionByNameOrId(collectionName)
		if err != nil {
			t.Fatalf("FindCollectionByNameOrId(%q) error = %v", collectionName, err)
		}

		for ruleName, rule := range map[string]*string{
			"list":   collection.ListRule,
			"view":   collection.ViewRule,
			"create": collection.CreateRule,
			"update": collection.UpdateRule,
			"delete": collection.DeleteRule,
		} {
			if rule != nil && strings.Contains(*rule, "@collection.participants") {
				t.Fatalf("%s.%s rule still references deleted participants collection", collectionName, ruleName)
			}
		}
	}
}
