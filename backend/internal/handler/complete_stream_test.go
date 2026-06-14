package handler

import (
	"context"
	"errors"
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/gateway"
)

func TestCollectGatewayStreamContinuesAfterClientDisconnect(t *testing.T) {
	t.Parallel()

	gatewayClient := &gateway.MockClient{
		CompleteStreamFunc: func(_ context.Context, _ gateway.CompleteRequest) (<-chan gateway.CompleteStreamEvent, error) {
			ch := make(chan gateway.CompleteStreamEvent, 3)
			ch <- gateway.CompleteStreamEvent{Delta: "hello "}
			ch <- gateway.CompleteStreamEvent{Delta: "back"}
			ch <- gateway.CompleteStreamEvent{Usage: &gateway.Usage{InputTokens: 12, OutputTokens: 8, TotalTokens: 20}}
			close(ch)
			return ch, nil
		},
	}

	deltaWrites := 0
	resp, clientDisconnected, err := collectGatewayStream(
		context.Background(),
		gatewayClient,
		gateway.CompleteRequest{ProviderID: "infomaniak", ProviderModelID: "model"},
		func(delta string) error {
			deltaWrites++
			if delta == "back" {
				return errors.New("client disconnected")
			}
			return nil
		},
		func(error) {},
	)
	if err != nil {
		t.Fatalf("collectGatewayStream() error = %v", err)
	}
	if !clientDisconnected {
		t.Fatal("clientDisconnected = false, want true")
	}
	if deltaWrites != 2 {
		t.Fatalf("delta writes = %d, want 2", deltaWrites)
	}
	if resp.Message.Content != "hello back" {
		t.Fatalf("assistant content = %q, want %q", resp.Message.Content, "hello back")
	}
	if resp.Usage.InputTokens != 12 || resp.Usage.OutputTokens != 8 {
		t.Fatalf("usage = %+v, want input=12 output=8", resp.Usage)
	}
}

func TestCollectGatewayStreamReturnsGatewayError(t *testing.T) {
	t.Parallel()

	gatewayErr := errors.New("provider down")
	gatewayClient := &gateway.MockClient{
		CompleteStreamFunc: func(_ context.Context, _ gateway.CompleteRequest) (<-chan gateway.CompleteStreamEvent, error) {
			ch := make(chan gateway.CompleteStreamEvent, 2)
			ch <- gateway.CompleteStreamEvent{Delta: "partial"}
			ch <- gateway.CompleteStreamEvent{Err: gatewayErr}
			close(ch)
			return ch, nil
		},
	}

	_, clientDisconnected, err := collectGatewayStream(
		context.Background(),
		gatewayClient,
		gateway.CompleteRequest{ProviderID: "infomaniak", ProviderModelID: "model"},
		func(string) error { return nil },
		func(error) {},
	)
	if !errors.Is(err, gatewayErr) {
		t.Fatalf("collectGatewayStream() error = %v, want %v", err, gatewayErr)
	}
	if clientDisconnected {
		t.Fatal("clientDisconnected = true, want false on gateway failure")
	}
}
