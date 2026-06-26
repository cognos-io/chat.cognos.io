package main

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/filesystem"
)

// buildAttachmentMultipart assembles a multipart/form-data body with a base64
// `data` manifest field and N `files` parts holding opaque ciphertext.
func buildAttachmentMultipart(t testing.TB, manifestB64 string, files [][]byte) (*bytes.Reader, string) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	if err := w.WriteField("data", manifestB64); err != nil {
		t.Fatalf("WriteField(data) error = %v", err)
	}
	for i, f := range files {
		fw, err := w.CreateFormFile("files", fmt.Sprintf("artifact-%d.enc", i))
		if err != nil {
			t.Fatalf("CreateFormFile error = %v", err)
		}
		if _, err := fw.Write(f); err != nil {
			t.Fatalf("write file part error = %v", err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatalf("multipart Close error = %v", err)
	}
	return bytes.NewReader(buf.Bytes()), w.FormDataContentType()
}

// seedAttachmentRecord persists a conversation_attachments record directly,
// mirroring what the create handler stores: ciphertext file parts + a base64
// manifest. Returns the server-assigned file names in order.
func seedAttachmentRecord(
	t testing.TB,
	app *tests.TestApp,
	id, conversationID, ownerEmail, manifestB64 string,
	files [][]byte,
) []string {
	t.Helper()

	owner, err := app.FindAuthRecordByEmail("users", ownerEmail)
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(%q) error = %v", ownerEmail, err)
	}

	collection, err := app.FindCollectionByNameOrId("conversation_attachments")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(conversation_attachments) error = %v", err)
	}

	record := core.NewRecord(collection)
	if id != "" {
		record.Id = id
	}
	record.Set("conversation", conversationID)
	record.Set("owner", owner.Id)
	record.Set("data", manifestB64)

	var total int64
	fileObjs := make([]*filesystem.File, 0, len(files))
	for i, f := range files {
		fileObj, err := filesystem.NewFileFromBytes(f, fmt.Sprintf("artifact-%d.enc", i))
		if err != nil {
			t.Fatalf("NewFileFromBytes error = %v", err)
		}
		// Deterministic stored name so download tests can address it by URL.
		fileObj.Name = fmt.Sprintf("art-%d.enc", i)
		fileObjs = append(fileObjs, fileObj)
		total += int64(len(f))
	}
	record.Set("files", fileObjs)
	record.Set("size_bytes", total)

	if err := app.Save(record); err != nil {
		t.Fatalf("Save(attachment) error = %v", err)
	}
	return record.GetStringSlice("files")
}

func TestConversationAttachmentCreateRequiresAuth(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "attachment create requires record auth",
		Method:          http.MethodPost,
		URL:             "/api/v1/conversations/convatt00000001/attachments",
		ExpectedStatus:  http.StatusUnauthorized,
		ExpectedContent: []string{`"message":"The request requires valid record authorization token."`},
		TestAppFactory:  setupTestApp,
	}
	scenario.Test(t)
}

func TestConversationAttachmentCreatePersistsCiphertext(t *testing.T) {
	t.Parallel()

	conversationID := "convattcreate01"
	manifest := base64.StdEncoding.EncodeToString([]byte("sealed-manifest-ciphertext"))
	original := []byte("ciphertext-original-bytes")
	extracted := []byte("ciphertext-extracted-text")
	body, contentType := buildAttachmentMultipart(t, manifest, [][]byte{original, extracted})

	scenario := tests.ApiScenario{
		Name:           "participant uploads encrypted attachment artifacts",
		Method:         http.MethodPost,
		URL:            "/api/v1/conversations/" + conversationID + "/attachments",
		Body:           body,
		Headers:        map[string]string{"Content-Type": contentType},
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"conversation":"` + conversationID + `"`,
			`"size_bytes":` + fmt.Sprintf("%d", len(original)+len(extracted)),
			`"files":[`,
			`"data":"` + manifest + `"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)
			seedConversationRecord(t, app, conversationID)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			records, err := app.FindRecordsByFilter(
				"conversation_attachments",
				"conversation={:c}", "", 10, 0,
				dbx.Params{"c": conversationID},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter error = %v", err)
			}
			if len(records) != 1 {
				t.Fatalf("persisted %d attachments, want 1", len(records))
			}
			rec := records[0]
			if rec.GetString("message") != "" {
				t.Errorf("new attachment has message=%q, want empty (draft)", rec.GetString("message"))
			}
			if got := rec.GetInt("size_bytes"); got != len(original)+len(extracted) {
				t.Errorf("size_bytes = %d, want %d", got, len(original)+len(extracted))
			}

			names := rec.GetStringSlice("files")
			if len(names) != 2 {
				t.Fatalf("stored %d files, want 2", len(names))
			}

			// Stored bytes must be exactly the ciphertext we uploaded, in order.
			fsys, err := app.NewFilesystem()
			if err != nil {
				t.Fatalf("NewFilesystem error = %v", err)
			}
			defer func() { _ = fsys.Close() }()
			want := [][]byte{original, extracted}
			for i, name := range names {
				reader, err := fsys.GetReader(rec.BaseFilesPath() + "/" + name)
				if err != nil {
					t.Fatalf("GetReader(%q) error = %v", name, err)
				}
				stored, _ := io.ReadAll(reader)
				_ = reader.Close()
				if !bytes.Equal(stored, want[i]) {
					t.Errorf("file %d stored %q, want %q", i, stored, want[i])
				}
			}
		},
	}
	scenario.Test(t)
}

func TestConversationAttachmentDownloadReturnsCiphertext(t *testing.T) {
	t.Parallel()

	conversationID := "convattdown0001"
	manifest := base64.StdEncoding.EncodeToString([]byte("sealed"))
	original := []byte("the-encrypted-original-ciphertext")

	scenario := tests.ApiScenario{
		Name:           "participant downloads encrypted artifact bytes",
		Method:         http.MethodGet,
		URL:            "/api/v1/conversations/" + conversationID + "/attachments/attrecord000001/files/art-0.enc",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			"the-encrypted-original-ciphertext",
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)
			seedConversationRecord(t, app, conversationID)
			names := seedAttachmentRecord(t, app, "attrecord000001", conversationID, "test1@example.com", manifest, [][]byte{original})
			if len(names) != 1 || names[0] != "art-0.enc" {
				t.Fatalf("seed returned %v, want [art-0.enc]", names)
			}
		},
	}
	scenario.Test(t)
}

func TestConversationAttachmentDownloadNonParticipant404(t *testing.T) {
	t.Parallel()

	conversationID := "convattnp000001"
	manifest := base64.StdEncoding.EncodeToString([]byte("sealed"))

	scenario := tests.ApiScenario{
		Name:            "non-participant cannot download another conversation's attachment",
		Method:          http.MethodGet,
		URL:             "/api/v1/conversations/" + conversationID + "/attachments/attnp0000000001/files/whatever.enc",
		ExpectedStatus:  http.StatusNotFound,
		ExpectedContent: []string{"Attachment not found"},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test2@example.com")(t, app, e)
			seedConversationRecord(t, app, conversationID) // owned by test1
			seedAttachmentRecord(t, app, "attnp0000000001", conversationID, "test1@example.com", manifest, [][]byte{[]byte("secret")})
		},
	}
	scenario.Test(t)
}

func TestConversationAttachmentListReturnsRecords(t *testing.T) {
	t.Parallel()

	conversationID := "convattlist0001"
	manifest := base64.StdEncoding.EncodeToString([]byte("sealed-manifest-1"))

	scenario := tests.ApiScenario{
		Name:           "participant lists conversation attachments",
		Method:         http.MethodGet,
		URL:            "/api/v1/conversations/" + conversationID + "/attachments",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"id":"attlist00000001"`,
			`"data":"` + manifest + `"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)
			seedConversationRecord(t, app, conversationID)
			seedAttachmentRecord(t, app, "attlist00000001", conversationID, "test1@example.com", manifest, [][]byte{[]byte("ct")})
		},
	}
	scenario.Test(t)
}

func TestConversationAttachmentCreateOversizeRejected(t *testing.T) {
	t.Parallel()

	conversationID := "convattbig00001"
	manifest := base64.StdEncoding.EncodeToString([]byte("sealed"))
	// 32 bytes against an injected 16-byte per-file cap.
	body, contentType := buildAttachmentMultipart(t, manifest, [][]byte{bytes.Repeat([]byte("x"), 32)})

	scenario := tests.ApiScenario{
		Name:            "oversized attachment is rejected before any record is created",
		Method:          http.MethodPost,
		URL:             "/api/v1/conversations/" + conversationID + "/attachments",
		Body:            body,
		Headers:         map[string]string{"Content-Type": contentType},
		ExpectedStatus:  http.StatusBadRequest,
		ExpectedContent: []string{"too large"},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{AttachmentMaxFileBytes: 16})
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)
			seedConversationRecord(t, app, conversationID)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			records, _ := app.FindRecordsByFilter("conversation_attachments", "conversation={:c}", "", 10, 0, dbx.Params{"c": conversationID})
			if len(records) != 0 {
				t.Fatalf("persisted %d attachments, want 0", len(records))
			}
		},
	}
	scenario.Test(t)
}

func TestConversationAttachmentCreateQuotaRejected(t *testing.T) {
	t.Parallel()

	conversationID := "convattquota001"
	manifest := base64.StdEncoding.EncodeToString([]byte("sealed"))
	body, contentType := buildAttachmentMultipart(t, manifest, [][]byte{bytes.Repeat([]byte("y"), 40)})

	scenario := tests.ApiScenario{
		Name:            "upload that would exceed the per-user storage cap is rejected",
		Method:          http.MethodPost,
		URL:             "/api/v1/conversations/" + conversationID + "/attachments",
		Body:            body,
		Headers:         map[string]string{"Content-Type": contentType},
		ExpectedStatus:  http.StatusForbidden,
		ExpectedContent: []string{"Storage limit reached"},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{AttachmentStorageCapBytes: 50})
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)
			seedConversationRecord(t, app, conversationID)
			// Already using 30 of a 50-byte cap; +40 would exceed.
			seedAttachmentRecord(t, app, "attquota0000001", conversationID, "test1@example.com", manifest, [][]byte{bytes.Repeat([]byte("z"), 30)})
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			records, _ := app.FindRecordsByFilter("conversation_attachments", "conversation={:c}", "", 10, 0, dbx.Params{"c": conversationID})
			if len(records) != 1 {
				t.Fatalf("persisted %d attachments, want 1 (the seeded one only)", len(records))
			}
		},
	}
	scenario.Test(t)
}

func TestConversationAttachmentDeleteDraft(t *testing.T) {
	t.Parallel()

	conversationID := "convattdel00001"
	manifest := base64.StdEncoding.EncodeToString([]byte("sealed"))

	scenario := tests.ApiScenario{
		Name:           "owner deletes an unlinked draft attachment",
		Method:         http.MethodDelete,
		URL:            "/api/v1/conversations/" + conversationID + "/attachments/attdel000000001",
		ExpectedStatus: http.StatusNoContent,
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)
			seedConversationRecord(t, app, conversationID)
			seedAttachmentRecord(t, app, "attdel000000001", conversationID, "test1@example.com", manifest, [][]byte{[]byte("ct")})
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			records, _ := app.FindRecordsByFilter("conversation_attachments", "conversation={:c}", "", 10, 0, dbx.Params{"c": conversationID})
			if len(records) != 0 {
				t.Fatalf("attachment not deleted: %d remain", len(records))
			}
		},
	}
	scenario.Test(t)
}
