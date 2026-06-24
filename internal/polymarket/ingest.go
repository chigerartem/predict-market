package polymarket

import (
	"context"
	"log"
	"math"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"predict/internal/markets"
)

// oddsFromProb turns an implied probability into our decimal odds (×1000),
// shaving the house edge off the profit part so odds never drop to/below 1.0:
//
//	our = 1 + (1/p − 1) × (1 − edge)
//
// Clamped to [1.01, 100.0] to satisfy the odds_milli > 1000 DB constraint and to
// avoid absurd payouts on near-certain outcomes.
func oddsFromProb(p, edge float64) int64 {
	if p <= 0 || p >= 1 {
		return 0 // caller skips
	}
	our := 1 + (1/p-1)*(1-edge)
	milli := int64(math.Round(our * 1000))
	if milli < 1010 {
		milli = 1010
	}
	if milli > 100_000 {
		milli = 100_000
	}
	return milli
}

// Ingest fetches the top markets from Polymarket and upserts them into our DB,
// computing our odds from Polymarket's implied probabilities with the given house
// edge. Returns how many markets were imported/updated. Best-effort per market: a
// bad row is skipped, not fatal.
func Ingest(ctx context.Context, pool *pgxpool.Pool, limit int, edge, maxProb float64) (int, error) {
	mkts, err := FetchMarkets(ctx, limit)
	if err != nil {
		return 0, err
	}

	count := 0
	for _, pm := range mkts {
		if pm.Closed || pm.Archived || !pm.Active || !pm.EnableOrderBook {
			continue
		}
		names, prices, err := pm.ParsedOutcomes()
		if err != nil || len(names) < 2 {
			continue
		}

		// Skip degenerate markets (one outcome already ~certain) — no betting interest.
		maxP := 0.0
		for _, p := range prices {
			if p > maxP {
				maxP = p
			}
		}
		if maxProb > 0 && maxP > maxProb {
			continue
		}

		outs := make([]markets.OutcomeInput, 0, len(names))
		ok := true
		for i, name := range names {
			milli := oddsFromProb(prices[i], edge)
			if milli == 0 {
				ok = false
				break
			}
			outs = append(outs, markets.OutcomeInput{Title: name, OddsMilli: milli})
		}
		if !ok {
			continue
		}

		if err := markets.UpsertExternal(ctx, pool, "polymarket", pm.ConditionID, pm.Question, categorize(pm.Question), pm.EndTime(), outs); err != nil {
			log.Printf("polymarket ingest upsert %s: %v", pm.ConditionID, err)
			continue
		}
		count++
	}
	return count, nil
}

// categorize buckets a market by keywords in its question. Polymarket's API gives
// no clean per-market category, so we infer one for filtering on the client.
func categorize(question string) string {
	q := strings.ToLower(question)
	has := func(words ...string) bool {
		for _, w := range words {
			if strings.Contains(q, w) {
				return true
			}
		}
		return false
	}
	switch {
	case has("bitcoin", "btc", "ethereum", " eth", "crypto", "solana", " sol ", "dogecoin", " xrp", "stablecoin", "altcoin"):
		return "crypto"
	case has("world cup", "fifa", "nba", "nfl", "super bowl", "champions league", "premier league", "la liga", "uefa", "olympic", "tennis", "grand prix", " f1 ", "playoff", "finals", "ufc", "boxing", "cricket", "super cup", "ballon"):
		return "sports"
	case has("election", "president", "nomination", "senate", "governor", "congress", "democrat", "republican", "trump", "biden", "vance", "newsom", "mamdani", "prime minister", "parliament", "vote", "ballot", "poll", "approval rating", "cabinet", "resign"):
		return "politics"
	case has("fed", "interest rate", "inflation", "recession", "gdp", "s&p", "nasdaq", "stock", "earnings", "unemployment", "jobs report", "tariff"):
		return "economy"
	default:
		return "other"
	}
}
