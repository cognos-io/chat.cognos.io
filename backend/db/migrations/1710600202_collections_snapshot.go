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
		jsonData := `[
			{
				"id": "e67leturz07k2td",
				"created": "2024-02-19 19:48:43.907Z",
				"updated": "2024-02-19 19:48:43.907Z",
				"name": "deleted",
				"type": "base",
				"system": false,
				"schema": [
					{
						"system": false,
						"id": "fvzzhn92",
						"name": "collection",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {
							"min": null,
							"max": null,
							"pattern": ""
						}
					},
					{
						"system": false,
						"id": "op9qj8df",
						"name": "record",
						"type": "json",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {
							"maxSize": 2000000
						}
					}
				],
				"indexes": [],
				"listRule": null,
				"viewRule": null,
				"createRule": null,
				"updateRule": null,
				"deleteRule": null,
				"options": {}
			},
			{
				"id": "23wjzzeeb4qilr9",
				"created": "2024-02-19 20:00:52.663Z",
				"updated": "2024-03-15 13:57:30.919Z",
				"name": "conversations",
				"type": "base",
				"system": false,
				"schema": [
					{
						"system": false,
						"id": "msxvlyrc",
						"name": "data",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"min": null,
							"max": null,
							"pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
						}
					},
					{
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
					}
				],
				"indexes": [],
				"listRule": "@request.auth.id != \"\" &&\n// User should be a viewer, editor or Admin of the conversations\n(@collection.participants.conversation ?= id &&\n@collection.participants.user ?= @request.auth.id &&\n(@collection.participants.role = 'Viewer' || @collection.participants.role = 'Editor' ||@collection.participants.role = 'Admin')\n) || (\n  creator ?= @request.auth.id\n)",
				"viewRule": "@request.auth.id != \"\" &&\n// User should be a viewer, editor or Admin of the conversations\n@collection.participants.conversation ?= id &&\n@collection.participants.user ?= @request.auth.id &&\n(@collection.participants.role = 'Viewer' || @collection.participants.role = 'Editor' ||@collection.participants.role = 'Admin')",
				"createRule": "// logged in\n@request.auth.id != \"\" \n// data validation\n  && @request.data.creator = @request.auth.id\n  && @request.data.data:isset = true\n&& @request.data.id:isset = false\n&& @request.data.created:isset = false\n&& @request.data.updated:isset = false",
				"updateRule": null,
				"deleteRule": null,
				"options": {}
			},
			{
				"id": "3v0m8v3xtw1286r",
				"created": "2024-02-19 20:02:02.688Z",
				"updated": "2024-03-15 15:03:53.328Z",
				"name": "conversation_public_keys",
				"type": "base",
				"system": false,
				"schema": [
					{
						"system": false,
						"id": "knjkxmbt",
						"name": "public_key",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {
							"min": null,
							"max": null,
							"pattern": ""
						}
					},
					{
						"system": false,
						"id": "vy8bto8z",
						"name": "conversation",
						"type": "relation",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"collectionId": "23wjzzeeb4qilr9",
							"cascadeDelete": true,
							"minSelect": null,
							"maxSelect": 1,
							"displayFields": null
						}
					}
				],
				"indexes": [],
				"listRule": "// logged in\n@request.auth.id != \"\"\n// permissions\n&& (\n  @collection.participants.conversation ?= conversation\n  && @collection.participants.user ?= @request.auth.id \n  && (\n    @collection.participants.role = 'Viewer'\n    || @collection.participants.role = 'Editor'\n    ||@collection.participants.role = 'Admin'\n  )\n) || (\n  conversation.creator ?= @request.auth.id\n)",
				"viewRule": null,
				"createRule": "// logged in\n@request.auth.id != \"\"\n// data validation\n&& @request.data.id:isset = false\n&& @request.data.public_key:isset = true\n&& @request.data.conversation:isset = true\n&& @request.data.updated:isset = false\n&& @request.data.created:isset = false\n// permissions\n&& (\n  (@collection.participants.conversation ?= @request.data.conversation\n    && @collection.participants.user ?= @request.auth.id \n    && @collection.participants.role = 'Admin' // only admins can add keys)\n  ||\n  (@collection.conversations.id = @request.data.conversation\n    && @collection.conversations.creator = @request.auth.id // creators can also add keys)\n  )",
				"updateRule": null,
				"deleteRule": null,
				"options": {}
			},
			{
				"id": "v893vvhgp688kie",
				"created": "2024-02-19 20:13:36.425Z",
				"updated": "2024-02-25 11:05:44.710Z",
				"name": "messages",
				"type": "base",
				"system": false,
				"schema": [
					{
						"system": false,
						"id": "wbuzpppe",
						"name": "data",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"min": null,
							"max": null,
							"pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
						}
					},
					{
						"system": false,
						"id": "rqegjuus",
						"name": "conversation",
						"type": "relation",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {
							"collectionId": "23wjzzeeb4qilr9",
							"cascadeDelete": true,
							"minSelect": null,
							"maxSelect": 1,
							"displayFields": null
						}
					},
					{
						"system": false,
						"id": "nciypmmv",
						"name": "parent_message",
						"type": "relation",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {
							"collectionId": "v893vvhgp688kie",
							"cascadeDelete": true,
							"minSelect": null,
							"maxSelect": 1,
							"displayFields": null
						}
					},
					{
						"system": false,
						"id": "8l6lqqqv",
						"name": "key",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"min": null,
							"max": null,
							"pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
						}
					}
				],
				"indexes": [],
				"listRule": "@request.auth.id != \"\" &&\n// User is a viewer, editor or admin for the given conversation\n@collection.participants.conversation = conversation &&\n@collection.participants.user = @request.auth.id &&\n(@collection.participants.role = 'Viewer' || @collection.participants.role = 'Editor' || @collection.participants.role = 'Admin') ",
				"viewRule": null,
				"createRule": "@request.auth.id != \"\" &&\n// User is an editor or admin for the the given conversation\n@collection.participants.conversation = conversation &&\n@collection.participants.user = @request.auth.id &&\n(@collection.participants.role = 'Editor' || @collection.participants.role = 'Admin') \n// Check the parent message is also in the same conversation\n(parent_message = \"\" || (parent_message.conversation = conversation))",
				"updateRule": null,
				"deleteRule": null,
				"options": {}
			},
			{
				"id": "kx3ewd64kz2os37",
				"created": "2024-02-19 20:17:21.004Z",
				"updated": "2024-02-28 08:21:13.770Z",
				"name": "user_key_pairs",
				"type": "base",
				"system": false,
				"schema": [
					{
						"system": false,
						"id": "t7gitdmt",
						"name": "public_key",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"min": 32,
							"max": 64,
							"pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
						}
					},
					{
						"system": false,
						"id": "naos08c4",
						"name": "secret_key",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"min": 64,
							"max": 128,
							"pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
						}
					},
					{
						"system": false,
						"id": "ohmtgv8t",
						"name": "user",
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
					}
				],
				"indexes": [],
				"listRule": "@request.auth.id != \"\" && \n@request.auth.id = user.id",
				"viewRule": "@request.auth.id != \"\" && \n@request.auth.id = user.id",
				"createRule": "@request.auth.id != \"\" && \n@request.auth.id = @request.data.user &&\n// Additional validation\n@request.data.id:isset = false &&\n@request.data.created:isset = false &&\n@request.data.updated:isset = false &&\n@request.data.public_key:isset = true &&\n@request.data.secret_key:isset = true",
				"updateRule": null,
				"deleteRule": null,
				"options": {}
			},
			{
				"id": "_pb_users_auth_",
				"created": "2024-02-24 19:25:43.004Z",
				"updated": "2024-02-24 19:25:43.005Z",
				"name": "users",
				"type": "auth",
				"system": false,
				"schema": [
					{
						"system": false,
						"id": "users_name",
						"name": "name",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {
							"min": null,
							"max": null,
							"pattern": ""
						}
					},
					{
						"system": false,
						"id": "users_avatar",
						"name": "avatar",
						"type": "file",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {
							"mimeTypes": [
								"image/jpeg",
								"image/png",
								"image/svg+xml",
								"image/gif",
								"image/webp"
							],
							"thumbs": null,
							"maxSelect": 1,
							"maxSize": 5242880,
							"protected": false
						}
					}
				],
				"indexes": [],
				"listRule": "id = @request.auth.id",
				"viewRule": "id = @request.auth.id",
				"createRule": "",
				"updateRule": "id = @request.auth.id",
				"deleteRule": "id = @request.auth.id",
				"options": {
					"allowEmailAuth": true,
					"allowOAuth2Auth": true,
					"allowUsernameAuth": true,
					"exceptEmailDomains": null,
					"manageRule": null,
					"minPasswordLength": 8,
					"onlyEmailDomains": null,
					"onlyVerified": false,
					"requireEmail": false
				}
			},
			{
				"id": "zy560w1blembu8s",
				"created": "2024-02-25 09:02:54.132Z",
				"updated": "2024-03-15 15:03:37.076Z",
				"name": "conversation_secret_keys",
				"type": "base",
				"system": false,
				"schema": [
					{
						"system": false,
						"id": "smzrfycv",
						"name": "conversation",
						"type": "relation",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"collectionId": "23wjzzeeb4qilr9",
							"cascadeDelete": true,
							"minSelect": null,
							"maxSelect": 1,
							"displayFields": null
						}
					},
					{
						"system": false,
						"id": "sqaq0wtv",
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
						"id": "tlxzpdgd",
						"name": "secret_key",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {
							"min": null,
							"max": null,
							"pattern": ""
						}
					}
				],
				"indexes": [],
				"listRule": "// logged in\n@request.auth.id != \"\"\n// permissions\n&& user = @request.auth.id\n&& (\n  @collection.participants.conversation ?= conversation\n  && @collection.participants.user ?= @request.auth.id \n  && (\n    @collection.participants.role = 'Viewer'\n    || @collection.participants.role = 'Editor'\n    ||@collection.participants.role = 'Admin'\n  )\n) || (\n  conversation.creator ?= @request.auth.id\n)",
				"viewRule": null,
				"createRule": "// logged in\n@request.auth.id != \"\"\n// data validation\n&& @request.data.id:isset = false\n&& @request.data.secret_key:isset = true\n&& @request.data.conversation:isset = true\n&& @request.data.updated:isset = false\n&& @request.data.created:isset = false\n&& @request.data.user = @request.auth.id\n// permissions\n&& (\n  (@collection.participants.conversation ?= @request.data.conversation\n    && @collection.participants.user ?= @request.auth.id \n    && @collection.participants.role = 'Admin' // only admins can add keys)\n  ||\n  (@collection.conversations.id ?= @request.data.conversation\n    && @collection.conversations.creator = @request.auth.id // creators can also add keys)\n  )",
				"updateRule": null,
				"deleteRule": null,
				"options": {}
			},
			{
				"id": "52et2jthsxn7mjr",
				"created": "2024-02-25 10:52:06.278Z",
				"updated": "2024-02-25 10:52:06.278Z",
				"name": "participants",
				"type": "base",
				"system": false,
				"schema": [
					{
						"system": false,
						"id": "ba8hv4fd",
						"name": "conversation",
						"type": "relation",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {
							"collectionId": "23wjzzeeb4qilr9",
							"cascadeDelete": false,
							"minSelect": null,
							"maxSelect": 1,
							"displayFields": null
						}
					},
					{
						"system": false,
						"id": "3rnus5de",
						"name": "user",
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
					},
					{
						"system": false,
						"id": "fnjvvx46",
						"name": "role",
						"type": "select",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {
							"maxSelect": 1,
							"values": [
								"Viewer",
								"Editor",
								"Admin"
							]
						}
					}
				],
				"indexes": [
					"CREATE UNIQUE INDEX ` + "`" + `idx_eVob3Ru` + "`" + ` ON ` + "`" + `participants` + "`" + ` (\n  ` + "`" + `conversation` + "`" + `,\n  ` + "`" + `user` + "`" + `\n)"
				],
				"listRule": null,
				"viewRule": null,
				"createRule": "@request.auth.id != \"\"",
				"updateRule": null,
				"deleteRule": null,
				"options": {}
			}
		]`

		collections := []*models.Collection{}
		if err := json.Unmarshal([]byte(jsonData), &collections); err != nil {
			return err
		}

		return daos.New(db).ImportCollections(collections, true, nil)
	}, func(db dbx.Builder) error {
		return nil
	})
}
