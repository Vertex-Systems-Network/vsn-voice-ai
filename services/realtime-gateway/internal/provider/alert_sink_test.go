package provider

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

type routingAlertSinkFunc func(context.Context, []RoutingOperationalAlertExport) error

func (f routingAlertSinkFunc) DeliverRoutingAlerts(
	ctx context.Context,
	alerts []RoutingOperationalAlertExport,
) error {
	return f(ctx, alerts)
}

func TestDispatchRoutingOperationalAlertsIsolatesSinksAndContinuesAfterFailure(t *testing.T) {
	alerts := []RoutingOperationalAlertExport{
		{Code: "provider.health_degraded", Severity: RoutingAlertWarning, Observed: "1"},
	}
	secondSaw := ""
	sinks := []RoutingAlertSink{
		routingAlertSinkFunc(func(_ context.Context, batch []RoutingOperationalAlertExport) error {
			batch[0].Code = "mutated-by-first-sink"
			return errors.New("unsafe adapter error with secret-like content")
		}),
		routingAlertSinkFunc(func(_ context.Context, batch []RoutingOperationalAlertExport) error {
			secondSaw = batch[0].Code
			return nil
		}),
	}

	report := DispatchRoutingOperationalAlerts(context.Background(), alerts, sinks)

	if secondSaw != "provider.health_degraded" {
		t.Fatalf("sink batches must be isolated, second sink saw %q", secondSaw)
	}
	if alerts[0].Code != "provider.health_degraded" {
		t.Fatalf("dispatch mutated caller alerts: %#v", alerts)
	}
	if report.DeliveredSinkCount != 1 || report.FailedSinkCount != 1 {
		t.Fatalf("unexpected dispatch report: %#v", report)
	}
	if report.RejectionCode != "" || report.Rejected {
		t.Fatalf("best-effort sink failure must not reject the bounded batch: %#v", report)
	}
}

func TestDispatchRoutingOperationalAlertsContainsSinkPanic(t *testing.T) {
	called := false
	sinks := []RoutingAlertSink{
		routingAlertSinkFunc(func(context.Context, []RoutingOperationalAlertExport) error {
			panic("adapter panic with unsafe content")
		}),
		routingAlertSinkFunc(func(context.Context, []RoutingOperationalAlertExport) error {
			called = true
			return nil
		}),
	}

	report := DispatchRoutingOperationalAlerts(
		context.Background(),
		[]RoutingOperationalAlertExport{{Code: "provider.health_unhealthy", Severity: RoutingAlertCritical, Observed: "1"}},
		sinks,
	)

	if !called {
		t.Fatal("panic in one sink must not prevent later bounded sinks")
	}
	if report.DeliveredSinkCount != 1 || report.FailedSinkCount != 1 {
		t.Fatalf("unexpected panic containment report: %#v", report)
	}
}

func TestDispatchRoutingOperationalAlertsRejectsBoundsBeforeDelivery(t *testing.T) {
	calls := 0
	sink := routingAlertSinkFunc(func(context.Context, []RoutingOperationalAlertExport) error {
		calls++
		return nil
	})

	tooManyAlerts := make([]RoutingOperationalAlertExport, MaxRoutingAlertsPerDispatch+1)
	alertReport := DispatchRoutingOperationalAlerts(context.Background(), tooManyAlerts, []RoutingAlertSink{sink})
	if !alertReport.Rejected || alertReport.RejectionCode != "too_many_alerts" || calls != 0 {
		t.Fatalf("too-many-alerts batch must fail closed before delivery: %#v calls=%d", alertReport, calls)
	}

	tooManySinks := make([]RoutingAlertSink, MaxRoutingAlertSinks+1)
	for index := range tooManySinks {
		tooManySinks[index] = sink
	}
	sinkReport := DispatchRoutingOperationalAlerts(context.Background(), nil, tooManySinks)
	if !sinkReport.Rejected || sinkReport.RejectionCode != "too_many_sinks" || calls != 0 {
		t.Fatalf("too-many-sinks batch must fail closed before delivery: %#v calls=%d", sinkReport, calls)
	}
}

func TestDispatchRoutingOperationalAlertsRejectsUnavailableContext(t *testing.T) {
	sink := routingAlertSinkFunc(func(context.Context, []RoutingOperationalAlertExport) error {
		t.Fatal("sink must not be called for unavailable context")
		return nil
	})

	nilReport := DispatchRoutingOperationalAlerts(nil, nil, []RoutingAlertSink{sink})
	if !nilReport.Rejected || nilReport.RejectionCode != "invalid_context" {
		t.Fatalf("nil context must fail closed: %#v", nilReport)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	cancelledReport := DispatchRoutingOperationalAlerts(ctx, nil, []RoutingAlertSink{sink})
	if !cancelledReport.Rejected || cancelledReport.RejectionCode != "context_unavailable" {
		t.Fatalf("cancelled context must fail closed: %#v", cancelledReport)
	}
}

func TestRoutingAlertDispatchReportHasClosedContentSafeFieldSurface(t *testing.T) {
	typeOfReport := reflect.TypeOf(RoutingAlertDispatchReport{})
	allowed := map[string]struct{}{
		"AlertCount": {}, "SinkCount": {}, "DeliveredSinkCount": {}, "FailedSinkCount": {},
		"Rejected": {}, "RejectionCode": {},
	}
	if typeOfReport.NumField() != len(allowed) {
		t.Fatalf("unexpected dispatch report field count: %d", typeOfReport.NumField())
	}
	for index := 0; index < typeOfReport.NumField(); index++ {
		name := typeOfReport.Field(index).Name
		if _, ok := allowed[name]; !ok {
			t.Fatalf("unsafe or unreviewed dispatch report field: %s", name)
		}
	}
}
