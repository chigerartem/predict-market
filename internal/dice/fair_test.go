package dice

import (
	"math"
	"testing"
)

// TestMultMilli pins the published multiplier table at the 5% edge.
func TestMultMilli(t *testing.T) {
	const edge = 500
	cases := []struct {
		kind   string
		target int
		want   int64
	}{
		{BetLow, 0, 2280},
		{BetHigh, 0, 2280},
		{BetExact, 7, 5700},
		{BetExact, 6, 6840}, {BetExact, 8, 6840},
		{BetExact, 5, 8550}, {BetExact, 9, 8550},
		{BetExact, 4, 11400}, {BetExact, 10, 11400},
		{BetExact, 3, 17100}, {BetExact, 11, 17100},
		{BetExact, 2, 34200}, {BetExact, 12, 34200},
	}
	for _, c := range cases {
		got := MultMilli(edge, Ways(c.kind, c.target))
		if got != c.want {
			t.Errorf("MultMilli(%s,%d) = %d, want %d", c.kind, c.target, got, c.want)
		}
	}
}

// TestEdgeIsExact checks the expected return is exactly (1−edge) for every bet:
// P(win)·mult == (1−edge), using exact integer ways. Allow only floor rounding.
func TestEdgeIsExact(t *testing.T) {
	const edge = 500
	check := func(kind string, target int) {
		ways := Ways(kind, target)
		mult := float64(MultMilli(edge, ways)) / 1000
		ev := float64(ways) / 36 * mult
		if math.Abs(ev-0.95) > 0.005 {
			t.Errorf("EV for %s/%d = %.4f, want ~0.95", kind, target, ev)
		}
	}
	check(BetLow, 0)
	check(BetHigh, 0)
	for tgt := 2; tgt <= 12; tgt++ {
		check(BetExact, tgt)
	}
}

func TestWins(t *testing.T) {
	for sum := 2; sum <= 12; sum++ {
		if got := Wins(BetLow, 0, sum); got != (sum <= 6) {
			t.Errorf("Wins(low,%d)=%v", sum, got)
		}
		if got := Wins(BetHigh, 0, sum); got != (sum >= 8) {
			t.Errorf("Wins(high,%d)=%v", sum, got)
		}
		if got := Wins(BetExact, 7, sum); got != (sum == 7) {
			t.Errorf("Wins(exact7,%d)=%v", sum, got)
		}
	}
}

func TestValidBet(t *testing.T) {
	if ValidBet(BetExact, 1) || ValidBet(BetExact, 13) {
		t.Error("exact out of range should be invalid")
	}
	if !ValidBet(BetExact, 2) || !ValidBet(BetExact, 12) || !ValidBet(BetLow, 0) {
		t.Error("valid bets rejected")
	}
	if ValidBet("bogus", 0) {
		t.Error("unknown kind should be invalid")
	}
}

// TestRollDeterministicAndInRange: same inputs reproduce the dice, and dice are 1–6.
func TestRollDeterministic(t *testing.T) {
	seed := []byte("server-seed-32-bytes-for-testing")
	for n := int64(0); n < 1000; n++ {
		a1, a2 := Roll(seed, "client", n)
		b1, b2 := Roll(seed, "client", n)
		if a1 != b1 || a2 != b2 {
			t.Fatalf("nonce %d not deterministic", n)
		}
		if a1 < 1 || a1 > 6 || a2 < 1 || a2 > 6 {
			t.Fatalf("nonce %d out of range: %d,%d", n, a1, a2)
		}
	}
}

// TestRollUniform: over many nonces each face is ~1/6 and the sum distribution
// tracks the theoretical two-dice shape (chi-square sanity, loose tolerance).
func TestRollUniform(t *testing.T) {
	seed := []byte("another-server-seed-for-uniformity!!")
	const N = 120000
	var faces [7]int
	var sums [13]int
	for n := int64(0); n < N; n++ {
		d1, d2 := Roll(seed, "c", n)
		faces[d1]++
		faces[d2]++
		sums[d1+d2]++
	}
	exp := float64(2*N) / 6
	for f := 1; f <= 6; f++ {
		dev := math.Abs(float64(faces[f])-exp) / exp
		if dev > 0.03 {
			t.Errorf("face %d freq off by %.1f%% (got %d, exp %.0f)", f, dev*100, faces[f], exp)
		}
	}
	ways := []int{0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1}
	for s := 2; s <= 12; s++ {
		expS := float64(N) * float64(ways[s]) / 36
		dev := math.Abs(float64(sums[s])-expS) / expS
		if dev > 0.06 {
			t.Errorf("sum %d freq off by %.1f%% (got %d, exp %.0f)", s, dev*100, sums[s], expS)
		}
	}
}
