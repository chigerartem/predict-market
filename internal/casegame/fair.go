// Package casegame implements "Кейсы": an instant single-player case-opening game in
// the CS:GO style. The player pays a fixed price per spin; a reel of items scrolls and
// lands on a prize — a TON amount equal to the spin price times a multiplier (0×..200×)
// with a rarity (colour). Like "Кости" there is no shared round: the outcome is settled
// in the same request and the money is booked through the double-entry ledger.
//
// Provably fair (commit + per-spin nonce): each user has a secret server seed whose
// SHA-256 hash is published before any spin. The outcome of spin N is
// HMAC-SHA256(server_seed, "{client_seed}:{nonce}") reduced to a uint64, which selects a
// prize from the weighted table below. A player can reproduce every spin once the seed
// is revealed (on rotation).
package casegame

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"strconv"
)

// Rarity tiers, low → high. The client colours each reel card by these.
const (
	RarityGrey   = "grey"   // «пусто» (0×) — ставка теряется
	RarityBlue   = "blue"   // 2×
	RarityPurple = "purple" // 3×
	RarityPink   = "pink"   // 7×
	RarityRed    = "red"    // 25×
	RarityGold   = "gold"   // джекпот (200×)
)

// Prize is one outcome bucket: a payout multiplier (×1000) drawn with the given integer
// weight. Payout = price * MultMilli / 1000.
type Prize struct {
	Rarity    string `json:"rarity"`
	MultMilli int64  `json:"mult_milli"`
	Weight    int64  `json:"-"`
}

// Prizes is the fixed prize table. Designed for RTP 90% (house edge 10%): the expected
// payout Σ(weight/total · mult) over the 100000 total weight equals 0.90× the stake.
// Per Артём's call there is NO partial-return tier: a spin is either «пусто» (the stake
// is lost) or a real multiplier (≥2×). The shape is "case-like" — most spins are empty,
// the winning tail is rare and fat:
//
//	mult   chance      1 in    contribution
//	0×     67.38%        1.5    0.0000   (пусто)
//	2×     25.00%        4      0.5000
//	3×      6.00%       17      0.1800
//	7×      1.20%       83      0.0840
//	25×     0.40%      250      0.1000
//	200×    0.018%    5556      0.0360   → Σ = 0.9000 (RTP 90%)
//
// To re-tune the edge, change the weights and keep TotalWeight in sync (it is summed at
// init, so just edit the slice).
var Prizes = []Prize{
	{Rarity: RarityGrey, MultMilli: 0, Weight: 67382},     // пусто — ставка теряется
	{Rarity: RarityBlue, MultMilli: 2000, Weight: 25000},  // 2×
	{Rarity: RarityPurple, MultMilli: 3000, Weight: 6000}, // 3×
	{Rarity: RarityPink, MultMilli: 7000, Weight: 1200},   // 7×
	{Rarity: RarityRed, MultMilli: 25000, Weight: 400},    // 25×
	{Rarity: RarityGold, MultMilli: 200000, Weight: 18},   // джекпот (200×)
}

// TotalWeight is the sum of all prize weights (the draw is modulo this).
var TotalWeight = func() int64 {
	var t int64
	for _, p := range Prizes {
		t += p.Weight
	}
	return t
}()

// GenerateSeed returns 32 cryptographically-random bytes used as a user's secret server
// seed. Its SHA-256 hash is the commitment shown before any spin.
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

// GenerateClientSeed returns a random default client seed (hex of 8 bytes). The player
// may replace it when rotating the server seed.
func GenerateClientSeed() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Draw derives the winning prize index for a spin from the secret server seed, the
// public client seed, and the per-spin nonce. The outcome is the first 8 bytes of
// HMAC-SHA256(server_seed, "{client_seed}:{nonce}") taken as a big-endian uint64, reduced
// modulo TotalWeight and mapped onto the cumulative weights. (Modulo bias over 2^64 vs a
// 10000 total is utterly negligible.) Fully reproducible once the seed is revealed.
func Draw(serverSeed []byte, clientSeed string, nonce int64) int {
	mac := hmac.New(sha256.New, serverSeed)
	mac.Write([]byte(clientSeed + ":" + strconv.FormatInt(nonce, 10)))
	sum := mac.Sum(nil) // 32 bytes
	r := int64(binary.BigEndian.Uint64(sum[:8]) % uint64(TotalWeight))
	var acc int64
	for i, p := range Prizes {
		acc += p.Weight
		if r < acc {
			return i
		}
	}
	return len(Prizes) - 1 // unreachable (weights sum to TotalWeight)
}
