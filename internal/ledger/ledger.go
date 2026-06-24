// Package ledger implements the double-entry money ledger. Every balance change
// goes through Post as a set of entries that net to zero. All amounts are integer
// nano-TON; never use floats for money.
package ledger

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TON is the number of nano-units in 1 TON.
const TON = int64(1_000_000_000)

// Account type names — must match the CHECK constraint in migration 0001.
const (
	TypeUserBalance      = "USER_BALANCE"
	TypeBetEscrow        = "BET_ESCROW"
	TypeLiabilityReserve = "LIABILITY_RESERVE"
	TypeHouseTreasury    = "HOUSE_TREASURY"
	TypeFeeRevenue       = "FEE_REVENUE"
	TypeGiftInventory    = "GIFT_INVENTORY"
	TypeExternalTON      = "EXTERNAL_TON"
	TypeExternalGift     = "EXTERNAL_GIFT"
)

var (
	// ErrNoEntries is returned when a posting has no entries.
	ErrNoEntries = errors.New("ledger: posting has no entries")
	// ErrUnbalanced is returned when entries do not sum to zero.
	ErrUnbalanced = errors.New("ledger: entries do not sum to zero")
)

// Entry is one leg of a transaction. Positive credits the account, negative debits it.
type Entry struct {
	AccountID  int64
	AmountNano int64
}

// Posting is a balanced set of entries applied atomically.
type Posting struct {
	Kind           string // e.g. "deposit", "bet_place", "bet_win"
	Reference      string // optional domain reference, e.g. "bet:123"
	IdempotencyKey string // optional; if already seen, the prior tx id is returned
	Metadata       []byte // optional JSON
	Entries        []Entry
}

// Post writes a balanced double-entry transaction in its own database
// transaction and returns the ledger transaction id.
func Post(ctx context.Context, pool *pgxpool.Pool, p Posting) (int64, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	id, err := PostTx(ctx, tx, p)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err // deferred zero-sum trigger and CHECK constraints fire here
	}
	return id, nil
}

// PostTx writes a balanced double-entry transaction within an existing database
// transaction, so ledger writes compose atomically with other domain writes
// (e.g. inserting a bet in the same tx). The caller is responsible for committing.
func PostTx(ctx context.Context, tx pgx.Tx, p Posting) (int64, error) {
	if len(p.Entries) == 0 {
		return 0, ErrNoEntries
	}
	var sum int64
	for _, e := range p.Entries {
		sum += e.AmountNano
	}
	if sum != 0 {
		return 0, fmt.Errorf("%w: sum=%d", ErrUnbalanced, sum)
	}

	if p.IdempotencyKey != "" {
		var existing int64
		err := tx.QueryRow(ctx,
			`SELECT id FROM ledger_transactions WHERE idempotency_key = $1`,
			p.IdempotencyKey).Scan(&existing)
		switch {
		case err == nil:
			return existing, nil // already applied
		case errors.Is(err, pgx.ErrNoRows):
			// not seen — create it below
		default:
			return 0, err
		}
	}

	metadata := p.Metadata
	if len(metadata) == 0 {
		metadata = []byte("{}")
	}

	var txID int64
	if err := tx.QueryRow(ctx,
		`INSERT INTO ledger_transactions (kind, reference, idempotency_key, metadata)
		 VALUES ($1, $2, NULLIF($3, ''), $4::jsonb)
		 RETURNING id`,
		p.Kind, p.Reference, p.IdempotencyKey, string(metadata)).Scan(&txID); err != nil {
		return 0, err
	}

	// Apply in a deterministic account order to avoid deadlocks under concurrency.
	entries := append([]Entry(nil), p.Entries...)
	sort.Slice(entries, func(i, j int) bool { return entries[i].AccountID < entries[j].AccountID })

	for _, e := range entries {
		if _, err := tx.Exec(ctx,
			`INSERT INTO ledger_entries (tx_id, account_id, amount_nano) VALUES ($1, $2, $3)`,
			txID, e.AccountID, e.AmountNano); err != nil {
			return 0, err
		}
		if _, err := tx.Exec(ctx,
			`UPDATE accounts SET balance_nano = balance_nano + $2 WHERE id = $1`,
			e.AccountID, e.AmountNano); err != nil {
			return 0, fmt.Errorf("update balance for account %d: %w", e.AccountID, err)
		}
	}

	return txID, nil
}

// Balance returns the current balance (nano-TON) of an account.
func Balance(ctx context.Context, pool *pgxpool.Pool, accountID int64) (int64, error) {
	var b int64
	err := pool.QueryRow(ctx, `SELECT balance_nano FROM accounts WHERE id = $1`, accountID).Scan(&b)
	return b, err
}

// SystemAccountID returns the id of the singleton system account of the given type.
func SystemAccountID(ctx context.Context, pool *pgxpool.Pool, accType string) (int64, error) {
	var id int64
	err := pool.QueryRow(ctx,
		`SELECT id FROM accounts WHERE type = $1 AND owner_user_id IS NULL`, accType).Scan(&id)
	return id, err
}

// EnsureUserBalance returns the user's balance account id, creating it if absent.
func EnsureUserBalance(ctx context.Context, pool *pgxpool.Pool, userID int64) (int64, error) {
	var id int64
	err := pool.QueryRow(ctx,
		`INSERT INTO accounts (type, owner_user_id, allow_negative)
		 VALUES ('USER_BALANCE', $1, false)
		 ON CONFLICT (owner_user_id, type) WHERE owner_user_id IS NOT NULL
		 DO UPDATE SET owner_user_id = accounts.owner_user_id
		 RETURNING id`, userID).Scan(&id)
	return id, err
}

// UserBalanceID returns the user's existing balance account id within a tx.
func UserBalanceID(ctx context.Context, tx pgx.Tx, userID int64) (int64, error) {
	var id int64
	err := tx.QueryRow(ctx,
		`SELECT id FROM accounts WHERE owner_user_id = $1 AND type = 'USER_BALANCE'`, userID).Scan(&id)
	return id, err
}
