// Package rates fetches and caches the live TON/USD price used to value Stars
// deposits. Stars are USD-pegged (~$0.013/star on withdrawal); the TON we credit
// floats with TON's market price, so we need a fresh quote at deposit time.
package rates

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"
)

const (
	coingeckoURL = "https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd"
	cacheTTL     = 5 * time.Minute
)

// Provider caches the TON/USD price and refreshes it on demand.
type Provider struct {
	http     *http.Client
	fallback float64 // used only until the first successful fetch

	mu        sync.Mutex
	price     float64
	fetchedAt time.Time
}

// New returns a provider. fallback is the TON/USD price used only if no live price
// has ever been fetched (cold start with the rate API down) — pick a conservative
// (high) value so a cold-start deposit under-credits rather than over-credits.
func New(fallback float64) *Provider {
	return &Provider{http: &http.Client{Timeout: 8 * time.Second}, fallback: fallback}
}

// TonUSD returns the TON price in USD, refreshing from CoinGecko if the cache is
// stale. On fetch failure it falls back to the last known price (even if stale),
// or the configured fallback if nothing was ever fetched — a deposit must never
// fail on a transient rate-API hiccup.
func (p *Provider) TonUSD(ctx context.Context) float64 {
	p.mu.Lock()
	price, fetchedAt := p.price, p.fetchedAt
	p.mu.Unlock()

	if price > 0 && time.Since(fetchedAt) < cacheTTL {
		return price
	}

	fresh, err := p.fetch(ctx)
	if err != nil || fresh <= 0 {
		if price > 0 {
			return price // stale, but better than failing the deposit
		}
		return p.fallback
	}

	p.mu.Lock()
	p.price = fresh
	p.fetchedAt = time.Now()
	p.mu.Unlock()
	return fresh
}

func (p *Provider) fetch(ctx context.Context) (float64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, coingeckoURL, nil)
	if err != nil {
		return 0, err
	}
	resp, err := p.http.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("rates: coingecko status %d", resp.StatusCode)
	}
	var body struct {
		TON struct {
			USD float64 `json:"usd"`
		} `json:"the-open-network"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return 0, err
	}
	if body.TON.USD <= 0 {
		return 0, errors.New("rates: coingecko returned non-positive TON price")
	}
	return body.TON.USD, nil
}
