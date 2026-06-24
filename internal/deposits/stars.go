// Package deposits credits external value into users' internal TON balances
// through the ledger. Stars now; TON and gifts in later phases.
package deposits

import (
	"context"
	"errors"
	"fmt"
	"math"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"predict/internal/ledger"
)

// Stars are priced in USD by Telegram, not in TON: a bot realizes ~$0.013 per
// earned star on Fragment withdrawal. So we credit a deposit by converting that
// USD value to TON at the LIVE TON price, minus a buffer covering the Fragment
// spread and TON volatility over the 21-day withdrawal hold. These are vars (not
// consts) so cmd/api can override them from env without a rebuild.
var (
	// StarUSDWithdraw — USD a bot realizes per earned star on Fragment (~$0.013).
	StarUSDWithdraw = 0.013
	// DepositBuffer — haircut applied when crediting (0.90 = keep 10% as cushion).
	DepositBuffer = 0.90
)

// StarsToNano converts a stars amount to nano-TON at the given live TON/USD price:
//
//	nano = stars × StarUSDWithdraw × DepositBuffer ÷ tonUSD × 1e9
//
// Returns 0 if the price or stars are non-positive (caller treats 0 as
// "rate unavailable" and rejects the credit rather than crediting nothing).
func StarsToNano(stars int64, tonUSD float64) int64 {
	if tonUSD <= 0 || stars <= 0 {
		return 0
	}
	tonValue := float64(stars) * StarUSDWithdraw * DepositBuffer / tonUSD
	return int64(math.Round(tonValue * float64(ledger.TON)))
}

// CreditStars credits a successful Stars payment to the user's balance exactly
// once per Telegram payment charge id, converting at the supplied live TON/USD
// price. Safe to call again with the same chargeID (e.g. webhook redelivery): the
// second call is a no-op, not a double-credit. Two layers guard this — the unique
// star_deposits row and the ledger idempotency key — so even concurrent
// redeliveries can't double-spend.
func CreditStars(ctx context.Context, pool *pgxpool.Pool, userID, stars int64, chargeID string, tonUSD float64) error {
	if stars <= 0 {
		return fmt.Errorf("deposits: non-positive stars: %d", stars)
	}
	if chargeID == "" {
		return errors.New("deposits: empty charge id")
	}
	nano := StarsToNano(stars, tonUSD)
	if nano <= 0 {
		return errors.New("deposits: could not value stars (no live TON price)")
	}

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
		`INSERT INTO star_deposits (user_id, telegram_payment_charge_id, stars, credited_nano, ledger_tx_id, ton_usd_milli)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		userID, chargeID, stars, nano, txID, int64(math.Round(tonUSD*1000))); err != nil {
		return err
	}

	return tx.Commit(ctx)
}
