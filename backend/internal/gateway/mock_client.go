package gateway

import "context"

type MockClient struct {
	CompleteFunc       func(context.Context, CompleteRequest) (CompleteResponse, error)
	CompleteStreamFunc func(context.Context, CompleteRequest) (<-chan CompleteStreamEvent, error)
	Requests           []CompleteRequest
}

func (m *MockClient) Complete(ctx context.Context, req CompleteRequest) (CompleteResponse, error) {
	m.Requests = append(m.Requests, cloneRequest(req))

	if m.CompleteFunc != nil {
		return m.CompleteFunc(ctx, req)
	}

	return CompleteResponse{}, nil
}

func (m *MockClient) CompleteStream(ctx context.Context, req CompleteRequest) (<-chan CompleteStreamEvent, error) {
	m.Requests = append(m.Requests, cloneRequest(req))

	if m.CompleteStreamFunc != nil {
		return m.CompleteStreamFunc(ctx, req)
	}

	if m.CompleteFunc != nil {
		resp, err := m.CompleteFunc(ctx, req)
		if err != nil {
			return nil, err
		}

		ch := make(chan CompleteStreamEvent, 2)
		if resp.Message.Content != "" {
			ch <- CompleteStreamEvent{Delta: resp.Message.Content}
		}
		ch <- CompleteStreamEvent{Usage: &resp.Usage}
		close(ch)
		return ch, nil
	}

	ch := make(chan CompleteStreamEvent)
	close(ch)
	return ch, nil
}

func cloneRequest(req CompleteRequest) CompleteRequest {
	cloned := req
	if req.Messages == nil {
		return cloned
	}

	cloned.Messages = append([]Message(nil), req.Messages...)
	return cloned
}
