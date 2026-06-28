// Package basket implements "Баскетбол": an instant single-player game. The player
// stakes any amount and shoots the ball — it either scores (win = stake × multiplier) or
// misses (the stake is lost). Like "Кости" there is no shared round: the outcome is
// settled in the same request and the money is booked through the double-entry ledger.
//
// Provably fair (commit + per-throw nonce): each user has a secret server seed whose
// SHA-256 hash is published before any throw. The outcome of throw N is the first 8 bytes
// of HMAC-SHA256(server_seed, "{client_seed}:{nonce}") reduced to a roll in [0, 10000); a
// score is roll < HitProbBp. A player can reproduce every throw once the seed is revealed.
package basket

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"strconv"
)

// RollRange is the resolution of a throw draw: roll ∈ [0, RollRange). Probabilities are
// expressed in basis points (1/RollRange), so HitProbBp=5000 → 50%.
const RollRange = 10000

// GenerateSeed returns 32 cryptographically-random bytes used as a user's secret server
// seed. Its SHA-256 hash is the commitment shown before any throw.
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

// Draw derives the throw roll in [0, RollRange) from the secret server seed, the public
// client seed and the per-throw nonce: the first 8 bytes of HMAC-SHA256(server_seed,
// "{client_seed}:{nonce}") as a big-endian uint64 modulo RollRange. (Modulo bias over
// 2^64 vs 10000 is negligible.) A score is roll < HitProbBp. Reproducible once revealed.
func Draw(serverSeed []byte, clientSeed string, nonce int64) int {
	mac := hmac.New(sha256.New, serverSeed)
	mac.Write([]byte(clientSeed + ":" + strconv.FormatInt(nonce, 10)))
	sum := mac.Sum(nil) // 32 bytes
	return int(binary.BigEndian.Uint64(sum[:8]) % uint64(RollRange))
}

// MultMilli is the win multiplier (×1000) for a score, with the house edge baked in:
// floor((10000−edgeBp)·1000 / probBp). The expected return is (1−edge): at probBp=5000,
// edgeBp=600 → 1880 (1.88×), so 0.50·1.88 = 0.94. Returns 0 for a non-positive prob.
func MultMilli(edgeBp, probBp int64) int64 {
	if probBp <= 0 {
		return 0
	}
	return (10000 - edgeBp) * 1000 / probBp
}
