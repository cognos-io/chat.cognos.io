package handler

import "testing"

func TestValidateConversationImport(t *testing.T) {
	base := conversationImportRequest{
		ImportID: "import_token_123456789",
		Source:   "chatgpt",
		Conversation: copyConversationInput{
			ID: "conversation123", Data: "ciphertext", PublicKey: "public",
			PublicKeySignature: "signature", WrappedSecretKey: "wrapped",
		},
		Messages: []importMessageInput{{ID: "message1", Data: "ciphertext"}},
	}
	tests := []struct {
		name    string
		mutate  func(*conversationImportRequest)
		wantErr bool
	}{
		{name: "valid", mutate: func(*conversationImportRequest) {}},
		{name: "unknown source", mutate: func(r *conversationImportRequest) { r.Source = "other" }, wantErr: true},
		{name: "duplicate id", mutate: func(r *conversationImportRequest) { r.Messages = append(r.Messages, r.Messages[0]) }, wantErr: true},
		{name: "forward parent", mutate: func(r *conversationImportRequest) { r.Messages[0].ParentMessage = "later" }, wantErr: true},
		{name: "empty messages", mutate: func(r *conversationImportRequest) { r.Messages = nil }, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := base
			req.Messages = append([]importMessageInput(nil), base.Messages...)
			tt.mutate(&req)
			if gotErr := validateConversationImport(req) != nil; gotErr != tt.wantErr {
				t.Errorf("validateConversationImport(%s) error = %t, want %t", tt.name, gotErr, tt.wantErr)
			}
		})
	}
}
