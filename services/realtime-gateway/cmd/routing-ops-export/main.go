package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"regexp"

	"github.com/Vertex-Systems-Network/vsn-voice-ai/services/realtime-gateway/internal/provider"
)

const (
	inputSchemaVersion uint32 = 1
	maxInputBytes             = 1 << 20
)

var (
	errInvalidInput   = errors.New("invalid routing operations input")
	errInputTooLarge  = errors.New("routing operations input exceeds limit")
	providerIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)
)

type auditedExportInput struct {
	SchemaVersion       uint32                                `json:"schema_version"`
	Metrics             provider.RoutingMetricsSnapshot       `json:"metrics"`
	ReportedCostControl provider.RoutingCostControlSummary    `json:"reported_cost_control"`
	Thresholds          provider.RoutingOperationalThresholds `json:"thresholds"`
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		_, _ = io.WriteString(os.Stderr, "routing ops export failed\n")
		os.Exit(1)
	}
}

func run(input io.Reader, output io.Writer) error {
	request, err := decodeInput(input)
	if err != nil {
		return err
	}
	if err := validateInput(request); err != nil {
		return err
	}

	snapshot := provider.BuildRoutingAuditedOperationalSnapshot(
		request.Metrics,
		request.ReportedCostControl,
		request.Thresholds,
	)
	exported := provider.ExportRoutingAuditedOperationalSnapshot(snapshot)

	encoder := json.NewEncoder(output)
	encoder.SetEscapeHTML(true)
	if err := encoder.Encode(exported); err != nil {
		return errors.New("routing ops export encoding failed")
	}
	return nil
}

func decodeInput(input io.Reader) (auditedExportInput, error) {
	limited := io.LimitReader(input, maxInputBytes+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return auditedExportInput{}, errInvalidInput
	}
	if len(data) > maxInputBytes {
		return auditedExportInput{}, errInputTooLarge
	}

	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var request auditedExportInput
	if err := decoder.Decode(&request); err != nil {
		return auditedExportInput{}, errInvalidInput
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return auditedExportInput{}, errInvalidInput
	}
	return request, nil
}

func validateInput(request auditedExportInput) error {
	if request.SchemaVersion != inputSchemaVersion {
		return errInvalidInput
	}
	if request.Thresholds.MaxLatencyP95Milliseconds < 0 ||
		request.Thresholds.MaxCostMicrounitsPerMinute < 0 ||
		request.Thresholds.MaxNoEligibleBasisPoints > 10_000 {
		return errInvalidInput
	}
	if err := validateMetrics(request.Metrics); err != nil {
		return err
	}
	return validateReportedSummary(request.ReportedCostControl)
}

func validateMetrics(snapshot provider.RoutingMetricsSnapshot) error {
	for providerID, metrics := range snapshot.ByProvider {
		if !validProviderID(providerID) || !validProviderID(metrics.ProviderID) {
			return errInvalidInput
		}
		if metrics.LatencyP95Milliseconds < 0 || metrics.CostMicrounitsPerMinute < 0 {
			return errInvalidInput
		}
		if !validHealth(metrics.Health) || !validRateLimit(metrics.RateLimit) {
			return errInvalidInput
		}
	}
	return nil
}

func validateReportedSummary(summary provider.RoutingCostControlSummary) error {
	if summary.NoEligibleBasisPoints > 10_000 || summary.AverageSelectedCostMicrounitsPerMinute < 0 {
		return errInvalidInput
	}
	seen := make(map[string]struct{}, len(summary.ByProvider))
	for _, item := range summary.ByProvider {
		if !validProviderID(item.ProviderID) {
			return errInvalidInput
		}
		if _, exists := seen[item.ProviderID]; exists {
			return errInvalidInput
		}
		seen[item.ProviderID] = struct{}{}
		if item.SelectionShareBasisPoints > 10_000 ||
			item.CostMicrounitsPerMinute < 0 ||
			item.WeightedCostContributionMicrounits < 0 ||
			item.LatencyP95Milliseconds < 0 {
			return errInvalidInput
		}
		if !validHealth(item.Health) || !validRateLimit(item.RateLimit) {
			return errInvalidInput
		}
	}
	return nil
}

func validProviderID(value string) bool {
	return providerIDPattern.MatchString(value)
}

func validHealth(value provider.HealthState) bool {
	switch value {
	case provider.HealthHealthy, provider.HealthDegraded, provider.HealthUnhealthy, provider.HealthOpen:
		return true
	default:
		return false
	}
}

func validRateLimit(value provider.RateLimitState) bool {
	switch value {
	case provider.RateLimitUnknown, provider.RateLimitAvailable, provider.RateLimitConstrained, provider.RateLimitExhausted:
		return true
	default:
		return false
	}
}
