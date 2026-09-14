package provider

import "testing"

func auditedMetricsFixture() RoutingMetricsSnapshot {
	return RoutingMetricsSnapshot{
		TotalSelections: 4,
		NoEligibleCount: 1,
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
}

func quietAuditedThresholds() RoutingOperationalThresholds {
	return RoutingOperationalThresholds{
		MaxLatencyP95Milliseconds:  1000,
		MaxCostMicrounitsPerMinute: 1000,
		MaxNoEligibleBasisPoints:   10000,
		MinRouteAttempts:           1,
	}
}

func TestBuildRoutingAuditedOperationalSnapshotConsistentReportAddsNoIntegrityAlert(t *testing.T) {
	metrics := auditedMetricsFixture()
	reported := BuildRoutingCostControlSummary(metrics)

	result := BuildRoutingAuditedOperationalSnapshot(
		metrics,
		reported,
		quietAuditedThresholds(),
	)

	if result.SchemaVersion != RoutingAuditedOperationalSnapshotSchemaVersion {
		t.Fatalf("unexpected schema version %d", result.SchemaVersion)
	}
	if result.Reconciliation.Status != RoutingCostReconciliationConsistent {
		t.Fatalf("expected consistent reconciliation, got %#v", result.Reconciliation)
	}
	if result.Reconciliation.TotalIssueCount != 0 || len(result.Reconciliation.Issues) != 0 {
		t.Fatalf("consistent reconciliation carried issues: %#v", result.Reconciliation)
	}
	if result.Operational.CriticalCount != 0 || len(result.Operational.Alerts) != 0 {
		t.Fatalf("consistent report added integrity alert: %#v", result.Operational)
	}
}

func TestBuildRoutingAuditedOperationalSnapshotInconsistencyAddsAggregateCriticalAlert(t *testing.T) {
	metrics := auditedMetricsFixture()
	reported := BuildRoutingCostControlSummary(metrics)
	reported.AverageSelectedCostMicrounitsPerMinute++

	result := BuildRoutingAuditedOperationalSnapshot(
		metrics,
		reported,
		quietAuditedThresholds(),
	)

	if result.Reconciliation.Status != RoutingCostReconciliationInconsistent {
		t.Fatalf("expected inconsistent reconciliation, got %#v", result.Reconciliation)
	}
	if result.Reconciliation.TotalIssueCount != 1 || len(result.Reconciliation.Issues) != 1 {
		t.Fatalf("expected one detailed reconciliation issue, got %#v", result.Reconciliation)
	}
	if result.Operational.CriticalCount != 1 || len(result.Operational.Alerts) != 1 {
		t.Fatalf("expected one aggregate critical alert, got %#v", result.Operational)
	}
	alert := result.Operational.Alerts[0]
	if alert.Code != RoutingCostReconciliationInconsistentAlertCode ||
		alert.Severity != RoutingAlertCritical ||
		alert.Observed != 1 {
		t.Fatalf("unexpected reconciliation alert: %#v", alert)
	}
	if alert.ProviderID != "" || alert.Threshold != 0 {
		t.Fatalf("aggregate integrity alert widened with detailed issue data: %#v", alert)
	}
	if result.Operational.CostControl.AverageSelectedCostMicrounitsPerMinute != 250 {
		t.Fatalf("reported summary replaced canonical cost control: %#v", result.Operational.CostControl)
	}
}

func TestBuildRoutingAuditedOperationalSnapshotPreservesExistingOperationalAlerts(t *testing.T) {
	metrics := auditedMetricsFixture()
	reported := BuildRoutingCostControlSummary(metrics)
	reported.TotalSelections++

	result := BuildRoutingAuditedOperationalSnapshot(
		metrics,
		reported,
		RoutingOperationalThresholds{
			MaxLatencyP95Milliseconds:  1000,
			MaxCostMicrounitsPerMinute: 100,
			MaxNoEligibleBasisPoints:   10000,
			MinRouteAttempts:           1,
		},
	)

	if result.Operational.WarningCount != 1 {
		t.Fatalf("expected existing warning count to survive, got %#v", result.Operational)
	}
	if result.Operational.CriticalCount != 1 {
		t.Fatalf("expected one reconciliation critical alert, got %#v", result.Operational)
	}
	if len(result.Operational.Alerts) != 2 {
		t.Fatalf("expected operational plus reconciliation alerts, got %#v", result.Operational.Alerts)
	}
	if result.Operational.Alerts[0].Code != "provider.cost_rate_high" ||
		result.Operational.Alerts[1].Code != RoutingCostReconciliationInconsistentAlertCode {
		t.Fatalf("unexpected alert ordering: %#v", result.Operational.Alerts)
	}
}
