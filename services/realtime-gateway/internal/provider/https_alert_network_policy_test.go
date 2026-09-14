package provider

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"testing"
)

type routingAlertResolverFunc func(context.Context, string, string) ([]netip.Addr, error)

func (f routingAlertResolverFunc) LookupNetIP(
	ctx context.Context,
	network string,
	host string,
) ([]netip.Addr, error) {
	return f(ctx, network, host)
}

func TestRoutingAlertHostnameNormalizationClosesLocalhostTrailingDotBypass(t *testing.T) {
	if got := normalizeRoutingAlertHostname(" LOCALHOST. "); got != "localhost" {
		t.Fatalf("unexpected normalized hostname: %q", got)
	}

	config := validWebhookConfig()
	config.Endpoint = "https://localhost./hook"
	config.AllowedHosts = []string{"localhost."}
	if _, err := NewHTTPSRoutingAlertSink(config); !errors.Is(err, ErrInvalidRoutingAlertWebhookConfig) {
		t.Fatalf("trailing-dot localhost must be rejected, got %v", err)
	}

	config = validWebhookConfig()
	config.Endpoint = "https://service.localhost./hook"
	config.AllowedHosts = []string{"service.localhost."}
	if _, err := NewHTTPSRoutingAlertSink(config); !errors.Is(err, ErrInvalidRoutingAlertWebhookConfig) {
		t.Fatalf("trailing-dot localhost subdomain must be rejected, got %v", err)
	}
}

func TestPublicRoutingAlertAddressPolicyRejectsNonPublicRanges(t *testing.T) {
	rejected := []string{
		"127.0.0.1",
		"10.0.0.1",
		"172.16.0.1",
		"192.168.0.1",
		"169.254.169.254",
		"100.64.0.1",
		"198.18.0.1",
		"192.0.2.1",
		"224.0.0.1",
		"240.0.0.1",
		"::1",
		"fe80::1",
		"fc00::1",
		"fec0::1",
		"2001:db8::1",
	}
	for _, value := range rejected {
		t.Run(value, func(t *testing.T) {
			if isPublicRoutingAlertAddress(netip.MustParseAddr(value)) {
				t.Fatalf("non-public address %s must be rejected", value)
			}
		})
	}

	for _, value := range []string{"8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"} {
		t.Run("public_"+value, func(t *testing.T) {
			if !isPublicRoutingAlertAddress(netip.MustParseAddr(value)) {
				t.Fatalf("public address %s should be accepted", value)
			}
		})
	}
}

func TestRoutingAlertDialRejectsMixedPublicPrivateDNSAnswers(t *testing.T) {
	resolver := routingAlertResolverFunc(func(
		context.Context,
		string,
		string,
	) ([]netip.Addr, error) {
		return []netip.Addr{
			netip.MustParseAddr("93.184.216.34"),
			netip.MustParseAddr("169.254.169.254"),
		}, nil
	})
	dialCalled := false
	dial := func(context.Context, string, string) (net.Conn, error) {
		dialCalled = true
		return nil, errors.New("unexpected dial")
	}

	guardedDial := newRoutingAlertPublicOnlyDialContext("alerts.example.com", resolver, dial)
	_, err := guardedDial(context.Background(), "tcp", "alerts.example.com:443")
	if !errors.Is(err, errRoutingAlertWebhookUnsafeNetwork) {
		t.Fatalf("mixed DNS answer must fail closed, got %v", err)
	}
	if dialCalled {
		t.Fatal("unsafe DNS answer must be rejected before any network dial")
	}
}

func TestRoutingAlertDialPinsConnectionToValidatedResolvedAddress(t *testing.T) {
	resolver := routingAlertResolverFunc(func(
		context.Context,
		string,
		string,
	) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
	})
	var dialedAddress string
	dialFailure := errors.New("test dial stop")
	dial := func(_ context.Context, _ string, address string) (net.Conn, error) {
		dialedAddress = address
		return nil, dialFailure
	}

	guardedDial := newRoutingAlertPublicOnlyDialContext("alerts.example.com", resolver, dial)
	_, err := guardedDial(context.Background(), "tcp", "alerts.example.com:443")
	if !errors.Is(err, dialFailure) {
		t.Fatalf("expected injected dial result, got %v", err)
	}
	if dialedAddress != "93.184.216.34:443" {
		t.Fatalf("dial must be pinned to validated resolved IP, got %q", dialedAddress)
	}

	_, err = guardedDial(context.Background(), "tcp", "other.example.com:443")
	if !errors.Is(err, errRoutingAlertWebhookUnsafeNetwork) {
		t.Fatalf("unexpected transport host must be rejected, got %v", err)
	}
}
