package provider

import (
	"context"
	"testing"
)

func TestDispatchRoutingAuditedOperationalAlertsIncludesReconciliationAlert(t *testing.T) {
	metrics := RoutingMetricsSnapshot{
		TotalSelections: 4,
		ByProvider: map[string]ProviderRoutingMetrics{
			"provider-a": {
				ProviderID:              "provider-a",
				SelectionCount:          4,
				LatencyP95Milliseconds:  120,
				CostMicrounitsPerMinute: 250,
				Health:                  HealthHealthy,
				RateLimit:               RateLimitAvailable,
			},
		},
	}
	reported := BuildRoutingCostControlSummary(metrics)
	reported.AverageSelectedCostMicrounitsPerMinute++
	audited := BuildRoutingAuditedOperationalSnapshot(
		metrics,
		reported,
		RoutingOperationalThresholds{MaxCostMicrounitsPerMinute: 100},
	)

	var delivered []RoutingOperationalAlertExport
	sink := routingAlertSinkFunc(func(_ context.Context, alerts []RoutingOperationalAlertExport) error {
		delivered = append([]RoutingOperationalAlertExport(nil), alerts...)
		return nil
	})

	report := DispatchRoutingAuditedOperationalAlerts(
		context.Background(),
		audited,
		[]RoutingAlertSink{sink},
	)

	if report.AlertCount != 2 || report.DeliveredSinkCount != 1 || report.FailedSinkCount != 0 {
		t.Fatalf("unexpected audited alert dispatch report: %#v", report)
	}
	if len(delivered) != 2 {
		t.Fatalf("expected operational plus reconciliation alert, got %#v", delivered)
	}
	if delivered[0].Code != "provider.cost_rate_high" {
		t.Fatalf("expected canonical operational alert first, got %#v", delivered)
	}
	if delivered[1].Code != RoutingCostReconciliationInconsistentAlertCode ||
		delivered[1].Severity != RoutingAlertCritical ||
		delivered[1].Observed != "1" {
		t.Fatalf("unexpected reconciliation alert export: %#v", delivered[1])
	}
	if delivered[1].ProviderID != "" || delivered[1].Threshold != "" {
		t.Fatalf("aggregate reconciliation alert leaked detailed issue data: %#v", delivered[1])
	}
}

func TestDispatchRoutingAuditedOperationalAlertsDoesNotExposeReconciliationIssues(t *testing.T) {
	audited := RoutingAuditedOperationalSnapshot{
		Operational: RoutingOperationalSnapshot{
			Alerts: []RoutingOperationalAlert{{
				Code:     RoutingCostReconciliationInconsistentAlertCode,
				Severity: RoutingAlertCritical,
				Observed: 1,
			}},
		},
		Reconciliation: RoutingCostReconciliation{
			Status:          RoutingCostReconciliationInconsistent,
			TotalIssueCount: 1,
			Issues: []RoutingCostReconciliationIssue{{
				Code:       "summary.provider_cost_rate_mismatch",
				ProviderID: "provider-sensitive-detail",
				Expected:   "100",
				Observed:   "200",
			}},
		},
	}

	var delivered []RoutingOperationalAlertExport
	sink := routingAlertSinkFunc(func(_ context.Context, alerts []RoutingOperationalAlertExport) error {
		delivered = append([]RoutingOperationalAlertExport(nil), alerts...)
		return nil
	})

	DispatchRoutingAuditedOperationalAlerts(context.Background(), audited, []RoutingAlertSink{sink})

	if len(delivered) != 1 {
		t.Fatalf("expected one aggregate alert, got %#v", delivered)
	}
	if delivered[0].ProviderID != "" || delivered[0].Observed != "1" {
		t.Fatalf("reconciliation detail crossed alert boundary: %#v", delivered[0])
	}
}

func TestDispatchRoutingAuditedOperationalAlertsPreservesSourceSnapshot(t *testing.T) {
	audited := RoutingAuditedOperationalSnapshot{
		Operational: RoutingOperationalSnapshot{
			Alerts: []RoutingOperationalAlert{{
				Code:       "provider.health_degraded",
				Severity:   RoutingAlertWarning,
				ProviderID: "provider-a",
				Observed:   1,
			}},
		},
	}
	sink := routingAlertSinkFunc(func(_ context.Context, alerts []RoutingOperationalAlertExport) error {
		alerts[0].Code = "mutated-by-sink"
		return nil
	})

	DispatchRoutingAuditedOperationalAlerts(context.Background(), audited, []RoutingAlertSink{sink})

	if audited.Operational.Alerts[0].Code != "provider.health_degraded" {
		t.Fatalf("sink mutation reached source audited snapshot: %#v", audited.Operational.Alerts)
	}
}

func TestDispatchRoutingAuditedOperationalAlertsKeepsFailClosedContextPolicy(t *testing.T) {
	sink := routingAlertSinkFunc(func(context.Context, []RoutingOperationalAlertExport) error {
		t.Fatal("sink must not run for nil context")
		return nil
	})

	report := DispatchRoutingAuditedOperationalAlerts(
		nil,
		RoutingAuditedOperationalSnapshot{},
		[]RoutingAlertSink{sink},
	)
	if !report.Rejected || report.RejectionCode != "invalid_context" {
		t.Fatalf("nil context must remain fail-closed: %#v", report)
	}
}
