// Package basket implements "Баскетбол": an instant single-player game. The player
// stakes any amount and shoots; the ball lands in one of five outcomes (each a distinct
// 🏀 sticker animation) chosen by weighted rarity — three misses (stake lost) and two
// scores (win = stake × that outcome's multiplier). Like "Кости" there is no shared
// round: the outcome is settled in the same request and booked through the ledger.
//
// Provably fair (commit + per-throw nonce): each user has a secret server seed whose
// SHA-256 hash is published before any throw. The outcome of throw N is the first 8 bytes
// of HMAC-SHA256(server_seed, "{client_seed}:{nonce}") reduced to a roll in [0, TotalWeight)
// and mapped onto the cumulative weights below. Reproducible once the seed is revealed.
package basket

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"strconv"
)

// Outcome is one of the five ways the ball can land. Anim is the lottie the client plays
// (server-authoritative). MultMilli=0 is a miss; >0 is a score paying stake × mult/1000.
type Outcome struct {
	Anim      string `json:"anim"`
	MultMilli int64  `json:"mult_milli"`
	Weight    int64  `json:"-"`
}

// Outcomes — the five landings by rarity. Designed for RTP 90% (house edge 10%) with a
// ~50% score chance: Σ(weight/total · mult) = 0.90 over the 10000 total weight.
//
//	outcome           mult   weight   chance   contribution
//	miss (off)        0×      2500    25%       0.000
//	miss (net)        0×      1700    17%       0.000
//	miss (rim)        0×       800     8%       0.000
//	score (regular)   1.5×    4400    44%       0.660
//	score (swish)     4×       600     6%       0.240   → Σ = 0.900, score chance 50%
//
// Weights sum to 10000. Misses map to the three distinct miss stickers (val 1/2/3); the
// regular score to the off-the-rim make (val 4) and the rare swish to the clean make (val 5).
var Outcomes = []Outcome{
	{Anim: "basket-miss-2", MultMilli: 0, Weight: 2500},   // мимо (val 1)
	{Anim: "basket-hit-2", MultMilli: 1500, Weight: 4400}, // попадание, 1.5× (val 4)
	{Anim: "basket-miss-1", MultMilli: 0, Weight: 1700},   // пустая сетка (val 2)
	{Anim: "basket-miss-3", MultMilli: 0, Weight: 800},    // от кольца (val 3)
	{Anim: "basket-hit-1", MultMilli: 4000, Weight: 600},  // чистый свиш, 4× (val 5)
}

// TotalWeight is the sum of all outcome weights (the draw is modulo this).
var TotalWeight = func() int64 {
	var t int64
	for _, o := range Outcomes {
		t += o.Weight
	}
	return t
}()

// HitProbBp is the total score chance in basis points (Σ scoring weight / total).
func HitProbBp() int64 {
	var w int64
	for _, o := range Outcomes {
		if o.MultMilli > 0 {
			w += o.Weight
		}
	}
	return w * 10000 / TotalWeight
}

// Score is a winning tier exposed to the UI (which multipliers exist and how likely).
type Score struct {
	MultMilli int64 `json:"mult_milli"`
	ChanceBp  int64 `json:"chance_bp"`
}

// Scores returns the winning outcomes (mult + chance) low → high, for the UI.
func Scores() []Score {
	out := make([]Score, 0, len(Outcomes))
	for _, o := range Outcomes {
		if o.MultMilli > 0 {
			out = append(out, Score{MultMilli: o.MultMilli, ChanceBp: o.Weight * 10000 / TotalWeight})
		}
	}
	return out
}

// GenerateSeed returns 32 cryptographically-random bytes — the user's secret server seed.
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

// GenerateClientSeed returns a random default client seed (hex of 8 bytes).
func GenerateClientSeed() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Draw derives the throw's raw roll in [0, TotalWeight) and the winning outcome index it
// maps to (cumulative weights). The roll is stored for audit; the index selects the
// outcome (animation + multiplier). Fully reproducible once the seed is revealed.
func Draw(serverSeed []byte, clientSeed string, nonce int64) (roll, index int) {
	mac := hmac.New(sha256.New, serverSeed)
	mac.Write([]byte(clientSeed + ":" + strconv.FormatInt(nonce, 10)))
	sum := mac.Sum(nil) // 32 bytes
	roll = int(binary.BigEndian.Uint64(sum[:8]) % uint64(TotalWeight))
	var acc int
	for i, o := range Outcomes {
		acc += int(o.Weight)
		if roll < acc {
			return roll, i
		}
	}
	return roll, len(Outcomes) - 1 // unreachable
}
