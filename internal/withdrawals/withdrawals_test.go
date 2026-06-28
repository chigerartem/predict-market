package withdrawals_test

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"predict/internal/db"
	"predict/internal/ledger"
	"predict/internal/withdrawals"
)

// A valid mainnet address (non-bounceable user form) for request validation.
const testAddr = "UQAFkMtsAYcZqfMG1ESQ-IPXjjp4nVtFM3WCfghqfL3vXIfg"

var pool *pgxpool.Pool

func TestMain(m *testing.M) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		os.Exit(0) // no DB → skip, like the other integration tests
	}
	ctx := context.Background()
	if err := db.Migrate(ctx, url); err != nil {
		panic(err)
	}
	p, err := db.Connect(ctx, url)
	if err != nil {
		panic(err)
	}
	pool = p
	code := m.Run()
	pool.Close()
	os.Exit(code)
}

func reset(t *testing.T) {
	t.Helper()
	ctx := context.Background()
	for _, q := range []string{
		`TRUNCATE withdrawals, ledger_entries, ledger_transactions RESTART IDENTITY`,
		`DELETE FROM accounts WHERE owner_user_id IS NOT NULL`,
		`DELETE FROM users`,
		`UPDATE accounts SET balance_nano = 0`,
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatalf("reset (%s): %v", q, err)
		}
	}
}

// seedUser inserts a user and credits balanceNano to their balance (mimicking a
// deposit: EXTERNAL_TON -> USER_BALANCE).
func seedUser(t *testing.T, userID, balanceNano int64) {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, first_name) VALUES ($1, 'test')`, userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	userAcct, err := ledger.EnsureUserBalance(ctx, pool, userID)
	if err != nil {
		t.Fatalf("ensure balance: %v", err)
	}
	extTON, err := ledger.SystemAccountID(ctx, pool, ledger.TypeExternalTON)
	if err != nil {
		t.Fatalf("external ton: %v", err)
	}
	if _, err := ledger.Post(ctx, pool, ledger.Posting{
		Kind: "seed",
		Entries: []ledger.Entry{
			{AccountID: extTON, AmountNano: -balanceNano},
			{AccountID: userAcct, AmountNano: balanceNano},
		},
	}); err != nil {
		t.Fatalf("seed credit: %v", err)
	}
}

func balanceOf(t *testing.T, userID int64) int64 {
	t.Helper()
	ctx := context.Background()
	acct, err := ledger.EnsureUserBalance(ctx, pool, userID)
	if err != nil {
		t.Fatalf("ensure balance: %v", err)
	}
	bal, err := ledger.Balance(ctx, pool, acct)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	return bal
}

// stubSender records sends and returns a canned hash (or an error).
type stubSender struct {
	sends []struct {
		to     string
		amount int64
	}
	err error
}

func (s *stubSender) Send(_ context.Context, to string, amountNano int64, _ string) (string, error) {
	if s.err != nil {
		return "", s.err
	}
	s.sends = append(s.sends, struct {
		to     string
		amount int64
	}{to, amountNano})
	return "deadbeef", nil
}

func TestRequestDebitsBalanceAndBooksFee(t *testing.T) {
	if pool == nil {
		t.Skip("no DATABASE_URL")
	}
	reset(t)
	const userID = int64(1001)
	seedUser(t, userID, 5*ledger.TON)

	wd, err := withdrawals.Request(context.Background(), pool, userID, testAddr, 2*ledger.TON)
	if err != nil {
		t.Fatalf("Request: %v", err)
	}
	if wd.Status != "pending" {
		t.Fatalf("status = %q, want pending", wd.Status)
	}
	if wd.SendNano != 2*ledger.TON-withdrawals.FeeNano {
		t.Fatalf("send_nano = %d, want %d", wd.SendNano, 2*ledger.TON-withdrawals.FeeNano)
	}
	// Gross amount debited from the user.
	if got, want := balanceOf(t, userID), 3*ledger.TON; got != want {
		t.Fatalf("balance after = %d, want %d", got, want)
	}
	// Fee booked as house revenue.
	feeAcct, _ := ledger.SystemAccountID(context.Background(), pool, ledger.TypeFeeRevenue)
	if fee, _ := ledger.Balance(context.Background(), pool, feeAcct); fee != withdrawals.FeeNano {
		t.Fatalf("fee revenue = %d, want %d", fee, withdrawals.FeeNano)
	}
}

func TestRequestRejectsOverdraftAndDust(t *testing.T) {
	if pool == nil {
		t.Skip("no DATABASE_URL")
	}
	reset(t)
	const userID = int64(1002)
	seedUser(t, userID, 1*ledger.TON+withdrawals.FeeNano) // just over the minimum

	// More than the balance → ErrInsufficient, balance untouched.
	if _, err := withdrawals.Request(context.Background(), pool, userID, testAddr, 10*ledger.TON); !errors.Is(err, withdrawals.ErrInsufficient) {
		t.Fatalf("overdraft err = %v, want ErrInsufficient", err)
	}
	if got := balanceOf(t, userID); got != 1*ledger.TON+withdrawals.FeeNano {
		t.Fatalf("balance changed on rejected withdraw: %d", got)
	}
	// Below the minimum → ErrAmountTooSmall.
	if _, err := withdrawals.Request(context.Background(), pool, userID, testAddr, withdrawals.MinWithdrawNano-1); !errors.Is(err, withdrawals.ErrAmountTooSmall) {
		t.Fatalf("dust err = %v, want ErrAmountTooSmall", err)
	}
	// Bad address → ErrBadAddress.
	if _, err := withdrawals.Request(context.Background(), pool, userID, "not-an-address", 1*ledger.TON); !errors.Is(err, withdrawals.ErrBadAddress) {
		t.Fatalf("bad addr err = %v, want ErrBadAddress", err)
	}
}

func TestProcessPendingSendsAndMarksSent(t *testing.T) {
	if pool == nil {
		t.Skip("no DATABASE_URL")
	}
	reset(t)
	const userID = int64(1003)
	seedUser(t, userID, 5*ledger.TON)
	wd, err := withdrawals.Request(context.Background(), pool, userID, testAddr, 2*ledger.TON)
	if err != nil {
		t.Fatalf("Request: %v", err)
	}

	sender := &stubSender{}
	n, err := withdrawals.ProcessPending(context.Background(), pool, sender, 10)
	if err != nil {
		t.Fatalf("ProcessPending: %v", err)
	}
	if n != 1 {
		t.Fatalf("sent = %d, want 1", n)
	}
	if len(sender.sends) != 1 || sender.sends[0].amount != wd.SendNano {
		t.Fatalf("sender got %+v, want one send of %d", sender.sends, wd.SendNano)
	}

	var status, txHash string
	if err := pool.QueryRow(context.Background(),
		`SELECT status, COALESCE(tx_hash, '') FROM withdrawals WHERE id = $1`, wd.ID).Scan(&status, &txHash); err != nil {
		t.Fatalf("read withdrawal: %v", err)
	}
	if status != "sent" || txHash != "deadbeef" {
		t.Fatalf("withdrawal = (%s, %s), want (sent, deadbeef)", status, txHash)
	}

	// Idempotent drain: nothing left pending.
	if n, _ := withdrawals.ProcessPending(context.Background(), pool, sender, 10); n != 0 {
		t.Fatalf("second drain sent %d, want 0", n)
	}
}

func TestProcessPendingFailureKeepsDebit(t *testing.T) {
	if pool == nil {
		t.Skip("no DATABASE_URL")
	}
	reset(t)
	const userID = int64(1004)
	seedUser(t, userID, 5*ledger.TON)
	if _, err := withdrawals.Request(context.Background(), pool, userID, testAddr, 2*ledger.TON); err != nil {
		t.Fatalf("Request: %v", err)
	}

	sender := &stubSender{err: errors.New("liteserver down")}
	if _, err := withdrawals.ProcessPending(context.Background(), pool, sender, 10); err != nil {
		t.Fatalf("ProcessPending: %v", err)
	}

	var status string
	if err := pool.QueryRow(context.Background(),
		`SELECT status FROM withdrawals WHERE user_id = $1`, userID).Scan(&status); err != nil {
		t.Fatalf("read withdrawal: %v", err)
	}
	if status != "failed" {
		t.Fatalf("status = %q, want failed", status)
	}
	// Debit is intentionally NOT reversed — funds stay out for manual review.
	if got, want := balanceOf(t, userID), 3*ledger.TON; got != want {
		t.Fatalf("balance = %d, want %d (debit must not auto-reverse)", got, want)
	}
}
