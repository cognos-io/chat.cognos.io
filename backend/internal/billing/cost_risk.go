package billing

import (
	"math"
	"sort"
	"time"

	"github.com/pocketbase/dbx"
)

// DefaultModelCostAlertRappen is the rolling-30-day Provider cost at which a
// single Model is surfaced to operators. It is an alert, never an automatic
// disable: disabling a Model is a deliberate incident or commercial decision.
const DefaultModelCostAlertRappen = 5_000

// DefaultFairUseShutdownReviewRappen is the rolling-30-day Provider cost at
// which an Unlimited Account requires an immediate human decision on pausing
// further Completions. It is deliberately 3x the CHF 150 monthly price. The
// job alerts only; it does not silently change Account access.
const DefaultFairUseShutdownReviewRappen = 45_000

type CostRiskLevel string

const (
	CostRiskNormal         CostRiskLevel = "normal"
	CostRiskReview         CostRiskLevel = "review"
	CostRiskShutdownReview CostRiskLevel = "shutdown_review"
)

// CostPercentiles reports nearest-rank percentiles of rolling Provider COGS
// per Account. Provider costs are used rather than Account-facing prices so
// the distribution remains meaningful across Plans.
type CostPercentiles struct {
	P50Rappen int64
	P90Rappen int64
	P95Rappen int64
	P99Rappen int64
}

// AccountModelCost is the content-free ledger aggregate used to build the
// commercial cost report. One row represents an Account, Model and Plan.
type AccountModelCost struct {
	UserID                  string
	ModelID                 string
	PlanType                PlanType
	RequestCount            int64
	ProviderCostMicroRappen int64
	UserCostMicroRappen     int64
}

// ModelCostProfile is the rolling COGS and PAYG unit-economics view for one
// Model. PAYGRevenue deliberately excludes Trial and Unlimited shadow prices:
// those are not revenue. It also excludes the monthly minimum, Paddle fees,
// refunds and tax, so it is a ledger contribution margin rather than final
// company gross margin.
type ModelCostProfile struct {
	ModelID               string
	RequestCount          int64
	ProviderCostRappen    int64
	PAYGRevenueRappen     int64
	PAYGGrossProfitRappen int64
	PAYGGrossMarginBPS    int64
	AccountProviderCost   CostPercentiles
}

type CostRiskReport struct {
	AccountProviderCost CostPercentiles
	Models              []ModelCostProfile
}

// CostRiskSince aggregates the content-free usage ledger by Account, Model and
// Plan. BuildCostRiskReport removes Account identifiers before anything is
// logged by the nightly job.
func (r *PocketBaseRepo) CostRiskSince(since time.Time) (CostRiskReport, error) {
	type row struct {
		UserID       string `db:"user_id"`
		ModelID      string `db:"model_id"`
		PlanType     string `db:"plan_type"`
		RequestCount int64  `db:"request_count"`
		ProviderCost int64  `db:"provider_cost"`
		UserCost     int64  `db:"user_cost"`
	}

	var rows []row
	err := r.app.DB().NewQuery(`
		SELECT user_id,
		       model_id,
		       plan_type,
		       COUNT(*) AS request_count,
		       COALESCE(SUM(provider_cost_microrappen), 0) AS provider_cost,
		       COALESCE(SUM(user_cost_microrappen), 0) AS user_cost
		FROM ` + balanceTransactionsCollectionName + `
		WHERE type = {:type}
		  AND occurred_at >= {:since}
		GROUP BY user_id, model_id, plan_type
	`).Bind(dbx.Params{
		"type":  UsageTransactionType,
		"since": since.UTC().Format(pbDateLayout),
	}).All(&rows)
	if err != nil {
		return CostRiskReport{}, err
	}

	costs := make([]AccountModelCost, 0, len(rows))
	for _, row := range rows {
		costs = append(costs, AccountModelCost{
			UserID:                  row.UserID,
			ModelID:                 row.ModelID,
			PlanType:                PlanType(row.PlanType),
			RequestCount:            row.RequestCount,
			ProviderCostMicroRappen: row.ProviderCost,
			UserCostMicroRappen:     row.UserCost,
		})
	}
	return BuildCostRiskReport(costs), nil
}

func BuildCostRiskReport(costs []AccountModelCost) CostRiskReport {
	type modelAggregate struct {
		requestCount       int64
		providerCost       int64
		paygRevenue        int64
		paygProviderCost   int64
		providerCostByUser map[string]int64
	}

	providerCostByUser := make(map[string]int64)
	models := make(map[string]*modelAggregate)
	for _, cost := range costs {
		providerCostByUser[cost.UserID] += cost.ProviderCostMicroRappen

		model := models[cost.ModelID]
		if model == nil {
			model = &modelAggregate{providerCostByUser: make(map[string]int64)}
			models[cost.ModelID] = model
		}
		model.requestCount += cost.RequestCount
		model.providerCost += cost.ProviderCostMicroRappen
		model.providerCostByUser[cost.UserID] += cost.ProviderCostMicroRappen
		if cost.PlanType == PlanTypePayG {
			model.paygRevenue += cost.UserCostMicroRappen
			model.paygProviderCost += cost.ProviderCostMicroRappen
		}
	}

	report := CostRiskReport{
		AccountProviderCost: percentilesFromMicroRappen(mapValues(providerCostByUser)),
		Models:              make([]ModelCostProfile, 0, len(models)),
	}
	for modelID, aggregate := range models {
		paygProfit := aggregate.paygRevenue - aggregate.paygProviderCost
		var grossMarginBPS int64
		if aggregate.paygRevenue > 0 {
			grossMarginBPS = int64(math.Round(
				float64(paygProfit) / float64(aggregate.paygRevenue) * 10_000,
			))
		}
		report.Models = append(report.Models, ModelCostProfile{
			ModelID:               modelID,
			RequestCount:          aggregate.requestCount,
			ProviderCostRappen:    CeilRappenFromMicro(aggregate.providerCost),
			PAYGRevenueRappen:     roundRappenFromMicro(aggregate.paygRevenue),
			PAYGGrossProfitRappen: roundRappenFromMicro(paygProfit),
			PAYGGrossMarginBPS:    grossMarginBPS,
			AccountProviderCost:   percentilesFromMicroRappen(mapValues(aggregate.providerCostByUser)),
		})
	}
	sort.Slice(report.Models, func(i, j int) bool {
		if report.Models[i].ProviderCostRappen == report.Models[j].ProviderCostRappen {
			return report.Models[i].ModelID < report.Models[j].ModelID
		}
		return report.Models[i].ProviderCostRappen > report.Models[j].ProviderCostRappen
	})
	return report
}

func ClassifyCostRisk(rollingCostRappen, reviewRappen, shutdownReviewRappen int64) CostRiskLevel {
	if shutdownReviewRappen > 0 && rollingCostRappen >= shutdownReviewRappen {
		return CostRiskShutdownReview
	}
	if reviewRappen > 0 && rollingCostRappen >= reviewRappen {
		return CostRiskReview
	}
	return CostRiskNormal
}

func percentilesFromMicroRappen(values []int64) CostPercentiles {
	if len(values) == 0 {
		return CostPercentiles{}
	}
	rappen := make([]int64, len(values))
	for i, value := range values {
		rappen[i] = CeilRappenFromMicro(value)
	}
	sort.Slice(rappen, func(i, j int) bool { return rappen[i] < rappen[j] })
	return CostPercentiles{
		P50Rappen: nearestRank(rappen, 50),
		P90Rappen: nearestRank(rappen, 90),
		P95Rappen: nearestRank(rappen, 95),
		P99Rappen: nearestRank(rappen, 99),
	}
}

func nearestRank(sorted []int64, percentile int) int64 {
	if len(sorted) == 0 {
		return 0
	}
	rank := int(math.Ceil(float64(percentile) / 100 * float64(len(sorted))))
	if rank < 1 {
		rank = 1
	}
	if rank > len(sorted) {
		rank = len(sorted)
	}
	return sorted[rank-1]
}

func mapValues(values map[string]int64) []int64 {
	result := make([]int64, 0, len(values))
	for _, value := range values {
		result = append(result, value)
	}
	return result
}

func roundRappenFromMicro(microRappen int64) int64 {
	return int64(math.Round(float64(microRappen) / MicroRappenPerRappen))
}
