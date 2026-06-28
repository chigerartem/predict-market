package basket

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"predict/internal/ledger"
)

var (
	// ErrStakeTooSmall / ErrStakeTooLarge — stake outside the configured bounds.
	ErrStakeTooSmall = errors.New("basket: stake too small")
	ErrStakeTooLarge = errors.New("basket: stake too large")
	// ErrInsufficient — the player can't cover the stake.
	ErrInsufficient = errors.New("basket: insufficient balance")
	// ErrHouseCantCover — the treasury can't cover this win.
	ErrHouseCantCover = errors.New("basket: house can't cover payout")
)

// Config tunes the stake bounds. The outcomes (animations, multipliers, weights) and the
// edge live in the prize table in fair.go. Amounts are nano-TON.
type Config struct {
	MinStakeNano int64
	MaxStakeNano int64 // 0 = no cap
}

// DefaultConfig: min stake 0.1 TON, no max (the real cap is the player's balance).
func DefaultConfig() Config {
	return Config{MinStakeNano: 100_000_000, MaxStakeNano: 0}
}

// Store persists per-user seeds and throws and books the money through the ledger.
type Store struct {
	pool     *pgxpool.Pool
	cfg      Config
	escrow   int64
	treasury int64
}

// NewStore resolves the ledger system accounts the game posts against.
func NewStore(ctx context.Context, pool *pgxpool.Pool, cfg Config) (*Store, error) {
	escrow, err := ledger.SystemAccountID(ctx, pool, ledger.TypeBetEscrow)
	if err != nil {
		return nil, fmt.Errorf("resolve escrow account: %w", err)
	}
	treasury, err := ledger.SystemAccountID(ctx, pool, ledger.TypeHouseTreasury)
	if err != nil {
		return nil, fmt.Errorf("resolve treasury account: %w", err)
	}
	return &Store{pool: pool, cfg: cfg, escrow: escrow, treasury: treasury}, nil
}

// payoutNano = floor(stake * multMilli / 1000), in big.Int to avoid overflow.
func payoutNano(stakeNano, multMilli int64) int64 {
	p := new(big.Int).Mul(big.NewInt(stakeNano), big.NewInt(multMilli))
	p.Quo(p, big.NewInt(1000))
	return p.Int64()
}

// ensureSeed creates the user's seed row if absent. Idempotent.
func (s *Store) ensureSeed(ctx context.Context, userID int64) error {
	seed, err := GenerateSeed()
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx,
		`INSERT INTO basket_seeds (user_id, server_seed, server_seed_hash, client_seed)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (user_id) DO NOTHING`,
		userID, seed, SeedHash(seed), GenerateClientSeed())
	return err
}

// ThrowResult is the outcome of one shot.
type ThrowResult struct {
	ThrowID        int64
	Nonce          int64
	Roll           int
	OutcomeIndex   int
	Anim           string // lottie the client plays for this landing
	Hit            bool
	MultMilli      int64
	StakeNano      int64
	PayoutNano     int64
	BalanceNano    int64
	ServerSeedHash string
}

// Throw plays one instant shot for userID at the chosen stake: it locks the stake, draws
// the outcome from the user's seed at the next nonce, settles win or loss, and records the
// throw — all in one transaction. Returns the result and the new balance.
func (s *Store) Throw(ctx context.Context, userID, stakeNano int64) (ThrowResult, error) {
	if stakeNano < s.cfg.MinStakeNano {
		return ThrowResult{}, ErrStakeTooSmall
	}
	if s.cfg.MaxStakeNano > 0 && stakeNano > s.cfg.MaxStakeNano {
		return ThrowResult{}, ErrStakeTooLarge
	}
	if err := s.ensureSeed(ctx, userID); err != nil {
		return ThrowResult{}, err
	}
	userAcct, err := ledger.EnsureUserBalance(ctx, s.pool, userID)
	if err != nil {
		return ThrowResult{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ThrowResult{}, err
	}
	defer tx.Rollback(ctx)

	// Advance the nonce (locks the seed row) and read the seed for this draw.
	var serverSeed []byte
	var clientSeed string
	var nonce int64
	if err := tx.QueryRow(ctx,
		`UPDATE basket_seeds SET nonce = nonce + 1 WHERE user_id = $1
		 RETURNING server_seed, client_seed, nonce`, userID).
		Scan(&serverSeed, &clientSeed, &nonce); err != nil {
		return ThrowResult{}, err
	}
	hash := SeedHash(serverSeed)

	roll, idx := Draw(serverSeed, clientSeed, nonce)
	out := Outcomes[idx]
	hit := out.MultMilli > 0
	var payout int64
	if hit {
		payout = payoutNano(stakeNano, out.MultMilli)
	}

	var throwID int64
	if err := tx.QueryRow(ctx,
		`INSERT INTO basket_throws (user_id, nonce, stake_nano, roll, hit, mult_milli, payout_nano)
		 VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
		userID, nonce, stakeNano, roll, hit, out.MultMilli, payout).
		Scan(&throwID); err != nil {
		return ThrowResult{}, err
	}
	ref := fmt.Sprintf("basket_throw:%d", throwID)

	// place: lock the stake in escrow (rejects if the player can't cover it).
	placeTx, err := ledger.PostTx(ctx, tx, ledger.Posting{
		Kind:      "basket_place",
		Reference: ref,
		Entries: []ledger.Entry{
			{AccountID: userAcct, AmountNano: -stakeNano},
			{AccountID: s.escrow, AmountNano: stakeNano},
		},
	})
	if err != nil {
		if isBalanceCheck(err) {
			return ThrowResult{}, ErrInsufficient
		}
		return ThrowResult{}, err
	}

	// settle: a score pays stake+profit out (escrow + treasury → user); a miss sends the
	// stake to the house (escrow → treasury).
	var entries []ledger.Entry
	kindStr := "basket_miss"
	if hit {
		profit := payout - stakeNano
		kindStr = "basket_win"
		entries = []ledger.Entry{
			{AccountID: s.escrow, AmountNano: -stakeNano},
			{AccountID: userAcct, AmountNano: payout},
			{AccountID: s.treasury, AmountNano: -profit},
		}
	} else {
		entries = []ledger.Entry{
			{AccountID: s.escrow, AmountNano: -stakeNano},
			{AccountID: s.treasury, AmountNano: stakeNano},
		}
	}
	settleTx, err := ledger.PostTx(ctx, tx, ledger.Posting{
		Kind:           kindStr,
		Reference:      ref,
		IdempotencyKey: fmt.Sprintf("basket_settle:%d", throwID),
		Entries:        entries,
	})
	if err != nil {
		if isBalanceCheck(err) { // only the treasury leg can fail here
			return ThrowResult{}, ErrHouseCantCover
		}
		return ThrowResult{}, err
	}

	if _, err := tx.Exec(ctx,
		`UPDATE basket_throws SET ledger_tx_place = $2, ledger_tx_settle = $3 WHERE id = $1`,
		throwID, placeTx, settleTx); err != nil {
		return ThrowResult{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		if isBalanceCheck(err) {
			return ThrowResult{}, ErrHouseCantCover
		}
		return ThrowResult{}, err
	}

	bal, err := ledger.Balance(ctx, s.pool, userAcct)
	if err != nil {
		return ThrowResult{}, err
	}
	return ThrowResult{
		ThrowID: throwID, Nonce: nonce, Roll: roll, OutcomeIndex: idx, Anim: out.Anim,
		Hit: hit, MultMilli: out.MultMilli, StakeNano: stakeNano, PayoutNano: payout,
		BalanceNano: bal, ServerSeedHash: hash,
	}, nil
}

// State is the fairness + economics snapshot the UI needs before a throw.
type State struct {
	ServerSeedHash string
	ClientSeed     string
	Nonce          int64
	HitProbBp      int64
	Scores         []Score // winning tiers (mult + chance), low → high
	MinStakeNano   int64
	MaxStakeNano   int64
	Recent         []ThrowRow
}

// ThrowRow is a past throw (newest first) for the user's history strip.
type ThrowRow struct {
	ID         int64     `json:"id"`
	Nonce      int64     `json:"nonce"`
	StakeNano  int64     `json:"stake_nano"`
	Roll       int       `json:"roll"`
	Hit        bool      `json:"hit"`
	MultMilli  int64     `json:"mult_milli"`
	PayoutNano int64     `json:"payout_nano"`
	CreatedAt  time.Time `json:"created_at"`
}

// State returns the user's commitment, the economics (score chance, winning tiers), stake
// bounds and recent throws — creating the seed on first use.
func (s *Store) State(ctx context.Context, userID int64) (State, error) {
	if err := s.ensureSeed(ctx, userID); err != nil {
		return State{}, err
	}
	st := State{
		HitProbBp: HitProbBp(), Scores: Scores(),
		MinStakeNano: s.cfg.MinStakeNano, MaxStakeNano: s.cfg.MaxStakeNano,
	}
	if err := s.pool.QueryRow(ctx,
		`SELECT server_seed_hash, client_seed, nonce FROM basket_seeds WHERE user_id = $1`, userID).
		Scan(&st.ServerSeedHash, &st.ClientSeed, &st.Nonce); err != nil {
		return State{}, err
	}
	recent, err := s.RecentThrows(ctx, userID, 15)
	if err != nil {
		return State{}, err
	}
	st.Recent = recent
	return st, nil
}

// RecentThrows returns the user's last n throws, newest first.
func (s *Store) RecentThrows(ctx context.Context, userID int64, n int) ([]ThrowRow, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, nonce, stake_nano, roll, hit, mult_milli, payout_nano, created_at
		   FROM basket_throws WHERE user_id = $1 ORDER BY id DESC LIMIT $2`, userID, n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ThrowRow, 0, n)
	for rows.Next() {
		var r ThrowRow
		if err := rows.Scan(&r.ID, &r.Nonce, &r.StakeNano, &r.Roll, &r.Hit,
			&r.MultMilli, &r.PayoutNano, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// Rotation is the reveal returned when a user rotates their seed.
type Rotation struct {
	OldServerSeed string // hex, revealed
	OldServerHash string
	ThrownNonce   int64
	NewServerHash string
	NewClientSeed string
}

// RotateSeed reveals the user's current server seed and commits a fresh one, resetting the
// nonce. newClientSeed sets the next client seed (random if empty).
func (s *Store) RotateSeed(ctx context.Context, userID int64, newClientSeed string) (Rotation, error) {
	if err := s.ensureSeed(ctx, userID); err != nil {
		return Rotation{}, err
	}
	newSeed, err := GenerateSeed()
	if err != nil {
		return Rotation{}, err
	}
	newHash := SeedHash(newSeed)
	if newClientSeed == "" {
		newClientSeed = GenerateClientSeed()
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Rotation{}, err
	}
	defer tx.Rollback(ctx)

	var oldSeed []byte
	var oldHash string
	var nonce int64
	if err := tx.QueryRow(ctx,
		`SELECT server_seed, server_seed_hash, nonce FROM basket_seeds WHERE user_id = $1 FOR UPDATE`, userID).
		Scan(&oldSeed, &oldHash, &nonce); err != nil {
		return Rotation{}, err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE basket_seeds SET server_seed = $2, server_seed_hash = $3, client_seed = $4,
		        nonce = 0, rotated_at = now() WHERE user_id = $1`,
		userID, newSeed, newHash, newClientSeed); err != nil {
		return Rotation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Rotation{}, err
	}
	return Rotation{
		OldServerSeed: hex.EncodeToString(oldSeed), OldServerHash: oldHash,
		ThrownNonce: nonce, NewServerHash: newHash, NewClientSeed: newClientSeed,
	}, nil
}

// isBalanceCheck reports whether err is the non-negative-balance CHECK violation (23514).
func isBalanceCheck(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23514"
}
