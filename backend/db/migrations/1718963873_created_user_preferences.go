package migrations

import (
	"encoding/json"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/daos"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/models"
)

func init() {
	m.Register(func(db dbx.Builder) error {
		jsonData := `{
			"id": "ck0wav09a3ouets",
			"created": "2024-06-21 09:57:53.969Z",
			"updated": "2024-06-21 09:57:53.969Z",
			"name": "user_preferences",
			"type": "base",
			"system": false,
			"schema": [
				{
					"system": false,
					"id": "a1zycynp",
					"name": "user",
					"type": "relation",
					"required": true,
					"presentable": false,
					"unique": false,
					"options": {
						"collectionId": "_pb_users_auth_",
						"cascadeDelete": true,
						"minSelect": null,
						"maxSelect": 1,
						"displayFields": null
					}
				},
				{
					"system": false,
					"id": "xqolutf8",
					"name": "data",
					"type": "text",
					"required": true,
					"presentable": false,
					"unique": false,
					"options": {
						"min": null,
						"max": 1048576,
						"pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
					}
				}
			],
			"indexes": [],
			"listRule": "@request.auth.id != \"\" && \n@request.auth.id = user",
			"viewRule": "@request.auth.id != \"\" && \n@request.auth.id = user",
			"createRule": "@request.auth.id != \"\" && \n@request.auth.id = @request.data.user &&\n// Additional validation\n@request.data.id:isset = false &&\n@request.data.created:isset = false &&\n@request.data.updated:isset = false &&\n@request.data.data:isset = true",
			"updateRule": "@request.auth.id != \"\" && \n@request.auth.id = user",
			"deleteRule": "@request.auth.id != \"\" && \n@request.auth.id = user",
			"options": {}
		}`

		collection := &models.Collection{}
		if err := json.Unmarshal([]byte(jsonData), &collection); err != nil {
			return err
		}

		return daos.New(db).SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db)

		collection, err := dao.FindCollectionByNameOrId("ck0wav09a3ouets")
		if err != nil {
			return err
		}

		return dao.DeleteCollection(collection)
	})
}
