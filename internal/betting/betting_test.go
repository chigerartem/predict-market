package betting_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"predict/internal/betting"
	"predict/internal/db"
	"predict/internal/ledger"
	"predict/internal/markets"
)

const TON = ledger.TON

var pool *pgxpool.Pool

func TestMain(m *testing.M) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
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
		`TRUNCATE bets, ledger_entries, ledger_transactions RESTART IDENTITY CASCADE`,
		`DELETE FROM markets`,
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

func sysBalance(t *testing.T, typ string) int64 {
	t.Helper()
	b, err := ledger.Balance(context.Background(), pool, sysID(t, typ))
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	return b
}

func userBalance(t *testing.T, userID int64) int64 {
	t.Helper()
	ctx := context.Background()
	ua, err := ledger.EnsureUserBalance(ctx, pool, userID)
	if err != nil {
		t.Fatalf("ensure user: %v", err)
	}
	b, err := ledger.Balance(ctx, pool, ua)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	return b
}

func capitalize(t *testing.T, amountNano int64) {
	t.Helper()
	if _, err := ledger.Post(context.Background(), pool, ledger.Posting{
		Kind: "house_capital",
		Entries: []ledger.Entry{
			{AccountID: sysID(t, ledger.TypeExternalTON), AmountNano: -amountNano},
			{AccountID: sysID(t, ledger.TypeHouseTreasury), AmountNano: amountNano},
		},
	}); err != nil {
		t.Fatalf("capitalize: %v", err)
	}
}

func fund(t *testing.T, userID, amountNano int64) {
	t.Helper()
	ctx := context.Background()
	ua, err := ledger.EnsureUserBalance(ctx, pool, userID)
	if err != nil {
		t.Fatalf("ensure user: %v", err)
	}
	if _, err := ledger.Post(ctx, pool, ledger.Posting{
		Kind: "deposit",
		Entries: []ledger.Entry{
			{AccountID: sysID(t, ledger.TypeExternalTON), AmountNano: -amountNano},
			{AccountID: ua, AmountNano: amountNano},
		},
	}); err != nil {
		t.Fatalf("fund: %v", err)
	}
}

func twoOutcomeMarket(t *testing.T, oddsA, oddsB int64, closeTime *time.Time) markets.Market {
	t.Helper()
	mk, err := markets.CreateMarket(context.Background(), pool, "Team A vs Team B", "sports", closeTime,
		[]markets.OutcomeInput{
			{Title: "A wins", OddsMilli: oddsA},
			{Title: "B wins", OddsMilli: oddsB},
		})
	if err != nil {
		t.Fatalf("create market: %v", err)
	}
	return mk
}

func TestBetLifecycleWinAndLose(t *testing.T) {
	reset(t)
	ctx := context.Background()
	capitalize(t, 10_000*TON)
	mk := twoOutcomeMarket(t, 2000, 2000, nil) // both at 2.0
	fund(t, 1, 100*TON)
	fund(t, 2, 100*TON)

	if _, err := betting.PlaceBet(ctx, pool, 1, mk.Outcomes[0].ID, 10*TON); err != nil {
		t.Fatalf("user1 place: %v", err)
	}
	if _, err := betting.PlaceBet(ctx, pool, 2, mk.Outcomes[1].ID, 20*TON); err != nil {
		t.Fatalf("user2 place: %v", err)
	}

	if err := betting.SettleMarket(ctx, pool, mk.ID, mk.Outcomes[0].ID); err != nil {
		t.Fatalf("settle: %v", err)
	}

	if got := userBalance(t, 1); got != 110*TON {
		t.Errorf("user1 = %d, want %d", got, 110*TON)
	}
	if got := userBalance(t, 2); got != 80*TON {
		t.Errorf("user2 = %d, want %d", got, 80*TON)
	}
	if got := sysBalance(t, ledger.TypeHouseTreasury); got != 10_010*TON {
		t.Errorf("treasury = %d, want %d", got, 10_010*TON)
	}
	if got := sysBalance(t, ledger.TypeBetEscrow); got != 0 {
		t.Errorf("escrow = %d, want 0", got)
	}
	if got := sysBalance(t, ledger.TypeLiabilityReserve); got != 0 {
		t.Errorf("reserve = %d, want 0", got)
	}

	var sum int64
	if err := pool.QueryRow(ctx, `SELECT COALESCE(SUM(balance_nano),0) FROM accounts`).Scan(&sum); err != nil {
		t.Fatal(err)
	}
	if sum != 0 {
		t.Errorf("global balances = %d, want 0", sum)
	}
}

func TestPlaceBetDuplicateRejected(t *testing.T) {
	reset(t)
	ctx := context.Background()
	capitalize(t, 1000*TON)
	mk := twoOutcomeMarket(t, 2000, 2000, nil)
	fund(t, 1, 100*TON)

	if _, err := betting.PlaceBet(ctx, pool, 1, mk.Outcomes[0].ID, 10*TON); err != nil {
		t.Fatalf("first bet: %v", err)
	}
	// Второй раз в ту же сторону — запрещено.
	if _, err := betting.PlaceBet(ctx, pool, 1, mk.Outcomes[0].ID, 10*TON); !errors.Is(err, betting.ErrAlreadyBet) {
		t.Fatalf("same outcome: err = %v, want ErrAlreadyBet", err)
	}
	// На второй исход того же рынка — тоже запрещено (нельзя хеджировать).
	if _, err := betting.PlaceBet(ctx, pool, 1, mk.Outcomes[1].ID, 10*TON); !errors.Is(err, betting.ErrAlreadyBet) {
		t.Fatalf("other outcome: err = %v, want ErrAlreadyBet", err)
	}
	// Списали ровно одну ставку (10 TON) → баланс 90.
	if got := userBalance(t, 1); got != 90*TON {
		t.Errorf("balance = %d, want %d (only first stake debited)", got, 90*TON)
	}
	// Другой юзер на тот же рынок — можно.
	fund(t, 2, 100*TON)
	if _, err := betting.PlaceBet(ctx, pool, 2, mk.Outcomes[0].ID, 10*TON); err != nil {
		t.Fatalf("other user same market: %v", err)
	}
}

func TestPlaceBetClosedMarket(t *testing.T) {
	reset(t)
	capitalize(t, 1000*TON)
	past := time.Now().Add(-time.Hour)
	mk := twoOutcomeMarket(t, 2000, 2000, &past)
	fund(t, 1, 100*TON)

	_, err := betting.PlaceBet(context.Background(), pool, 1, mk.Outcomes[0].ID, 10*TON)
	if !errors.Is(err, betting.ErrMarketClosed) {
		t.Fatalf("err = %v, want ErrMarketClosed", err)
	}
}

func TestPlaceBetLimitExceeded(t *testing.T) {
	reset(t)
	capitalize(t, 1000*TON)
	mk, err := markets.CreateMarket(context.Background(), pool, "Capped", "test", nil,
		[]markets.OutcomeInput{
			{Title: "A", OddsMilli: 2000, MaxLiabilityNano: 15 * TON},
			{Title: "B", OddsMilli: 2000},
		})
	if err != nil {
		t.Fatal(err)
	}
	fund(t, 1, 100*TON)

	// stake 10 @ 2.0 -> payout 20 > cap 15
	_, err = betting.PlaceBet(context.Background(), pool, 1, mk.Outcomes[0].ID, 10*TON)
	if !errors.Is(err, betting.ErrLimitExceeded) {
		t.Fatalf("err = %v, want ErrLimitExceeded", err)
	}
}

func TestPlaceBetInsufficientFunds(t *testing.T) {
	reset(t)
	capitalize(t, 1000*TON)
	mk := twoOutcomeMarket(t, 2000, 2000, nil)

	_, err := betting.PlaceBet(context.Background(), pool, 5, mk.Outcomes[0].ID, 10*TON)
	if err == nil {
		t.Fatal("expected error placing bet with no balance")
	}
	if got := userBalance(t, 5); got != 0 {
		t.Fatalf("user balance = %d, want 0 (unchanged)", got)
	}
}

func TestSettleIdempotent(t *testing.T) {
	reset(t)
	ctx := context.Background()
	capitalize(t, 1000*TON)
	mk := twoOutcomeMarket(t, 2000, 2000, nil)
	fund(t, 1, 100*TON)
	if _, err := betting.PlaceBet(ctx, pool, 1, mk.Outcomes[0].ID, 10*TON); err != nil {
		t.Fatal(err)
	}
	if err := betting.SettleMarket(ctx, pool, mk.ID, mk.Outcomes[0].ID); err != nil {
		t.Fatal(err)
	}
	first := userBalance(t, 1)
	if err := betting.SettleMarket(ctx, pool, mk.ID, mk.Outcomes[0].ID); err != nil {
		t.Fatalf("re-settle: %v", err)
	}
	if got := userBalance(t, 1); got != first {
		t.Fatalf("balance changed on re-settle: %d -> %d", first, got)
	}
}
