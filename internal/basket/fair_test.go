package basket

import (
	"math"
	"testing"
)

// TestOutcomeTable pins the economics: weights sum to TotalWeight, RTP is 90% and the
// score chance is 50%. The canary if someone re-tunes the table.
func TestOutcomeTable(t *testing.T) {
	var totalW, weightedMilli, scoreW int64
	for _, o := range Outcomes {
		if o.Weight <= 0 {
			t.Fatalf("outcome %+v has non-positive weight", o)
		}
		totalW += o.Weight
		weightedMilli += o.Weight * o.MultMilli
		if o.MultMilli > 0 {
			scoreW += o.Weight
		}
	}
	if totalW != TotalWeight {
		t.Fatalf("TotalWeight=%d but weights sum to %d", TotalWeight, totalW)
	}
	rtp := float64(weightedMilli) / float64(totalW*1000)
	if math.Abs(rtp-0.90) > 1e-9 {
		t.Fatalf("RTP=%.6f, want 0.90 (edge 10%%)", rtp)
	}
	if rtp >= 1.0 {
		t.Fatalf("RTP=%.4f ≥ 1 — house loses", rtp)
	}
	if hp := HitProbBp(); hp != 5000 {
		t.Errorf("HitProbBp=%d, want 5000 (50%%)", hp)
	}
	if got := scoreW * 10000 / totalW; got != 5000 {
		t.Errorf("score weight share=%d bp, want 5000", got)
	}
	if len(Scores()) != 2 {
		t.Errorf("Scores() len=%d, want 2 winning tiers", len(Scores()))
	}
	// The three misses must be EQUAL by weight (operator requirement).
	var missW []int64
	for _, o := range Outcomes {
		if o.MultMilli == 0 {
			missW = append(missW, o.Weight)
		}
	}
	if len(missW) != 3 {
		t.Fatalf("want 3 miss outcomes, got %d", len(missW))
	}
	for _, w := range missW {
		if w != missW[0] {
			t.Errorf("miss weights not equal: %v", missW)
			break
		}
	}
}

// TestDrawDeterministic: same (seed, client, nonce) → same (roll, index); index valid.
func TestDrawDeterministic(t *testing.T) {
	seed := []byte("basket-server-seed-fixed-test!!!")
	for nonce := int64(1); nonce <= 1000; nonce++ {
		r1, i1 := Draw(seed, "client", nonce)
		r2, i2 := Draw(seed, "client", nonce)
		if r1 != r2 || i1 != i2 {
			t.Fatalf("nonce %d: non-deterministic (%d,%d) != (%d,%d)", nonce, r1, i1, r2, i2)
		}
		if i1 < 0 || i1 >= len(Outcomes) || r1 < 0 || r1 >= int(TotalWeight) {
			t.Fatalf("nonce %d: out of range roll=%d idx=%d", nonce, r1, i1)
		}
	}
}

// TestDrawDistribution: empirical outcome frequencies track the weights, and the overall
// score rate is ≈ 50%.
func TestDrawDistribution(t *testing.T) {
	seed := []byte("basket-distribution-seed-test!!!")
	const n = 300_000
	counts := make([]int, len(Outcomes))
	hits := 0
	for nonce := int64(1); nonce <= n; nonce++ {
		_, idx := Draw(seed, "client", nonce)
		counts[idx]++
		if Outcomes[idx].MultMilli > 0 {
			hits++
		}
	}
	for i, o := range Outcomes {
		expected := float64(o.Weight) / float64(TotalWeight)
		got := float64(counts[i]) / float64(n)
		if rel := math.Abs(got-expected) / expected; rel > 0.08 {
			t.Errorf("outcome %d (%s): freq %.4f vs expected %.4f (%.1f%% off)", i, o.Anim, got, expected, rel*100)
		}
	}
	if rate := float64(hits) / n; math.Abs(rate-0.50) > 0.01 {
		t.Errorf("score rate %.4f, want ≈0.50", rate)
	}
}
