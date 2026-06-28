package rocket

import (
	"math"
	"testing"
)

func TestSeedHashStable(t *testing.T) {
	seed := []byte("01234567890123456789012345678901")
	if got := SeedHash(seed); len(got) != 64 {
		t.Fatalf("hash len = %d, want 64", len(got))
	}
	// Deterministic: same seed → same hash on repeated calls.
	if a, b := SeedHash(seed), SeedHash(seed); a != b {
		t.Fatal("hash not deterministic")
	}
}

func TestCrashMilliDeterministic(t *testing.T) {
	seed, err := GenerateSeed()
	if err != nil {
		t.Fatal(err)
	}
	a := CrashMilli(seed, 42, 500, 50000)
	b := CrashMilli(seed, 42, 500, 50000)
	if a != b {
		t.Fatalf("not deterministic: %d != %d", a, b)
	}
}

func TestCrashMilliBounds(t *testing.T) {
	seed := []byte("deterministic-seed-for-bounds!!!")
	for id := int64(0); id < 5000; id++ {
		m := CrashMilli(seed, id, 500, 50000)
		if m < 1000 {
			t.Fatalf("round %d: crash %d below 1000", id, m)
		}
		if m > 50000 {
			t.Fatalf("round %d: crash %d above cap 50000", id, m)
		}
	}
}

// The realised house edge over many rounds should be close to edgeBp. We measure
// EV of a player who always cashes out at a fixed target T: payout T when the round
// reaches T, else 0. With the cap removed, mean payout ≈ (1 − edge).
func TestHouseEdgeApprox(t *testing.T) {
	seed := []byte("house-edge-statistical-seed-32by")
	const (
		n       = 200000
		edgeBp  = 500 // 5%
		targetM = 2000
	)
	wins := 0
	for id := int64(0); id < n; id++ {
		// No cap, so the tail isn't truncated and the EV estimate is unbiased.
		m := CrashMilli(seed, id, edgeBp, 0)
		if m >= targetM {
			wins++
		}
	}
	// EV per unit stake = (target/1000) * P(reach target). Expect ≈ 1 − edge = 0.95.
	ev := (float64(targetM) / 1000) * (float64(wins) / float64(n))
	if math.Abs(ev-0.95) > 0.01 {
		t.Fatalf("EV at 2.00x = %.4f, want ≈0.95 (edge 5%%)", ev)
	}
}
