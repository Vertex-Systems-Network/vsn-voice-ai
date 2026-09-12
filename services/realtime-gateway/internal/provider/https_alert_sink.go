package provider

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	RoutingAlertWebhookSchemaVersion                    uint32        = 1
	MaxRoutingAlertWebhookPayloadBytes                                = 64 * 1024
	MinRoutingAlertWebhookSecretBytes                                 = 32
	defaultRoutingAlertWebhookTimeout                   time.Duration = 5 * time.Second
	maxRoutingAlertWebhookTimeout                       time.Duration = 15 * time.Second
)

var (
	ErrInvalidRoutingAlertWebhookConfig   = errors.New("invalid routing alert webhook configuration")
	ErrRoutingAlertWebhookPayloadTooLarge = errors.New("routing alert webhook payload too large")
	ErrRoutingAlertWebhookDeliveryFailed  = errors.New("routing alert webhook delivery failed")
	ErrRoutingAlertWebhookRejected        = errors.New("routing alert webhook rejected")
)

type HTTPSRoutingAlertSinkConfig struct {
	Endpoint     string
	AllowedHosts []string
	Secret       []byte
	Timeout      time.Duration
}

type routingAlertWebhookEnvelope struct {
	SchemaVersion uint32                          `json:"schema_version"`
	Alerts        []RoutingOperationalAlertExport `json:"alerts"`
}

// HTTPSRoutingAlertSink is a concrete provider-neutral delivery adapter for
// content-safe operational alerts. The target is fixed at construction, must
// use HTTPS and an explicitly allowlisted hostname, and cannot embed URL
// credentials, query parameters, or fragments.
type HTTPSRoutingAlertSink struct {
	endpoint *url.URL
	secret   []byte
	timeout  time.Duration
	client   *http.Client
	now      func() time.Time
}

func NewHTTPSRoutingAlertSink(
	config HTTPSRoutingAlertSinkConfig,
	transport http.RoundTripper,
) (*HTTPSRoutingAlertSink, error) {
	endpoint, err := validateRoutingAlertWebhookEndpoint(config.Endpoint, config.AllowedHosts)
	if err != nil {
		return nil, err
	}
	if len(config.Secret) < MinRoutingAlertWebhookSecretBytes {
		return nil, ErrInvalidRoutingAlertWebhookConfig
	}

	timeout := config.Timeout
	if timeout == 0 {
		timeout = defaultRoutingAlertWebhookTimeout
	}
	if timeout <= 0 || timeout > maxRoutingAlertWebhookTimeout {
		return nil, ErrInvalidRoutingAlertWebhookConfig
	}
	if transport == nil {
		transport = http.DefaultTransport
	}

	client := &http.Client{
		Transport: transport,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	return &HTTPSRoutingAlertSink{
		endpoint: endpoint,
		secret:   append([]byte(nil), config.Secret...),
		timeout:  timeout,
		client:   client,
		now:      time.Now,
	}, nil
}

func (s *HTTPSRoutingAlertSink) DeliverRoutingAlerts(
	ctx context.Context,
	alerts []RoutingOperationalAlertExport,
) error {
	if s == nil || ctx == nil || s.endpoint == nil || s.client == nil || s.now == nil {
		return ErrRoutingAlertWebhookDeliveryFailed
	}
	if len(alerts) > MaxRoutingAlertsPerDispatch {
		return ErrRoutingAlertWebhookPayloadTooLarge
	}
	if err := ctx.Err(); err != nil {
		return ErrRoutingAlertWebhookDeliveryFailed
	}

	envelope := routingAlertWebhookEnvelope{
		SchemaVersion: RoutingAlertWebhookSchemaVersion,
		Alerts:        append([]RoutingOperationalAlertExport(nil), alerts...),
	}
	body, err := json.Marshal(envelope)
	if err != nil {
		return ErrRoutingAlertWebhookDeliveryFailed
	}
	if len(body) > MaxRoutingAlertWebhookPayloadBytes {
		return ErrRoutingAlertWebhookPayloadTooLarge
	}

	timestamp := strconv.FormatInt(s.now().UTC().Unix(), 10)
	signature := signRoutingAlertWebhookPayload(s.secret, timestamp, body)

	requestContext, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(
		requestContext,
		http.MethodPost,
		s.endpoint.String(),
		bytes.NewReader(body),
	)
	if err != nil {
		return ErrRoutingAlertWebhookDeliveryFailed
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-VSN-Timestamp", timestamp)
	request.Header.Set("X-VSN-Signature", "sha256="+signature)
	request.Header.Set("User-Agent", "vsn-realtime-gateway/1")

	response, err := s.client.Do(request)
	if err != nil {
		return ErrRoutingAlertWebhookDeliveryFailed
	}
	defer response.Body.Close()
	_, _ = io.CopyN(io.Discard, response.Body, 4096)

	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return ErrRoutingAlertWebhookRejected
	}
	return nil
}

func signRoutingAlertWebhookPayload(secret []byte, timestamp string, body []byte) string {
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(timestamp))
	_, _ = mac.Write([]byte("."))
	_, _ = mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

func validateRoutingAlertWebhookEndpoint(
	rawEndpoint string,
	allowedHosts []string,
) (*url.URL, error) {
	endpoint, err := url.Parse(strings.TrimSpace(rawEndpoint))
	if err != nil || endpoint.Scheme != "https" || endpoint.Host == "" {
		return nil, ErrInvalidRoutingAlertWebhookConfig
	}
	if endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" {
		return nil, ErrInvalidRoutingAlertWebhookConfig
	}

	hostname := strings.ToLower(endpoint.Hostname())
	if hostname == "" || hostname == "localhost" || strings.HasSuffix(hostname, ".localhost") {
		return nil, ErrInvalidRoutingAlertWebhookConfig
	}
	if net.ParseIP(hostname) != nil {
		return nil, ErrInvalidRoutingAlertWebhookConfig
	}

	allowed := false
	for _, candidate := range allowedHosts {
		normalized := strings.ToLower(strings.TrimSpace(candidate))
		if normalized == "" || strings.ContainsAny(normalized, "/:@?#") {
			continue
		}
		if normalized == hostname {
			allowed = true
			break
		}
	}
	if !allowed {
		return nil, ErrInvalidRoutingAlertWebhookConfig
	}

	return endpoint, nil
}
