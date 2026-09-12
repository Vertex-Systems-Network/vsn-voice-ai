package provider

const RoutingOperationalSnapshotSchemaVersion uint32 = 1

// RoutingOperationalSnapshot is a deterministic content-safe read model for
// admin/observability surfaces. It composes already-approved routing metadata;
// it is not a billing ledger, request log, or customer-content container.
type RoutingOperationalSnapshot struct {
	SchemaVersion   uint32                    `json:"schema_version"`
	RouteAttempts   uint64                    `json:"route_attempts"`
	TotalSelections uint64                    `json:"total_selections"`
	NoEligibleCount uint64                    `json:"no_eligible_count"`
	WarningCount    uint32                    `json:"warning_count"`
	CriticalCount   uint32                    `json:"critical_count"`
	CostControl     RoutingCostControlSummary `json:"cost_control"`
	Alerts          []RoutingOperationalAlert `json:"alerts"`
}

// BuildRoutingOperationalSnapshot composes the existing metrics, cost-control,
// and alert decisions into one closed read model. Ordering is inherited from
// BuildRoutingCostControlSummary and EvaluateRoutingOperationalAlerts, both of
// which sort provider identifiers deterministically.
func BuildRoutingOperationalSnapshot(
	snapshot RoutingMetricsSnapshot,
	thresholds RoutingOperationalThresholds,
) RoutingOperationalSnapshot {
	costControl := BuildRoutingCostControlSummary(snapshot)
	alerts := EvaluateRoutingOperationalAlerts(snapshot, thresholds)

	result := RoutingOperationalSnapshot{
		SchemaVersion:   RoutingOperationalSnapshotSchemaVersion,
		RouteAttempts:   saturatedAddUint64(snapshot.TotalSelections, snapshot.NoEligibleCount),
		TotalSelections: snapshot.TotalSelections,
		NoEligibleCount: snapshot.NoEligibleCount,
		CostControl:     costControl,
		Alerts:          append([]RoutingOperationalAlert(nil), alerts...),
	}

	for _, alert := range result.Alerts {
		switch alert.Severity {
		case RoutingAlertWarning:
			result.WarningCount = saturatedIncrementUint32(result.WarningCount)
		case RoutingAlertCritical:
			result.CriticalCount = saturatedIncrementUint32(result.CriticalCount)
		}
	}

	return result
}

func saturatedIncrementUint32(value uint32) uint32 {
	if value == ^uint32(0) {
		return value
	}
	return value + 1
}
