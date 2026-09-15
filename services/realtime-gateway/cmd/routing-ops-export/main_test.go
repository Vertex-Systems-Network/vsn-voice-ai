package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/Vertex-Systems-Network/vsn-voice-ai/services/realtime-gateway/internal/provider"
)

func validInput() auditedExportInput {
	metrics := provider.RoutingMetricsSnapshot{
		TotalSelections: 3,
		NoEligibleCount: 1,
		ByProvider: map[string]provider.ProviderRoutingMetrics{
			"provider-a": {
				ProviderID:              "provider-a",
				SelectionCount:          2,
				LatencyP95Milliseconds:  120,
				CostMicrounitsPerMinute: 1000,
				Health:                  provider.HealthHealthy,
				RateLimit:               provider.RateLimitAvailable,
			},
			"provider-b": {
				ProviderID:              "provider-b",
				SelectionCount:          1,
				LatencyP95Milliseconds:  240,
				CostMicrounitsPerMinute: 2000,
				Health:                  provider.HealthDegraded,
				RateLimit:               provider.RateLimitConstrained,
			},
		},
	}
	return auditedExportInput{
		SchemaVersion:       1,
		Metrics:             metrics,
		ReportedCostControl: provider.BuildRoutingCostControlSummary(metrics),
		Thresholds: provider.RoutingOperationalThresholds{
			MaxLatencyP95Milliseconds:  200,
			MaxCostMicrounitsPerMinute: 1500,
			MaxNoEligibleBasisPoints:   2000,
			MinRouteAttempts:           1,
		},
	}
}

func encodeInput(t *testing.T, input auditedExportInput) []byte {
	t.Helper()
	data, err := json.Marshal(input)
	if err != nil {
		t.Fatalf("marshal input: %v", err)
	}
	return data
}

func TestRunProducesAuditedContentSafeExport(t *testing.T) {
	input := validInput()
	var output bytes.Buffer
	if err := run(bytes.NewReader(encodeInput(t, input)), &output); err != nil {
		t.Fatalf("run: %v", err)
	}

	var exported provider.RoutingAuditedOperationalExport
	if err := json.Unmarshal(output.Bytes(), &exported); err != nil {
		t.Fatalf("decode export: %v", err)
	}
	if exported.SchemaVersion != provider.RoutingAuditedOperationalExportSchemaVersion {
		t.Fatalf("unexpected schema version: %d", exported.SchemaVersion)
	}
	if exported.Operational.TotalSelections != "3" || exported.Operational.NoEligibleCount != "1" {
		t.Fatalf("unexpected operational totals: %#v", exported.Operational)
	}
	if exported.Reconciliation.Status != provider.RoutingCostReconciliationConsistent {
		t.Fatalf("expected consistent reconciliation, got %q", exported.Reconciliation.Status)
	}
	if !strings.Contains(output.String(), `"provider_id":"provider-a"`) {
		t.Fatalf("provider attribution missing: %s", output.String())
	}
	if strings.Contains(output.String(), "audio") || strings.Contains(output.String(), "transcript") {
		t.Fatalf("unexpected content-bearing field in export: %s", output.String())
	}
}

func TestRunPreservesReconciliationMismatchAsAuditedIssue(t *testing.T) {
	input := validInput()
	input.ReportedCostControl.TotalSelections = 99

	var output bytes.Buffer
	if err := run(bytes.NewReader(encodeInput(t, input)), &output); err != nil {
		t.Fatalf("run: %v", err)
	}

	var exported provider.RoutingAuditedOperationalExport
	if err := json.Unmarshal(output.Bytes(), &exported); err != nil {
		t.Fatalf("decode export: %v", err)
	}
	if exported.Reconciliation.Status != provider.RoutingCostReconciliationInconsistent {
		t.Fatalf("expected inconsistent reconciliation, got %q", exported.Reconciliation.Status)
	}
	if exported.Reconciliation.TotalIssueCount == 0 {
		t.Fatal("expected at least one reconciliation issue")
	}
}

func TestDecodeRejectsUnknownOrTrailingInput(t *testing.T) {
	unknown := `{"schema_version":1,"metrics":{"total_selections":0,"no_eligible_count":0,"by_provider":{}},"reported_cost_control":{"total_selections":0,"no_eligible_count":0,"no_eligible_basis_points":0,"average_selected_cost_microunits_per_minute":0,"by_provider":[]},"thresholds":{"max_latency_p95_ms":0,"max_cost_microunits_per_minute":0,"max_no_eligible_basis_points":0,"min_route_attempts":0},"customer_secret":"do-not-accept"}`
	if _, err := decodeInput(strings.NewReader(unknown)); !errors.Is(err, errInvalidInput) {
		t.Fatalf("expected invalid input for unknown field, got %v", err)
	}

	valid := string(encodeInput(t, validInput())) + ` {}`
	if _, err := decodeInput(strings.NewReader(valid)); !errors.Is(err, errInvalidInput) {
		t.Fatalf("expected invalid input for trailing JSON, got %v", err)
	}
}

func TestValidateRejectsUnboundedOrContentLikeProviderIdentifiers(t *testing.T) {
	input := validInput()
	metrics := input.Metrics.ByProvider["provider-a"]
	delete(input.Metrics.ByProvider, "provider-a")
	metrics.ProviderID = "Customer Name / transcript text"
	input.Metrics.ByProvider["Customer Name / transcript text"] = metrics
	if err := validateInput(input); !errors.Is(err, errInvalidInput) {
		t.Fatalf("expected invalid provider identifier, got %v", err)
	}

	input = validInput()
	input.Thresholds.MaxNoEligibleBasisPoints = 10_001
	if err := validateInput(input); !errors.Is(err, errInvalidInput) {
		t.Fatalf("expected invalid threshold bound, got %v", err)
	}
}

func TestDecodeRejectsOversizedInputWithoutEchoingContent(t *testing.T) {
	oversized := strings.Repeat("x", maxInputBytes+1)
	_, err := decodeInput(strings.NewReader(oversized))
	if !errors.Is(err, errInputTooLarge) {
		t.Fatalf("expected size error, got %v", err)
	}
	if err.Error() != errInputTooLarge.Error() {
		t.Fatalf("size error must remain generic, got %q", err.Error())
	}
}
