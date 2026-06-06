package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		userKeyPairs, err := app.FindCollectionByNameOrId("kx3ewd64kz2os37")
		if err != nil {
			return err
		}

		if err := addLegacyField(app, userKeyPairs, `{
			"system": false,
			"id": "macykp01",
			"name": "record_mac",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": 32,
				"max": 128,
				"pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
			}
		}`); err != nil {
			return err
		}

		userKeyPairs.UpdateRule = types.Pointer("@request.auth.id != \"\" &&\n@request.auth.id = user.id &&\n@request.body.id:isset = false &&\n@request.body.created:isset = false &&\n@request.body.updated:isset = false &&\n@request.body.user:isset = false &&\n@request.body.public_key:isset = false &&\n@request.body.secret_key:isset = false &&\n@request.body.record_mac:isset = true")
		if err := app.Save(userKeyPairs); err != nil {
			return err
		}

		conversationPublicKeys, err := app.FindCollectionByNameOrId("3v0m8v3xtw1286r")
		if err != nil {
			return err
		}

		if err := addLegacyField(app, conversationPublicKeys, `{
			"system": false,
			"id": "sigcpk01",
			"name": "public_key_signature",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": 32,
				"max": 128,
				"pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
			}
		}`); err != nil {
			return err
		}

		conversationPublicKeys.UpdateRule = types.Pointer("@request.auth.id != \"\" &&\nconversation.creator = @request.auth.id &&\n@request.body.id:isset = false &&\n@request.body.created:isset = false &&\n@request.body.updated:isset = false &&\n@request.body.conversation:isset = false &&\n@request.body.public_key:isset = false &&\n@request.body.public_key_signature:isset = true")
		return app.Save(conversationPublicKeys)
	}, func(app core.App) error {
		userKeyPairs, err := app.FindCollectionByNameOrId("kx3ewd64kz2os37")
		if err != nil {
			return err
		}
		userKeyPairs.Fields.RemoveByName("record_mac")
		userKeyPairs.UpdateRule = nil
		if err := app.Save(userKeyPairs); err != nil {
			return err
		}

		conversationPublicKeys, err := app.FindCollectionByNameOrId("3v0m8v3xtw1286r")
		if err != nil {
			return err
		}
		conversationPublicKeys.Fields.RemoveByName("public_key_signature")
		conversationPublicKeys.UpdateRule = nil
		return app.Save(conversationPublicKeys)
	})
}
