// Package polymarket ingests real prediction markets from Polymarket's public
// Gamma API and mirrors them into our markets/outcomes tables. Polymarket is the
// source of events, outcomes, and implied probabilities only — we compute our own
// odds (with a house edge) from those probabilities.
package polymarket

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

const gammaBase = "https://gamma-api.polymarket.com"

// Market is the subset of a Gamma API market we use.
type Market struct {
	ID              string  `json:"id"`
	Question        string  `json:"question"`
	ConditionID     string  `json:"conditionId"`
	Slug            string  `json:"slug"`
	EndDate         string  `json:"endDate"`
	Outcomes        string  `json:"outcomes"`      // JSON array string, e.g. "[\"Yes\",\"No\"]"
	OutcomePrices   string  `json:"outcomePrices"` // JSON array string, e.g. "[\"0.65\",\"0.35\"]"
	Active          bool    `json:"active"`
	Closed          bool    `json:"closed"`
	Archived        bool    `json:"archived"`
	EnableOrderBook bool    `json:"enableOrderBook"`
	VolumeNum       float64 `json:"volumeNum"`     // lifetime volume
	Volume24hr      float64 `json:"volume24hr"`    // last-24h volume — "active right now"
	LiquidityNum    float64 `json:"liquidityNum"`  // current order-book depth
	Image           string  `json:"image"`         // event image URL (often team/country specific)
	Icon            string  `json:"icon"`          // icon URL (usually same as image)
	Description     string  `json:"description"`   // resolution criteria
	GameStartTime   string  `json:"gameStartTime"` // scheduled match kickoff (sports)
	// The market's events[] carry the human-readable preview under
	// eventMetadata.context_description (NOT at the market top level — that nesting
	// fooled an earlier top-level field). title/slug also help categorize matches.
	Events []struct {
		Title         string `json:"title"`
		Slug          string `json:"slug"`
		EventMetadata struct {
			ContextDescription string `json:"context_description"`
		} `json:"eventMetadata"`
	} `json:"events"`
	// Tags are Polymarket's own category labels (Politics, Geopolitics, Crypto,
	// Sports, Economy, Iran, …), returned only with &include_tag=true. They drive
	// categorization far better than keyword-guessing the question. See categorize.
	Tags []Tag `json:"tags"`
}

// Tag is a Polymarket category label attached to a market.
type Tag struct {
	Label string `json:"label"`
	Slug  string `json:"slug"`
}

// ParsedOutcomes decodes the outcome names and their implied probabilities, which
// the Gamma API encodes as JSON-array *strings*. Returns matching-length slices.
func (m Market) ParsedOutcomes() ([]string, []float64, error) {
	var names []string
	if err := json.Unmarshal([]byte(m.Outcomes), &names); err != nil {
		return nil, nil, fmt.Errorf("outcomes: %w", err)
	}
	var priceStrs []string
	if err := json.Unmarshal([]byte(m.OutcomePrices), &priceStrs); err != nil {
		return nil, nil, fmt.Errorf("outcomePrices: %w", err)
	}
	if len(names) != len(priceStrs) {
		return nil, nil, fmt.Errorf("outcomes/prices length mismatch: %d vs %d", len(names), len(priceStrs))
	}
	prices := make([]float64, len(priceStrs))
	for i, s := range priceStrs {
		p, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return nil, nil, fmt.Errorf("price %q: %w", s, err)
		}
		prices[i] = p
	}
	return names, prices, nil
}

// EndTime parses the market's close time, or nil if absent/unparseable.
func (m Market) EndTime() *time.Time {
	if m.EndDate == "" {
		return nil
	}
	t, err := time.Parse(time.RFC3339, m.EndDate)
	if err != nil {
		return nil
	}
	return &t
}

// GameStart parses the scheduled match kickoff (Gamma sends e.g.
// "2026-06-25 20:00:00+00", not RFC3339), or nil if absent/unparseable.
func (m Market) GameStart() *time.Time {
	if m.GameStartTime == "" {
		return nil
	}
	for _, layout := range []string{"2006-01-02 15:04:05-07", "2006-01-02 15:04:05Z07:00", time.RFC3339} {
		if t, err := time.Parse(layout, m.GameStartTime); err == nil {
			return &t
		}
	}
	return nil
}

// Context returns the human-readable match preview carried by the market's event
// (events[].eventMetadata.context_description), or "" if absent.
func (m Market) Context() string {
	if len(m.Events) > 0 {
		return m.Events[0].EventMetadata.ContextDescription
	}
	return ""
}

// gammaPageSize is the Gamma API's hard per-request cap (it ignores larger limits).
const gammaPageSize = 100

// FetchMarkets returns up to limit active, open markets ordered by volume,
// paginating the Gamma API (capped at 100 per request) via offset.
func FetchMarkets(ctx context.Context, limit int) ([]Market, error) {
	var all []Market
	for offset := 0; offset < limit; offset += gammaPageSize {
		page, err := fetchPage(ctx, gammaPageSize, offset)
		if err != nil {
			if len(all) > 0 {
				break // keep the partial result rather than failing the whole ingest
			}
			return nil, err
		}
		all = append(all, page...)
		if len(page) < gammaPageSize {
			break // reached the end of the list
		}
	}
	return all, nil
}

func fetchPage(ctx context.Context, limit, offset int) ([]Market, error) {
	url := fmt.Sprintf(
		"%s/markets?closed=false&active=true&archived=false&limit=%d&offset=%d&order=volumeNum&ascending=false&include_tag=true",
		gammaBase, limit, offset)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("polymarket: gamma status %d", resp.StatusCode)
	}
	var out []Market
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("polymarket: decode markets: %w", err)
	}
	return out, nil
}

// FetchMarketByCondition fetches a single market by its conditionId (our source_id).
// Returns ok=false if Polymarket returns no such market.
func FetchMarketByCondition(ctx context.Context, conditionID string) (Market, bool, error) {
	url := fmt.Sprintf("%s/markets?condition_ids=%s", gammaBase, conditionID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return Market{}, false, err
	}
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return Market{}, false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Market{}, false, fmt.Errorf("polymarket: gamma status %d", resp.StatusCode)
	}
	var out []Market
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return Market{}, false, err
	}
	if len(out) == 0 {
		return Market{}, false, nil
	}
	return out[0], true, nil
}
