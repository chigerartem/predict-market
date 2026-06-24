package deposits

import (
	"math"
	"testing"
)

func TestStarsToNano(t *testing.T) {
	// Pin config so the test is independent of any env overrides.
	StarUSDWithdraw = 0.013
	DepositBuffer = 0.90

	cases := []struct {
		stars  int64
		tonUSD float64
	}{
		{1000, 3.0}, // ≈ 3.9 TON
		{200, 2.6},  // ≈ 0.9 TON (1.0 before the 10% buffer)
		{500, 5.0},  // ≈ 1.17 TON
		{50, 2.6},   // min deposit
	}
	for _, c := range cases {
		want := int64(math.Round(float64(c.stars) * StarUSDWithdraw * DepositBuffer / c.tonUSD * 1e9))
		if got := StarsToNano(c.stars, c.tonUSD); got != want {
			t.Errorf("StarsToNano(%d, %.2f) = %d, want %d", c.stars, c.tonUSD, got, want)
		}
	}

	// Guards: non-positive price or stars → 0 (rate unavailable / nothing to credit).
	if StarsToNano(100, 0) != 0 {
		t.Error("expected 0 for zero TON price")
	}
	if StarsToNano(0, 3.0) != 0 {
		t.Error("expected 0 for zero stars")
	}
}
