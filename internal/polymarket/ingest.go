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
func Ingest(ctx context.Context, pool *pgxpool.Pool, limit int, edge, maxProb, minVol24h float64) (int, error) {
	mkts, err := FetchMarkets(ctx, limit)
	if err != nil {
		return 0, err
	}

	active := make([]string, 0, len(mkts))
	count := 0
	for _, pm := range mkts {
		if pm.Closed || pm.Archived || !pm.Active || !pm.EnableOrderBook {
			continue
		}
		// Только рынки, где реально торгуют сейчас — свежая, надёжная цена для дома.
		if minVol24h > 0 && pm.Volume24hr < minVol24h {
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

		img := pm.Image
		if img == "" {
			img = pm.Icon
		}
		// Категоризуем по тайтлу + названию/slug события: тайтлы матчей («Japan vs.
		// Sweden») сами не содержат «world cup», а событие — содержит.
		catText := pm.Question
		if len(pm.Events) > 0 {
			catText += " " + pm.Events[0].Title + " " + pm.Events[0].Slug
		}
		if err := markets.UpsertExternal(ctx, pool, "polymarket", pm.ConditionID, pm.Question, categorize(catText, pm.Tags), pm.EndTime(),
			markets.ExternalMeta{
				ImageURL:    img,
				Volume24h:   pm.Volume24hr,
				Description: pm.Description,
				Context:     pm.Context(),
				GameStart:   pm.GameStart(),
			}, outs); err != nil {
			log.Printf("polymarket ingest upsert %s: %v", pm.ConditionID, err)
			continue
		}
		active = append(active, pm.ConditionID)
		count++
	}

	// Закрываем рынки, выпавшие из выборки (объём упал ниже порога / закрылись на
	// Polymarket): иначе зомби-рынок висит OPEN с устаревшей ценой — риск снайпинга.
	// Только если выборка непустая (иначе сетевой сбой закрыл бы всё).
	if len(active) > 0 {
		if n, err := markets.CloseStaleExternal(ctx, pool, "polymarket", active); err != nil {
			log.Printf("polymarket close stale: %v", err)
		} else if n > 0 {
			log.Printf("polymarket: closed %d stale markets", n)
		}
	}

	return count, nil
}

// categorize buckets a market into one of our client-side filters (sports /
// politics / crypto / economy / other). Polymarket's own tags (when present) are
// far more reliable than guessing from the question, so we try them first and fall
// back to the keyword heuristic only for markets that arrive without useful tags.
func categorize(text string, tags []Tag) string {
	if c, ok := categorizeByTags(tags); ok {
		return c
	}
	return categorizeByText(text)
}

// categorizeByTags maps Polymarket's category tags to our buckets. ok is false when
// no tag matches (caller falls back to the text heuristic).
//
// Priority matters and is deliberate: crypto and sports are checked first because
// their tags are specific and unambiguous — this also shields against substring
// false positives where a *team* name contains a category word ("Warriors"→war,
// "Oilers"→oil, "Federer"→fed): those markets carry a Sports tag and resolve to
// sports before the politics/economy checks ever run. Geopolitics outranks economy
// so Iran/Hormuz markets (often tagged both) land in politics, not economy.
func categorizeByTags(tags []Tag) (string, bool) {
	if len(tags) == 0 {
		return "", false
	}
	var b strings.Builder
	for _, t := range tags {
		b.WriteString(strings.ToLower(t.Label))
		b.WriteByte('|')
		b.WriteString(strings.ToLower(t.Slug))
		b.WriteByte('|')
	}
	s := b.String()
	has := func(subs ...string) bool {
		for _, sub := range subs {
			if strings.Contains(s, sub) {
				return true
			}
		}
		return false
	}
	switch {
	case has("crypto", "bitcoin", "ethereum", "solana", "dogecoin", "altcoin", "stablecoin", "xrp"):
		return "crypto", true
	case has("sports", "soccer", "football", "fifa", "tennis", "esports", "dota", "basketball",
		"nba", "nfl", "mlb", "nhl", "ufc", "boxing", "formula 1", "cricket", "golf", "olympic", "nascar", "hockey", "baseball"):
		return "sports", true
	case has("tweet market", "mentions"): // tweet-count / mention trackers → "other", not politics
		return "other", true
	// Macro-specific economy tags outrank politics: Polymarket also slaps a broad
	// "Politics" tag on Fed/FOMC markets, so without this they'd misfile as politics.
	// Only *specific* macro signals here (not broad "Economy"/"Oil") — those also
	// appear on Hormuz/oil geopolitics, which must stay politics (handled below).
	case has("fomc", "fed rate", "jerome powell", "economic policy", "inflation", "recession",
		"interest rate", "tariff", "gdp", "unemployment", "jobs report"):
		return "economy", true
	case has("politic", "geopolitic", "election", "iran", "israel", "ukrain", "russia", "middle east",
		"hormuz", "khamenei", "trump", "putin", "war", "nuclear", "peace deal", "ceasefire", "regime",
		"senate", "congress", "parliament", "government shutdown"):
		return "politics", true
	// Broad economy/commodity tags last: oil/commodity markets without a geopolitics
	// angle land here.
	case has("econom", "commodit", "oil", "nymex"):
		return "economy", true
	}
	return "", false
}

// categorizeByText is the fallback keyword heuristic over the question + event text,
// used only when a market arrives without tags we recognize.
func categorizeByText(text string) string {
	q := strings.ToLower(text)
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
	case has("world cup", "fifa", "nba", "nfl", "super bowl", "champions league", "premier league", "la liga", "uefa", "olympic", "tennis", "grand prix", " f1 ", "playoff", "finals", "ufc", "boxing", "cricket", "super cup", "ballon", "soccer", "nhl", "mlb"):
		return "sports"
	case has("election", "president", "nomination", "senate", "governor", "congress", "democrat", "republican", "trump", "biden", "vance", "newsom", "mamdani", "prime minister", "parliament", "vote", "ballot", "poll", "approval rating", "cabinet", "resign"):
		return "politics"
	case has("fed", "interest rate", "inflation", "recession", "gdp", "s&p", "nasdaq", "stock", "earnings", "unemployment", "jobs report", "tariff"):
		return "economy"
	// Спорт-паттерны ставок — ПОСЛЕ политики/экономики, чтобы напр. «…win on 20XX» в
	// политическом рынке не утянуло в спорт. Ловят матчи без явного вида спорта в
	// тайтле: «Japan vs. Sweden», «Spread: …», «… win on 2026-…», «O/U 2.5».
	case has("vs.", " vs ", "o/u", "spread:", "moneyline", " win on 20", "in a draw", "to advance", "to qualify"):
		return "sports"
	default:
		return "other"
	}
}
