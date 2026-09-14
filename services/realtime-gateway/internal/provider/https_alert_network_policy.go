package provider

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

var errRoutingAlertWebhookUnsafeNetwork = errors.New("routing alert webhook network target is not public")

var routingAlertNonPublicPrefixes = []netip.Prefix{
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("fec0::/10"),
}

type routingAlertResolver interface {
	LookupNetIP(context.Context, string, string) ([]netip.Addr, error)
}

type routingAlertDialContext func(context.Context, string, string) (net.Conn, error)

func normalizeRoutingAlertHostname(value string) string {
	return strings.TrimSuffix(strings.ToLower(strings.TrimSpace(value)), ".")
}

func isPublicRoutingAlertAddress(address netip.Addr) bool {
	address = address.Unmap()
	if !address.IsValid() ||
		!address.IsGlobalUnicast() ||
		address.IsPrivate() ||
		address.IsLoopback() ||
		address.IsLinkLocalUnicast() ||
		address.IsMulticast() ||
		address.IsUnspecified() {
		return false
	}
	for _, prefix := range routingAlertNonPublicPrefixes {
		if prefix.Contains(address) {
			return false
		}
	}
	return true
}

func newRoutingAlertWebhookTransport(expectedHostname string) http.RoundTripper {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	// Environment proxies are deliberately disabled for this narrowly scoped
	// outbound sink so an ambient proxy cannot widen the approved egress path.
	transport.Proxy = nil
	transport.DialContext = newRoutingAlertPublicOnlyDialContext(
		expectedHostname,
		net.DefaultResolver,
		(&net.Dialer{}).DialContext,
	)
	return transport
}

func newRoutingAlertPublicOnlyDialContext(
	expectedHostname string,
	resolver routingAlertResolver,
	dial routingAlertDialContext,
) routingAlertDialContext {
	expectedHostname = normalizeRoutingAlertHostname(expectedHostname)
	return func(ctx context.Context, network string, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil || normalizeRoutingAlertHostname(host) != expectedHostname {
			return nil, errRoutingAlertWebhookUnsafeNetwork
		}
		if resolver == nil || dial == nil {
			return nil, errRoutingAlertWebhookUnsafeNetwork
		}

		resolved, err := resolver.LookupNetIP(ctx, "ip", expectedHostname)
		if err != nil || len(resolved) == 0 {
			return nil, errRoutingAlertWebhookUnsafeNetwork
		}

		public := make([]netip.Addr, 0, len(resolved))
		for _, candidate := range resolved {
			candidate = candidate.Unmap()
			// Fail closed when a hostname has a mixed public/private answer set.
			// This prevents DNS rebinding and resolver-order tricks from reaching
			// loopback, metadata, RFC1918/ULA, link-local, CGNAT or test networks.
			if !isPublicRoutingAlertAddress(candidate) {
				return nil, errRoutingAlertWebhookUnsafeNetwork
			}
			public = append(public, candidate)
		}

		var lastErr error
		for _, candidate := range public {
			connection, dialErr := dial(
				ctx,
				network,
				net.JoinHostPort(candidate.String(), port),
			)
			if dialErr == nil {
				return connection, nil
			}
			lastErr = dialErr
		}
		if lastErr != nil {
			return nil, lastErr
		}
		return nil, errRoutingAlertWebhookUnsafeNetwork
	}
}
