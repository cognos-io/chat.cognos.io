package gateway

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/maximhq/bifrost/core/schemas"
)

type stubBifrostRequester struct {
	resp      *schemas.BifrostChatResponse
	err       *schemas.BifrostError
	stream    chan *schemas.BifrostStreamChunk
	streamErr *schemas.BifrostError
	req       *schemas.BifrostChatRequest
	streamReq *schemas.BifrostChatRequest

	respResp      *schemas.BifrostResponsesResponse
	respErr       *schemas.BifrostError
	respStream    chan *schemas.BifrostStreamChunk
	respStreamErr *schemas.BifrostError
	respReq       *schemas.BifrostResponsesRequest
	respStreamReq *schemas.BifrostResponsesRequest

	imageResp *schemas.BifrostImageGenerationResponse
	imageErr  *schemas.BifrostError
	imageReq  *schemas.BifrostImageGenerationRequest
}

func (s *stubBifrostRequester) ChatCompletionRequest(
	_ *schemas.BifrostContext,
	req *schemas.BifrostChatRequest,
) (*schemas.BifrostChatResponse, *schemas.BifrostError) {
	s.req = req
	return s.resp, s.err
}

func (s *stubBifrostRequester) ChatCompletionStreamRequest(
	_ *schemas.BifrostContext,
	req *schemas.BifrostChatRequest,
) (chan *schemas.BifrostStreamChunk, *schemas.BifrostError) {
	s.streamReq = req
	return s.stream, s.streamErr
}

func (s *stubBifrostRequester) ResponsesRequest(
	_ *schemas.BifrostContext,
	req *schemas.BifrostResponsesRequest,
) (*schemas.BifrostResponsesResponse, *schemas.BifrostError) {
	s.respReq = req
	return s.respResp, s.respErr
}

func (s *stubBifrostRequester) ResponsesStreamRequest(
	_ *schemas.BifrostContext,
	req *schemas.BifrostResponsesRequest,
) (chan *schemas.BifrostStreamChunk, *schemas.BifrostError) {
	s.respStreamReq = req
	return s.respStream, s.respStreamErr
}

func (s *stubBifrostRequester) ImageGenerationRequest(
	_ *schemas.BifrostContext,
	req *schemas.BifrostImageGenerationRequest,
) (*schemas.BifrostImageGenerationResponse, *schemas.BifrostError) {
	s.imageReq = req
	return s.imageResp, s.imageErr
}

type stubBifrostShutdowner struct{ called bool }

func (s *stubBifrostShutdowner) Shutdown() { s.called = true }

func TestBuildResponsesRequestMapsCoreFields(t *testing.T) {
	t.Parallel()

	client := NewBifrostClient(&stubBifrostRequester{}, nil, nil, nil)
	got, err := client.buildResponsesRequest(CompleteRequest{
		ProviderID:      "requesty",
		ProviderModelID: "some-model",
		Messages: []Message{
			{Role: "system", Content: "You are helpful"},
			{Role: "user", Content: "Hello"},
		},
		MaxOutputTokens: 512,
	})
	if err != nil {
		t.Fatalf("buildResponsesRequest() error = %v, want nil", err)
	}
	if got.Provider != schemas.ModelProvider("requesty") {
		t.Fatalf("provider = %q, want requesty", got.Provider)
	}
	if got.Model != "some-model" {
		t.Fatalf("model = %q, want some-model", got.Model)
	}
	if len(got.Input) != 2 {
		t.Fatalf("len(input) = %d, want 2", len(got.Input))
	}
	if got.Input[0].Role == nil || *got.Input[0].Role != schemas.ResponsesInputMessageRoleSystem {
		t.Fatalf("first input role = %#v, want system", got.Input[0].Role)
	}
	if got.Input[0].Content == nil || got.Input[0].Content.ContentStr == nil || *got.Input[0].Content.ContentStr != "You are helpful" {
		t.Fatalf("first input content = %#v, want the system prompt as a string", got.Input[0].Content)
	}
	if got.Input[1].Role == nil || *got.Input[1].Role != schemas.ResponsesInputMessageRoleUser {
		t.Fatalf("second input role = %#v, want user", got.Input[1].Role)
	}
	if got.Params == nil || got.Params.MaxOutputTokens == nil || *got.Params.MaxOutputTokens != 512 {
		t.Fatalf("max output tokens = %#v, want 512", got.Params)
	}
}

func TestBuildResponsesRequestReasoning(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		effort     string
		budget     int
		wantNil    bool
		wantEffort string
		wantBudget *int
	}{
		{name: "empty omits reasoning", effort: "", wantNil: true},
		{name: "off omits reasoning", effort: "off", wantNil: true},
		{name: "none omits reasoning", effort: "none", wantNil: true},
		{name: "medium passes through", effort: "medium", wantEffort: "medium"},
		{name: "model-specific tier passes through", effort: "ultra", wantEffort: "ultra"},
		{name: "budget rides along with an enabled tier", effort: "high", budget: 16384, wantEffort: "high", wantBudget: intPtr(16384)},
		{name: "off never carries a budget", effort: "off", budget: 16384, wantNil: true},
	}

	client := NewBifrostClient(&stubBifrostRequester{}, nil, nil, nil)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := client.buildResponsesRequest(CompleteRequest{
				ProviderID:         "requesty",
				ProviderModelID:    "model",
				ReasoningEffort:    tc.effort,
				ReasoningMaxTokens: tc.budget,
			})
			if err != nil {
				t.Fatalf("buildResponsesRequest() error = %v", err)
			}
			var reasoning *schemas.ResponsesParametersReasoning
			if got.Params != nil {
				reasoning = got.Params.Reasoning
			}
			if tc.wantNil {
				if reasoning != nil {
					t.Fatalf("reasoning = %#v, want nil", reasoning)
				}
				return
			}
			if reasoning == nil || reasoning.Effort == nil || *reasoning.Effort != tc.wantEffort {
				t.Fatalf("reasoning effort = %#v, want %q", reasoning, tc.wantEffort)
			}
			switch {
			case tc.wantBudget == nil:
				if reasoning.MaxTokens != nil {
					t.Fatalf("reasoning max tokens = %d, want nil", *reasoning.MaxTokens)
				}
			default:
				if reasoning.MaxTokens == nil || *reasoning.MaxTokens != *tc.wantBudget {
					t.Fatalf("reasoning max tokens = %#v, want %d", reasoning.MaxTokens, *tc.wantBudget)
				}
			}
		})
	}
}

func TestBuildResponsesRequestJSONMode(t *testing.T) {
	t.Parallel()

	client := NewBifrostClient(&stubBifrostRequester{}, nil, nil, nil)
	got, err := client.buildResponsesRequest(CompleteRequest{
		ProviderID:         "requesty",
		ProviderModelID:    "model",
		JSONResponseFormat: true,
	})
	if err != nil {
		t.Fatalf("buildResponsesRequest() error = %v", err)
	}
	if got.Params == nil || got.Params.Text == nil || got.Params.Text.Format == nil {
		t.Fatalf("text format = %#v, want json_object format", got.Params)
	}
	if got.Params.Text.Format.Type != "json_object" {
		t.Fatalf("text format type = %q, want json_object", got.Params.Text.Format.Type)
	}
}

func TestBuildResponsesRequestWebSearchTool(t *testing.T) {
	t.Parallel()

	client := NewBifrostClient(&stubBifrostRequester{}, nil, nil, nil)

	t.Run("enabled adds tool and include", func(t *testing.T) {
		t.Parallel()
		got, err := client.buildResponsesRequest(CompleteRequest{
			ProviderID:      "requesty",
			ProviderModelID: "model",
			WebSearch:       true,
		})
		if err != nil {
			t.Fatalf("buildResponsesRequest() error = %v", err)
		}
		if got.Params == nil || len(got.Params.Tools) != 1 {
			t.Fatalf("tools = %#v, want a single web_search tool", got.Params)
		}
		if got.Params.Tools[0].Type != schemas.ResponsesToolTypeWebSearch {
			t.Fatalf("tool type = %q, want web_search", got.Params.Tools[0].Type)
		}
		if !containsString(got.Params.Include, "web_search_call.action.sources") {
			t.Fatalf("include = %#v, want the action sources flag", got.Params.Include)
		}
	})

	t.Run("disabled sends no tool or include", func(t *testing.T) {
		t.Parallel()
		got, err := client.buildResponsesRequest(CompleteRequest{
			ProviderID:      "requesty",
			ProviderModelID: "model",
			WebSearch:       false,
		})
		if err != nil {
			t.Fatalf("buildResponsesRequest() error = %v", err)
		}
		if got.Params != nil && len(got.Params.Tools) != 0 {
			t.Fatalf("tools = %#v, want none", got.Params.Tools)
		}
		if got.Params != nil && len(got.Params.Include) != 0 {
			t.Fatalf("include = %#v, want none", got.Params.Include)
		}
	})
}

func TestBuildResponsesMessageContent(t *testing.T) {
	t.Parallel()

	t.Run("text only stays a string", func(t *testing.T) {
		t.Parallel()
		content := buildResponsesMessageContent("hello", nil, nil)
		if content.ContentStr == nil || *content.ContentStr != "hello" {
			t.Fatalf("content = %#v, want ContentStr=hello", content)
		}
		if content.ContentBlocks != nil {
			t.Fatalf("text-only content should not use blocks")
		}
	})

	t.Run("image becomes input_image block", func(t *testing.T) {
		t.Parallel()
		content := buildResponsesMessageContent("describe this", []MessageImage{
			{Base64: "QUJD", MimeType: "image/png"},
		}, nil)
		if len(content.ContentBlocks) != 2 {
			t.Fatalf("want 2 blocks (text+image), got %d", len(content.ContentBlocks))
		}
		if content.ContentBlocks[0].Type != schemas.ResponsesInputMessageContentBlockTypeText ||
			content.ContentBlocks[0].Text == nil || *content.ContentBlocks[0].Text != "describe this" {
			t.Fatalf("first block should be the prompt text: %#v", content.ContentBlocks[0])
		}
		image := content.ContentBlocks[1]
		if image.Type != schemas.ResponsesInputMessageContentBlockTypeImage ||
			image.ResponsesInputMessageContentBlockImage == nil || image.ImageURL == nil ||
			*image.ImageURL != "data:image/png;base64,QUJD" {
			t.Fatalf("second block should be an input_image data URL: %#v", image)
		}
	})

	t.Run("file becomes input_file block", func(t *testing.T) {
		t.Parallel()
		content := buildResponsesMessageContent("summarise", nil, []MessageFile{
			{Base64: "JVBERi0=", MimeType: "application/pdf", Filename: "report.pdf"},
		})
		if len(content.ContentBlocks) != 2 {
			t.Fatalf("want 2 blocks (text+file), got %d", len(content.ContentBlocks))
		}
		file := content.ContentBlocks[1]
		if file.Type != schemas.ResponsesInputMessageContentBlockTypeFile ||
			file.ResponsesInputMessageContentBlockFile == nil || file.FileData == nil ||
			*file.FileData != "data:application/pdf;base64,JVBERi0=" {
			t.Fatalf("second block should be an input_file data URL: %#v", file)
		}
		if file.Filename == nil || *file.Filename != "report.pdf" {
			t.Fatalf("file name = %#v, want report.pdf", file.Filename)
		}
	})
}

func containsString(values []string, want string) bool {
	for _, v := range values {
		if v == want {
			return true
		}
	}
	return false
}

func TestBifrostClientCompleteMapsRequestAndResponse(t *testing.T) {
	t.Parallel()

	requester := &stubBifrostRequester{
		respResp: &schemas.BifrostResponsesResponse{
			Output: []schemas.ResponsesMessage{responsesTextItem("Hi there")},
			Usage: &schemas.ResponsesResponseUsage{
				InputTokens:  12,
				OutputTokens: 34,
				TotalTokens:  46,
				InputTokensDetails: &schemas.ResponsesResponseInputTokens{
					CachedReadTokens:  5,
					CachedWriteTokens: 6,
				},
				Cost: &schemas.BifrostCost{TotalCost: 0.42},
			},
		},
	}
	shutdowner := &stubBifrostShutdowner{}
	client := NewBifrostClient(requester, shutdowner, nil, nil)

	got, err := client.Complete(context.Background(), CompleteRequest{
		ProviderID:      "requesty",
		ProviderModelID: "gpt-mock",
		Messages: []Message{{
			Role:    "user",
			Content: "Hello",
		}},
		MaxOutputTokens: 512,
	})
	if err != nil {
		t.Fatalf("Complete() error = %v, want nil", err)
	}
	if requester.respReq.Provider != schemas.ModelProvider("requesty") {
		t.Fatalf("request provider = %q, want %q", requester.respReq.Provider, "requesty")
	}
	if requester.respReq.Model != "gpt-mock" {
		t.Fatalf("request model = %q, want %q", requester.respReq.Model, "gpt-mock")
	}
	if requester.respReq.Params == nil || requester.respReq.Params.MaxOutputTokens == nil || *requester.respReq.Params.MaxOutputTokens != 512 {
		t.Fatalf("request max output tokens = %#v, want 512", requester.respReq.Params)
	}
	if len(requester.respReq.Input) != 1 {
		t.Fatalf("len(request input) = %d, want %d", len(requester.respReq.Input), 1)
	}
	if requester.respReq.Input[0].Content == nil || requester.respReq.Input[0].Content.ContentStr == nil || *requester.respReq.Input[0].Content.ContentStr != "Hello" {
		t.Fatalf("request content = %#v, want Hello", requester.respReq.Input[0].Content)
	}
	if got.Message.Role != "assistant" || got.Message.Content != "Hi there" {
		t.Fatalf("Complete() message = %#v, want assistant/Hi there", got.Message)
	}
	if got.Usage.InputTokens != 12 || got.Usage.OutputTokens != 34 || got.Usage.TotalTokens != 46 {
		t.Fatalf("Complete() usage = %#v", got.Usage)
	}
	if got.Usage.CacheReadInputTokens != 5 || got.Usage.CacheCreationInputTokens != 6 {
		t.Fatalf("Complete() cache usage = %#v", got.Usage)
	}
	if got.Usage.ProviderCostUSD == nil || *got.Usage.ProviderCostUSD != 0.42 {
		t.Fatalf("Complete() provider cost = %#v, want 0.42", got.Usage.ProviderCostUSD)
	}

	client.Shutdown()
	if !shutdowner.called {
		t.Fatal("Shutdown() did not call underlying shutdowner")
	}
}

func TestBifrostClientCompleteMapsReasoning(t *testing.T) {
	t.Parallel()

	reasoning := "First I weigh the constraints, then I answer."
	reasoningType := schemas.ResponsesMessageTypeReasoning
	reasoningBlockType := schemas.ResponsesOutputMessageContentTypeReasoning
	requester := &stubBifrostRequester{
		respResp: &schemas.BifrostResponsesResponse{
			Output: []schemas.ResponsesMessage{
				{
					Type: &reasoningType,
					Content: &schemas.ResponsesMessageContent{
						ContentBlocks: []schemas.ResponsesMessageContentBlock{
							{Type: reasoningBlockType, Text: stringPtr(reasoning)},
						},
					},
				},
				responsesTextItem("The answer is 42."),
			},
			Usage: &schemas.ResponsesResponseUsage{
				InputTokens:         10,
				OutputTokens:        20,
				TotalTokens:         30,
				OutputTokensDetails: &schemas.ResponsesResponseOutputTokens{ReasoningTokens: 8},
			},
		},
	}
	client := NewBifrostClient(requester, nil, nil, nil)

	got, err := client.Complete(context.Background(), CompleteRequest{ProviderID: "requesty", ProviderModelID: "model"})
	if err != nil {
		t.Fatalf("Complete() error = %v, want nil", err)
	}
	if got.Message.Content != "The answer is 42." {
		t.Fatalf("Complete() content = %q, want %q", got.Message.Content, "The answer is 42.")
	}
	if got.Reasoning != reasoning {
		t.Fatalf("Complete() reasoning = %q, want %q", got.Reasoning, reasoning)
	}
	if got.Usage.ReasoningTokens != 8 {
		t.Fatalf("Complete() reasoning tokens = %d, want 8", got.Usage.ReasoningTokens)
	}
}

func TestBifrostClientCompleteOmitsReasoningWhenAbsent(t *testing.T) {
	t.Parallel()

	requester := &stubBifrostRequester{
		respResp: &schemas.BifrostResponsesResponse{
			Output: []schemas.ResponsesMessage{responsesTextItem("Hi")},
		},
	}
	client := NewBifrostClient(requester, nil, nil, nil)

	got, err := client.Complete(context.Background(), CompleteRequest{ProviderID: "requesty", ProviderModelID: "model"})
	if err != nil {
		t.Fatalf("Complete() error = %v, want nil", err)
	}
	if got.Reasoning != "" {
		t.Fatalf("Complete() reasoning = %q, want empty", got.Reasoning)
	}
	if got.Usage.ReasoningTokens != 0 {
		t.Fatalf("Complete() reasoning tokens = %d, want 0", got.Usage.ReasoningTokens)
	}
}

func TestBifrostClientCompleteStreamSeparatesReasoningDeltas(t *testing.T) {
	t.Parallel()

	stream := make(chan *schemas.BifrostStreamChunk, 4)
	stream <- respTextChunk("Let me ")
	stream <- respReasoningChunk("think about this")
	stream <- respTextChunk("Answer")
	stream <- respCompletedChunk(&schemas.ResponsesResponseUsage{InputTokens: 1, OutputTokens: 2, TotalTokens: 3})
	close(stream)

	requester := &stubBifrostRequester{respStream: stream}
	client := NewBifrostClient(requester, nil, nil, nil)

	out, err := client.CompleteStream(context.Background(), CompleteRequest{ProviderID: "requesty", ProviderModelID: "model"})
	if err != nil {
		t.Fatalf("CompleteStream() error = %v, want nil", err)
	}

	var answer, reasoning strings.Builder
	var usage *Usage
	for event := range out {
		if event.Err != nil {
			t.Fatalf("stream event error = %v", event.Err)
		}
		answer.WriteString(event.Delta)
		reasoning.WriteString(event.ReasoningDelta)
		if event.Usage != nil {
			usage = event.Usage
		}
	}

	if answer.String() != "Let me Answer" {
		t.Fatalf("answer = %q, want %q", answer.String(), "Let me Answer")
	}
	if reasoning.String() != "think about this" {
		t.Fatalf("reasoning = %q, want %q", reasoning.String(), "think about this")
	}
	if usage == nil || usage.TotalTokens != 3 {
		t.Fatalf("usage = %#v, want total tokens 3 from the terminal event", usage)
	}
}

func TestBifrostClientCompleteJoinsOutputTextBlocks(t *testing.T) {
	t.Parallel()

	textType := schemas.ResponsesOutputMessageContentTypeText
	messageType := schemas.ResponsesMessageTypeMessage
	requester := &stubBifrostRequester{
		respResp: &schemas.BifrostResponsesResponse{
			Output: []schemas.ResponsesMessage{{
				Type: &messageType,
				Content: &schemas.ResponsesMessageContent{
					ContentBlocks: []schemas.ResponsesMessageContentBlock{
						{Type: textType, Text: stringPtr("Hello")},
						{Type: textType, Text: stringPtr(" world")},
					},
				},
			}},
		},
	}

	client := NewBifrostClient(requester, nil, nil, nil)
	got, err := client.Complete(context.Background(), CompleteRequest{ProviderID: "requesty", ProviderModelID: "model"})
	if err != nil {
		t.Fatalf("Complete() error = %v, want nil", err)
	}
	if got.Message.Content != "Hello world" {
		t.Fatalf("Complete() content = %q, want %q", got.Message.Content, "Hello world")
	}
}

func TestBifrostClientCompleteStreamCitationsAndAnchors(t *testing.T) {
	t.Parallel()

	// Answer carries an accented word so byte offsets differ from rune offsets.
	// "Le salaire minimum " is 19 ASCII bytes; "légal" is 6 bytes / 5 runes.
	answer := "Le salaire minimum légal est fixé."
	startByte := strings.Index(answer, "légal")
	endByte := startByte + len("légal")

	stream := make(chan *schemas.BifrostStreamChunk, 8)
	stream <- respTextChunk(answer)
	// Annotation arrives AFTER the text (this family's ordering) and carries a
	// usable {url,title}. Its offsets are UTF-8 byte offsets.
	stream <- respAnnotationChunk("https://example.com/wage", "example.com", startByte, endByte)
	// A web_search_call item + its title-less proxy source, added at the end.
	stream <- respSearchItemAddedChunk()
	stream <- respSearchActivityChunk(schemas.ResponsesStreamResponseTypeWebSearchCallCompleted)
	stream <- respSearchSourcesChunk("https://vertexaisearch.example/redirect/x")
	stream <- respCompletedChunk(&schemas.ResponsesResponseUsage{InputTokens: 5, OutputTokens: 9, TotalTokens: 14})
	close(stream)

	requester := &stubBifrostRequester{respStream: stream}
	client := NewBifrostClient(requester, nil, nil, nil)

	out, err := client.CompleteStream(context.Background(), CompleteRequest{ProviderID: "requesty", ProviderModelID: "model", WebSearch: true})
	if err != nil {
		t.Fatalf("CompleteStream() error = %v", err)
	}

	var citations []Citation
	var anchors []CitationAnchor
	var activity []string
	var usage *Usage
	for event := range out {
		if event.Err != nil {
			t.Fatalf("stream event error = %v", event.Err)
		}
		citations = append(citations, event.Citations...)
		anchors = append(anchors, event.CitationAnchors...)
		if event.SearchActivity != "" {
			activity = append(activity, event.SearchActivity)
		}
		if event.Usage != nil {
			usage = event.Usage
		}
	}

	if len(citations) != 2 {
		t.Fatalf("citations = %#v, want 2 (annotation + unseen proxy source)", citations)
	}
	if citations[0].URL != "https://example.com/wage" || citations[0].Title != "example.com" {
		t.Fatalf("first citation = %#v, want the annotation source with title", citations[0])
	}
	if citations[1].URL != "https://vertexaisearch.example/redirect/x" || citations[1].Title != "" {
		t.Fatalf("second citation = %#v, want the title-less proxy source", citations[1])
	}
	if len(anchors) != 1 {
		t.Fatalf("anchors = %#v, want 1", anchors)
	}
	// Byte offsets [19,25] convert to code-point offsets [19,24].
	wantStart := utf8.RuneCountInString(answer[:startByte])
	wantEnd := utf8.RuneCountInString(answer[:endByte])
	if anchors[0].CitationIndex != 0 || anchors[0].StartIndex != wantStart || anchors[0].EndIndex != wantEnd {
		t.Fatalf("anchor = %#v, want citation 0 spanning code points [%d,%d]", anchors[0], wantStart, wantEnd)
	}
	if len(activity) == 0 || activity[len(activity)-1] != SearchActivityCompleted {
		t.Fatalf("search activity = %#v, want it to end with completed", activity)
	}
	if usage == nil || usage.SearchCount != 1 {
		t.Fatalf("usage = %#v, want SearchCount 1 from one web_search_call item", usage)
	}
}

func TestBifrostClientCompleteStreamDeDupesCitationsByURL(t *testing.T) {
	t.Parallel()

	answer := "abcdefghij"
	stream := make(chan *schemas.BifrostStreamChunk, 5)
	stream <- respTextChunk(answer)
	stream <- respAnnotationChunk("https://dup.example/a", "dup.example", 0, 3)
	stream <- respAnnotationChunk("https://dup.example/a", "dup.example", 4, 7)
	stream <- respCompletedChunk(&schemas.ResponsesResponseUsage{})
	close(stream)

	requester := &stubBifrostRequester{respStream: stream}
	client := NewBifrostClient(requester, nil, nil, nil)
	out, err := client.CompleteStream(context.Background(), CompleteRequest{ProviderID: "requesty", ProviderModelID: "model", WebSearch: true})
	if err != nil {
		t.Fatalf("CompleteStream() error = %v", err)
	}

	var citations []Citation
	var anchors []CitationAnchor
	for event := range out {
		citations = append(citations, event.Citations...)
		anchors = append(anchors, event.CitationAnchors...)
	}
	if len(citations) != 1 {
		t.Fatalf("citations = %#v, want 1 (de-duplicated by URL)", citations)
	}
	if len(anchors) != 2 {
		t.Fatalf("anchors = %#v, want 2 spans referencing the single citation", anchors)
	}
	for _, a := range anchors {
		if a.CitationIndex != 0 {
			t.Fatalf("anchor %#v, want CitationIndex 0", a)
		}
	}
}

func TestBifrostClientCompleteStreamDropsUnusableAnchors(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name              string
		answer            string
		start, end        int
		wantCitationCount int
		wantAnchorCount   int
	}{
		{name: "out of range end drops anchor, keeps citation", answer: "short", start: 0, end: 999, wantCitationCount: 1, wantAnchorCount: 0},
		{name: "inverted offsets drop anchor", answer: "abcdef", start: 5, end: 2, wantCitationCount: 1, wantAnchorCount: 0},
		{name: "offset inside a multi-byte rune drops anchor", answer: "café", start: 0, end: 4, wantCitationCount: 1, wantAnchorCount: 0},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			stream := make(chan *schemas.BifrostStreamChunk, 4)
			stream <- respTextChunk(tc.answer)
			stream <- respAnnotationChunk("https://x.example/a", "x.example", tc.start, tc.end)
			stream <- respCompletedChunk(&schemas.ResponsesResponseUsage{})
			close(stream)

			requester := &stubBifrostRequester{respStream: stream}
			client := NewBifrostClient(requester, nil, nil, nil)
			out, err := client.CompleteStream(context.Background(), CompleteRequest{ProviderID: "requesty", ProviderModelID: "model", WebSearch: true})
			if err != nil {
				t.Fatalf("CompleteStream() error = %v", err)
			}
			var citations []Citation
			var anchors []CitationAnchor
			for event := range out {
				citations = append(citations, event.Citations...)
				anchors = append(anchors, event.CitationAnchors...)
			}
			if len(citations) != tc.wantCitationCount {
				t.Fatalf("citations = %d, want %d (anchor unusable, citation still shown)", len(citations), tc.wantCitationCount)
			}
			if len(anchors) != tc.wantAnchorCount {
				t.Fatalf("anchors = %d, want %d (never guess)", len(anchors), tc.wantAnchorCount)
			}
		})
	}
}

func TestBifrostClientCompletePropagatesBifrostError(t *testing.T) {
	t.Parallel()

	// The provider's free-text message can echo request snippets (plaintext
	// user content), so it must never appear in the error we propagate.
	statusCode := 400
	errorType := "invalid_request_error"
	requester := &stubBifrostRequester{
		respErr: &schemas.BifrostError{
			StatusCode: &statusCode,
			Error: &schemas.ErrorField{
				Type:    &errorType,
				Message: "invalid token in messages[0]: 'my secret prompt'",
			},
		},
	}
	client := NewBifrostClient(requester, nil, nil, nil)

	_, err := client.Complete(context.Background(), CompleteRequest{ProviderID: "infomaniak", ProviderModelID: "model"})
	if err == nil {
		t.Fatal("Complete() error = nil, want non-nil")
	}
	if strings.Contains(err.Error(), "my secret prompt") {
		t.Fatalf("Complete() error leaks the provider message: %v", err)
	}
	if want := "bifrost request failed: status=400 type=invalid_request_error"; err.Error() != want {
		t.Fatalf("Complete() error = %q, want %q", err.Error(), want)
	}
}

func TestBifrostClientCompleteLogsStructuredErrorFields(t *testing.T) {
	t.Parallel()

	var logBuf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logBuf, nil))
	statusCode := 404
	errorType := "provider_error"
	errorCode := "not_found"
	requester := &stubBifrostRequester{
		respErr: &schemas.BifrostError{
			StatusCode: &statusCode,
			Error: &schemas.ErrorField{
				Type:    &errorType,
				Code:    &errorCode,
				Message: "provider API error: {\"error\":\"not found\"}",
			},
			ExtraFields: schemas.BifrostErrorExtraFields{
				OriginalModelRequested: "google/gemma-4-31B-it",
				ResolvedModelUsed:      "google/gemma-4-31B-it",
			},
		},
	}
	client := NewBifrostClient(requester, nil, nil, logger)

	_, err := client.Complete(context.Background(), CompleteRequest{ProviderID: "infomaniak", ProviderModelID: "google/gemma-4-31B-it"})
	if err == nil {
		t.Fatal("Complete() error = nil, want non-nil")
	}

	for _, want := range []string{
		"\"msg\":\"bifrost request failed\"",
		"\"provider\":\"infomaniak\"",
		"\"model\":\"google/gemma-4-31B-it\"",
		"\"status_code\":404",
		"\"error_type\":\"provider_error\"",
		"\"error_code\":\"not_found\"",
		"\"resolved_model_used\":\"google/gemma-4-31B-it\"",
	} {
		if !strings.Contains(logBuf.String(), want) {
			t.Fatalf("log output = %s, want substring %s", logBuf.String(), want)
		}
	}

	// The provider's free-text message (which can contain plaintext user
	// content) must never be logged.
	for _, notWant := range []string{"error_message", "provider API error", "not found"} {
		if strings.Contains(logBuf.String(), notWant) {
			t.Fatalf("log output = %s, must not contain %q", logBuf.String(), notWant)
		}
	}
}

func TestBifrostClientCompleteRejectsMissingConfig(t *testing.T) {
	t.Parallel()

	client := &BifrostClient{}
	_, err := client.Complete(context.Background(), CompleteRequest{ProviderID: "infomaniak", ProviderModelID: "model"})
	if err == nil {
		t.Fatal("Complete() error = nil, want non-nil")
	}
}

func TestBifrostClientCompleteRejectsMissingProviderOrModel(t *testing.T) {
	t.Parallel()

	client := NewBifrostClient(&stubBifrostRequester{}, nil, nil, nil)

	cases := []CompleteRequest{{ProviderModelID: "model"}, {ProviderID: "infomaniak"}}
	for _, req := range cases {
		_, err := client.Complete(context.Background(), req)
		if err == nil {
			t.Fatalf("Complete(%#v) error = nil, want non-nil", req)
		}
	}
}

func TestNewConfiguredBifrostClientRequiresAccount(t *testing.T) {
	t.Parallel()

	_, err := NewConfiguredBifrostClient(nil, "", nil)
	if err == nil {
		t.Fatal("NewConfiguredBifrostClient(nil) error = nil, want non-nil")
	}
}

func TestParseBifrostLogLevelDefaultsToError(t *testing.T) {
	t.Parallel()

	if got := parseBifrostLogLevel("unknown"); got != schemas.LogLevelError {
		t.Fatalf("parseBifrostLogLevel(unknown) = %q, want %q", got, schemas.LogLevelError)
	}
	if got := parseBifrostLogLevel("debug"); got != schemas.LogLevelDebug {
		t.Fatalf("parseBifrostLogLevel(debug) = %q, want %q", got, schemas.LogLevelDebug)
	}
}

func stringPtr(v string) *string { return &v }

func intPtr(v int) *int { return &v }

// responsesTextItem builds a completed assistant message output item carrying a
// single output_text block — the common non-streaming shape.
func responsesTextItem(text string) schemas.ResponsesMessage {
	messageType := schemas.ResponsesMessageTypeMessage
	role := schemas.ResponsesInputMessageRoleAssistant
	return schemas.ResponsesMessage{
		Type: &messageType,
		Role: &role,
		Content: &schemas.ResponsesMessageContent{
			ContentBlocks: []schemas.ResponsesMessageContentBlock{
				{Type: schemas.ResponsesOutputMessageContentTypeText, Text: &text},
			},
		},
	}
}

// respTextChunk builds an output_text.delta stream chunk.
func respTextChunk(delta string) *schemas.BifrostStreamChunk {
	return &schemas.BifrostStreamChunk{
		BifrostResponsesStreamResponse: &schemas.BifrostResponsesStreamResponse{
			Type:  schemas.ResponsesStreamResponseTypeOutputTextDelta,
			Delta: &delta,
		},
	}
}

// respReasoningChunk builds a reasoning_summary_text.delta stream chunk.
func respReasoningChunk(delta string) *schemas.BifrostStreamChunk {
	return &schemas.BifrostStreamChunk{
		BifrostResponsesStreamResponse: &schemas.BifrostResponsesStreamResponse{
			Type:  schemas.ResponsesStreamResponseTypeReasoningSummaryTextDelta,
			Delta: &delta,
		},
	}
}

// respAnnotationChunk mirrors the real Requesty quirk: the event's type is
// output_text.delta while it carries a url_citation annotation with UTF-8 byte
// offsets.
func respAnnotationChunk(url, title string, startByte, endByte int) *schemas.BifrostStreamChunk {
	return &schemas.BifrostStreamChunk{
		BifrostResponsesStreamResponse: &schemas.BifrostResponsesStreamResponse{
			Type: schemas.ResponsesStreamResponseTypeOutputTextDelta,
			Annotation: &schemas.ResponsesOutputMessageContentTextAnnotation{
				Type:       "url_citation",
				URL:        &url,
				Title:      &title,
				StartIndex: &startByte,
				EndIndex:   &endByte,
			},
		},
	}
}

// respSearchItemAddedChunk builds an output_item.added for a web_search_call
// item (drives SearchCount).
func respSearchItemAddedChunk() *schemas.BifrostStreamChunk {
	wsType := schemas.ResponsesMessageTypeWebSearchCall
	return &schemas.BifrostStreamChunk{
		BifrostResponsesStreamResponse: &schemas.BifrostResponsesStreamResponse{
			Type: schemas.ResponsesStreamResponseTypeOutputItemAdded,
			Item: &schemas.ResponsesMessage{Type: &wsType},
		},
	}
}

// respSearchActivityChunk builds a web_search_call activity event.
func respSearchActivityChunk(t schemas.ResponsesStreamResponseType) *schemas.BifrostStreamChunk {
	return &schemas.BifrostStreamChunk{
		BifrostResponsesStreamResponse: &schemas.BifrostResponsesStreamResponse{Type: t},
	}
}

// respSearchSourcesChunk builds an output_item.done for a web_search_call item
// carrying title-less proxy action sources.
func respSearchSourcesChunk(urls ...string) *schemas.BifrostStreamChunk {
	wsType := schemas.ResponsesMessageTypeWebSearchCall
	sources := make([]schemas.ResponsesWebSearchToolCallActionSearchSource, 0, len(urls))
	for _, u := range urls {
		sources = append(sources, schemas.ResponsesWebSearchToolCallActionSearchSource{Type: "url", URL: u})
	}
	return &schemas.BifrostStreamChunk{
		BifrostResponsesStreamResponse: &schemas.BifrostResponsesStreamResponse{
			Type: schemas.ResponsesStreamResponseTypeOutputItemDone,
			Item: &schemas.ResponsesMessage{
				Type: &wsType,
				ResponsesToolMessage: &schemas.ResponsesToolMessage{
					Action: &schemas.ResponsesToolMessageActionStruct{
						ResponsesWebSearchToolCallAction: &schemas.ResponsesWebSearchToolCallAction{Sources: sources},
					},
				},
			},
		},
	}
}

// respCompletedChunk builds the terminal response.completed event carrying usage.
func respCompletedChunk(usage *schemas.ResponsesResponseUsage) *schemas.BifrostStreamChunk {
	return &schemas.BifrostStreamChunk{
		BifrostResponsesStreamResponse: &schemas.BifrostResponsesStreamResponse{
			Type:     schemas.ResponsesStreamResponseTypeCompleted,
			Response: &schemas.BifrostResponsesResponse{Usage: usage},
		},
	}
}
