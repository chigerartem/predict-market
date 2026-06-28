// TON deposits credit native TON transfers (1:1, no conversion) into users'
// balances. Users send to one house address via TON Connect, tagging the transfer
// with their per-user memo; a chain watcher reads confirmed inbound transfers and
// calls CreditTON. See internal/ton for the watcher.
package deposits

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"predict/internal/ledger"
)

// MinTonDepositNano is the smallest inbound transfer we credit (0.1 TON). The
// watcher ignores dust below this — it would cost more in fees than it's worth.
const MinTonDepositNano = int64(100_000_000)

// memoAlphabet excludes look-alike characters (0/o, 1/l/i) so a memo glanced off a
// screen can't be mistyped into a *different* valid memo. 31^8 ≈ 8.5e11 keyspace.
const (
	memoAlphabet = "abcdefghjkmnpqrstuvwxyz23456789"
	memoLen      = 8
)

// EnsureTonMemo returns the user's deposit memo, assigning a unique one on first
// use. The memo is the comment the user attaches to their TON transfer so the
// watcher can attribute an otherwise-anonymous inbound transfer to them.
func EnsureTonMemo(ctx context.Context, pool *pgxpool.Pool, userID int64) (string, error) {
	memo, err := readMemo(ctx, pool, userID)
	if err != nil {
		return "", err
	}
	if memo != "" {
		return memo, nil
	}
	var lastErr error
	for i := 0; i < 6; i++ {
		cand, err := randomMemo()
		if err != nil {
			return "", err
		}
		// Claim the memo only if still unset; the partial unique index rejects a
		// collision with another user's memo (then we retry with a fresh one).
		ct, err := pool.Exec(ctx,
			`UPDATE users SET ton_deposit_memo = $2
			 WHERE id = $1 AND ton_deposit_memo IS NULL`, userID, cand)
		if err != nil {
			lastErr = err // most likely a unique collision on cand — try another
			continue
		}
		if ct.RowsAffected() == 1 {
			return cand, nil
		}
		// 0 rows updated: a memo was assigned concurrently between read and update.
		if memo, err = readMemo(ctx, pool, userID); err == nil && memo != "" {
			return memo, nil
		}
	}
	if lastErr != nil {
		return "", lastErr
	}
	return "", errors.New("deposits: could not assign ton memo")
}

func readMemo(ctx context.Context, pool *pgxpool.Pool, userID int64) (string, error) {
	var memo string
	err := pool.QueryRow(ctx,
		`SELECT COALESCE(ton_deposit_memo, '') FROM users WHERE id = $1`, userID).Scan(&memo)
	return memo, err
}

func randomMemo() (string, error) {
	b := make([]byte, memoLen)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	for i := range b {
		b[i] = memoAlphabet[int(b[i])%len(memoAlphabet)]
	}
	return string(b), nil
}

// UserByTonMemo resolves a transfer comment (memo) back to its user id. Returns
// pgx.ErrNoRows if the comment matches no user (a stray/garbage transfer).
func UserByTonMemo(ctx context.Context, pool *pgxpool.Pool, memo string) (int64, error) {
	var id int64
	err := pool.QueryRow(ctx, `SELECT id FROM users WHERE ton_deposit_memo = $1`, memo).Scan(&id)
	return id, err
}

// CreditTON credits a confirmed inbound TON transfer to the user's balance exactly
// once per on-chain tx hash. Native TON credits 1:1 (no conversion). Safe to call
// again with the same txHash (watcher re-poll / restart): the second call is a
// no-op, not a double-credit. Two layers guard this — the unique ton_deposits row
// and the ledger idempotency key.
func CreditTON(ctx context.Context, pool *pgxpool.Pool, userID, amountNano int64, txHash string) error {
	if amountNano <= 0 {
		return fmt.Errorf("deposits: non-positive ton amount: %d", amountNano)
	}
	if txHash == "" {
		return errors.New("deposits: empty tx hash")
	}

	userAcct, err := ledger.EnsureUserBalance(ctx, pool, userID)
	if err != nil {
		return err
	}
	extTON, err := ledger.SystemAccountID(ctx, pool, ledger.TypeExternalTON)
	if err != nil {
		return err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Already credited? Then we're done — don't credit twice.
	var existing int64
	switch err := tx.QueryRow(ctx,
		`SELECT id FROM ton_deposits WHERE tx_hash = $1`, txHash).Scan(&existing); {
	case err == nil:
		return nil
	case errors.Is(err, pgx.ErrNoRows):
		// new tx — credit it below
	default:
		return err
	}

	txID, err := ledger.PostTx(ctx, tx, ledger.Posting{
		Kind:           "deposit_ton",
		Reference:      fmt.Sprintf("user:%d", userID),
		IdempotencyKey: "ton:" + txHash,
		Entries: []ledger.Entry{
			{AccountID: extTON, AmountNano: -amountNano},
			{AccountID: userAcct, AmountNano: amountNano},
		},
	})
	if err != nil {
		return err
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO ton_deposits (user_id, tx_hash, amount_nano, ledger_tx_id)
		 VALUES ($1, $2, $3, $4)`, userID, txHash, amountNano, txID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
