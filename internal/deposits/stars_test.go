package deposits

import "testing"

func TestStarsToNano(t *testing.T) {
	cases := []struct {
		stars int64
		nano  int64
	}{
		{0, 0},
		{1, 5_000_000},        // 1 Star = 0.005 TON
		{50, 250_000_000},     // 0.25 TON
		{200, 1_000_000_000},  // 200 Stars = 1 TON (the peg)
		{1000, 5_000_000_000}, // Fragment min withdrawal = 5 TON
		{123_456, 617_280_000_000},
	}
	for _, c := range cases {
		if got := StarsToNano(c.stars); got != c.nano {
			t.Errorf("StarsToNano(%d) = %d, want %d", c.stars, got, c.nano)
		}
	}
}
