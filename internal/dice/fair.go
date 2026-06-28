// Package dice implements the "Кости" game: an instant single-player roll of two
// six-sided dice. The player bets on the sum (low/high/exact); the outcome is
// provably fair (commit + per-roll nonce) and the money is booked through the
// double-entry ledger in one transaction.
package dice

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
)

// Bet kinds. "low" = sum 2–6, "high" = sum 8–12, "exact" = a specific sum 2–12
// (target). Seven is "exact" with target 7.
const (
	BetLow   = "low"
	BetHigh  = "high"
	BetExact = "exact"
)

// GenerateSeed returns 32 cryptographically-random bytes used as a user's secret
// server seed. Its SHA-256 hash is the commitment shown before any roll.
func GenerateSeed() ([]byte, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	return b, nil
}

// SeedHash returns the hex SHA-256 commitment of a server seed.
func SeedHash(seed []byte) string {
	h := sha256.Sum256(seed)
	return hex.EncodeToString(h[:])
}

// GenerateClientSeed returns a random default client seed (hex of 8 bytes). The
// player may replace it when rotating the server seed.
func GenerateClientSeed() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Roll derives the two dice (each 1–6) for a given roll from the secret server
// seed, the public client seed, and the per-roll nonce. The outcome is
// HMAC-SHA256(server_seed, "{client_seed}:{nonce}"); each die is drawn unbiased
// from its own half of the MAC by rejection sampling (a byte ≥ 252 is skipped, so
// the remaining 0–251 map evenly onto 1–6). A player can reproduce this exactly
// once the server seed is revealed.
func Roll(serverSeed []byte, clientSeed string, nonce int64) (d1, d2 int) {
	mac := hmac.New(sha256.New, serverSeed)
	mac.Write([]byte(clientSeed + ":" + strconv.FormatInt(nonce, 10)))
	sum := mac.Sum(nil) // 32 bytes
	return die(sum[:16]), die(sum[16:])
}

// die maps a byte slice to a uniform 1–6 via rejection sampling. 252 = 6×42 is the
// largest multiple of 6 ≤ 256, so bytes 0–251 are unbiased and ≥252 are rejected.
// With 16 bytes the chance of exhausting them all (~(4/256)^16) is negligible; the
// final fallback keeps it total.
func die(b []byte) int {
	for _, x := range b {
		if x < 252 {
			return int(x%6) + 1
		}
	}
	return 1
}

// ValidBet reports whether (kind, target) is a legal bet. target is only used for
// "exact" (must be 2–12) and ignored otherwise.
func ValidBet(kind string, target int) bool {
	switch kind {
	case BetLow, BetHigh:
		return true
	case BetExact:
		return target >= 2 && target <= 12
	}
	return false
}

// Ways returns how many of the 36 equally-likely two-dice outcomes win this bet:
// 15 for low/high, and 6−|target−7| for an exact sum (1 for 2/12 … 6 for 7).
func Ways(kind string, target int) int {
	switch kind {
	case BetLow, BetHigh:
		return 15
	case BetExact:
		d := target - 7
		if d < 0 {
			d = -d
		}
		return 6 - d
	}
	return 0
}

// MultMilli is the payout multiplier (×1000) for a bet winning `ways` of 36, with
// the house edge in basis points baked in: floor((10000−edgeBp)·36 / (10·ways)).
// At edgeBp=500: low/high (ways 15) → 2280; exact 7 (ways 6) → 5700; exact 2/12
// (ways 1) → 34200. The expected return is exactly (1−edge) for every bet.
func MultMilli(edgeBp int64, ways int) int64 {
	if ways <= 0 {
		return 0
	}
	return (10000 - edgeBp) * 36 / (10 * int64(ways))
}

// Wins reports whether a sum settles the bet as a win.
func Wins(kind string, target, sum int) bool {
	switch kind {
	case BetLow:
		return sum >= 2 && sum <= 6
	case BetHigh:
		return sum >= 8 && sum <= 12
	case BetExact:
		return sum == target
	}
	return false
}
