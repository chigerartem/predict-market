// Package withdrawals handles TON payouts. A request debits the user's balance
// atomically (USER_BALANCE -> EXTERNAL_TON for the sent part, + FEE_REVENUE for the
// withheld fee) and records a 'pending' row; a background sender then signs and
// broadcasts the on-chain transfer from the house hot wallet (see internal/ton).
// All amounts are integer nano-TON — never floats for money.
package withdrawals

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"predict/internal/ledger"
	"predict/internal/ton"
)

const (
	// MinWithdrawNano is the smallest payout we accept (1 TON). Below this the
	// network fee would dominate.
	MinWithdrawNano = int64(1_000_000_000)
	// FeeNano is withheld from each withdrawal to cover the on-chain send. The
	// excess over the actual gas (~0.0055 TON for a simple transfer) is house
	// revenue. The user receives amount - FeeNano.
	FeeNano = int64(50_000_000) // 0.05 TON
)

var (
	// ErrAmountTooSmall is returned for requests below MinWithdrawNano (or whose
	// net send after the fee would be non-positive).
	ErrAmountTooSmall = errors.New("withdrawals: amount below minimum")
	// ErrBadAddress is returned when the destination address can't be parsed.
	ErrBadAddress = ton.ErrBadAddress
	// ErrInsufficient is returned when the balance can't cover the requested gross
	// amount (enforced atomically by the ledger's non-negative CHECK).
	ErrInsufficient = errors.New("withdrawals: insufficient balance")
)

// Sender is the subset of *ton.Sender that ProcessPending needs (also lets tests
// stub the on-chain send).
type Sender interface {
	Send(ctx context.Context, to string, amountNano int64, comment string) (string, error)
}

// Withdrawal is a payout row as returned to the API/worker.
type Withdrawal struct {
	ID         int64
	Status     string
	AmountNano int64 // gross, debited from balance
	FeeNano    int64 // withheld fee
	SendNano   int64 // actually sent on-chain (amount - fee)
	ToAddress  string
}

// Request validates and books a withdrawal: it debits amountNano from the user's
// balance and inserts a 'pending' row for the sender. The on-chain transfer happens
// later in ProcessPending. Returns ErrInsufficient if the balance can't cover it.
func Request(ctx context.Context, pool *pgxpool.Pool, userID int64, toAddress string, amountNano int64) (Withdrawal, error) {
	toAddress = strings.TrimSpace(toAddress)
	if err := ton.ValidateAddress(toAddress); err != nil {
		return Withdrawal{}, ErrBadAddress
	}
	if amountNano < MinWithdrawNano {
		return Withdrawal{}, ErrAmountTooSmall
	}
	sendNano := amountNano - FeeNano
	if sendNano <= 0 {
		return Withdrawal{}, ErrAmountTooSmall
	}

	userAcct, err := ledger.EnsureUserBalance(ctx, pool, userID)
	if err != nil {
		return Withdrawal{}, err
	}
	extTON, err := ledger.SystemAccountID(ctx, pool, ledger.TypeExternalTON)
	if err != nil {
		return Withdrawal{}, err
	}
	feeAcct, err := ledger.SystemAccountID(ctx, pool, ledger.TypeFeeRevenue)
	if err != nil {
		return Withdrawal{}, err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return Withdrawal{}, err
	}
	defer tx.Rollback(ctx)

	// Debit the user; the sent part leaves the system (EXTERNAL_TON), the fee is
	// booked as house revenue. The accounts non-negative CHECK rejects an
	// overdraft, surfacing as ErrInsufficient.
	ledgerTxID, err := ledger.PostTx(ctx, tx, ledger.Posting{
		Kind:      "withdraw_ton",
		Reference: fmt.Sprintf("user:%d", userID),
		Entries: []ledger.Entry{
			{AccountID: userAcct, AmountNano: -amountNano},
			{AccountID: extTON, AmountNano: sendNano},
			{AccountID: feeAcct, AmountNano: FeeNano},
		},
	})
	if err != nil {
		if isOverdraft(err) {
			return Withdrawal{}, ErrInsufficient
		}
		return Withdrawal{}, err
	}

	w := Withdrawal{Status: "pending", AmountNano: amountNano, FeeNano: FeeNano, SendNano: sendNano, ToAddress: toAddress}
	if err := tx.QueryRow(ctx,
		`INSERT INTO withdrawals (user_id, to_address, amount_nano, fee_nano, send_nano, ledger_tx_id)
		 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		userID, toAddress, amountNano, FeeNano, sendNano, ledgerTxID).Scan(&w.ID); err != nil {
		return Withdrawal{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		if isOverdraft(err) {
			return Withdrawal{}, ErrInsufficient
		}
		return Withdrawal{}, err
	}
	return w, nil
}

// ProcessPending claims up to `max` pending withdrawals (oldest first) and
// broadcasts each on-chain. Success marks the row 'sent' with the tx hash. A send
// error marks it 'failed' WITHOUT reversing the ledger debit: the broadcast may
// have gone through, so the safe default is manual review over risking a double
// payout or a double credit. Returns how many were sent successfully.
func ProcessPending(ctx context.Context, pool *pgxpool.Pool, sender Sender, max int) (int, error) {
	sent := 0
	for i := 0; i < max; i++ {
		w, ok, err := claimPending(ctx, pool)
		if err != nil {
			return sent, err
		}
		if !ok {
			break // no pending rows left
		}
		hash, err := sender.Send(ctx, w.ToAddress, w.SendNano, fmt.Sprintf("Withdrawal #%d", w.ID))
		if err != nil {
			markFailed(ctx, pool, w.ID, err.Error())
			log.Printf("withdrawals: send #%d FAILED — needs manual review, ledger NOT reversed: %v", w.ID, err)
			continue
		}
		if err := markSent(ctx, pool, w.ID, hash); err != nil {
			// Paid on-chain but the DB write failed: the row is stuck in 'sending'.
			// Surface loudly; a re-run won't re-send (it's no longer 'pending').
			log.Printf("withdrawals: #%d sent on-chain (tx %s) but DB update failed: %v", w.ID, hash, err)
			return sent, err
		}
		sent++
	}
	return sent, nil
}

// claimPending atomically flips the oldest pending row to 'sending' and returns it,
// so it can't be picked up twice. ok is false when nothing is pending.
func claimPending(ctx context.Context, pool *pgxpool.Pool) (Withdrawal, bool, error) {
	var w Withdrawal
	err := pool.QueryRow(ctx,
		`UPDATE withdrawals SET status = 'sending'
		   WHERE id = (
		     SELECT id FROM withdrawals WHERE status = 'pending'
		     ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
		 RETURNING id, to_address, send_nano`).Scan(&w.ID, &w.ToAddress, &w.SendNano)
	if errors.Is(err, pgx.ErrNoRows) {
		return Withdrawal{}, false, nil
	}
	if err != nil {
		return Withdrawal{}, false, err
	}
	return w, true, nil
}

func markSent(ctx context.Context, pool *pgxpool.Pool, id int64, txHash string) error {
	_, err := pool.Exec(ctx,
		`UPDATE withdrawals SET status = 'sent', tx_hash = $2, sent_at = now() WHERE id = $1`,
		id, txHash)
	return err
}

func markFailed(ctx context.Context, pool *pgxpool.Pool, id int64, reason string) {
	if _, err := pool.Exec(ctx,
		`UPDATE withdrawals SET status = 'failed', error = $2 WHERE id = $1`, id, reason); err != nil {
		log.Printf("withdrawals: mark #%d failed: %v", id, err)
	}
}

// isOverdraft reports whether err is the accounts non-negative CHECK violation
// (Postgres check_violation, 23514) raised when a debit would overdraw a balance.
func isOverdraft(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23514"
}
