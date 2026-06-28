package polymarket

import "testing"

func tags(labels ...string) []Tag {
	out := make([]Tag, len(labels))
	for i, l := range labels {
		out[i] = Tag{Label: l}
	}
	return out
}

func TestCategorizeByTags(t *testing.T) {
	cases := []struct {
		name string
		tags []string
		want string
	}{
		// Geopolitics — the bug the user hit: these landed in "other" before.
		{"iran-enter", []string{"Politics", "Iran", "Geopolitics", "Middle East", "U.S. x Iran"}, "politics"},
		{"hormuz-60-ships", []string{"Oil", "Iran", "Trump", "Hormuz", "Geopolitics", "Strait of Hormuz"}, "politics"},
		{"us-iran-nuclear", []string{"Iran", "US-Iran", "Peace Deal", "Geopolitics", "Middle East", "Iran Ceasefire"}, "politics"},
		{"iran-regime-fall", []string{"Politics", "Iran", "Middle East", "Israel", "Geopolitics", "Khamenei"}, "politics"},
		// Politics ∩ Economy (Hormuz oil) must resolve to politics, not economy.
		{"hormuz-traffic-economy", []string{"transit", "Economy", "Macro Geopolitics", "Hormuz", "Oil", "ships", "Iran", "Strait of Hormuz"}, "politics"},

		// Sports stays sports — even when the question names Iran (the country isn't tagged).
		{"iran-world-cup", []string{"Sports", "Soccer", "FIFA World Cup", "2026 FIFA World Cup"}, "sports"},
		// Substring guards: team names containing category words must not leak out of sports.
		{"warriors-not-war", []string{"Golden State Warriors", "NBA", "Sports"}, "sports"},
		{"oilers-not-oil", []string{"Edmonton Oilers", "NHL", "Hockey", "Sports"}, "sports"},

		{"crypto", []string{"Crypto", "Bitcoin"}, "crypto"},
		{"economy-fed", []string{"Economy", "Fed", "FOMC", "Jerome Powell"}, "economy"},
		// Fed markets are ALSO tagged "Politics" by Polymarket — macro signals must win.
		{"fed-rates-also-politics", []string{"Politics", "Fed", "Fed Rates", "Economy", "fomc", "Jerome Powell", "Economic Policy"}, "economy"},
		// Pure oil/commodity with no geopolitics angle → economy (broad, checked last).
		{"oil-commodity", []string{"Oil", "Commodities", "NYMEX Crude Oil Futures"}, "economy"},
		// Tweet-count / mention trackers are "other", not politics, even when tagged Politics.
		{"musk-tweets", []string{"Culture", "Politics", "Tweet Markets"}, "other"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := categorize("", tags(c.tags...)); got != c.want {
				t.Errorf("categorize(%v) = %q, want %q", c.tags, got, c.want)
			}
		})
	}
}

func TestCategorizeFallsBackToText(t *testing.T) {
	// No usable tags → keyword heuristic over the question text.
	if got := categorize("Bitcoin above $150k by year end", nil); got != "crypto" {
		t.Errorf("text fallback crypto = %q", got)
	}
	if got := categorize("Will the Fed cut the interest rate in July?", tags("Recurring", "Weekly")); got != "economy" {
		t.Errorf("text fallback economy = %q", got)
	}
	if got := categorize("Some unclassifiable question", nil); got != "other" {
		t.Errorf("unmatched = %q, want other", got)
	}
}
