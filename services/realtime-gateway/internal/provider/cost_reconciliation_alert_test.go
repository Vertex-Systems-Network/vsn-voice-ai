package provider

import "testing"

func TestEvaluateRoutingCostReconciliationAlertConsistentIsSilent(t *testing.T) {
	alerts := EvaluateRoutingCostReconciliationAlert(RoutingCostReconciliation{
		SchemaVersion: RoutingCostReconciliationSchemaVersion,
		Status:        RoutingCostReconciliationConsistent,
		Issues:        []RoutingCostReconciliationIssue{},
	})
	if len(alerts) != 0 {
		t.Fatalf("expected no alert, got %#v", alerts)
	}
}

func TestEvaluateRoutingCostReconciliationAlertInconsistentIsCritical(t *testing.T) {
	alerts := EvaluateRoutingCostReconciliationAlert(RoutingCostReconciliation{
		SchemaVersion:   RoutingCostReconciliationSchemaVersion,
		Status:          RoutingCostReconciliationInconsistent,
		TotalIssueCount: 1,
		Issues: []RoutingCostReconciliationIssue{{
			Code:       "summary.provider_cost_rate_mismatch",
			ProviderID: "provider-a",
			Expected:   "10",
			Observed:   "20",
		}},
	})
	if len(alerts) != 1 {
		t.Fatalf("expected one alert, got %#v", alerts)
	}
	alert := alerts[0]
	if alert.Code != RoutingCostReconciliationInconsistentAlertCode {
		t.Fatalf("unexpected code %q", alert.Code)
	}
	if alert.Severity != RoutingAlertCritical {
		t.Fatalf("unexpected severity %q", alert.Severity)
	}
	if alert.Observed != 1 {
		t.Fatalf("unexpected observed count %d", alert.Observed)
	}
	if alert.ProviderID != "" || alert.Threshold != 0 {
		t.Fatalf("alert should expose only aggregate integrity metadata: %#v", alert)
	}
}

func TestEvaluateRoutingCostReconciliationAlertRejectsMalformedConsistentState(t *testing.T) {
	alerts := EvaluateRoutingCostReconciliationAlert(RoutingCostReconciliation{
		SchemaVersion:   RoutingCostReconciliationSchemaVersion,
		Status:          RoutingCostReconciliationConsistent,
		TotalIssueCount: 1,
		Issues: []RoutingCostReconciliationIssue{{
			Code: "unexpected_issue",
		}},
	})
	if len(alerts) != 1 || alerts[0].Code != RoutingCostReconciliationInvalidAlertCode {
		t.Fatalf("expected invalid-state alert, got %#v", alerts)
	}
}

func TestEvaluateRoutingCostReconciliationAlertRejectsMalformedInconsistentState(t *testing.T) {
	cases := []RoutingCostReconciliation{
		{
			SchemaVersion: RoutingCostReconciliationSchemaVersion,
			Status:        RoutingCostReconciliationInconsistent,
			Issues:        []RoutingCostReconciliationIssue{},
		},
		{
			SchemaVersion:   RoutingCostReconciliationSchemaVersion,
			Status:          RoutingCostReconciliationInconsistent,
			TotalIssueCount: 2,
			Issues: []RoutingCostReconciliationIssue{{
				Code: "only_one_issue",
			}},
		},
		{
			SchemaVersion:   RoutingCostReconciliationSchemaVersion,
			Status:          RoutingCostReconciliationStatus("unknown"),
			TotalIssueCount: 0,
			Issues:          []RoutingCostReconciliationIssue{},
		},
	}

	for _, reconciliation := range cases {
		alerts := EvaluateRoutingCostReconciliationAlert(reconciliation)
		if len(alerts) != 1 || alerts[0].Code != RoutingCostReconciliationInvalidAlertCode {
			t.Fatalf("expected invalid-state alert for %#v, got %#v", reconciliation, alerts)
		}
	}
}

func TestEvaluateRoutingCostReconciliationAlertAcceptsBoundedTruncation(t *testing.T) {
	issues := make([]RoutingCostReconciliationIssue, MaxRoutingCostReconciliationIssues)
	for index := range issues {
		issues[index] = RoutingCostReconciliationIssue{Code: "issue"}
	}
	alerts := EvaluateRoutingCostReconciliationAlert(RoutingCostReconciliation{
		SchemaVersion:   RoutingCostReconciliationSchemaVersion,
		Status:          RoutingCostReconciliationInconsistent,
		TotalIssueCount: MaxRoutingCostReconciliationIssues + 1,
		Truncated:       true,
		Issues:          issues,
	})
	if len(alerts) != 1 || alerts[0].Code != RoutingCostReconciliationInconsistentAlertCode {
		t.Fatalf("expected bounded inconsistent alert, got %#v", alerts)
	}
	if alerts[0].Observed != int64(MaxRoutingCostReconciliationIssues+1) {
		t.Fatalf("unexpected observed count %d", alerts[0].Observed)
	}
}
