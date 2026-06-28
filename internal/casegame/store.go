package casegame

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
	ErrStakeTooSmall = errors.New("case: stake too small")
	ErrStakeTooLarge = errors.New("case: stake too large")
	// ErrInsufficient — the player can't cover the stake.
	ErrInsufficient = errors.New("case: insufficient balance")
	// ErrHouseCantCover — the treasury can't cover this payout. With the treasury
	// allowed to go negative (migration 0014) this should not fire, but we keep the
	// guard so a future config change surfaces cleanly instead of corrupting books.
	ErrHouseCantCover = errors.New("case: house can't cover payout")
)

// Config tunes the economics. The prize table (multipliers + weights) lives in fair.go;
// the player stakes any amount and wins stake × multiplier. Amounts are nano-TON.
type Config struct {
	MinStakeNano int64
	MaxStakeNano int64 // 0 = no cap
}

// DefaultConfig: min stake 0.1 TON, NO max (0 = uncapped — same call as dice; the real
// cap is the player's balance). The edge (10%) is baked into the prize-table weights.
func DefaultConfig() Config {
	return Config{MinStakeNano: 100_000_000, MaxStakeNano: 0}
}

// Store persists per-user seeds and spins and books the money through the ledger.
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

// payoutNano = floor(price * multMilli / 1000), in big.Int to avoid overflow.
func payoutNano(priceNano, multMilli int64) int64 {
	p := new(big.Int).Mul(big.NewInt(priceNano), big.NewInt(multMilli))
	p.Quo(p, big.NewInt(1000))
	return p.Int64()
}

// ensureSeed creates the user's seed row if absent (random server seed, its hash, a
// random default client seed, nonce 0). Idempotent.
func (s *Store) ensureSeed(ctx context.Context, userID int64) error {
	seed, err := GenerateSeed()
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx,
		`INSERT INTO case_seeds (user_id, server_seed, server_seed_hash, client_seed)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (user_id) DO NOTHING`,
		userID, seed, SeedHash(seed), GenerateClientSeed())
	return err
}

// SpinResult is the outcome of one case open.
type SpinResult struct {
	SpinID         int64
	Nonce          int64
	PrizeIndex     int
	Rarity         string
	MultMilli      int64
	StakeNano      int64
	PayoutNano     int64
	BalanceNano    int64
	ServerSeedHash string
}

// Open plays one instant spin for userID at the chosen stake: it locks the stake in
// escrow, draws the prize from the user's seed at the next nonce, settles the payout
// (stake × multiplier), and records the spin — all in one transaction. Returns the
// result and the new balance.
func (s *Store) Open(ctx context.Context, userID, stakeNano int64) (SpinResult, error) {
	if stakeNano < s.cfg.MinStakeNano {
		return SpinResult{}, ErrStakeTooSmall
	}
	if s.cfg.MaxStakeNano > 0 && stakeNano > s.cfg.MaxStakeNano {
		return SpinResult{}, ErrStakeTooLarge
	}
	if err := s.ensureSeed(ctx, userID); err != nil {
		return SpinResult{}, err
	}
	userAcct, err := ledger.EnsureUserBalance(ctx, s.pool, userID)
	if err != nil {
		return SpinResult{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return SpinResult{}, err
	}
	defer tx.Rollback(ctx)

	// Advance the nonce (locks the seed row) and read the seed for this draw.
	var serverSeed []byte
	var clientSeed string
	var nonce int64
	if err := tx.QueryRow(ctx,
		`UPDATE case_seeds SET nonce = nonce + 1 WHERE user_id = $1
		 RETURNING server_seed, client_seed, nonce`, userID).
		Scan(&serverSeed, &clientSeed, &nonce); err != nil {
		return SpinResult{}, err
	}
	hash := SeedHash(serverSeed)

	idx := Draw(serverSeed, clientSeed, nonce)
	prize := Prizes[idx]
	payout := payoutNano(stakeNano, prize.MultMilli)

	var spinID int64
	if err := tx.QueryRow(ctx,
		`INSERT INTO case_spins (user_id, nonce, stake_nano, prize_index, rarity,
		                         mult_milli, payout_nano)
		 VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
		userID, nonce, stakeNano, idx, prize.Rarity, prize.MultMilli, payout).
		Scan(&spinID); err != nil {
		return SpinResult{}, err
	}
	ref := fmt.Sprintf("case_spin:%d", spinID)

	// place: lock the stake in escrow (rejects if the player can't cover it).
	placeTx, err := ledger.PostTx(ctx, tx, ledger.Posting{
		Kind:      "case_place",
		Reference: ref,
		Entries: []ledger.Entry{
			{AccountID: userAcct, AmountNano: -stakeNano},
			{AccountID: s.escrow, AmountNano: stakeNano},
		},
	})
	if err != nil {
		if isBalanceCheck(err) {
			return SpinResult{}, ErrInsufficient
		}
		return SpinResult{}, err
	}

	// settle: release the stake from escrow, pay the player their payout, and the house
	// keeps (or, on a >1× win, pays) the difference. Zero legs are omitted.
	//   escrow -stake ; user +payout ; treasury +(stake-payout)
	// payout=0     → escrow→treasury (house keeps the whole stake)
	// payout=stake → escrow→user      (break-even, treasury untouched)
	// payout>stake → treasury pays the profit (may push it negative; allowed by 0014)
	entries := []ledger.Entry{{AccountID: s.escrow, AmountNano: -stakeNano}}
	if payout > 0 {
		entries = append(entries, ledger.Entry{AccountID: userAcct, AmountNano: payout})
	}
	if houseDelta := stakeNano - payout; houseDelta != 0 {
		entries = append(entries, ledger.Entry{AccountID: s.treasury, AmountNano: houseDelta})
	}
	settleTx, err := ledger.PostTx(ctx, tx, ledger.Posting{
		Kind:           "case_settle",
		Reference:      ref,
		IdempotencyKey: fmt.Sprintf("case_settle:%d", spinID),
		Entries:        entries,
	})
	if err != nil {
		if isBalanceCheck(err) { // only the treasury leg can fail here
			return SpinResult{}, ErrHouseCantCover
		}
		return SpinResult{}, err
	}

	if _, err := tx.Exec(ctx,
		`UPDATE case_spins SET ledger_tx_place = $2, ledger_tx_settle = $3 WHERE id = $1`,
		spinID, placeTx, settleTx); err != nil {
		return SpinResult{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		if isBalanceCheck(err) {
			return SpinResult{}, ErrHouseCantCover
		}
		return SpinResult{}, err
	}

	bal, err := ledger.Balance(ctx, s.pool, userAcct)
	if err != nil {
		return SpinResult{}, err
	}
	return SpinResult{
		SpinID: spinID, Nonce: nonce, PrizeIndex: idx, Rarity: prize.Rarity,
		MultMilli: prize.MultMilli, StakeNano: stakeNano, PayoutNano: payout,
		BalanceNano: bal, ServerSeedHash: hash,
	}, nil
}

// State is the fairness + economics snapshot the UI needs before a spin.
type State struct {
	ServerSeedHash string
	ClientSeed     string
	Nonce          int64
	MinStakeNano   int64
	MaxStakeNano   int64
	Prizes         []Prize
	Recent         []SpinRow
}

// SpinRow is a past spin (newest first) for the user's history strip.
type SpinRow struct {
	ID         int64     `json:"id"`
	Nonce      int64     `json:"nonce"`
	StakeNano  int64     `json:"stake_nano"`
	PrizeIndex int       `json:"prize_index"`
	Rarity     string    `json:"rarity"`
	MultMilli  int64     `json:"mult_milli"`
	PayoutNano int64     `json:"payout_nano"`
	CreatedAt  time.Time `json:"created_at"`
}

// State returns the user's current commitment (seed hash), client seed, nonce, the spin
// price and prize table, and recent spins — creating the seed on first use.
func (s *Store) State(ctx context.Context, userID int64) (State, error) {
	if err := s.ensureSeed(ctx, userID); err != nil {
		return State{}, err
	}
	st := State{MinStakeNano: s.cfg.MinStakeNano, MaxStakeNano: s.cfg.MaxStakeNano, Prizes: Prizes}
	if err := s.pool.QueryRow(ctx,
		`SELECT server_seed_hash, client_seed, nonce FROM case_seeds WHERE user_id = $1`, userID).
		Scan(&st.ServerSeedHash, &st.ClientSeed, &st.Nonce); err != nil {
		return State{}, err
	}
	recent, err := s.RecentSpins(ctx, userID, 15)
	if err != nil {
		return State{}, err
	}
	st.Recent = recent
	return st, nil
}

// RecentSpins returns the user's last n spins, newest first.
func (s *Store) RecentSpins(ctx context.Context, userID int64, n int) ([]SpinRow, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, nonce, stake_nano, prize_index, rarity, mult_milli, payout_nano, created_at
		   FROM case_spins WHERE user_id = $1 ORDER BY id DESC LIMIT $2`, userID, n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]SpinRow, 0, n)
	for rows.Next() {
		var r SpinRow
		if err := rows.Scan(&r.ID, &r.Nonce, &r.StakeNano, &r.PrizeIndex, &r.Rarity,
			&r.MultMilli, &r.PayoutNano, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// Rotation is the reveal returned when a user rotates their seed: the old server seed
// (hex) they can now verify past spins against, plus the new commitment.
type Rotation struct {
	OldServerSeed string // hex, revealed
	OldServerHash string
	SpunNonce     int64 // how many spins the old seed produced
	NewServerHash string
	NewClientSeed string
}

// RotateSeed reveals the user's current server seed and commits a fresh one, resetting
// the nonce. newClientSeed sets the next client seed (random if empty).
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
		`SELECT server_seed, server_seed_hash, nonce FROM case_seeds WHERE user_id = $1 FOR UPDATE`, userID).
		Scan(&oldSeed, &oldHash, &nonce); err != nil {
		return Rotation{}, err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE case_seeds SET server_seed = $2, server_seed_hash = $3, client_seed = $4,
		        nonce = 0, rotated_at = now() WHERE user_id = $1`,
		userID, newSeed, newHash, newClientSeed); err != nil {
		return Rotation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Rotation{}, err
	}
	return Rotation{
		OldServerSeed: hex.EncodeToString(oldSeed), OldServerHash: oldHash,
		SpunNonce: nonce, NewServerHash: newHash, NewClientSeed: newClientSeed,
	}, nil
}

// isBalanceCheck reports whether err is the non-negative-balance CHECK violation
// (code 23514) — the actor couldn't cover the move.
func isBalanceCheck(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23514"
}
