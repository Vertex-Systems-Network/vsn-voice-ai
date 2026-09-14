package provider

import (
	"math"
	"reflect"
	"testing"
)

func TestExportRoutingAuditedOperationalSnapshotPreservesPrecisionAndReconciliation(t *testing.T) {
	source := RoutingAuditedOperationalSnapshot{
		SchemaVersion: RoutingAuditedOperationalSnapshotSchemaVersion,
		Operational: RoutingOperationalSnapshot{
			SchemaVersion:   RoutingOperationalSnapshotSchemaVersion,
			RouteAttempts:   math.MaxUint64,
			TotalSelections: math.MaxUint64 - 1,
			NoEligibleCount: 1,
			WarningCount:    2,
			CriticalCount:   3,
			CostControl: RoutingCostControlSummary{
				TotalSelections:                        math.MaxUint64 - 1,
				NoEligibleCount:                        1,
				NoEligibleBasisPoints:                  1,
				AverageSelectedCostMicrounitsPerMinute: 250,
				ByProvider: []ProviderCostControl{
					{
						ProviderID:                         "provider-a",
						SelectionCount:                     math.MaxUint64 - 1,
						SelectionShareBasisPoints:          10000,
						CostMicrounitsPerMinute:            250,
						WeightedCostContributionMicrounits: 250,
						LatencyP95Milliseconds:             120,
						Health:                             HealthHealthy,
						RateLimit:                          RateLimitAvailable,
					},
				},
			},
			Alerts: []RoutingOperationalAlert{
				{
					Code:     "routing.cost_reconciliation_inconsistent",
					Severity: RoutingAlertCritical,
					Observed: 1,
				},
			},
		},
		Reconciliation: RoutingCostReconciliation{
			SchemaVersion:   RoutingCostReconciliationSchemaVersion,
			Status:          RoutingCostReconciliationInconsistent,
			TotalIssueCount: 1,
			Issues: []RoutingCostReconciliationIssue{
				{
					Code:     "summary.average_cost_mismatch",
					Expected: "250",
					Observed: "251",
				},
			},
		},
	}

	exported := ExportRoutingAuditedOperationalSnapshot(source)

	if exported.SchemaVersion != RoutingAuditedOperationalExportSchemaVersion {
		t.Fatalf("unexpected audited export schema version: %d", exported.SchemaVersion)
	}
	if exported.Operational.RouteAttempts != "18446744073709551615" {
		t.Fatalf("route attempts lost precision: %q", exported.Operational.RouteAttempts)
	}
	if exported.Operational.TotalSelections != "18446744073709551614" {
		t.Fatalf("total selections lost precision: %q", exported.Operational.TotalSelections)
	}
	if exported.Reconciliation.Status != RoutingCostReconciliationInconsistent ||
		exported.Reconciliation.TotalIssueCount != 1 ||
		len(exported.Reconciliation.Issues) != 1 {
		t.Fatalf("reconciliation drifted during export: %#v", exported.Reconciliation)
	}
	if exported.Reconciliation.Issues[0].Expected != "250" ||
		exported.Reconciliation.Issues[0].Observed != "251" {
		t.Fatalf("reconciliation values drifted: %#v", exported.Reconciliation.Issues[0])
	}
}

func TestExportRoutingAuditedOperationalSnapshotDetachesNestedSlices(t *testing.T) {
	source := RoutingAuditedOperationalSnapshot{
		Operational: RoutingOperationalSnapshot{
			CostControl: RoutingCostControlSummary{
				ByProvider: []ProviderCostControl{{ProviderID: "provider-a"}},
			},
			Alerts: []RoutingOperationalAlert{{Code: "provider.health_unhealthy"}},
		},
		Reconciliation: RoutingCostReconciliation{
			Issues: []RoutingCostReconciliationIssue{{
				Code:     "summary.average_cost_mismatch",
				Expected: "10",
				Observed: "11",
			}},
		},
	}

	exported := ExportRoutingAuditedOperationalSnapshot(source)
	exported.Operational.CostControl.ByProvider[0].ProviderID = "mutated-provider"
	exported.Operational.Alerts[0].Code = "mutated-alert"
	exported.Reconciliation.Issues[0].Observed = "999"

	if source.Operational.CostControl.ByProvider[0].ProviderID != "provider-a" {
		t.Fatalf("provider slice aliased source: %#v", source.Operational.CostControl.ByProvider)
	}
	if source.Operational.Alerts[0].Code != "provider.health_unhealthy" {
		t.Fatalf("alert slice aliased source: %#v", source.Operational.Alerts)
	}
	if source.Reconciliation.Issues[0].Observed != "11" {
		t.Fatalf("reconciliation issue slice aliased source: %#v", source.Reconciliation.Issues)
	}
}

func TestRoutingAuditedOperationalExportHasClosedFieldSurface(t *testing.T) {
	typeOfExport := reflect.TypeOf(RoutingAuditedOperationalExport{})
	want := []string{"SchemaVersion", "Operational", "Reconciliation"}
	if typeOfExport.NumField() != len(want) {
		t.Fatalf("audited export field surface widened: got %d fields want %d", typeOfExport.NumField(), len(want))
	}
	for index, fieldName := range want {
		if typeOfExport.Field(index).Name != fieldName {
			t.Fatalf("audited export field surface drifted at %d: got %s want %s", index, typeOfExport.Field(index).Name, fieldName)
		}
	}
}
