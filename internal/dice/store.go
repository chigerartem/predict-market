package dice

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
	// ErrInvalidBet — the bet kind/target combination is not legal.
	ErrInvalidBet = errors.New("dice: invalid bet")
	// ErrStakeTooSmall / ErrStakeTooLarge — stake outside the configured bounds.
	ErrStakeTooSmall = errors.New("dice: stake too small")
	ErrStakeTooLarge = errors.New("dice: stake too large")
	// ErrInsufficient — the player can't cover the stake.
	ErrInsufficient = errors.New("dice: insufficient balance")
	// ErrHouseCantCover — the treasury can't cover this win (stake too large for the
	// current bankroll). Structural: the ledger's non-negative CHECK rejects it.
	ErrHouseCantCover = errors.New("dice: house can't cover payout")
)

// Config tunes the economics. Amounts are nano-TON; the edge is basis points.
type Config struct {
	EdgeBp       int64 // house edge, e.g. 500 = 5%
	MinStakeNano int64
	MaxStakeNano int64 // 0 = no cap
}

// DefaultConfig: 12% edge, min stake 0.1 TON, NO max stake (0 = uncapped — operator
// decision for the test phase; the real cap is the player's own balance). Edge is
// higher than Ракета's 5% on purpose — dice bets (especially the exact-sum jackpots)
// carry far more variance, which the house must price in; real casinos charge 10–17%
// on the equivalent craps/Sic Bo "exact number" bets.
func DefaultConfig() Config {
	return Config{EdgeBp: 1200, MinStakeNano: 100_000_000, MaxStakeNano: 0}
}

// Store persists per-user seeds and rolls and books the money through the ledger.
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

// Config exposes the economics so the API can hand them (and the multiplier table)
// to the client.
func (s *Store) Config() Config { return s.cfg }

// payoutNano = floor(stake * multMilli / 1000), in big.Int to avoid overflow.
func payoutNano(stakeNano, multMilli int64) int64 {
	p := new(big.Int).Mul(big.NewInt(stakeNano), big.NewInt(multMilli))
	p.Quo(p, big.NewInt(1000))
	if !p.IsInt64() {
		return 0 // overflow guard (balance-gated; unreachable in practice)
	}
	return p.Int64()
}

// ensureSeed creates the user's seed row if absent (random server seed, its hash,
// a random default client seed, nonce 0). Idempotent.
func (s *Store) ensureSeed(ctx context.Context, userID int64) error {
	seed, err := GenerateSeed()
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx,
		`INSERT INTO dice_seeds (user_id, server_seed, server_seed_hash, client_seed)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (user_id) DO NOTHING`,
		userID, seed, SeedHash(seed), GenerateClientSeed())
	return err
}

// RollResult is the outcome of one roll.
type RollResult struct {
	RollID         int64
	Nonce          int64
	Die1, Die2     int
	Sum            int
	Won            bool
	MultMilli      int64
	PayoutNano     int64
	BalanceNano    int64
	ServerSeedHash string
}

// Roll plays one instant round for userID: it locks the stake, draws the dice from
// the user's seed at the next nonce, settles win or loss, and records the roll —
// all in one transaction. Returns the result and the new balance.
func (s *Store) Roll(ctx context.Context, userID int64, kind string, target int, stakeNano int64) (RollResult, error) {
	if !ValidBet(kind, target) {
		return RollResult{}, ErrInvalidBet
	}
	if stakeNano < s.cfg.MinStakeNano {
		return RollResult{}, ErrStakeTooSmall
	}
	if s.cfg.MaxStakeNano > 0 && stakeNano > s.cfg.MaxStakeNano {
		return RollResult{}, ErrStakeTooLarge
	}
	if err := s.ensureSeed(ctx, userID); err != nil {
		return RollResult{}, err
	}
	userAcct, err := ledger.EnsureUserBalance(ctx, s.pool, userID)
	if err != nil {
		return RollResult{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return RollResult{}, err
	}
	defer tx.Rollback(ctx)

	// Advance the nonce (locks the seed row) and read the seed for this draw.
	var serverSeed []byte
	var clientSeed string
	var nonce int64
	if err := tx.QueryRow(ctx,
		`UPDATE dice_seeds SET nonce = nonce + 1 WHERE user_id = $1
		 RETURNING server_seed, client_seed, nonce`, userID).
		Scan(&serverSeed, &clientSeed, &nonce); err != nil {
		return RollResult{}, err
	}
	hash := SeedHash(serverSeed)

	d1, d2 := Roll(serverSeed, clientSeed, nonce)
	sum := d1 + d2
	ways := Ways(kind, target)
	mult := MultMilli(s.cfg.EdgeBp, ways)
	won := Wins(kind, target, sum)
	var payout int64
	if won {
		payout = payoutNano(stakeNano, mult)
	}

	var targetArg any
	if kind == BetExact {
		targetArg = target
	}
	var rollID int64
	if err := tx.QueryRow(ctx,
		`INSERT INTO dice_rolls (user_id, nonce, bet_kind, bet_target, stake_nano,
		                         die1, die2, sum, won, mult_milli, payout_nano)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
		userID, nonce, kind, targetArg, stakeNano, d1, d2, sum, won, mult, payout).
		Scan(&rollID); err != nil {
		return RollResult{}, err
	}
	ref := fmt.Sprintf("dice_roll:%d", rollID)

	// place: lock the stake in escrow (rejects if the player can't cover it).
	placeTx, err := ledger.PostTx(ctx, tx, ledger.Posting{
		Kind:      "dice_place",
		Reference: ref,
		Entries: []ledger.Entry{
			{AccountID: userAcct, AmountNano: -stakeNano},
			{AccountID: s.escrow, AmountNano: stakeNano},
		},
	})
	if err != nil {
		if isBalanceCheck(err) {
			return RollResult{}, ErrInsufficient
		}
		return RollResult{}, err
	}

	// settle: win pays stake+profit out (escrow + treasury → user); loss sends the
	// stake to the house (escrow → treasury).
	var entries []ledger.Entry
	kindStr := "dice_lose"
	if won {
		profit := payout - stakeNano
		kindStr = "dice_win"
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
		IdempotencyKey: fmt.Sprintf("dice_settle:%d", rollID),
		Entries:        entries,
	})
	if err != nil {
		if isBalanceCheck(err) { // only the treasury leg can fail here
			return RollResult{}, ErrHouseCantCover
		}
		return RollResult{}, err
	}

	if _, err := tx.Exec(ctx,
		`UPDATE dice_rolls SET ledger_tx_place = $2, ledger_tx_settle = $3 WHERE id = $1`,
		rollID, placeTx, settleTx); err != nil {
		return RollResult{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		if isBalanceCheck(err) {
			return RollResult{}, ErrHouseCantCover
		}
		return RollResult{}, err
	}

	bal, err := ledger.Balance(ctx, s.pool, userAcct)
	if err != nil {
		return RollResult{}, err
	}
	return RollResult{
		RollID: rollID, Nonce: nonce, Die1: d1, Die2: d2, Sum: sum,
		Won: won, MultMilli: mult, PayoutNano: payout, BalanceNano: bal,
		ServerSeedHash: hash,
	}, nil
}

// State is the fairness + economics snapshot the UI needs before a roll.
type State struct {
	ServerSeedHash string
	ClientSeed     string
	Nonce          int64
	Recent         []RollRow
}

// RollRow is a past roll (newest first) for the user's history strip.
type RollRow struct {
	ID         int64     `json:"id"`
	Nonce      int64     `json:"nonce"`
	BetKind    string    `json:"bet_kind"`
	BetTarget  *int      `json:"bet_target,omitempty"`
	StakeNano  int64     `json:"stake_nano"`
	Die1       int       `json:"die1"`
	Die2       int       `json:"die2"`
	Sum        int       `json:"sum"`
	Won        bool      `json:"won"`
	MultMilli  int64     `json:"mult_milli"`
	PayoutNano int64     `json:"payout_nano"`
	CreatedAt  time.Time `json:"created_at"`
}

// State returns the user's current commitment (seed hash), client seed, nonce, and
// recent rolls, creating the seed on first use.
func (s *Store) State(ctx context.Context, userID int64) (State, error) {
	if err := s.ensureSeed(ctx, userID); err != nil {
		return State{}, err
	}
	var st State
	if err := s.pool.QueryRow(ctx,
		`SELECT server_seed_hash, client_seed, nonce FROM dice_seeds WHERE user_id = $1`, userID).
		Scan(&st.ServerSeedHash, &st.ClientSeed, &st.Nonce); err != nil {
		return State{}, err
	}
	recent, err := s.RecentRolls(ctx, userID, 15)
	if err != nil {
		return State{}, err
	}
	st.Recent = recent
	return st, nil
}

// RecentRolls returns the user's last n rolls, newest first.
func (s *Store) RecentRolls(ctx context.Context, userID int64, n int) ([]RollRow, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, nonce, bet_kind, bet_target, stake_nano, die1, die2, sum, won,
		        mult_milli, payout_nano, created_at
		   FROM dice_rolls WHERE user_id = $1 ORDER BY id DESC LIMIT $2`, userID, n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]RollRow, 0, n)
	for rows.Next() {
		var r RollRow
		if err := rows.Scan(&r.ID, &r.Nonce, &r.BetKind, &r.BetTarget, &r.StakeNano,
			&r.Die1, &r.Die2, &r.Sum, &r.Won, &r.MultMilli, &r.PayoutNano, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// Rotation is the reveal returned when a user rotates their seed: the old server
// seed (hex) they can now verify past rolls against, plus the new commitment.
type Rotation struct {
	OldServerSeed string // hex, revealed
	OldServerHash string
	RolledNonce   int64 // how many rolls the old seed produced
	NewServerHash string
	NewClientSeed string
}

// RotateSeed reveals the user's current server seed and commits a fresh one,
// resetting the nonce. newClientSeed sets the next client seed (random if empty).
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
		`SELECT server_seed, server_seed_hash, nonce FROM dice_seeds WHERE user_id = $1 FOR UPDATE`, userID).
		Scan(&oldSeed, &oldHash, &nonce); err != nil {
		return Rotation{}, err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE dice_seeds SET server_seed = $2, server_seed_hash = $3, client_seed = $4,
		        nonce = 0, rotated_at = now() WHERE user_id = $1`,
		userID, newSeed, newHash, newClientSeed); err != nil {
		return Rotation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Rotation{}, err
	}
	return Rotation{
		OldServerSeed: hex.EncodeToString(oldSeed), OldServerHash: oldHash,
		RolledNonce: nonce, NewServerHash: newHash, NewClientSeed: newClientSeed,
	}, nil
}

// isBalanceCheck reports whether err is the non-negative-balance CHECK violation
// (code 23514) — the actor couldn't cover the move.
func isBalanceCheck(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23514"
}
