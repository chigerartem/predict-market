package rocket

import (
	"context"
	"errors"
	"fmt"
	"math/big"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"predict/internal/ledger"
)

var (
	// ErrRoundNotFound — the round row is gone (should not happen in normal flow).
	ErrRoundNotFound = errors.New("rocket: round not found")
	// ErrBettingClosed — the round is no longer accepting bets.
	ErrBettingClosed = errors.New("rocket: betting is closed")
	// ErrAlreadyInRound — the user already has a bet in this round.
	ErrAlreadyInRound = errors.New("rocket: already bet in this round")
	// ErrNoActiveBet — no un-cashed bet to cash out (already settled, busted, or none).
	ErrNoActiveBet = errors.New("rocket: no active bet")
	// ErrInsufficient — the user can't cover the stake.
	ErrInsufficient = errors.New("rocket: insufficient balance")
)

// Store persists rounds/bets and books the money through the ledger. The escrow and
// treasury system-account ids are resolved once at construction.
type Store struct {
	pool     *pgxpool.Pool
	escrow   int64
	treasury int64
}

// NewStore resolves the ledger system accounts the game posts against.
func NewStore(ctx context.Context, pool *pgxpool.Pool) (*Store, error) {
	escrow, err := ledger.SystemAccountID(ctx, pool, ledger.TypeBetEscrow)
	if err != nil {
		return nil, fmt.Errorf("resolve escrow account: %w", err)
	}
	treasury, err := ledger.SystemAccountID(ctx, pool, ledger.TypeHouseTreasury)
	if err != nil {
		return nil, fmt.Errorf("resolve treasury account: %w", err)
	}
	return &Store{pool: pool, escrow: escrow, treasury: treasury}, nil
}

// payoutNano = floor(stake * multMilli / 1000), in big.Int to avoid overflow.
func payoutNano(stakeNano, multMilli int64) int64 {
	p := new(big.Int).Mul(big.NewInt(stakeNano), big.NewInt(multMilli))
	p.Quo(p, big.NewInt(1000))
	return p.Int64()
}

// InsertRound creates a BETTING round with its published seed commitment and
// returns the new id. The crash point is set separately (it depends on the id).
func (s *Store) InsertRound(ctx context.Context, seedHash string) (int64, error) {
	var id int64
	err := s.pool.QueryRow(ctx,
		`INSERT INTO rocket_rounds (server_seed_hash, status) VALUES ($1, 'BETTING') RETURNING id`,
		seedHash).Scan(&id)
	return id, err
}

// SetRoundCrash stores the (still secret) crash point derived from the round's seed
// and id. Kept out of every broadcast until the round crashes.
func (s *Store) SetRoundCrash(ctx context.Context, id, crashMilli int64) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE rocket_rounds SET crash_multiplier_milli = $2 WHERE id = $1`, id, crashMilli)
	return err
}

// StartFlying marks the round FLYING and stamps its start time.
func (s *Store) StartFlying(ctx context.Context, id int64) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE rocket_rounds SET status = 'FLYING', started_at = now() WHERE id = $1`, id)
	return err
}

// PlaceBet locks the stake in escrow and records a PLACED bet, all in one tx. It
// re-checks the round is still BETTING inside the tx (closing the race with the
// engine flipping to FLYING) and enforces one bet per user per round.
func (s *Store) PlaceBet(ctx context.Context, roundID, userID, stakeNano int64) (int64, error) {
	// Ensure the user's balance account exists before opening the tx.
	if _, err := ledger.EnsureUserBalance(ctx, s.pool, userID); err != nil {
		return 0, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	var status string
	err = tx.QueryRow(ctx,
		`SELECT status FROM rocket_rounds WHERE id = $1 FOR UPDATE`, roundID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrRoundNotFound
	} else if err != nil {
		return 0, err
	}
	if status != "BETTING" {
		return 0, ErrBettingClosed
	}

	var betID int64
	err = tx.QueryRow(ctx,
		`INSERT INTO rocket_bets (round_id, user_id, stake_nano, status)
		 VALUES ($1, $2, $3, 'PLACED') RETURNING id`,
		roundID, userID, stakeNano).Scan(&betID)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" { // unique_violation
			return 0, ErrAlreadyInRound
		}
		return 0, err
	}

	userAcct, err := ledger.UserBalanceID(ctx, tx, userID)
	if err != nil {
		return 0, err
	}
	placeTx, err := ledger.PostTx(ctx, tx, ledger.Posting{
		Kind:      "rocket_place",
		Reference: fmt.Sprintf("rocket_bet:%d", betID),
		Entries: []ledger.Entry{
			{AccountID: userAcct, AmountNano: -stakeNano},
			{AccountID: s.escrow, AmountNano: stakeNano},
		},
	})
	if err != nil {
		if isBalanceCheck(err) {
			return 0, ErrInsufficient
		}
		return 0, err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE rocket_bets SET ledger_tx_place = $2 WHERE id = $1`, betID, placeTx); err != nil {
		return 0, err
	}

	if err := tx.Commit(ctx); err != nil {
		if isBalanceCheck(err) { // deferred CHECK can also fire at commit
			return 0, ErrInsufficient
		}
		return 0, err
	}
	return betID, nil
}

// Cashout settles the user's PLACED bet in this round at multMilli: the stake comes
// back from escrow and the profit from the treasury. The status guard
// (status='PLACED') makes it exactly-once and mutually exclusive with a bust.
// Returns the payout (nano). ErrNoActiveBet if there's nothing to cash out.
func (s *Store) Cashout(ctx context.Context, roundID, userID, multMilli int64) (int64, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	var betID, stake int64
	err = tx.QueryRow(ctx,
		`SELECT id, stake_nano FROM rocket_bets
		   WHERE round_id = $1 AND user_id = $2 AND status = 'PLACED' FOR UPDATE`,
		roundID, userID).Scan(&betID, &stake)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNoActiveBet
	} else if err != nil {
		return 0, err
	}

	payout := payoutNano(stake, multMilli)
	profit := payout - stake
	userAcct, err := ledger.UserBalanceID(ctx, tx, userID)
	if err != nil {
		return 0, err
	}

	entries := []ledger.Entry{
		{AccountID: userAcct, AmountNano: payout},
		{AccountID: s.escrow, AmountNano: -stake},
	}
	if profit > 0 {
		entries = append(entries, ledger.Entry{AccountID: s.treasury, AmountNano: -profit})
	}
	settleTx, err := ledger.PostTx(ctx, tx, ledger.Posting{
		Kind:           "rocket_cashout",
		Reference:      fmt.Sprintf("rocket_bet:%d", betID),
		IdempotencyKey: fmt.Sprintf("rocket_cashout:%d", betID),
		Entries:        entries,
	})
	if err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE rocket_bets
		    SET status = 'WON', cashout_multiplier_milli = $2, payout_nano = $3,
		        ledger_tx_settle = $4, settled_at = now()
		  WHERE id = $1`,
		betID, multMilli, payout, settleTx); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return payout, nil
}

// CrashRound reveals the seed, marks the round CRASHED, and busts every bet still
// PLACED (escrow → treasury). Idempotent per bet via ledger keys; safe to run once
// per round. Returns the number of busted bets.
func (s *Store) CrashRound(ctx context.Context, roundID int64, seed []byte) (int, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx,
		`UPDATE rocket_rounds SET status = 'CRASHED', server_seed = $2, crashed_at = now()
		  WHERE id = $1 AND status = 'FLYING'`, roundID, seed); err != nil {
		return 0, err
	}

	rows, err := tx.Query(ctx,
		`SELECT id, stake_nano FROM rocket_bets
		   WHERE round_id = $1 AND status = 'PLACED' FOR UPDATE`, roundID)
	if err != nil {
		return 0, err
	}
	type pending struct{ id, stake int64 }
	var bets []pending
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.id, &p.stake); err != nil {
			rows.Close()
			return 0, err
		}
		bets = append(bets, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	for _, p := range bets {
		settleTx, err := ledger.PostTx(ctx, tx, ledger.Posting{
			Kind:           "rocket_bust",
			Reference:      fmt.Sprintf("rocket_bet:%d", p.id),
			IdempotencyKey: fmt.Sprintf("rocket_bust:%d", p.id),
			Entries: []ledger.Entry{
				{AccountID: s.escrow, AmountNano: -p.stake},
				{AccountID: s.treasury, AmountNano: p.stake},
			},
		})
		if err != nil {
			return 0, err
		}
		if _, err := tx.Exec(ctx,
			`UPDATE rocket_bets SET status = 'LOST', ledger_tx_settle = $2, settled_at = now()
			  WHERE id = $1`, p.id, settleTx); err != nil {
			return 0, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(bets), nil
}

// RecentCrashes returns the crash points (milli) of the last n crashed rounds,
// newest first — for the trend strip in the UI.
func (s *Store) RecentCrashes(ctx context.Context, n int) ([]int64, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT crash_multiplier_milli FROM rocket_rounds
		   WHERE status = 'CRASHED' AND crash_multiplier_milli IS NOT NULL
		   ORDER BY id DESC LIMIT $1`, n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var m int64
		if err := rows.Scan(&m); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// isBalanceCheck reports whether err is the non-negative-balance CHECK violation
// (code 23514), i.e. the actor couldn't cover the move.
func isBalanceCheck(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23514"
}
