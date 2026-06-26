package handler

import (
	"context"
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/catalogue"
	"github.com/cognos-io/chat.cognos.io/backend/internal/compaction"
	"github.com/cognos-io/chat.cognos.io/backend/internal/gateway"
)

const validCompactionJSON = `{"durable_memory":{"items":[]},"rolling_narrative":"n","citations":[]}`

// scriptedGateway returns a queued response per Complete call and records whether
// each call asked for JSON response format.
type scriptedGateway struct {
	replies       []string
	calls         int
	jsonRequested []bool
}

func (g *scriptedGateway) Complete(_ context.Context, req gateway.CompleteRequest) (gateway.CompleteResponse, error) {
	g.jsonRequested = append(g.jsonRequested, req.JSONResponseFormat)
	reply := ""
	if g.calls < len(g.replies) {
		reply = g.replies[g.calls]
	}
	g.calls++
	return gateway.CompleteResponse{Message: gateway.Message{Role: "assistant", Content: reply}}, nil
}

func (g *scriptedGateway) CompleteStream(context.Context, gateway.CompleteRequest) (<-chan gateway.CompleteStreamEvent, error) {
	return nil, nil
}

func (g *scriptedGateway) GenerateImage(context.Context, gateway.ImageRequest) (gateway.ImageResponse, error) {
	return gateway.ImageResponse{}, nil
}

func runFixture(t *testing.T, model catalogue.Model, replies []string) (compaction.ParseResult, compaction.OutputMode, *scriptedGateway, error) {
	t.Helper()
	gw := &scriptedGateway{replies: replies}
	params := CompactionHandlerParams{GatewayClient: gw}
	messages := []compaction.InputMessage{{Alias: "M1", MessageID: "m1", Role: "user", Content: "hi"}}
	parsed, mode, _, err := runCompaction(params, model, nil, messages)
	return parsed, mode, gw, err
}

func TestEffectiveMaxOutputTokens(t *testing.T) {
	t.Parallel()

	model := catalogue.Model{MaxOutputTokens: 128000}
	cases := []struct {
		name      string
		requested int
		model     catalogue.Model
		plan      billing.PlanType
		want      int
	}{
		{"trial uses default cap", 0, model, billing.PlanTypeTrial, defaultMaxOutputTokens},
		{"inactive uses default cap", 0, model, billing.PlanTypeInactive, defaultMaxOutputTokens},
		{"payg uses paid cap", 0, model, billing.PlanTypePayG, paidMaxOutputTokens},
		{"unlimited uses paid cap", 0, model, billing.PlanTypeUnlimited, paidMaxOutputTokens},
		{"caller request honoured", 2000, model, billing.PlanTypeTrial, 2000},
		{"paid cap clamped to model max", 0, catalogue.Model{MaxOutputTokens: 16000}, billing.PlanTypeUnlimited, 16000},
		{"request clamped to model max", 200000, model, billing.PlanTypeUnlimited, 128000},
		{"no model max keeps paid cap", 0, catalogue.Model{}, billing.PlanTypeUnlimited, paidMaxOutputTokens},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := effectiveMaxOutputTokens(tc.requested, tc.model, tc.plan); got != tc.want {
				t.Errorf("effectiveMaxOutputTokens(%d, %s) = %d, want %d", tc.requested, tc.plan, got, tc.want)
			}
		})
	}
}

func TestEstimatePromptInputTokensUsesActualPrompt(t *testing.T) {
	t.Parallel()

	// 1M-context model: the estimate must reflect the short prompt, not the
	// context window.
	model := catalogue.Model{InputContextTokens: 1_000_000, ApproxCharsPerToken: 4}
	got := estimatePromptInputTokens("system", []completionMessage{
		{Role: "user", Content: "hello there friend"},
	}, model)
	// (6 + 18) / 4 + 1 = 7
	if got != 7 {
		t.Errorf("estimatePromptInputTokens = %d, want 7", got)
	}
	if got >= int64(model.InputContextTokens) {
		t.Errorf("estimate %d should be far below the context window", got)
	}
}

func TestRunCompactionUsesStructuredWhenSupported(t *testing.T) {
	t.Parallel()

	model := catalogue.Model{ProviderID: "p", ProviderModelID: "m", SupportsStructuredOutput: true}
	_, mode, gw, err := runFixture(t, model, []string{validCompactionJSON})
	if err != nil {
		t.Fatalf("runCompaction: %v", err)
	}
	if mode != compaction.OutputModeStructured {
		t.Errorf("expected structured mode, got %q", mode)
	}
	if gw.calls != 1 {
		t.Errorf("expected 1 call, got %d", gw.calls)
	}
	if len(gw.jsonRequested) == 0 || !gw.jsonRequested[0] {
		t.Errorf("expected first call to request JSON response format, got %v", gw.jsonRequested)
	}
}

func TestRunCompactionFallsBackToDelimitedOnBadStructuredOutput(t *testing.T) {
	t.Parallel()

	model := catalogue.Model{ProviderID: "p", ProviderModelID: "m", SupportsStructuredOutput: true}
	// First (structured) reply is unparseable; second (delimited) succeeds.
	_, mode, gw, err := runFixture(t, model, []string{
		"the model ignored json mode and wrote prose",
		"<compaction>" + validCompactionJSON + "</compaction>",
	})
	if err != nil {
		t.Fatalf("runCompaction: %v", err)
	}
	if mode != compaction.OutputModeDelimitedText {
		t.Errorf("expected delimited fallback mode, got %q", mode)
	}
	if gw.calls != 2 {
		t.Errorf("expected 2 calls (structured then fallback), got %d", gw.calls)
	}
	if gw.jsonRequested[0] != true || gw.jsonRequested[1] != false {
		t.Errorf("expected JSON requested only on first attempt, got %v", gw.jsonRequested)
	}
}

func TestRunCompactionUsesDelimitedWhenStructuredUnsupported(t *testing.T) {
	t.Parallel()

	model := catalogue.Model{ProviderID: "p", ProviderModelID: "m", SupportsStructuredOutput: false}
	_, mode, gw, err := runFixture(t, model, []string{"<compaction>" + validCompactionJSON + "</compaction>"})
	if err != nil {
		t.Fatalf("runCompaction: %v", err)
	}
	if mode != compaction.OutputModeDelimitedText {
		t.Errorf("expected delimited mode, got %q", mode)
	}
	if gw.jsonRequested[0] != false {
		t.Errorf("expected no JSON response format request, got %v", gw.jsonRequested)
	}
}
