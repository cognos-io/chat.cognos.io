package gateway

import "context"

type MockClient struct {
	CompleteFunc func(context.Context, CompleteRequest) (CompleteResponse, error)
	Requests     []CompleteRequest
}

func (m *MockClient) Complete(ctx context.Context, req CompleteRequest) (CompleteResponse, error) {
	m.Requests = append(m.Requests, cloneRequest(req))

	if m.CompleteFunc != nil {
		return m.CompleteFunc(ctx, req)
	}

	return CompleteResponse{}, nil
}

func cloneRequest(req CompleteRequest) CompleteRequest {
	cloned := req
	if req.Messages == nil {
		return cloned
	}

	cloned.Messages = append([]Message(nil), req.Messages...)
	return cloned
}
