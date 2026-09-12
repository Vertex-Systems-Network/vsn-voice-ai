package provider

import (
	"fmt"
	"math"
	"reflect"
	"testing"
)

func reconciliationSnapshot() RoutingMetricsSnapshot {
	return RoutingMetricsSnapshot{
		TotalSelections: 4,
		NoEligibleCount: 1,
		ByProvider: map[string]ProviderRoutingMetrics{
			"provider-a": {
				ProviderID:              "provider-a",
				SelectionCount:          3,
				LatencyP95Milliseconds:  80,
				CostMicrounitsPerMinute: 100,
				Health:                  HealthHealthy,
				RateLimit:               RateLimitAvailable,
			},
			"provider-b": {
				ProviderID:              "provider-b",
				SelectionCount:          1,
				LatencyP95Milliseconds:  240,
				CostMicrounitsPerMinute: 700,
				Health:                  HealthDegraded,
				RateLimit:               RateLimitConstrained,
			},
		},
	}
}

func reconciliationIssueCodes(result RoutingCostReconciliation) map[string]bool {
	codes := make(map[string]bool, len(result.Issues))
	for _, issue := range result.Issues {
		codes[issue.Code] = true
	}
	return codes
}

func TestReconcileRoutingCostControlAcceptsCanonicalSummary(t *testing.T) {
	snapshot := reconciliationSnapshot()
	reported := BuildRoutingCostControlSummary(snapshot)

	result := ReconcileRoutingCostControl(snapshot, reported)
	if result.SchemaVersion != RoutingCostReconciliationSchemaVersion {
		t.Fatalf("unexpected schema version: %d", result.SchemaVersion)
	}
	if result.Status != RoutingCostReconciliationConsistent {
		t.Fatalf("canonical summary must reconcile: %#v", result)
	}
	if result.TotalIssueCount != 0 || len(result.Issues) != 0 || result.Truncated {
		t.Fatalf("canonical summary emitted issues: %#v", result)
	}
}

func TestReconcileRoutingCostControlDetectsInvalidSourceSnapshot(t *testing.T) {
	snapshot := RoutingMetricsSnapshot{
		TotalSelections: 3,
		ByProvider: map[string]ProviderRoutingMetrics{
			"provider-a": {
				ProviderID:              "provider-other",
				SelectionCount:          2,
				CostMicrounitsPerMinute: -5,
			},
		},
	}
	reported := BuildRoutingCostControlSummary(snapshot)

	result := ReconcileRoutingCostControl(snapshot, reported)
	if result.Status != RoutingCostReconciliationInconsistent {
		t.Fatalf("invalid source must fail reconciliation: %#v", result)
	}
	wantCodes := []string{
		"snapshot.provider_id_mismatch",
		"snapshot.cost_rate_invalid",
		"snapshot.selection_total_mismatch",
	}
	if len(result.Issues) != len(wantCodes) {
		t.Fatalf("unexpected source issues: %#v", result.Issues)
	}
	for index, want := range wantCodes {
		if result.Issues[index].Code != want {
			t.Fatalf("issue %d: got %q want %q", index, result.Issues[index].Code, want)
		}
	}
}

func TestReconcileRoutingCostControlDetectsTamperedSummary(t *testing.T) {
	snapshot := reconciliationSnapshot()
	reported := BuildRoutingCostControlSummary(snapshot)
	reported.TotalSelections = 99

	providerA := reported.ByProvider[0]
	providerA.SelectionCount++
	providerA.CostMicrounitsPerMinute++
	providerA.Health = HealthUnhealthy
	reported.ByProvider = []ProviderCostControl{
		providerA,
		providerA,
		{
			ProviderID:     "provider-x",
			SelectionCount: 1,
		},
	}

	result := ReconcileRoutingCostControl(snapshot, reported)
	codes := reconciliationIssueCodes(result)
	for _, code := range []string{
		"summary.total_selections_mismatch",
		"summary.provider_duplicate",
		"summary.provider_unexpected",
		"summary.provider_selection_count_mismatch",
		"summary.provider_cost_rate_mismatch",
		"summary.provider_health_mismatch",
		"summary.provider_missing",
	} {
		if !codes[code] {
			t.Fatalf("missing reconciliation issue %q: %#v", code, result.Issues)
		}
	}
}

func TestReconcileRoutingCostControlPreservesMaximumCounterPrecision(t *testing.T) {
	snapshot := RoutingMetricsSnapshot{
		TotalSelections: math.MaxUint64,
		ByProvider: map[string]ProviderRoutingMetrics{
			"provider-a": {
				ProviderID:     "provider-a",
				SelectionCount: math.MaxUint64 - 1,
			},
		},
	}

	result := ReconcileRoutingCostControl(snapshot, BuildRoutingCostControlSummary(snapshot))
	if len(result.Issues) != 1 || result.Issues[0].Code != "snapshot.selection_total_mismatch" {
		t.Fatalf("expected one precision-safe total mismatch: %#v", result.Issues)
	}
	if result.Issues[0].Expected != "18446744073709551615" ||
		result.Issues[0].Observed != "18446744073709551614" {
		t.Fatalf("counter precision was lost: %#v", result.Issues[0])
	}
}

func TestReconcileRoutingCostControlBoundsIssueDetails(t *testing.T) {
	byProvider := make(map[string]ProviderRoutingMetrics, 300)
	for index := 0; index < 300; index++ {
		providerID := fmt.Sprintf("provider-%03d", index)
		byProvider[providerID] = ProviderRoutingMetrics{
			ProviderID:     "mismatched-provider-id",
			SelectionCount: 1,
		}
	}
	snapshot := RoutingMetricsSnapshot{
		TotalSelections: 300,
		ByProvider:      byProvider,
	}

	result := ReconcileRoutingCostControl(snapshot, BuildRoutingCostControlSummary(snapshot))
	if result.Status != RoutingCostReconciliationInconsistent {
		t.Fatalf("mismatched provider identities must fail reconciliation")
	}
	if result.TotalIssueCount != 300 {
		t.Fatalf("expected 300 total issues, got %d", result.TotalIssueCount)
	}
	if len(result.Issues) != MaxRoutingCostReconciliationIssues || !result.Truncated {
		t.Fatalf("issue details must be bounded: count=%d truncated=%v", len(result.Issues), result.Truncated)
	}
}

func TestRoutingCostReconciliationSurfaceCannotCarryCustomerContent(t *testing.T) {
	typeOf := reflect.TypeOf(RoutingCostReconciliationIssue{})
	want := map[string]bool{
		"Code":       true,
		"ProviderID": true,
		"Expected":   true,
		"Observed":   true,
	}
	if typeOf.NumField() != len(want) {
		t.Fatalf("reconciliation issue field surface changed: %d fields", typeOf.NumField())
	}
	for index := 0; index < typeOf.NumField(); index++ {
		field := typeOf.Field(index)
		if !want[field.Name] {
			t.Fatalf("unexpected reconciliation field %q may widen telemetry surface", field.Name)
		}
	}
}
