// Package deposits credits external value into users' internal TON balances
// through the ledger. Stars now; TON and gifts in later phases.
package deposits

import (
	"context"
	"errors"
	"fmt"
	"math/big"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"predict/internal/ledger"
)

// StarsPerTON is the fixed Stars→TON peg. Telegram/Fragment redeems a bot's
// earned stars at exactly 200 Stars = 1 TON, so we credit deposits at the same
// rate with no spread (product decision). 1e9 nano / 200 = 5_000_000, so every
// whole-star amount converts to an exact integer nano-TON value (no rounding).
const StarsPerTON = 200

// StarsToNano converts a whole-stars amount to nano-TON at the fixed peg.
// Computed in big.Int purely for overflow safety on large amounts.
func StarsToNano(stars int64) int64 {
	n := new(big.Int).Mul(big.NewInt(stars), big.NewInt(ledger.TON))
	n.Quo(n, big.NewInt(StarsPerTON))
	return n.Int64()
}

// CreditStars credits a successful Stars payment to the user's balance exactly
// once per Telegram payment charge id. It is safe to call again with the same
// chargeID (e.g. webhook redelivery): the second call is a no-op, not a
// double-credit. Two layers guard this — the unique star_deposits row and the
// ledger idempotency key — so even concurrent redeliveries can't double-spend.
func CreditStars(ctx context.Context, pool *pgxpool.Pool, userID, stars int64, chargeID string) error {
	if stars <= 0 {
		return fmt.Errorf("deposits: non-positive stars: %d", stars)
	}
	if chargeID == "" {
		return errors.New("deposits: empty charge id")
	}
	nano := StarsToNano(stars)

	userAcct, err := ledger.EnsureUserBalance(ctx, pool, userID)
	if err != nil {
		return err
	}
	extStars, err := ledger.SystemAccountID(ctx, pool, ledger.TypeExternalStars)
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
	err = tx.QueryRow(ctx,
		`SELECT id FROM star_deposits WHERE telegram_payment_charge_id = $1`, chargeID).Scan(&existing)
	switch {
	case err == nil:
		return nil
	case errors.Is(err, pgx.ErrNoRows):
		// new charge — credit it below
	default:
		return err
	}

	txID, err := ledger.PostTx(ctx, tx, ledger.Posting{
		Kind:           "deposit_stars",
		Reference:      fmt.Sprintf("user:%d", userID),
		IdempotencyKey: "stars:" + chargeID,
		Entries: []ledger.Entry{
			{AccountID: extStars, AmountNano: -nano},
			{AccountID: userAcct, AmountNano: nano},
		},
	})
	if err != nil {
		return err
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO star_deposits (user_id, telegram_payment_charge_id, stars, credited_nano, ledger_tx_id)
		 VALUES ($1, $2, $3, $4, $5)`,
		userID, chargeID, stars, nano, txID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}
