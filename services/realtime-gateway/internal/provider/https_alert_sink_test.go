package provider

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type routingAlertRoundTripperFunc func(*http.Request) (*http.Response, error)

func (f routingAlertRoundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func validWebhookConfig() HTTPSRoutingAlertSinkConfig {
	return HTTPSRoutingAlertSinkConfig{
		Endpoint:     "https://alerts.example.com/v1/routing",
		AllowedHosts: []string{"alerts.example.com"},
		Secret:       []byte("0123456789abcdef0123456789abcdef"),
		Timeout:      2 * time.Second,
	}
}

func successResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func TestHTTPSRoutingAlertSinkDeliversSignedBoundedEnvelope(t *testing.T) {
	config := validWebhookConfig()
	originalSecret := append([]byte(nil), config.Secret...)
	var captured *http.Request
	var capturedBody []byte
	transport := routingAlertRoundTripperFunc(func(request *http.Request) (*http.Response, error) {
		captured = request.Clone(request.Context())
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("read request body: %v", err)
		}
		capturedBody = body
		return successResponse(http.StatusNoContent, "ok"), nil
	})

	sink, err := NewHTTPSRoutingAlertSink(config, transport)
	if err != nil {
		t.Fatalf("construct sink: %v", err)
	}
	for index := range config.Secret {
		config.Secret[index] = 0
	}
	sink.now = func() time.Time { return time.Unix(1_700_000_000, 0) }

	alerts := []RoutingOperationalAlertExport{
		{
			Code:       "provider.health_degraded",
			Severity:   RoutingAlertWarning,
			ProviderID: "provider-a",
			Observed:   "1",
		},
	}
	if err := sink.DeliverRoutingAlerts(context.Background(), alerts); err != nil {
		t.Fatalf("deliver alerts: %v", err)
	}

	if captured == nil {
		t.Fatal("expected one HTTP request")
	}
	if captured.Method != http.MethodPost {
		t.Fatalf("unexpected method: %s", captured.Method)
	}
	if captured.URL.String() != "https://alerts.example.com/v1/routing" {
		t.Fatalf("unexpected URL: %s", captured.URL.String())
	}
	if captured.Header.Get("Content-Type") != "application/json" ||
		captured.Header.Get("Accept") != "application/json" {
		t.Fatalf("unexpected content negotiation headers: %#v", captured.Header)
	}
	if captured.Header.Get("Authorization") != "" {
		t.Fatal("webhook sink must not synthesize an Authorization header")
	}
	if captured.Header.Get("X-VSN-Timestamp") != "1700000000" {
		t.Fatalf("unexpected timestamp: %q", captured.Header.Get("X-VSN-Timestamp"))
	}

	mac := hmac.New(sha256.New, originalSecret)
	_, _ = mac.Write([]byte("1700000000."))
	_, _ = mac.Write(capturedBody)
	wantSignature := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	if captured.Header.Get("X-VSN-Signature") != wantSignature {
		t.Fatalf("signature mismatch: got %q want %q", captured.Header.Get("X-VSN-Signature"), wantSignature)
	}

	var envelope struct {
		SchemaVersion uint32                          `json:"schema_version"`
		Alerts        []RoutingOperationalAlertExport `json:"alerts"`
	}
	if err := json.Unmarshal(capturedBody, &envelope); err != nil {
		t.Fatalf("decode webhook envelope: %v", err)
	}
	if envelope.SchemaVersion != RoutingAlertWebhookSchemaVersion {
		t.Fatalf("unexpected schema version: %d", envelope.SchemaVersion)
	}
	if len(envelope.Alerts) != 1 || envelope.Alerts[0].Code != alerts[0].Code {
		t.Fatalf("unexpected alert envelope: %#v", envelope.Alerts)
	}
}

func TestHTTPSRoutingAlertSinkRejectsUnsafeEndpointConfiguration(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*HTTPSRoutingAlertSinkConfig)
	}{
		{name: "http", mutate: func(config *HTTPSRoutingAlertSinkConfig) { config.Endpoint = "http://alerts.example.com/hook" }},
		{name: "userinfo", mutate: func(config *HTTPSRoutingAlertSinkConfig) { config.Endpoint = "https://user:pass@alerts.example.com/hook" }},
		{name: "query", mutate: func(config *HTTPSRoutingAlertSinkConfig) { config.Endpoint = "https://alerts.example.com/hook?token=secret" }},
		{name: "fragment", mutate: func(config *HTTPSRoutingAlertSinkConfig) { config.Endpoint = "https://alerts.example.com/hook#fragment" }},
		{name: "localhost", mutate: func(config *HTTPSRoutingAlertSinkConfig) { config.Endpoint = "https://localhost/hook"; config.AllowedHosts = []string{"localhost"} }},
		{name: "ip_literal", mutate: func(config *HTTPSRoutingAlertSinkConfig) { config.Endpoint = "https://127.0.0.1/hook"; config.AllowedHosts = []string{"127.0.0.1"} }},
		{name: "not_allowlisted", mutate: func(config *HTTPSRoutingAlertSinkConfig) { config.Endpoint = "https://other.example.com/hook" }},
		{name: "weak_secret", mutate: func(config *HTTPSRoutingAlertSinkConfig) { config.Secret = []byte("too-short") }},
		{name: "excessive_timeout", mutate: func(config *HTTPSRoutingAlertSinkConfig) { config.Timeout = 16 * time.Second }},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			config := validWebhookConfig()
			testCase.mutate(&config)
			_, err := NewHTTPSRoutingAlertSink(config, nil)
			if !errors.Is(err, ErrInvalidRoutingAlertWebhookConfig) {
				t.Fatalf("expected invalid config error, got %v", err)
			}
		})
	}
}

func TestHTTPSRoutingAlertSinkReturnsStableErrorsWithoutResponseOrTransportContent(t *testing.T) {
	transportFailure := routingAlertRoundTripperFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("dial failed with credential=must-not-propagate")
	})
	failedSink, err := NewHTTPSRoutingAlertSink(validWebhookConfig(), transportFailure)
	if err != nil {
		t.Fatalf("construct failed sink: %v", err)
	}
	if got := failedSink.DeliverRoutingAlerts(context.Background(), nil); !errors.Is(got, ErrRoutingAlertWebhookDeliveryFailed) || got.Error() != ErrRoutingAlertWebhookDeliveryFailed.Error() {
		t.Fatalf("transport error leaked or changed: %v", got)
	}

	rejectedTransport := routingAlertRoundTripperFunc(func(*http.Request) (*http.Response, error) {
		return successResponse(http.StatusInternalServerError, "credential=must-not-propagate"), nil
	})
	rejectedSink, err := NewHTTPSRoutingAlertSink(validWebhookConfig(), rejectedTransport)
	if err != nil {
		t.Fatalf("construct rejected sink: %v", err)
	}
	if got := rejectedSink.DeliverRoutingAlerts(context.Background(), nil); !errors.Is(got, ErrRoutingAlertWebhookRejected) || got.Error() != ErrRoutingAlertWebhookRejected.Error() {
		t.Fatalf("response body/status detail leaked or changed: %v", got)
	}
}

func TestHTTPSRoutingAlertSinkDoesNotFollowRedirects(t *testing.T) {
	calls := 0
	transport := routingAlertRoundTripperFunc(func(*http.Request) (*http.Response, error) {
		calls++
		response := successResponse(http.StatusFound, "redirect")
		response.Header.Set("Location", "https://other.example.com/collect")
		return response, nil
	})
	sink, err := NewHTTPSRoutingAlertSink(validWebhookConfig(), transport)
	if err != nil {
		t.Fatalf("construct sink: %v", err)
	}

	if got := sink.DeliverRoutingAlerts(context.Background(), nil); !errors.Is(got, ErrRoutingAlertWebhookRejected) {
		t.Fatalf("redirect should be rejected, got %v", got)
	}
	if calls != 1 {
		t.Fatalf("redirect must not trigger a second request, calls=%d", calls)
	}
}

func TestHTTPSRoutingAlertSinkEnforcesContextAndPayloadBounds(t *testing.T) {
	calls := 0
	transport := routingAlertRoundTripperFunc(func(*http.Request) (*http.Response, error) {
		calls++
		return successResponse(http.StatusNoContent, ""), nil
	})
	sink, err := NewHTTPSRoutingAlertSink(validWebhookConfig(), transport)
	if err != nil {
		t.Fatalf("construct sink: %v", err)
	}

	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if got := sink.DeliverRoutingAlerts(cancelled, nil); !errors.Is(got, ErrRoutingAlertWebhookDeliveryFailed) {
		t.Fatalf("cancelled context should fail closed, got %v", got)
	}
	if got := sink.DeliverRoutingAlerts(nil, nil); !errors.Is(got, ErrRoutingAlertWebhookDeliveryFailed) {
		t.Fatalf("nil context should fail closed, got %v", got)
	}

	tooMany := make([]RoutingOperationalAlertExport, MaxRoutingAlertsPerDispatch+1)
	if got := sink.DeliverRoutingAlerts(context.Background(), tooMany); !errors.Is(got, ErrRoutingAlertWebhookPayloadTooLarge) {
		t.Fatalf("alert-count bound should reject, got %v", got)
	}

	oversized := []RoutingOperationalAlertExport{{
		Code:     strings.Repeat("x", MaxRoutingAlertWebhookPayloadBytes),
		Severity: RoutingAlertWarning,
		Observed: "1",
	}}
	if got := sink.DeliverRoutingAlerts(context.Background(), oversized); !errors.Is(got, ErrRoutingAlertWebhookPayloadTooLarge) {
		t.Fatalf("byte-size bound should reject, got %v", got)
	}
	if calls != 0 {
		t.Fatalf("rejected deliveries must not reach transport, calls=%d", calls)
	}
}
