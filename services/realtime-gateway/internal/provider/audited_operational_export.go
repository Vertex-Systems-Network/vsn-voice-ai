package provider

const RoutingAuditedOperationalExportSchemaVersion uint32 = 1

// RoutingAuditedOperationalExport is the browser/cross-service-safe form of
// RoutingAuditedOperationalSnapshot. The nested operational export preserves
// JavaScript integer precision, while reconciliation already uses bounded
// uint32 counters plus string-valued expected/observed diagnostics.
type RoutingAuditedOperationalExport struct {
	SchemaVersion  uint32                    `json:"schema_version"`
	Operational    RoutingOperationalExport  `json:"operational"`
	Reconciliation RoutingCostReconciliation `json:"reconciliation"`
}

// ExportRoutingAuditedOperationalSnapshot creates detached slices for both
// nested artifacts so a caller cannot mutate the internal read model through
// an exported reconciliation issue or operational alert/provider slice.
func ExportRoutingAuditedOperationalSnapshot(
	snapshot RoutingAuditedOperationalSnapshot,
) RoutingAuditedOperationalExport {
	return RoutingAuditedOperationalExport{
		SchemaVersion:  RoutingAuditedOperationalExportSchemaVersion,
		Operational:    ExportRoutingOperationalSnapshot(snapshot.Operational),
		Reconciliation: cloneRoutingCostReconciliation(snapshot.Reconciliation),
	}
}

func cloneRoutingCostReconciliation(
	reconciliation RoutingCostReconciliation,
) RoutingCostReconciliation {
	issues := make([]RoutingCostReconciliationIssue, len(reconciliation.Issues))
	copy(issues, reconciliation.Issues)
	return RoutingCostReconciliation{
		SchemaVersion:   reconciliation.SchemaVersion,
		Status:          reconciliation.Status,
		TotalIssueCount: reconciliation.TotalIssueCount,
		Truncated:       reconciliation.Truncated,
		Issues:          issues,
	}
}
