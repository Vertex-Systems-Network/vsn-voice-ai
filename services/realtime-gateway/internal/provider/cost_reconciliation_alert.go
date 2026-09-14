package provider

const (
	RoutingCostReconciliationInconsistentAlertCode = "routing.cost_reconciliation_inconsistent"
	RoutingCostReconciliationInvalidAlertCode      = "routing.cost_reconciliation_invalid_state"
)

// EvaluateRoutingCostReconciliationAlert turns the integrity result into at
// most one content-safe critical operational alert. Detailed issue values stay
// in the reconciliation artifact; alert delivery carries only a stable code and
// bounded issue count so cost-control integrity failures can be surfaced without
// creating a new path for request, tenant, transcript, audio or credential data.
func EvaluateRoutingCostReconciliationAlert(
	reconciliation RoutingCostReconciliation,
) []RoutingOperationalAlert {
	if validConsistentReconciliation(reconciliation) {
		return nil
	}

	code := RoutingCostReconciliationInvalidAlertCode
	if validInconsistentReconciliation(reconciliation) {
		code = RoutingCostReconciliationInconsistentAlertCode
	}

	return []RoutingOperationalAlert{{
		Code:     code,
		Severity: RoutingAlertCritical,
		Observed: int64(reconciliation.TotalIssueCount),
	}}
}

func validConsistentReconciliation(reconciliation RoutingCostReconciliation) bool {
	return reconciliation.Status == RoutingCostReconciliationConsistent &&
		reconciliation.TotalIssueCount == 0 &&
		!reconciliation.Truncated &&
		len(reconciliation.Issues) == 0
}

func validInconsistentReconciliation(reconciliation RoutingCostReconciliation) bool {
	if reconciliation.Status != RoutingCostReconciliationInconsistent ||
		reconciliation.TotalIssueCount == 0 ||
		len(reconciliation.Issues) == 0 ||
		len(reconciliation.Issues) > MaxRoutingCostReconciliationIssues ||
		uint64(len(reconciliation.Issues)) > uint64(reconciliation.TotalIssueCount) {
		return false
	}

	if reconciliation.Truncated {
		return len(reconciliation.Issues) == MaxRoutingCostReconciliationIssues &&
			reconciliation.TotalIssueCount > uint32(len(reconciliation.Issues))
	}
	return reconciliation.TotalIssueCount == uint32(len(reconciliation.Issues))
}
