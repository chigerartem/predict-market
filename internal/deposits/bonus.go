package deposits

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"predict/internal/ledger"
)

// GrantSignupBonus credits a one-time test bonus of amountNano to the user's TON
// balance, exactly once per user. The ledger idempotency key (signup_bonus:<userID>)
// makes repeat calls a no-op, so it's safe to call on every app open. Booked from
// EXTERNAL_TON like a deposit (that account mirrors the outside world and may go
// negative). amountNano <= 0 is a no-op.
//
// This is a TEST-PHASE convenience (withdrawals are disabled, balances are play
// money) so newcomers can try the games without depositing. Gate it with the
// SIGNUP_BONUS_NANO env / Server.signupBonusNano — set 0 to disable.
func GrantSignupBonus(ctx context.Context, pool *pgxpool.Pool, userID, amountNano int64) error {
	if amountNano <= 0 {
		return nil
	}
	userAcct, err := ledger.EnsureUserBalance(ctx, pool, userID)
	if err != nil {
		return err
	}
	extTON, err := ledger.SystemAccountID(ctx, pool, ledger.TypeExternalTON)
	if err != nil {
		return err
	}
	_, err = ledger.Post(ctx, pool, ledger.Posting{
		Kind:           "signup_bonus",
		Reference:      fmt.Sprintf("user:%d", userID),
		IdempotencyKey: fmt.Sprintf("signup_bonus:%d", userID),
		Entries: []ledger.Entry{
			{AccountID: extTON, AmountNano: -amountNano},
			{AccountID: userAcct, AmountNano: amountNano},
		},
	})
	return err
}
