package main

import (
	"net/http"
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/buildinfo"
	"github.com/pocketbase/pocketbase/tests"
)

func TestHealthExposesCommit(t *testing.T) {
	prev := buildinfo.Commit
	t.Cleanup(func() { buildinfo.Commit = prev })
	buildinfo.Commit = "test-commit-sha-health"

	scenario := tests.ApiScenario{
		Name:           "GET /health returns commit in JSON and header",
		Method:         http.MethodGet,
		URL:            "/health",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"is_database_connected":true`,
			`"commit":"test-commit-sha-health"`,
		},
		TestAppFactory: setupTestApp,
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			t.Helper()

			gotHeader := res.Header.Get(buildinfo.CommitHeader)
			if gotHeader != "test-commit-sha-health" {
				t.Errorf(
					"Header %s = %q, want %q",
					buildinfo.CommitHeader,
					gotHeader,
					"test-commit-sha-health",
				)
			}

			expose := res.Header.Get("Access-Control-Expose-Headers")
			if !headerListContains(expose, buildinfo.CommitHeader) {
				t.Errorf(
					"Access-Control-Expose-Headers = %q, want it to include %q",
					expose,
					buildinfo.CommitHeader,
				)
			}
		},
	}
	scenario.Test(t)
}
