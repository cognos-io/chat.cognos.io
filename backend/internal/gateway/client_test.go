package gateway

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

func TestMockClientCompleteCapturesRequestAndReturnsStubbedResponse(t *testing.T) {
	t.Parallel()

	providerCostUSD := 0.42
	wantReq := CompleteRequest{
		ProviderID:      "infomaniak",
		ProviderModelID: "llama-3.3-70b-instruct",
		Messages: []Message{
			{Role: "system", Content: "You are helpful."},
			{Role: "user", Content: "Hello"},
		},
		MaxOutputTokens: 512,
	}
	wantResp := CompleteResponse{
		Message: Message{Role: "assistant", Content: "Hi there"},
		Usage: Usage{
			InputTokens:              12,
			OutputTokens:             34,
			TotalTokens:              46,
			CacheCreationInputTokens: 5,
			CacheReadInputTokens:     6,
			ProviderCostUSD:          &providerCostUSD,
		},
	}

	client := &MockClient{
		CompleteFunc: func(_ context.Context, gotReq CompleteRequest) (CompleteResponse, error) {
			if gotReq.ProviderID != wantReq.ProviderID {
				t.Fatalf("Complete() ProviderID = %q, want %q", gotReq.ProviderID, wantReq.ProviderID)
			}
			if gotReq.ProviderModelID != wantReq.ProviderModelID {
				t.Fatalf(
					"Complete() ProviderModelID = %q, want %q",
					gotReq.ProviderModelID,
					wantReq.ProviderModelID,
				)
			}
			if gotReq.MaxOutputTokens != wantReq.MaxOutputTokens {
				t.Fatalf(
					"Complete() MaxOutputTokens = %d, want %d",
					gotReq.MaxOutputTokens,
					wantReq.MaxOutputTokens,
				)
			}
			if len(gotReq.Messages) != len(wantReq.Messages) {
				t.Fatalf("Complete() len(Messages) = %d, want %d", len(gotReq.Messages), len(wantReq.Messages))
			}
			for i := range wantReq.Messages {
				if !reflect.DeepEqual(gotReq.Messages[i], wantReq.Messages[i]) {
					t.Fatalf("Complete() Messages[%d] = %#v, want %#v", i, gotReq.Messages[i], wantReq.Messages[i])
				}
			}

			return wantResp, nil
		},
	}

	gotResp, err := client.Complete(context.Background(), wantReq)
	if err != nil {
		t.Fatalf("Complete() error = %v, want nil", err)
	}
	if len(client.Requests) != 1 {
		t.Fatalf("len(Requests) = %d, want %d", len(client.Requests), 1)
	}
	if client.Requests[0].ProviderID != wantReq.ProviderID {
		t.Fatalf("Requests[0].ProviderID = %q, want %q", client.Requests[0].ProviderID, wantReq.ProviderID)
	}
	if client.Requests[0].ProviderModelID != wantReq.ProviderModelID {
		t.Fatalf(
			"Requests[0].ProviderModelID = %q, want %q",
			client.Requests[0].ProviderModelID,
			wantReq.ProviderModelID,
		)
	}
	if len(client.Requests[0].Messages) != len(wantReq.Messages) {
		t.Fatalf(
			"len(Requests[0].Messages) = %d, want %d",
			len(client.Requests[0].Messages),
			len(wantReq.Messages),
		)
	}
	if !reflect.DeepEqual(gotResp.Message, wantResp.Message) {
		t.Fatalf("Complete() Message = %#v, want %#v", gotResp.Message, wantResp.Message)
	}
	if gotResp.Usage.InputTokens != wantResp.Usage.InputTokens {
		t.Fatalf("Complete() Usage.InputTokens = %d, want %d", gotResp.Usage.InputTokens, wantResp.Usage.InputTokens)
	}
	if gotResp.Usage.OutputTokens != wantResp.Usage.OutputTokens {
		t.Fatalf("Complete() Usage.OutputTokens = %d, want %d", gotResp.Usage.OutputTokens, wantResp.Usage.OutputTokens)
	}
	if gotResp.Usage.TotalTokens != wantResp.Usage.TotalTokens {
		t.Fatalf("Complete() Usage.TotalTokens = %d, want %d", gotResp.Usage.TotalTokens, wantResp.Usage.TotalTokens)
	}
	if gotResp.Usage.CacheCreationInputTokens != wantResp.Usage.CacheCreationInputTokens {
		t.Fatalf(
			"Complete() Usage.CacheCreationInputTokens = %d, want %d",
			gotResp.Usage.CacheCreationInputTokens,
			wantResp.Usage.CacheCreationInputTokens,
		)
	}
	if gotResp.Usage.CacheReadInputTokens != wantResp.Usage.CacheReadInputTokens {
		t.Fatalf(
			"Complete() Usage.CacheReadInputTokens = %d, want %d",
			gotResp.Usage.CacheReadInputTokens,
			wantResp.Usage.CacheReadInputTokens,
		)
	}
	if gotResp.Usage.ProviderCostUSD == nil {
		t.Fatal("Complete() Usage.ProviderCostUSD = nil, want non-nil")
	}
	if *gotResp.Usage.ProviderCostUSD != providerCostUSD {
		t.Fatalf("Complete() Usage.ProviderCostUSD = %f, want %f", *gotResp.Usage.ProviderCostUSD, providerCostUSD)
	}
}

func TestMockClientCompleteReturnsInjectedError(t *testing.T) {
	t.Parallel()

	wantErr := errors.New("provider unavailable")
	client := &MockClient{
		CompleteFunc: func(context.Context, CompleteRequest) (CompleteResponse, error) {
			return CompleteResponse{}, wantErr
		},
	}

	_, err := client.Complete(context.Background(), CompleteRequest{ProviderID: "infomaniak"})
	if !errors.Is(err, wantErr) {
		t.Fatalf("Complete() error = %v, want %v", err, wantErr)
	}
	if len(client.Requests) != 1 {
		t.Fatalf("len(Requests) = %d, want %d", len(client.Requests), 1)
	}
}

func TestMockClientCompleteClonesMessages(t *testing.T) {
	t.Parallel()

	messages := []Message{{Role: "user", Content: "Hello"}}
	client := &MockClient{}

	_, err := client.Complete(context.Background(), CompleteRequest{Messages: messages})
	if err != nil {
		t.Fatalf("Complete() error = %v, want nil", err)
	}

	messages[0].Content = "mutated"
	if client.Requests[0].Messages[0].Content != "Hello" {
		t.Fatalf("Requests[0].Messages[0].Content = %q, want %q", client.Requests[0].Messages[0].Content, "Hello")
	}
}

func TestMockClientCompleteStreamCapturesRequestAndReturnsStubbedStream(t *testing.T) {
	t.Parallel()

	wantReq := CompleteRequest{
		ProviderID:      "infomaniak",
		ProviderModelID: "llama-3.3-70b-instruct",
		Messages:        []Message{{Role: "user", Content: "Hello"}},
	}

	client := &MockClient{
		CompleteStreamFunc: func(_ context.Context, gotReq CompleteRequest) (<-chan CompleteStreamEvent, error) {
			if gotReq.ProviderID != wantReq.ProviderID {
				t.Fatalf("CompleteStream() ProviderID = %q, want %q", gotReq.ProviderID, wantReq.ProviderID)
			}
			ch := make(chan CompleteStreamEvent, 2)
			ch <- CompleteStreamEvent{Delta: "Hi"}
			ch <- CompleteStreamEvent{Usage: &Usage{OutputTokens: 1}}
			close(ch)
			return ch, nil
		},
	}

	stream, err := client.CompleteStream(context.Background(), wantReq)
	if err != nil {
		t.Fatalf("CompleteStream() error = %v, want nil", err)
	}

	var events []CompleteStreamEvent
	for event := range stream {
		events = append(events, event)
	}

	if len(client.Requests) != 1 {
		t.Fatalf("len(Requests) = %d, want %d", len(client.Requests), 1)
	}
	if len(events) != 2 {
		t.Fatalf("len(events) = %d, want %d", len(events), 2)
	}
	if events[0].Delta != "Hi" {
		t.Fatalf("events[0].Delta = %q, want %q", events[0].Delta, "Hi")
	}
	if events[1].Usage == nil || events[1].Usage.OutputTokens != 1 {
		t.Fatalf("events[1].Usage = %#v, want OutputTokens=1", events[1].Usage)
	}
}
