package provider

import (
	"math/big"
	"sort"
	"strconv"
)

const (
	RoutingCostReconciliationSchemaVersion uint32 = 1
	MaxRoutingCostReconciliationIssues            = 256
)

type RoutingCostReconciliationStatus string

const (
	RoutingCostReconciliationConsistent   RoutingCostReconciliationStatus = "consistent"
	RoutingCostReconciliationInconsistent RoutingCostReconciliationStatus = "inconsistent"
)

// RoutingCostReconciliationIssue is intentionally content-safe. Expected and
// observed values contain only operational counters/rates/states or provider
// identifiers; no request, tenant, transcript, audio, credential, or payment
// content is accepted by this type.
type RoutingCostReconciliationIssue struct {
	Code       string `json:"code"`
	ProviderID string `json:"provider_id,omitempty"`
	Expected   string `json:"expected,omitempty"`
	Observed   string `json:"observed,omitempty"`
}

// RoutingCostReconciliation validates that a reported operational cost summary
// still matches its routing-metrics source. It is an integrity check for
// estimated provider rates, not an accrued-spend or billing-ledger result.
type RoutingCostReconciliation struct {
	SchemaVersion   uint32                           `json:"schema_version"`
	Status          RoutingCostReconciliationStatus `json:"status"`
	TotalIssueCount uint32                           `json:"total_issue_count"`
	Truncated       bool                             `json:"truncated"`
	Issues          []RoutingCostReconciliationIssue `json:"issues"`
}

func ReconcileRoutingCostControl(
	snapshot RoutingMetricsSnapshot,
	reported RoutingCostControlSummary,
) RoutingCostReconciliation {
	result := RoutingCostReconciliation{
		SchemaVersion: RoutingCostReconciliationSchemaVersion,
		Status:        RoutingCostReconciliationConsistent,
		Issues:        make([]RoutingCostReconciliationIssue, 0),
	}
	addIssue := func(issue RoutingCostReconciliationIssue) {
		result.Status = RoutingCostReconciliationInconsistent
		result.TotalIssueCount = saturatedIncrementUint32(result.TotalIssueCount)
		if len(result.Issues) < MaxRoutingCostReconciliationIssues {
			result.Issues = append(result.Issues, issue)
		} else {
			result.Truncated = true
		}
	}

	providerIDs := make([]string, 0, len(snapshot.ByProvider))
	for providerID := range snapshot.ByProvider {
		providerIDs = append(providerIDs, providerID)
	}
	sort.Strings(providerIDs)

	selectionSum := new(big.Int)
	for _, providerID := range providerIDs {
		metrics := snapshot.ByProvider[providerID]
		selectionSum.Add(selectionSum, new(big.Int).SetUint64(metrics.SelectionCount))
		if metrics.ProviderID != providerID {
			addIssue(RoutingCostReconciliationIssue{
				Code:       "snapshot.provider_id_mismatch",
				ProviderID: providerID,
				Expected:   providerID,
				Observed:   metrics.ProviderID,
			})
		}
		if metrics.CostMicrounitsPerMinute < 0 {
			addIssue(RoutingCostReconciliationIssue{
				Code:       "snapshot.cost_rate_invalid",
				ProviderID: providerID,
				Expected:   ">=0",
				Observed:   strconv.FormatInt(metrics.CostMicrounitsPerMinute, 10),
			})
		}
	}
	if selectionSum.Cmp(new(big.Int).SetUint64(snapshot.TotalSelections)) != 0 {
		addIssue(RoutingCostReconciliationIssue{
			Code:     "snapshot.selection_total_mismatch",
			Expected: strconv.FormatUint(snapshot.TotalSelections, 10),
			Observed: selectionSum.String(),
		})
	}

	expected := BuildRoutingCostControlSummary(snapshot)
	compareUint64 := func(code string, expectedValue uint64, observedValue uint64) {
		if expectedValue != observedValue {
			addIssue(RoutingCostReconciliationIssue{
				Code:     code,
				Expected: strconv.FormatUint(expectedValue, 10),
				Observed: strconv.FormatUint(observedValue, 10),
			})
		}
	}
	compareUint32 := func(code string, expectedValue uint32, observedValue uint32) {
		if expectedValue != observedValue {
			addIssue(RoutingCostReconciliationIssue{
				Code:     code,
				Expected: strconv.FormatUint(uint64(expectedValue), 10),
				Observed: strconv.FormatUint(uint64(observedValue), 10),
			})
		}
	}
	compareInt64 := func(code string, expectedValue int64, observedValue int64) {
		if expectedValue != observedValue {
			addIssue(RoutingCostReconciliationIssue{
				Code:     code,
				Expected: strconv.FormatInt(expectedValue, 10),
				Observed: strconv.FormatInt(observedValue, 10),
			})
		}
	}

	compareUint64("summary.total_selections_mismatch", expected.TotalSelections, reported.TotalSelections)
	compareUint64("summary.no_eligible_count_mismatch", expected.NoEligibleCount, reported.NoEligibleCount)
	compareUint32("summary.no_eligible_basis_points_mismatch", expected.NoEligibleBasisPoints, reported.NoEligibleBasisPoints)
	compareInt64(
		"summary.average_cost_mismatch",
		expected.AverageSelectedCostMicrounitsPerMinute,
		reported.AverageSelectedCostMicrounitsPerMinute,
	)

	expectedByProvider := make(map[string]ProviderCostControl, len(expected.ByProvider))
	for _, provider := range expected.ByProvider {
		expectedByProvider[provider.ProviderID] = provider
	}

	reportedByProvider := make(map[string]ProviderCostControl, len(reported.ByProvider))
	reportedProviderCounts := make(map[string]uint64, len(reported.ByProvider))
	for _, provider := range reported.ByProvider {
		reportedProviderCounts[provider.ProviderID]++
		if _, exists := reportedByProvider[provider.ProviderID]; !exists {
			reportedByProvider[provider.ProviderID] = provider
		}
	}

	reportedIDs := make([]string, 0, len(reportedProviderCounts))
	for providerID := range reportedProviderCounts {
		reportedIDs = append(reportedIDs, providerID)
	}
	sort.Strings(reportedIDs)
	for _, providerID := range reportedIDs {
		count := reportedProviderCounts[providerID]
		if count > 1 {
			addIssue(RoutingCostReconciliationIssue{
				Code:       "summary.provider_duplicate",
				ProviderID: providerID,
				Expected:   "1",
				Observed:   strconv.FormatUint(count, 10),
			})
		}
		if _, exists := expectedByProvider[providerID]; !exists {
			addIssue(RoutingCostReconciliationIssue{
				Code:       "summary.provider_unexpected",
				ProviderID: providerID,
				Expected:   "absent",
				Observed:   "present",
			})
		}
	}

	for _, expectedProvider := range expected.ByProvider {
		providerID := expectedProvider.ProviderID
		observedProvider, exists := reportedByProvider[providerID]
		if !exists {
			addIssue(RoutingCostReconciliationIssue{
				Code:       "summary.provider_missing",
				ProviderID: providerID,
				Expected:   "present",
				Observed:   "absent",
			})
			continue
		}
		compareProviderCostControl(expectedProvider, observedProvider, addIssue)
	}

	return result
}

func compareProviderCostControl(
	expected ProviderCostControl,
	observed ProviderCostControl,
	addIssue func(RoutingCostReconciliationIssue),
) {
	providerID := expected.ProviderID
	compare := func(code string, expectedValue string, observedValue string) {
		if expectedValue != observedValue {
			addIssue(RoutingCostReconciliationIssue{
				Code:       code,
				ProviderID: providerID,
				Expected:   expectedValue,
				Observed:   observedValue,
			})
		}
	}

	compare(
		"summary.provider_selection_count_mismatch",
		strconv.FormatUint(expected.SelectionCount, 10),
		strconv.FormatUint(observed.SelectionCount, 10),
	)
	compare(
		"summary.provider_selection_share_mismatch",
		strconv.FormatUint(uint64(expected.SelectionShareBasisPoints), 10),
		strconv.FormatUint(uint64(observed.SelectionShareBasisPoints), 10),
	)
	compare(
		"summary.provider_cost_rate_mismatch",
		strconv.FormatInt(expected.CostMicrounitsPerMinute, 10),
		strconv.FormatInt(observed.CostMicrounitsPerMinute, 10),
	)
	compare(
		"summary.provider_weighted_contribution_mismatch",
		strconv.FormatInt(expected.WeightedCostContributionMicrounits, 10),
		strconv.FormatInt(observed.WeightedCostContributionMicrounits, 10),
	)
	compare(
		"summary.provider_latency_p95_mismatch",
		strconv.Itoa(expected.LatencyP95Milliseconds),
		strconv.Itoa(observed.LatencyP95Milliseconds),
	)
	compare("summary.provider_health_mismatch", string(expected.Health), string(observed.Health))
	compare("summary.provider_rate_limit_mismatch", string(expected.RateLimit), string(observed.RateLimit))
}
