package types

import (
	"net/http"
	"testing"
)

func TestOpenAIErrorIsUpstreamError(t *testing.T) {
	cases := []struct {
		name string
		err  *OpenAIError
		want bool
	}{
		{"nil", nil, false},
		{"empty", &OpenAIError{}, false},
		{"zero code only", &OpenAIError{Code: 0}, false},
		{"type only", &OpenAIError{Type: "rate_limit_error"}, true},
		// 上游只返回 message/code 而不带 type 时同样必须识别为错误，
		// 否则响应会被当成正常结果计费。
		{"message only", &OpenAIError{Message: "Upstream rate limit"}, true},
		{"string code only", &OpenAIError{Code: "rate_limit_exceeded"}, true},
		{"numeric code only", &OpenAIError{Code: 429}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.err.IsUpstreamError(); got != tc.want {
				t.Fatalf("IsUpstreamError() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestOpenAIErrorHTTPStatusCode(t *testing.T) {
	cases := []struct {
		name string
		err  *OpenAIError
		want int
	}{
		{"nil keeps fallback", nil, http.StatusOK},
		{"unknown keeps fallback", &OpenAIError{Message: "bad gateway"}, http.StatusOK},
		{"numeric code wins", &OpenAIError{Code: 429, Message: "Upstream rate limit"}, http.StatusTooManyRequests},
		{"string numeric code wins", &OpenAIError{Code: "503"}, http.StatusServiceUnavailable},
		{"success-range code ignored", &OpenAIError{Code: 200, Message: "ok-ish"}, http.StatusOK},
		{"rate limit by message", &OpenAIError{Message: "Upstream rate limit"}, http.StatusTooManyRequests},
		{"rate limit by code", &OpenAIError{Code: "rate_limit_exceeded"}, http.StatusTooManyRequests},
		{"rate limit by type", &OpenAIError{Type: "rate_limit_error"}, http.StatusTooManyRequests},
		{"rate limit in chinese", &OpenAIError{Message: "当前分组上游负载已饱和，请稍后再试"}, http.StatusTooManyRequests},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.err.HTTPStatusCode(http.StatusOK); got != tc.want {
				t.Fatalf("HTTPStatusCode() = %d, want %d", got, tc.want)
			}
		})
	}
}

func TestClaudeErrorUpstreamHelpers(t *testing.T) {
	var nilErr *ClaudeError
	if nilErr.IsUpstreamError() {
		t.Fatal("nil ClaudeError should not be an upstream error")
	}
	if (&ClaudeError{}).IsUpstreamError() {
		t.Fatal("empty ClaudeError should not be an upstream error")
	}
	if !(&ClaudeError{Message: "Upstream rate limit"}).IsUpstreamError() {
		t.Fatal("ClaudeError with message only should be an upstream error")
	}

	if got := (&ClaudeError{Message: "Upstream rate limit"}).HTTPStatusCode(http.StatusInternalServerError); got != http.StatusTooManyRequests {
		t.Fatalf("HTTPStatusCode() = %d, want %d", got, http.StatusTooManyRequests)
	}
	if got := (&ClaudeError{Type: "overloaded_error"}).HTTPStatusCode(http.StatusInternalServerError); got != http.StatusInternalServerError {
		t.Fatalf("HTTPStatusCode() = %d, want %d", got, http.StatusInternalServerError)
	}
}
