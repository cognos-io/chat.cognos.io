package migrations

import (
	"encoding/json"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

func importLegacyCollections(app core.App, raw string, deleteMissing bool) error {
	collections, err := normalizeLegacyCollectionsJSON(raw)
	if err != nil {
		return err
	}

	for _, collection := range collections {
		rewriteLegacyFieldCollectionRefs(app, collection)
	}

	return app.ImportCollections(collections, deleteMissing)
}

func addLegacyField(app core.App, collection *core.Collection, raw string) error {
	normalized, err := normalizeLegacyFieldsJSON(raw)
	if err != nil {
		return err
	}

	var field map[string]any
	if err := json.Unmarshal(normalized, &field); err == nil {
		rewriteLegacyFieldCollectionRef(app, field)
		normalized, err = json.Marshal(field)
		if err != nil {
			return err
		}
	}

	return collection.Fields.AddMarshaledJSON(normalized)
}

func normalizeLegacyCollectionsJSON(raw string) ([]map[string]any, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, nil
	}

	var collections []map[string]any
	if strings.HasPrefix(trimmed, "{") {
		var collection map[string]any
		if err := json.Unmarshal([]byte(trimmed), &collection); err != nil {
			return nil, err
		}
		collections = []map[string]any{collection}
	} else {
		if err := json.Unmarshal([]byte(trimmed), &collections); err != nil {
			return nil, err
		}
	}

	for _, collection := range collections {
		normalizeLegacyCollection(collection)
	}

	for i, collection := range collections {
		if name, _ := collection["name"].(string); name == "users" {
			collections = append([]map[string]any{collection}, append(collections[:i], collections[i+1:]...)...)
			break
		}
	}

	return collections, nil
}

func normalizeLegacyFieldsJSON(raw string) ([]byte, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, nil
	}

	var fields []map[string]any
	if strings.HasPrefix(trimmed, "{") {
		var field map[string]any
		if err := json.Unmarshal([]byte(trimmed), &field); err != nil {
			return nil, err
		}
		normalizeLegacyField(field)
		return json.Marshal(field)
	}

	if err := json.Unmarshal([]byte(trimmed), &fields); err != nil {
		return nil, err
	}
	for _, field := range fields {
		normalizeLegacyField(field)
	}

	return json.Marshal(fields)
}

func normalizeLegacyCollection(collection map[string]any) {
	if schema, ok := collection["schema"]; ok {
		collection["fields"] = schema
		delete(collection, "schema")
	}

	name, _ := collection["name"].(string)
	typ, _ := collection["type"].(string)
	id, _ := collection["id"].(string)

	normalized := core.NewCollection(typ, name, id)
	if system, ok := collection["system"].(bool); ok {
		normalized.System = system
	}
	if v, ok := collection["listRule"].(string); ok {
		normalized.ListRule = stringPtr(v)
	}
	if v, ok := collection["viewRule"].(string); ok {
		normalized.ViewRule = stringPtr(v)
	}
	if v, ok := collection["createRule"].(string); ok {
		normalized.CreateRule = stringPtr(v)
	}
	if v, ok := collection["updateRule"].(string); ok {
		normalized.UpdateRule = stringPtr(v)
	}
	if v, ok := collection["deleteRule"].(string); ok {
		normalized.DeleteRule = stringPtr(v)
	}
	if indexes, ok := collection["indexes"].([]any); ok {
		normalized.Indexes = make([]string, 0, len(indexes))
		for _, rawIndex := range indexes {
			if index, ok := rawIndex.(string); ok {
				normalized.Indexes = append(normalized.Indexes, index)
			}
		}
	}
	if name == "users" {
		normalized.System = false
		normalized.OAuth2.Enabled = true
		normalized.OAuth2.MappedFields.Name = "name"
		normalized.OAuth2.MappedFields.AvatarURL = "avatar"
	}

	fields, ok := collection["fields"].([]any)
	if ok && name != "users" {
		normalizedFields := make([]map[string]any, 0, len(fields))
		for _, rawField := range fields {
			field, ok := rawField.(map[string]any)
			if !ok {
				continue
			}
			normalizeLegacyField(field)
			normalizedFields = append(normalizedFields, field)
		}
		if len(normalizedFields) > 0 {
			rawFields, err := json.Marshal(normalizedFields)
			if err == nil {
				_ = normalized.Fields.AddMarshaledJSON(rawFields)
			}
		}
	}

	rawNormalized, err := json.Marshal(normalized)
	if err != nil {
		return
	}

	var normalizedMap map[string]any
	if err := json.Unmarshal(rawNormalized, &normalizedMap); err != nil {
		return
	}

	for key := range collection {
		delete(collection, key)
	}
	for key, value := range normalizedMap {
		collection[key] = value
	}
}

func normalizeLegacyField(field map[string]any) {
	rawOptions, ok := field["options"]
	if !ok {
		return
	}

	options, ok := rawOptions.(map[string]any)
	if !ok {
		return
	}

	for key, value := range options {
		if _, exists := field[key]; exists {
			continue
		}
		field[key] = value
	}

	delete(field, "options")
}

func rewriteLegacyFieldCollectionRefs(app core.App, collection map[string]any) {
	fields, ok := collection["fields"].([]map[string]any)
	if !ok {
		return
	}

	for _, field := range fields {
		rewriteLegacyFieldCollectionRef(app, field)
	}
}

func rewriteLegacyFieldCollectionRef(app core.App, field map[string]any) {
	_ = app
	_ = field
}

func stringPtr(v string) *string {
	return &v
}
