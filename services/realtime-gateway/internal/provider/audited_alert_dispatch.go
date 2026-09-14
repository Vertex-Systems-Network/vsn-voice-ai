package provider

import "context"

// DispatchRoutingAuditedOperationalAlerts exports only the content-safe alert
// projection from an already-built audited operational snapshot and delivers it
// through the existing bounded sink fan-out. Detailed reconciliation issues,
// cost-control provider rows, request data and customer content never cross the
// alert-sink boundary.
func DispatchRoutingAuditedOperationalAlerts(
	ctx context.Context,
	snapshot RoutingAuditedOperationalSnapshot,
	sinks []RoutingAlertSink,
) RoutingAlertDispatchReport {
	exported := ExportRoutingOperationalSnapshot(snapshot.Operational)
	return DispatchRoutingOperationalAlerts(ctx, exported.Alerts, sinks)
}
