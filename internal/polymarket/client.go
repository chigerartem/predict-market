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
	VolumeNum       float64 `json:"volumeNum"`
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

// FetchMarkets returns up to limit active, open markets ordered by volume.
func FetchMarkets(ctx context.Context, limit int) ([]Market, error) {
	url := fmt.Sprintf(
		"%s/markets?closed=false&active=true&archived=false&limit=%d&order=volumeNum&ascending=false",
		gammaBase, limit)
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
