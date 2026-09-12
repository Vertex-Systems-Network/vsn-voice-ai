package provider

import "context"

const (
	MaxRoutingAlertSinks       = 8
	MaxRoutingAlertsPerDispatch = 128
)

// RoutingAlertSink is a provider-neutral delivery boundary for already
// content-safe operational alerts. Concrete network/vendor adapters remain
// outside this package.
type RoutingAlertSink interface {
	DeliverRoutingAlerts(context.Context, []RoutingOperationalAlertExport) error
}

// RoutingAlertDispatchReport deliberately contains counts and stable rejection
// codes only. Sink error strings are never retained because external adapters
// may include credentials, endpoints, tenant data or other unsafe content in
// their errors.
type RoutingAlertDispatchReport struct {
	AlertCount         int    `json:"alert_count"`
	SinkCount          int    `json:"sink_count"`
	DeliveredSinkCount int    `json:"delivered_sink_count"`
	FailedSinkCount    int    `json:"failed_sink_count"`
	Rejected           bool   `json:"rejected"`
	RejectionCode      string `json:"rejection_code,omitempty"`
}

// DispatchRoutingOperationalAlerts performs bounded best-effort fan-out. Each
// sink receives an isolated copy of the alert slice, a sink failure does not
// prevent later sinks from receiving the batch, and sink panics are contained
// as delivery failures.
func DispatchRoutingOperationalAlerts(
	ctx context.Context,
	alerts []RoutingOperationalAlertExport,
	sinks []RoutingAlertSink,
) RoutingAlertDispatchReport {
	report := RoutingAlertDispatchReport{AlertCount: len(alerts)}

	if ctx == nil {
		report.Rejected = true
		report.RejectionCode = "invalid_context"
		return report
	}
	if len(alerts) > MaxRoutingAlertsPerDispatch {
		report.Rejected = true
		report.RejectionCode = "too_many_alerts"
		return report
	}

	for _, sink := range sinks {
		if sink != nil {
			report.SinkCount++
		}
	}
	if report.SinkCount > MaxRoutingAlertSinks {
		report.Rejected = true
		report.RejectionCode = "too_many_sinks"
		return report
	}
	if err := ctx.Err(); err != nil {
		report.Rejected = true
		report.RejectionCode = "context_unavailable"
		return report
	}
	if len(alerts) == 0 || report.SinkCount == 0 {
		return report
	}

	for _, sink := range sinks {
		if sink == nil {
			continue
		}

		batch := append([]RoutingOperationalAlertExport(nil), alerts...)
		if deliverRoutingAlertBatch(ctx, sink, batch) {
			report.DeliveredSinkCount++
		} else {
			report.FailedSinkCount++
		}
	}

	return report
}

func deliverRoutingAlertBatch(
	ctx context.Context,
	sink RoutingAlertSink,
	alerts []RoutingOperationalAlertExport,
) (delivered bool) {
	defer func() {
		if recover() != nil {
			delivered = false
		}
	}()
	return sink.DeliverRoutingAlerts(ctx, alerts) == nil
}
