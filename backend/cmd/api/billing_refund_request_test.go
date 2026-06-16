package main

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
)

func TestBillingRefundRequestRequiresAuth(t *testing.T) {
	t.Parallel()
	scenario := tests.ApiScenario{
		Name:            "refund-request requires auth",
		Method:          http.MethodPost,
		URL:             "/api/v1/billing/refund-request",
		Body:            strings.NewReader(`{"reason_text":"changed my mind"}`),
		ExpectedStatus:  http.StatusUnauthorized,
		ExpectedContent: []string{"requires valid record authorization"},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupBillingApp(t, &fakePaddleClient{})
		},
	}
	scenario.Test(t)
}

func TestBillingRefundRequestAccepted(t *testing.T) {
	t.Parallel()
	scenario := tests.ApiScenario{
		Name:            "refund-request is accepted (stub)",
		Method:          http.MethodPost,
		URL:             "/api/v1/billing/refund-request",
		Body:            strings.NewReader(`{"reason_text":"too expensive"}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"status":"received"`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupBillingApp(t, &fakePaddleClient{})
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}
	scenario.Test(t)
}
