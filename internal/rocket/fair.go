// Package rocket implements the "Ракета" crash game: one shared round runs in
// real time for all players, with a provably-fair crash point and the money flow
// booked through the double-entry ledger.
package rocket

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"math/big"
)

// crashScale is 2^52 — the space we sample a round's uniform outcome from. 52 bits
// fit exactly in a float64 mantissa and are plenty of resolution for a multiplier.
var crashScale = new(big.Int).Lsh(big.NewInt(1), 52)

// GenerateSeed returns 32 cryptographically-random bytes used as a round's secret
// server seed. Its SHA-256 hash is the commitment published before bets close; the
// seed itself is revealed after the crash so players can verify the outcome.
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

// CrashMilli derives a round's crash multiplier (×1000) from its secret seed and
// public round id, deterministically and verifiably — no floats, so every platform
// agrees and a player can reproduce it exactly.
//
// We draw u = h/2^52 ∈ [0,1) from the first 52 bits of HMAC-SHA256(seed, roundID)
// and map it to m = (1 − edge) / (1 − u). With this map the expected return of ANY
// cashout strategy is exactly (1 − edge): betting 1 and auto-cashing at target T has
// P(reach T) = (1 − edge)/T and pays T, so EV = (1 − edge). The house edge is edgeBp
// basis points regardless of how the player plays. The result is clamped to
// [1000, maxMilli]; an m below 1.00 lands as an instant 1.00x bust (the edge,
// realised). maxMilli ≤ 0 means no cap.
func CrashMilli(seed []byte, roundID, edgeBp, maxMilli int64) int64 {
	mac := hmac.New(sha256.New, seed)
	var idb [8]byte
	binary.BigEndian.PutUint64(idb[:], uint64(roundID))
	_, _ = mac.Write(idb[:])
	sum := mac.Sum(nil)

	// First 52 bits of the MAC as h ∈ [0, 2^52).
	h := new(big.Int).SetBytes(sum[:7]) // 56 bits
	h.Rsh(h, 4)                         // → 52 bits

	// m_milli = floor( 1000 · (1 − edgeBp/10000) · 2^52 / (2^52 − h) )
	//         = floor( (10000 − edgeBp) · 2^52 / (10 · (2^52 − h)) ), all integer.
	num := new(big.Int).Mul(big.NewInt(10000-edgeBp), crashScale)
	den := new(big.Int).Sub(crashScale, h) // ≥ 1 since h < 2^52
	den.Mul(den, big.NewInt(10))
	m := num.Div(num, den).Int64() // floor

	if m < 1000 {
		return 1000
	}
	if maxMilli > 0 && m > maxMilli {
		return maxMilli
	}
	return m
}
