package ledger_test

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"predict/internal/db"
	"predict/internal/ledger"
)

const TON = ledger.TON

var pool *pgxpool.Pool

func TestMain(m *testing.M) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		// Integration tests need a database; skip when not configured.
		os.Exit(0)
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
		`TRUNCATE ledger_entries, ledger_transactions RESTART IDENTITY CASCADE`,
		`DELETE FROM accounts WHERE owner_user_id IS NOT NULL`,
		`UPDATE accounts SET balance_nano = 0`,
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatalf("reset (%s): %v", q, err)
		}
	}
}

func sysID(t *testing.T, typ string) int64 {
	t.Helper()
	id, err := ledger.SystemAccountID(context.Background(), pool, typ)
	if err != nil {
		t.Fatalf("system account %s: %v", typ, err)
	}
	return id
}

func userAcct(t *testing.T, uid int64) int64 {
	t.Helper()
	id, err := ledger.EnsureUserBalance(context.Background(), pool, uid)
	if err != nil {
		t.Fatalf("user balance %d: %v", uid, err)
	}
	return id
}

func balance(t *testing.T, acct int64) int64 {
	t.Helper()
	b, err := ledger.Balance(context.Background(), pool, acct)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	return b
}

func mustPost(t *testing.T, p ledger.Posting) {
	t.Helper()
	if _, err := ledger.Post(context.Background(), pool, p); err != nil {
		t.Fatalf("post %q: %v", p.Kind, err)
	}
}

func TestDepositCreditsUser(t *testing.T) {
	reset(t)
	ext := sysID(t, ledger.TypeExternalTON)
	user := userAcct(t, 1)

	mustPost(t, ledger.Posting{
		Kind:      "deposit",
		Reference: "deposit:1",
		Entries: []ledger.Entry{
			{AccountID: ext, AmountNano: -25 * TON},
			{AccountID: user, AmountNano: 25 * TON},
		},
	})

	if got := balance(t, user); got != 25*TON {
		t.Fatalf("user balance = %d, want %d", got, 25*TON)
	}
}

func TestUnbalancedRejected(t *testing.T) {
	reset(t)
	ext := sysID(t, ledger.TypeExternalTON)
	user := userAcct(t, 1)

	_, err := ledger.Post(context.Background(), pool, ledger.Posting{
		Kind: "bad",
		Entries: []ledger.Entry{
			{AccountID: ext, AmountNano: -10},
			{AccountID: user, AmountNano: 5},
		},
	})
	if !errors.Is(err, ledger.ErrUnbalanced) {
		t.Fatalf("err = %v, want ErrUnbalanced", err)
	}
}

func TestInsufficientFundsRejected(t *testing.T) {
	reset(t)
	user := userAcct(t, 1)
	treas := sysID(t, ledger.TypeHouseTreasury)

	// User has 0 — moving funds out must fail on the non-negative CHECK.
	_, err := ledger.Post(context.Background(), pool, ledger.Posting{
		Kind: "bet_place",
		Entries: []ledger.Entry{
			{AccountID: user, AmountNano: -5 * TON},
			{AccountID: treas, AmountNano: 5 * TON},
		},
	})
	if err == nil {
		t.Fatal("expected error when user balance would go negative")
	}
	if got := balance(t, user); got != 0 {
		t.Fatalf("user balance = %d, want 0 (unchanged after rollback)", got)
	}
}

// Full bet lifecycle with the escrow + liability-reserve model.
func TestBetWinFlow(t *testing.T) {
	reset(t)
	ext := sysID(t, ledger.TypeExternalTON)
	treas := sysID(t, ledger.TypeHouseTreasury)
	escrow := sysID(t, ledger.TypeBetEscrow)
	reserve := sysID(t, ledger.TypeLiabilityReserve)
	user := userAcct(t, 1)

	mustPost(t, ledger.Posting{Kind: "house_capital", Entries: []ledger.Entry{
		{AccountID: ext, AmountNano: -1000 * TON}, {AccountID: treas, AmountNano: 1000 * TON},
	}})
	mustPost(t, ledger.Posting{Kind: "deposit", Entries: []ledger.Entry{
		{AccountID: ext, AmountNano: -10 * TON}, {AccountID: user, AmountNano: 10 * TON},
	}})

	stake := 10 * TON
	profit := 15 * TON // stake 10 @ odds 2.5 -> payout 25, profit 15

	mustPost(t, ledger.Posting{Kind: "bet_place", Reference: "bet:1", Entries: []ledger.Entry{
		{AccountID: user, AmountNano: -stake}, {AccountID: escrow, AmountNano: stake},
		{AccountID: treas, AmountNano: -profit}, {AccountID: reserve, AmountNano: profit},
	}})

	mustPost(t, ledger.Posting{Kind: "bet_win", Reference: "bet:1", Entries: []ledger.Entry{
		{AccountID: escrow, AmountNano: -stake}, {AccountID: user, AmountNano: stake},
		{AccountID: reserve, AmountNano: -profit}, {AccountID: user, AmountNano: profit},
	}})

	if got := balance(t, user); got != 25*TON {
		t.Fatalf("user = %d, want %d", got, 25*TON)
	}
	if got := balance(t, treas); got != 985*TON {
		t.Fatalf("treasury = %d, want %d", got, 985*TON)
	}
	if got := balance(t, escrow); got != 0 {
		t.Fatalf("escrow = %d, want 0", got)
	}
	if got := balance(t, reserve); got != 0 {
		t.Fatalf("reserve = %d, want 0", got)
	}
}

func TestIdempotentPost(t *testing.T) {
	reset(t)
	ext := sysID(t, ledger.TypeExternalTON)
	user := userAcct(t, 1)

	p := ledger.Posting{
		Kind:           "deposit",
		IdempotencyKey: "dep-abc",
		Entries: []ledger.Entry{
			{AccountID: ext, AmountNano: -5 * TON},
			{AccountID: user, AmountNano: 5 * TON},
		},
	}
	id1, err := ledger.Post(context.Background(), pool, p)
	if err != nil {
		t.Fatal(err)
	}
	id2, err := ledger.Post(context.Background(), pool, p)
	if err != nil {
		t.Fatal(err)
	}
	if id1 != id2 {
		t.Fatalf("idempotency: ids differ (%d != %d)", id1, id2)
	}
	if got := balance(t, user); got != 5*TON {
		t.Fatalf("balance = %d, want %d (credited once)", got, 5*TON)
	}
}

// Global invariant: across all activity, entries and balances each net to zero.
func TestGlobalLedgerInvariant(t *testing.T) {
	reset(t)
	ext := sysID(t, ledger.TypeExternalTON)
	user := userAcct(t, 7)
	mustPost(t, ledger.Posting{Kind: "deposit", Entries: []ledger.Entry{
		{AccountID: ext, AmountNano: -50 * TON}, {AccountID: user, AmountNano: 50 * TON},
	}})

	ctx := context.Background()
	var entriesSum, balancesSum int64
	if err := pool.QueryRow(ctx, `SELECT COALESCE(SUM(amount_nano), 0) FROM ledger_entries`).Scan(&entriesSum); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT COALESCE(SUM(balance_nano), 0) FROM accounts`).Scan(&balancesSum); err != nil {
		t.Fatal(err)
	}
	if entriesSum != 0 {
		t.Fatalf("sum of all entries = %d, want 0", entriesSum)
	}
	if balancesSum != 0 {
		t.Fatalf("sum of all balances = %d, want 0", balancesSum)
	}
}
