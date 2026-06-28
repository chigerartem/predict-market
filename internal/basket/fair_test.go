package basket

import (
	"math"
	"testing"
)

// TestMultAndRTP pins the economics: the default 50% chance at 6% edge pays 1.88×, and
// RTP = chance × multiplier = 1 − edge for a range of configs.
func TestMultAndRTP(t *testing.T) {
	if got := MultMilli(600, 5000); got != 1880 {
		t.Fatalf("MultMilli(600,5000)=%d, want 1880 (1.88×)", got)
	}
	cases := []struct{ edgeBp, probBp int64 }{
		{600, 5000}, {600, 3200}, {700, 5500}, {500, 4000},
	}
	for _, c := range cases {
		mult := MultMilli(c.edgeBp, c.probBp)
		rtp := (float64(c.probBp) / 10000) * (float64(mult) / 1000)
		want := float64(10000-c.edgeBp) / 10000
		// floor in MultMilli can shave a hair; allow a small slack below `want`.
		if rtp > want+1e-9 || rtp < want-0.002 {
			t.Errorf("edge %d prob %d: RTP=%.5f, want ≈%.5f (mult %d)", c.edgeBp, c.probBp, rtp, want, mult)
		}
		if rtp >= 1.0 {
			t.Errorf("edge %d prob %d: RTP=%.4f ≥ 1 — house loses", c.edgeBp, c.probBp, rtp)
		}
	}
}

// TestDrawDeterministic: same (seed, client, nonce) → same roll, always in range.
func TestDrawDeterministic(t *testing.T) {
	seed := []byte("basket-server-seed-fixed-test!!!")
	for nonce := int64(1); nonce <= 1000; nonce++ {
		a := Draw(seed, "client", nonce)
		if a != Draw(seed, "client", nonce) {
			t.Fatalf("nonce %d: non-deterministic", nonce)
		}
		if a < 0 || a >= RollRange {
			t.Fatalf("nonce %d: roll %d out of range", nonce, a)
		}
	}
}

// TestHitRate: over many throws the empirical score rate tracks HitProbBp (validates the
// uniform draw + threshold).
func TestHitRate(t *testing.T) {
	seed := []byte("basket-distribution-seed-test!!!")
	const n = 200_000
	const probBp = 5000
	hits := 0
	for nonce := int64(1); nonce <= n; nonce++ {
		if Draw(seed, "client", nonce) < probBp {
			hits++
		}
	}
	rate := float64(hits) / n
	if math.Abs(rate-0.50) > 0.01 {
		t.Errorf("hit rate %.4f, want ≈0.50 (prob %d bp)", rate, probBp)
	}
}
