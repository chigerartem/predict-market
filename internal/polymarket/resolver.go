package polymarket

import (
	"context"
	"errors"
	"log"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"predict/internal/betting"
)

// winnerThreshold — у зарезолвленного рынка цена исхода-победителя ≈ 1.0
// (Polymarket отдаёт outcomePrices вида ["1","0"]).
const winnerThreshold = 0.99

// ResolveSettled checks our markets that still have open (PLACED) bets and have
// resolved on Polymarket, and settles them (pays winners, charges losers via the
// ledger). Idempotent: SettleMarket is a no-op on already-resolved markets and
// settles each bet exactly once. Returns how many markets were settled this pass.
//
// Only markets with open bets are checked — those are the ones holding user money;
// bet-less stale markets just stay CLOSED. This also covers markets that left the
// public feed (CLOSED by volume) but still have a user's bet waiting on them.
func ResolveSettled(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	rows, err := pool.Query(ctx,
		`SELECT DISTINCT m.id, m.source_id
		   FROM markets m
		   JOIN bets b ON b.market_id = m.id
		  WHERE b.status = 'PLACED' AND m.source = 'polymarket'
		    AND m.status NOT IN ('RESOLVED', 'CANCELLED') AND m.source_id IS NOT NULL`)
	if err != nil {
		return 0, err
	}
	type mk struct {
		id       int64
		sourceID string
	}
	var pending []mk
	for rows.Next() {
		var x mk
		if err := rows.Scan(&x.id, &x.sourceID); err != nil {
			rows.Close()
			return 0, err
		}
		pending = append(pending, x)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	settled := 0
	for _, m := range pending {
		pm, ok, err := FetchMarketByCondition(ctx, m.sourceID)
		if err != nil || !ok || !pm.Closed {
			continue // ещё открыт на Polymarket / не нашли — ждём
		}
		_, prices, err := pm.ParsedOutcomes()
		if err != nil {
			continue
		}
		win := winnerIndex(prices)
		if win < 0 {
			continue // нет явного победителя (спор/в процессе) — ждём следующий тик
		}

		var outcomeID int64
		err = pool.QueryRow(ctx,
			`SELECT id FROM outcomes WHERE market_id = $1 AND sort_order = $2`,
			m.id, win).Scan(&outcomeID)
		if err != nil {
			if !errors.Is(err, pgx.ErrNoRows) {
				log.Printf("resolver outcome market=%d sort=%d: %v", m.id, win, err)
			}
			continue
		}

		if err := betting.SettleMarket(ctx, pool, m.id, outcomeID); err != nil {
			log.Printf("resolver settle market=%d: %v", m.id, err)
			continue
		}
		settled++
	}
	return settled, nil
}

// winnerIndex returns the index of the winning outcome (price ≈ 1.0), or -1 if the
// market isn't clearly resolved yet.
func winnerIndex(prices []float64) int {
	for i, p := range prices {
		if p >= winnerThreshold {
			return i
		}
	}
	return -1
}
