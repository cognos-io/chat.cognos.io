package migrations

import (
	"encoding/json"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/daos"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/models/schema"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(db dbx.Builder) error {
		dao := daos.New(db);

		collection, err := dao.FindCollectionByNameOrId("23wjzzeeb4qilr9")
		if err != nil {
			return err
		}

		collection.ListRule = types.Pointer("@request.auth.id != \"\" &&\n// User should be a viewer, editor or Admin of the conversations\n(@collection.participants.conversation ?= id &&\n@collection.participants.user ?= @request.auth.id &&\n(@collection.participants.role = 'Viewer' || @collection.participants.role = 'Editor' ||@collection.participants.role = 'Admin')\n) || (\n  creator ?= @request.auth.id\n)")

		collection.ViewRule = types.Pointer("@request.auth.id != \"\" &&\n// User should be a viewer, editor or Admin of the conversations\n@collection.participants.conversation ?= id &&\n@collection.participants.user ?= @request.auth.id &&\n(@collection.participants.role = 'Viewer' || @collection.participants.role = 'Editor' ||@collection.participants.role = 'Admin')")

		// update
		edit_creator := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "9j9ur6uc",
			"name": "creator",
			"type": "relation",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"collectionId": "_pb_users_auth_",
				"cascadeDelete": false,
				"minSelect": null,
				"maxSelect": 1,
				"displayFields": null
			}
		}`), edit_creator); err != nil {
			return err
		}
		collection.Schema.AddField(edit_creator)

		return dao.SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db);

		collection, err := dao.FindCollectionByNameOrId("23wjzzeeb4qilr9")
		if err != nil {
			return err
		}

		collection.ListRule = types.Pointer("@request.auth.id != \"\" &&\n// User should be a viewer, editor or Admin of the conversations\n@collection.participants.conversation = id &&\n@collection.participants.user = @request.auth.id &&\n(@collection.participants.role = 'Viewer' || @collection.participants.role = 'Editor' ||@collection.participants.role = 'Admin')")

		collection.ViewRule = types.Pointer("@request.auth.id != \"\" &&\n// User should be a viewer, editor or Admin of the conversations\n@collection.participants.conversation = id &&\n@collection.participants.user = @request.auth.id &&\n(@collection.participants.role = 'Viewer' || @collection.participants.role = 'Editor' ||@collection.participants.role = 'Admin')")

		// update
		edit_creator := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "9j9ur6uc",
			"name": "creator",
			"type": "relation",
			"required": true,
			"presentable": false,
			"unique": false,
			"options": {
				"collectionId": "_pb_users_auth_",
				"cascadeDelete": false,
				"minSelect": null,
				"maxSelect": 1,
				"displayFields": null
			}
		}`), edit_creator); err != nil {
			return err
		}
		collection.Schema.AddField(edit_creator)

		return dao.SaveCollection(collection)
	})
}
