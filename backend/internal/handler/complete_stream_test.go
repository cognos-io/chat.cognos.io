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
		func(string) error { return nil },
		func([]gateway.Citation, []gateway.CitationAnchor, string) error { return nil },
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

func TestCollectGatewayStreamSeparatesReasoningFromAnswer(t *testing.T) {
	t.Parallel()

	gatewayClient := &gateway.MockClient{
		CompleteStreamFunc: func(_ context.Context, _ gateway.CompleteRequest) (<-chan gateway.CompleteStreamEvent, error) {
			ch := make(chan gateway.CompleteStreamEvent, 4)
			ch <- gateway.CompleteStreamEvent{ReasoningDelta: "I weigh "}
			ch <- gateway.CompleteStreamEvent{ReasoningDelta: "the options."}
			ch <- gateway.CompleteStreamEvent{Delta: "The answer."}
			ch <- gateway.CompleteStreamEvent{Usage: &gateway.Usage{OutputTokens: 5, ReasoningTokens: 9}}
			close(ch)
			return ch, nil
		},
	}

	var answerWrites, reasoningWrites []string
	resp, clientDisconnected, stopped, err := collectGatewayStream(
		context.Background(),
		gatewayClient,
		gateway.CompleteRequest{ProviderID: "requesty", ProviderModelID: "model"},
		func(delta string) error { answerWrites = append(answerWrites, delta); return nil },
		func(reasoning string) error { reasoningWrites = append(reasoningWrites, reasoning); return nil },
		func([]gateway.Citation, []gateway.CitationAnchor, string) error { return nil },
		func() error { return nil },
		func(error) {},
	)
	if err != nil {
		t.Fatalf("collectGatewayStream() error = %v", err)
	}
	if clientDisconnected || stopped {
		t.Fatalf("clientDisconnected=%v stopped=%v, want both false", clientDisconnected, stopped)
	}
	if resp.Message.Content != "The answer." {
		t.Fatalf("answer = %q, want %q", resp.Message.Content, "The answer.")
	}
	if resp.Reasoning != "I weigh the options." {
		t.Fatalf("reasoning = %q, want %q", resp.Reasoning, "I weigh the options.")
	}
	if resp.Usage.ReasoningTokens != 9 {
		t.Fatalf("reasoning tokens = %d, want 9", resp.Usage.ReasoningTokens)
	}
	// Reasoning deltas stream on their own channel and never mix into the answer.
	if len(reasoningWrites) != 2 || len(answerWrites) != 1 {
		t.Fatalf("writes: reasoning=%v answer=%v", reasoningWrites, answerWrites)
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
		func(string) error { return nil },
		func([]gateway.Citation, []gateway.CitationAnchor, string) error { return nil },
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
		func(string) error { return nil },
		func([]gateway.Citation, []gateway.CitationAnchor, string) error { return nil },
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

func TestCollectGatewayStreamAccumulatesWebSearch(t *testing.T) {
	t.Parallel()

	gatewayClient := &gateway.MockClient{
		CompleteStreamFunc: func(_ context.Context, _ gateway.CompleteRequest) (<-chan gateway.CompleteStreamEvent, error) {
			ch := make(chan gateway.CompleteStreamEvent, 4)
			ch <- gateway.CompleteStreamEvent{Delta: "answer"}
			ch <- gateway.CompleteStreamEvent{
				Citations:       []gateway.Citation{{URL: "https://a.example", Title: "a.example"}},
				CitationAnchors: []gateway.CitationAnchor{{CitationIndex: 0, StartIndex: 0, EndIndex: 6}},
			}
			ch <- gateway.CompleteStreamEvent{SearchActivity: gateway.SearchActivityCompleted}
			ch <- gateway.CompleteStreamEvent{Usage: &gateway.Usage{SearchCount: 1}}
			close(ch)
			return ch, nil
		},
	}

	webSearchEvents := 0
	var activities []string
	resp, clientDisconnected, stopped, err := collectGatewayStream(
		context.Background(),
		gatewayClient,
		gateway.CompleteRequest{ProviderID: "requesty", ProviderModelID: "model", WebSearch: true},
		func(string) error { return nil },
		func(string) error { return nil },
		func(_ []gateway.Citation, _ []gateway.CitationAnchor, activity string) error {
			webSearchEvents++
			if activity != "" {
				activities = append(activities, activity)
			}
			return nil
		},
		func() error { return nil },
		func(error) {},
	)
	if err != nil {
		t.Fatalf("collectGatewayStream() error = %v", err)
	}
	if clientDisconnected || stopped {
		t.Fatalf("clientDisconnected=%v stopped=%v, want both false", clientDisconnected, stopped)
	}
	// One event carried citations+anchors, a separate event carried activity.
	if webSearchEvents != 2 {
		t.Fatalf("web search events = %d, want 2", webSearchEvents)
	}
	if len(resp.Citations) != 1 || resp.Citations[0].URL != "https://a.example" {
		t.Fatalf("accumulated citations = %+v", resp.Citations)
	}
	if len(resp.CitationAnchors) != 1 || resp.CitationAnchors[0].EndIndex != 6 {
		t.Fatalf("accumulated anchors = %+v", resp.CitationAnchors)
	}
	if resp.Usage.SearchCount != 1 {
		t.Fatalf("search count = %d, want 1", resp.Usage.SearchCount)
	}
	if len(activities) != 1 || activities[0] != gateway.SearchActivityCompleted {
		t.Fatalf("activities = %v, want [completed]", activities)
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
		func(string) error { return nil },
		func([]gateway.Citation, []gateway.CitationAnchor, string) error { return nil },
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
