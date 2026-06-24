// Command seed capitalizes the house treasury and inserts demo markets.
// Idempotent: treasury is funded only if empty; markets are added only if none exist.
//
//	DATABASE_URL=postgres://... go run ./cmd/seed
package main

import (
	"context"
	"log"
	"os"
	"time"

	"predict/internal/db"
	"predict/internal/ledger"
	"predict/internal/markets"
)

func main() {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		log.Fatal("DATABASE_URL is not set")
	}
	ctx := context.Background()
	if err := db.Migrate(ctx, url); err != nil {
		log.Fatalf("migrate: %v", err)
	}
	pool, err := db.Connect(ctx, url)
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	defer pool.Close()

	// Capitalize the house treasury once so bets can be covered.
	treasury, err := ledger.SystemAccountID(ctx, pool, ledger.TypeHouseTreasury)
	if err != nil {
		log.Fatal(err)
	}
	bal, err := ledger.Balance(ctx, pool, treasury)
	if err != nil {
		log.Fatal(err)
	}
	if bal == 0 {
		ext, err := ledger.SystemAccountID(ctx, pool, ledger.TypeExternalTON)
		if err != nil {
			log.Fatal(err)
		}
		if _, err := ledger.Post(ctx, pool, ledger.Posting{
			Kind:      "house_capital",
			Reference: "seed",
			Entries: []ledger.Entry{
				{AccountID: ext, AmountNano: -100_000 * ledger.TON},
				{AccountID: treasury, AmountNano: 100_000 * ledger.TON},
			},
		}); err != nil {
			log.Fatalf("capitalize treasury: %v", err)
		}
		log.Println("treasury capitalized: 100000 TON")
	}

	existing, err := markets.ListOpen(ctx, pool)
	if err != nil {
		log.Fatal(err)
	}
	if len(existing) > 0 {
		log.Printf("%d market(s) already present — skipping demo seed", len(existing))
		return
	}

	week := time.Now().Add(7 * 24 * time.Hour)
	demos := []struct {
		title    string
		category string
		close    *time.Time
		outs     []markets.OutcomeInput
	}{
		{"Победит ли Германия Францию?", "sports", &week, []markets.OutcomeInput{
			{Title: "Германия", OddsMilli: 1850},
			{Title: "Франция", OddsMilli: 2050},
		}},
		{"BTC выше $200k к 2027?", "crypto", nil, []markets.OutcomeInput{
			{Title: "Да", OddsMilli: 3200},
			{Title: "Нет", OddsMilli: 1300},
		}},
		{"Будет ли релиз продукта X в Q3?", "tech", &week, []markets.OutcomeInput{
			{Title: "Да", OddsMilli: 1500},
			{Title: "Нет", OddsMilli: 2600},
		}},
	}
	for _, d := range demos {
		m, err := markets.CreateMarket(ctx, pool, d.title, d.category, d.close, d.outs)
		if err != nil {
			log.Fatalf("create market %q: %v", d.title, err)
		}
		log.Printf("created market #%d %q", m.ID, d.title)
	}
	log.Println("seed done")
}
