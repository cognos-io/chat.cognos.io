package main

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
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

// seedLibraryAttachment persists a user_attachments (library) record directly,
// mirroring what the create handler stores: ciphertext file parts + a base64
// manifest sealed to the owner. Returns the server-assigned file names in order.
func seedLibraryAttachment(
	t testing.TB,
	app *tests.TestApp,
	id, ownerEmail, manifestB64 string,
	files [][]byte,
) []string {
	t.Helper()

	owner, err := app.FindAuthRecordByEmail("users", ownerEmail)
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(%q) error = %v", ownerEmail, err)
	}

	collection, err := app.FindCollectionByNameOrId("user_attachments")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(user_attachments) error = %v", err)
	}

	record := core.NewRecord(collection)
	if id != "" {
		record.Id = id
	}
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

// seedAttachmentUsage persists an attachment_usages join row linking a library
// file to a (conversation, message), as the completion flow would.
func seedAttachmentUsage(
	t testing.TB,
	app *tests.TestApp,
	attachmentID, conversationID, messageID, ownerEmail string,
) {
	t.Helper()
	owner, err := app.FindAuthRecordByEmail("users", ownerEmail)
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(%q) error = %v", ownerEmail, err)
	}
	collection, err := app.FindCollectionByNameOrId("attachment_usages")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(attachment_usages) error = %v", err)
	}
	record := core.NewRecord(collection)
	record.Set("attachment", attachmentID)
	record.Set("conversation", conversationID)
	record.Set("message", messageID)
	record.Set("user", owner.Id)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(attachment_usage) error = %v", err)
	}
}

func TestLibraryAttachmentCreateRequiresAuth(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "attachment create requires record auth",
		Method:          http.MethodPost,
		URL:             "/api/v1/attachments",
		ExpectedStatus:  http.StatusUnauthorized,
		ExpectedContent: []string{`"message":"The request requires valid record authorization token."`},
		TestAppFactory:  setupTestApp,
	}
	scenario.Test(t)
}

func TestLibraryAttachmentCreatePersistsCiphertext(t *testing.T) {
	t.Parallel()

	manifest := base64.StdEncoding.EncodeToString([]byte("sealed-manifest-ciphertext"))
	original := []byte("ciphertext-original-bytes")
	extracted := []byte("ciphertext-extracted-text")
	body, contentType := buildAttachmentMultipart(t, manifest, [][]byte{original, extracted})

	scenario := tests.ApiScenario{
		Name:           "user uploads encrypted attachment artifacts to their library",
		Method:         http.MethodPost,
		URL:            "/api/v1/attachments",
		Body:           body,
		Headers:        map[string]string{"Content-Type": contentType},
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"size_bytes":` + fmt.Sprintf("%d", len(original)+len(extracted)),
			`"files":[`,
			`"data":"` + manifest + `"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			owner, _ := app.FindAuthRecordByEmail("users", "test1@example.com")
			records, err := app.FindRecordsByFilter(
				"user_attachments",
				"owner={:o}", "", 10, 0,
				dbx.Params{"o": owner.Id},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter error = %v", err)
			}
			if len(records) != 1 {
				t.Fatalf("persisted %d attachments, want 1", len(records))
			}
			rec := records[0]
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

func TestLibraryAttachmentDownloadReturnsCiphertext(t *testing.T) {
	t.Parallel()

	manifest := base64.StdEncoding.EncodeToString([]byte("sealed"))
	original := []byte("the-encrypted-original-ciphertext")

	scenario := tests.ApiScenario{
		Name:           "owner downloads encrypted artifact bytes",
		Method:         http.MethodGet,
		URL:            "/api/v1/attachments/attrecord000001/files/art-0.enc",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			"the-encrypted-original-ciphertext",
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)
			names := seedLibraryAttachment(t, app, "attrecord000001", "test1@example.com", manifest, [][]byte{original})
			if len(names) != 1 || names[0] != "art-0.enc" {
				t.Fatalf("seed returned %v, want [art-0.enc]", names)
			}
		},
	}
	scenario.Test(t)
}

func TestLibraryAttachmentDownloadNonOwner404(t *testing.T) {
	t.Parallel()

	manifest := base64.StdEncoding.EncodeToString([]byte("sealed"))

	scenario := tests.ApiScenario{
		Name:            "a user cannot download another user's library file",
		Method:          http.MethodGet,
		URL:             "/api/v1/attachments/attnp0000000001/files/art-0.enc",
		ExpectedStatus:  http.StatusNotFound,
		ExpectedContent: []string{"Attachment not found"},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test2@example.com")(t, app, e) // not the owner
			seedLibraryAttachment(t, app, "attnp0000000001", "test1@example.com", manifest, [][]byte{[]byte("secret")})
		},
	}
	scenario.Test(t)
}

func TestLibraryAttachmentListReturnsOwnRecordsOnly(t *testing.T) {
	t.Parallel()

	mine := base64.StdEncoding.EncodeToString([]byte("sealed-mine"))
	theirs := base64.StdEncoding.EncodeToString([]byte("sealed-theirs"))

	scenario := tests.ApiScenario{
		Name:           "list returns only the caller's library files",
		Method:         http.MethodGet,
		URL:            "/api/v1/attachments",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"id":"attlist00000001"`,
			`"data":"` + mine + `"`,
		},
		NotExpectedContent: []string{
			`"id":"attlistother001"`,
			theirs,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)
			seedLibraryAttachment(t, app, "attlist00000001", "test1@example.com", mine, [][]byte{[]byte("ct")})
			seedLibraryAttachment(t, app, "attlistother001", "test2@example.com", theirs, [][]byte{[]byte("ct")})
		},
	}
	scenario.Test(t)
}

func TestLibraryAttachmentCreateOversizeRejected(t *testing.T) {
	t.Parallel()

	manifest := base64.StdEncoding.EncodeToString([]byte("sealed"))
	// 32 bytes against an injected 16-byte per-file cap.
	body, contentType := buildAttachmentMultipart(t, manifest, [][]byte{bytes.Repeat([]byte("x"), 32)})

	scenario := tests.ApiScenario{
		Name:            "oversized attachment is rejected before any record is created",
		Method:          http.MethodPost,
		URL:             "/api/v1/attachments",
		Body:            body,
		Headers:         map[string]string{"Content-Type": contentType},
		ExpectedStatus:  http.StatusBadRequest,
		ExpectedContent: []string{"too large"},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{AttachmentMaxFileBytes: 16})
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			records, _ := app.FindRecordsByFilter("user_attachments", "", "", 10, 0, nil)
			if len(records) != 0 {
				t.Fatalf("persisted %d attachments, want 0", len(records))
			}
		},
	}
	scenario.Test(t)
}

func TestLibraryAttachmentCreateQuotaRejected(t *testing.T) {
	t.Parallel()

	manifest := base64.StdEncoding.EncodeToString([]byte("sealed"))
	body, contentType := buildAttachmentMultipart(t, manifest, [][]byte{bytes.Repeat([]byte("y"), 40)})

	scenario := tests.ApiScenario{
		Name:            "upload that would exceed the per-user storage cap is rejected",
		Method:          http.MethodPost,
		URL:             "/api/v1/attachments",
		Body:            body,
		Headers:         map[string]string{"Content-Type": contentType},
		ExpectedStatus:  http.StatusForbidden,
		ExpectedContent: []string{"Storage limit reached"},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{AttachmentStorageCapBytes: 50})
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)
			// Already using 30 of a 50-byte cap; +40 would exceed.
			seedLibraryAttachment(t, app, "attquota0000001", "test1@example.com", manifest, [][]byte{bytes.Repeat([]byte("z"), 30)})
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			records, _ := app.FindRecordsByFilter("user_attachments", "", "", 10, 0, nil)
			if len(records) != 1 {
				t.Fatalf("persisted %d attachments, want 1 (the seeded one only)", len(records))
			}
		},
	}
	scenario.Test(t)
}

func TestLibraryAttachmentRenameReplacesManifestOnly(t *testing.T) {
	t.Parallel()

	original := base64.StdEncoding.EncodeToString([]byte("sealed-old-name"))
	renamed := base64.StdEncoding.EncodeToString([]byte("sealed-new-name"))

	scenario := tests.ApiScenario{
		Name:            "owner renames a library file by replacing its sealed manifest",
		Method:          http.MethodPatch,
		URL:             "/api/v1/attachments/attrename000001",
		Body:            strings.NewReader(`{"data":"` + renamed + `"}`),
		Headers:         map[string]string{"Content-Type": "application/json"},
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"data":"` + renamed + `"`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)
			seedLibraryAttachment(t, app, "attrename000001", "test1@example.com", original, [][]byte{[]byte("ct")})
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			rec, err := app.FindRecordById("user_attachments", "attrename000001")
			if err != nil {
				t.Fatalf("FindRecordById error = %v", err)
			}
			if got := rec.GetString("data"); got != renamed {
				t.Errorf("data = %q, want renamed manifest", got)
			}
			// Bytes/accounting untouched by a rename.
			if got := rec.GetInt("size_bytes"); got != len("ct") {
				t.Errorf("size_bytes = %d, want %d", got, len("ct"))
			}
		},
	}
	scenario.Test(t)
}

func TestLibraryAttachmentRenameNonOwner404(t *testing.T) {
	t.Parallel()

	renamed := base64.StdEncoding.EncodeToString([]byte("sealed-new-name"))

	scenario := tests.ApiScenario{
		Name:            "a user cannot rename another user's library file",
		Method:          http.MethodPatch,
		URL:             "/api/v1/attachments/attrenamenp0001",
		Body:            strings.NewReader(`{"data":"` + renamed + `"}`),
		Headers:         map[string]string{"Content-Type": "application/json"},
		ExpectedStatus:  http.StatusNotFound,
		ExpectedContent: []string{"Attachment not found"},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test2@example.com")(t, app, e)
			seedLibraryAttachment(t, app, "attrenamenp0001", "test1@example.com", base64.StdEncoding.EncodeToString([]byte("x")), [][]byte{[]byte("ct")})
		},
	}
	scenario.Test(t)
}

// TestLibraryAttachmentDeleteRemovesFileAndUsagesKeepsMessage covers the
// remove+tombstone contract: deleting a *used* library file is allowed, removes
// the file row and its usage rows, but must NOT delete the referencing message.
func TestLibraryAttachmentDeleteRemovesFileAndUsagesKeepsMessage(t *testing.T) {
	t.Parallel()

	conversationID := "convattdel00001"
	messageID := "msgattdel000001"
	manifest := base64.StdEncoding.EncodeToString([]byte("sealed"))

	scenario := tests.ApiScenario{
		Name:           "owner deletes a referenced library file; message survives as a tombstone",
		Method:         http.MethodDelete,
		URL:            "/api/v1/attachments/attdel000000001",
		ExpectedStatus: http.StatusNoContent,
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)
			seedConversationRecord(t, app, conversationID)
			seedMessage(t, app, messageID, conversationID, false)
			seedLibraryAttachment(t, app, "attdel000000001", "test1@example.com", manifest, [][]byte{[]byte("ct")})
			seedAttachmentUsage(t, app, "attdel000000001", conversationID, messageID, "test1@example.com")
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			if _, err := app.FindRecordById("user_attachments", "attdel000000001"); err == nil {
				t.Fatalf("attachment not deleted")
			}
			usages, _ := app.FindRecordsByFilter("attachment_usages", "attachment={:a}", "", 10, 0, dbx.Params{"a": "attdel000000001"})
			if len(usages) != 0 {
				t.Fatalf("usage rows not cleared: %d remain", len(usages))
			}
			// The referencing message must survive (tombstone, not cascade).
			if _, err := app.FindRecordById("messages", messageID); err != nil {
				t.Fatalf("message was deleted with the attachment: %v", err)
			}
		},
	}
	scenario.Test(t)
}

func TestLibraryAttachmentUsagesListsReferences(t *testing.T) {
	t.Parallel()

	conversationID := "convattuse00001"
	messageID := "msgattuse000001"

	scenario := tests.ApiScenario{
		Name:           "owner lists where a library file is used",
		Method:         http.MethodGet,
		URL:            "/api/v1/attachments/attuse000000001/usages",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"conversation":"` + conversationID + `"`,
			`"message":"` + messageID + `"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)
			seedConversationRecord(t, app, conversationID)
			seedMessage(t, app, messageID, conversationID, false)
			seedLibraryAttachment(t, app, "attuse000000001", "test1@example.com", base64.StdEncoding.EncodeToString([]byte("s")), [][]byte{[]byte("ct")})
			seedAttachmentUsage(t, app, "attuse000000001", conversationID, messageID, "test1@example.com")
		},
	}
	scenario.Test(t)
}

func TestLibraryAttachmentUsagesNonOwner404(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "a user cannot enumerate where another user's file is used",
		Method:          http.MethodGet,
		URL:             "/api/v1/attachments/attusenp0000001/usages",
		ExpectedStatus:  http.StatusNotFound,
		ExpectedContent: []string{"Attachment not found"},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test2@example.com")(t, app, e)
			seedLibraryAttachment(t, app, "attusenp0000001", "test1@example.com", base64.StdEncoding.EncodeToString([]byte("s")), [][]byte{[]byte("ct")})
		},
	}
	scenario.Test(t)
}
