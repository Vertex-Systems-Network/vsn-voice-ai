package provider

const RoutingAuditedOperationalSnapshotSchemaVersion uint32 = 1

// RoutingAuditedOperationalSnapshot composes the canonical operational read
// model with an integrity comparison against a separately reported cost-control
// summary. The canonical snapshot is always rebuilt from routing metrics; the
// reported summary can add integrity alerts but cannot replace canonical values.
type RoutingAuditedOperationalSnapshot struct {
	SchemaVersion  uint32                     `json:"schema_version"`
	Operational    RoutingOperationalSnapshot `json:"operational"`
	Reconciliation RoutingCostReconciliation  `json:"reconciliation"`
}

// BuildRoutingAuditedOperationalSnapshot keeps cost reconciliation on the
// observability path instead of the billing path. A valid inconsistency adds one
// aggregate critical alert; malformed reconciliation state also fails closed as
// one critical integrity alert. Detailed reconciliation issues remain in the
// reconciliation artifact and are never copied into alert payloads.
func BuildRoutingAuditedOperationalSnapshot(
	metrics RoutingMetricsSnapshot,
	reported RoutingCostControlSummary,
	thresholds RoutingOperationalThresholds,
) RoutingAuditedOperationalSnapshot {
	operational := BuildRoutingOperationalSnapshot(metrics, thresholds)
	reconciliation := ReconcileRoutingCostControl(metrics, reported)
	reconciliationAlerts := EvaluateRoutingCostReconciliationAlert(reconciliation)

	if len(reconciliationAlerts) > 0 {
		operational.Alerts = append(operational.Alerts, reconciliationAlerts...)
		for _, alert := range reconciliationAlerts {
			switch alert.Severity {
			case RoutingAlertWarning:
				operational.WarningCount = saturatedIncrementUint32(operational.WarningCount)
			case RoutingAlertCritical:
				operational.CriticalCount = saturatedIncrementUint32(operational.CriticalCount)
			}
		}
	}

	return RoutingAuditedOperationalSnapshot{
		SchemaVersion:  RoutingAuditedOperationalSnapshotSchemaVersion,
		Operational:    operational,
		Reconciliation: reconciliation,
	}
}
