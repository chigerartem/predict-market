package casegame

import (
	"math"
	"testing"
)

// TestPrizeTable pins the economics: weights sum to TotalWeight and the table's exact
// RTP is 90% (house edge 10%). If someone re-tunes the weights, this is the canary.
func TestPrizeTable(t *testing.T) {
	var totalW, weightedMilli int64
	for _, p := range Prizes {
		if p.Weight <= 0 {
			t.Fatalf("prize %+v has non-positive weight", p)
		}
		totalW += p.Weight
		weightedMilli += p.Weight * p.MultMilli
	}
	if totalW != TotalWeight {
		t.Fatalf("TotalWeight=%d but weights sum to %d", TotalWeight, totalW)
	}
	// RTP = Σ(weight·mult) / total = weightedMilli / (total·1000).
	rtp := float64(weightedMilli) / float64(totalW*1000)
	if math.Abs(rtp-0.90) > 1e-9 {
		t.Fatalf("RTP=%.6f, want 0.90 (edge 10%%)", rtp)
	}
	if rtp >= 1.0 {
		t.Fatalf("RTP=%.4f ≥ 1 — house loses in expectation", rtp)
	}
	// First bucket is the 0× miss, last is the headline jackpot.
	if Prizes[0].MultMilli != 0 {
		t.Errorf("first prize should be the 0× miss, got %d", Prizes[0].MultMilli)
	}
	if last := Prizes[len(Prizes)-1]; last.Rarity != RarityGold {
		t.Errorf("last prize should be gold jackpot, got %q", last.Rarity)
	}
}

// TestDrawDeterministic: the same (seed, client, nonce) always yields the same prize,
// and every draw returns a valid index — the provably-fair guarantee.
func TestDrawDeterministic(t *testing.T) {
	seed := []byte("server-seed-fixed-for-the-test!!")
	for nonce := int64(1); nonce <= 1000; nonce++ {
		a := Draw(seed, "client", nonce)
		b := Draw(seed, "client", nonce)
		if a != b {
			t.Fatalf("nonce %d: non-deterministic draw %d != %d", nonce, a, b)
		}
		if a < 0 || a >= len(Prizes) {
			t.Fatalf("nonce %d: index %d out of range", nonce, a)
		}
	}
}

// TestDrawDistribution: over many nonces the empirical frequency of each prize tracks
// its weight (validates the cumulative-weight mapping has no off-by-one). The two rarest
// tiers only get a presence check — Monte-Carlo variance on a 1-in-2500 event is too
// high for a tight bound.
func TestDrawDistribution(t *testing.T) {
	seed := []byte("distribution-test-server-seed!!!")
	const n = 300_000
	counts := make([]int, len(Prizes))
	for nonce := int64(1); nonce <= n; nonce++ {
		counts[Draw(seed, "client", nonce)]++
	}
	for i, p := range Prizes {
		expected := float64(p.Weight) / float64(TotalWeight)
		got := float64(counts[i]) / float64(n)
		// Common tiers (expected ≥ 1%) must be within 10% relative; rare tiers just
		// need to appear so we know the bucket is reachable.
		if expected >= 0.01 {
			if rel := math.Abs(got-expected) / expected; rel > 0.10 {
				t.Errorf("prize %d (%s %d‰): freq %.4f vs expected %.4f (%.1f%% off)",
					i, p.Rarity, p.MultMilli, got, expected, rel*100)
			}
		} else if counts[i] == 0 {
			t.Errorf("prize %d (%s %d‰) never drawn in %d spins", i, p.Rarity, p.MultMilli, n)
		}
	}
}
