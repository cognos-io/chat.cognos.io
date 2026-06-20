package handler

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/cognos-io/chat.cognos.io/backend/internal/gateway"
)

func TestCompletionStopperScopesStopsByOwnerAndRequest(t *testing.T) {
	stopper := NewCompletionStopper()

	cancelled := false
	unregister := stopper.Register("user-1", "req-1", func() { cancelled = true })
	defer unregister()

	if stopper.Stop("user-2", "req-1") {
		t.Fatal("Stop(user-2, req-1) = true, want false")
	}
	if cancelled {
		t.Fatal("wrong owner cancelled the completion")
	}
	if stopper.Stop("user-1", "missing") {
		t.Fatal("Stop(user-1, missing) = true, want false")
	}
	if cancelled {
		t.Fatal("missing request cancelled the completion")
	}
	if !stopper.Stop("user-1", "req-1") {
		t.Fatal("Stop(user-1, req-1) = false, want true")
	}
	if !cancelled {
		t.Fatal("matching stop did not cancel the completion")
	}
}

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
	resp, clientDisconnected, stopped, err := collectGatewayStream(
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
		func() error { return nil },
		func(error) {},
	)
	if err != nil {
		t.Fatalf("collectGatewayStream() error = %v", err)
	}
	if !clientDisconnected {
		t.Fatal("clientDisconnected = false, want true")
	}
	if stopped {
		t.Fatal("stopped = true, want false")
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

func TestCollectGatewayStreamPersistsPartialWhenStopped(t *testing.T) {
	gatewayClient := &gateway.MockClient{
		CompleteStreamFunc: func(ctx context.Context, _ gateway.CompleteRequest) (<-chan gateway.CompleteStreamEvent, error) {
			out := make(chan gateway.CompleteStreamEvent)
			go func() {
				defer close(out)
				out <- gateway.CompleteStreamEvent{Delta: "partial "}
				<-ctx.Done()
			}()
			return out, nil
		},
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	deltaWrites := 0
	resp, clientDisconnected, stopped, err := collectGatewayStreamWithHeartbeat(
		ctx,
		gatewayClient,
		gateway.CompleteRequest{ProviderID: "infomaniak", ProviderModelID: "model"},
		func(delta string) error {
			deltaWrites++
			cancel()
			return nil
		},
		func() error { return nil },
		func(error) {},
		time.Hour,
	)
	if err != nil {
		t.Fatalf("collectGatewayStreamWithHeartbeat() error = %v", err)
	}
	if clientDisconnected {
		t.Fatal("clientDisconnected = true, want false")
	}
	if !stopped {
		t.Fatal("stopped = false, want true")
	}
	if deltaWrites != 1 {
		t.Fatalf("delta writes = %d, want 1", deltaWrites)
	}
	if resp.Message.Content != "partial " {
		t.Fatalf("assistant content = %q, want %q", resp.Message.Content, "partial ")
	}
}

func TestCollectGatewayStreamSendsHeartbeatWhileWaitingForDeltas(t *testing.T) {
	ch := make(chan gateway.CompleteStreamEvent, 1)
	gatewayClient := &gateway.MockClient{
		CompleteStreamFunc: func(_ context.Context, _ gateway.CompleteRequest) (<-chan gateway.CompleteStreamEvent, error) {
			return ch, nil
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	heartbeatWrites := 0
	resp, clientDisconnected, stopped, err := collectGatewayStreamWithHeartbeat(
		ctx,
		gatewayClient,
		gateway.CompleteRequest{ProviderID: "infomaniak", ProviderModelID: "model"},
		func(string) error { return nil },
		func() error {
			if heartbeatWrites == 0 {
				ch <- gateway.CompleteStreamEvent{Delta: "done"}
				close(ch)
			}
			heartbeatWrites++
			return nil
		},
		func(error) {},
		time.Millisecond,
	)
	if err != nil {
		t.Fatalf("collectGatewayStreamWithHeartbeat() error = %v", err)
	}
	if clientDisconnected {
		t.Fatal("clientDisconnected = true, want false")
	}
	if stopped {
		t.Fatal("stopped = true, want false")
	}
	if heartbeatWrites == 0 {
		t.Fatalf("heartbeat writes = %d, want at least 1", heartbeatWrites)
	}
	if resp.Message.Content != "done" {
		t.Fatalf("assistant content = %q, want %q", resp.Message.Content, "done")
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

	_, clientDisconnected, stopped, err := collectGatewayStream(
		context.Background(),
		gatewayClient,
		gateway.CompleteRequest{ProviderID: "infomaniak", ProviderModelID: "model"},
		func(string) error { return nil },
		func() error { return nil },
		func(error) {},
	)
	if !errors.Is(err, gatewayErr) {
		t.Fatalf("collectGatewayStream() error = %v, want %v", err, gatewayErr)
	}
	if clientDisconnected {
		t.Fatal("clientDisconnected = true, want false on gateway failure")
	}
	if stopped {
		t.Fatal("stopped = true, want false on gateway failure")
	}
}
