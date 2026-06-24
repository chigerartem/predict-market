// Package markets manages prediction markets and their outcomes.
package markets

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// OutcomeInput describes an outcome when creating a market.
type OutcomeInput struct {
	Title            string
	OddsMilli        int64 // decimal odds x1000 (e.g. 2500 = 2.5)
	MaxLiabilityNano int64 // 0 = no cap
}

// Outcome is a possible result of a market.
type Outcome struct {
	ID               int64
	MarketID         int64
	Title            string
	OddsMilli        int64
	MaxLiabilityNano *int64
	TotalStakeNano   int64
	TotalPayoutNano  int64
}

// Market is a prediction market with its outcomes.
type Market struct {
	ID                int64
	Source            string
	Title             string
	Category          string
	Status            string
	CloseTime         *time.Time
	ResolvedOutcomeID *int64
	Outcomes          []Outcome
}

// CreateMarket creates a market with its outcomes (admin action).
func CreateMarket(ctx context.Context, pool *pgxpool.Pool, title, category string, closeTime *time.Time, outs []OutcomeInput) (Market, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return Market{}, err
	}
	defer tx.Rollback(ctx)

	m := Market{Title: title, Category: category, CloseTime: closeTime}
	if err := tx.QueryRow(ctx,
		`INSERT INTO markets (source, title, category, close_time)
		 VALUES ('manual', $1, NULLIF($2, ''), $3)
		 RETURNING id, source, status`,
		title, category, closeTime).Scan(&m.ID, &m.Source, &m.Status); err != nil {
		return Market{}, err
	}

	for i, o := range outs {
		var maxLiab *int64
		if o.MaxLiabilityNano > 0 {
			v := o.MaxLiabilityNano
			maxLiab = &v
		}
		var oc Outcome
		if err := tx.QueryRow(ctx,
			`INSERT INTO outcomes (market_id, title, odds_milli, max_liability_nano, sort_order)
			 VALUES ($1, $2, $3, $4, $5)
			 RETURNING id, market_id, title, odds_milli, total_stake_nano, total_payout_nano`,
			m.ID, o.Title, o.OddsMilli, maxLiab, i).Scan(
			&oc.ID, &oc.MarketID, &oc.Title, &oc.OddsMilli, &oc.TotalStakeNano, &oc.TotalPayoutNano); err != nil {
			return Market{}, err
		}
		oc.MaxLiabilityNano = maxLiab
		m.Outcomes = append(m.Outcomes, oc)
	}

	if err := tx.Commit(ctx); err != nil {
		return Market{}, err
	}
	return m, nil
}

// UpsertExternal mirrors a market from an external source (e.g. Polymarket) into
// our tables, keyed by (source, source_id) for idempotency. First sight: creates
// the market and outcomes. Later runs: refreshes the title, close time, and each
// outcome's odds (matched by sort_order). Bets keep the odds they were placed at,
// so refreshing market odds never disturbs existing bets.
func UpsertExternal(ctx context.Context, pool *pgxpool.Pool, source, sourceID, title, category string, closeTime *time.Time, outs []OutcomeInput) error {
	if len(outs) == 0 {
		return errors.New("markets: no outcomes")
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var marketID int64
	err = tx.QueryRow(ctx,
		`SELECT id FROM markets WHERE source = $1 AND source_id = $2`, source, sourceID).Scan(&marketID)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		if err := tx.QueryRow(ctx,
			`INSERT INTO markets (source, source_id, title, category, close_time)
			 VALUES ($1, $2, $3, NULLIF($4, ''), $5)
			 RETURNING id`,
			source, sourceID, title, category, closeTime).Scan(&marketID); err != nil {
			return err
		}
		for i, o := range outs {
			if _, err := tx.Exec(ctx,
				`INSERT INTO outcomes (market_id, title, odds_milli, sort_order)
				 VALUES ($1, $2, $3, $4)`,
				marketID, o.Title, o.OddsMilli, i); err != nil {
				return err
			}
		}
	case err == nil:
		if _, err := tx.Exec(ctx,
			`UPDATE markets SET title = $2, close_time = $3, updated_at = now() WHERE id = $1`,
			marketID, title, closeTime); err != nil {
			return err
		}
		for i, o := range outs {
			ct, err := tx.Exec(ctx,
				`UPDATE outcomes SET odds_milli = $3 WHERE market_id = $1 AND sort_order = $2`,
				marketID, i, o.OddsMilli)
			if err != nil {
				return err
			}
			if ct.RowsAffected() == 0 {
				if _, err := tx.Exec(ctx,
					`INSERT INTO outcomes (market_id, title, odds_milli, sort_order)
					 VALUES ($1, $2, $3, $4)`,
					marketID, o.Title, o.OddsMilli, i); err != nil {
					return err
				}
			}
		}
	default:
		return err
	}

	return tx.Commit(ctx)
}

// GetMarket loads a market and its outcomes by id.
func GetMarket(ctx context.Context, pool *pgxpool.Pool, id int64) (Market, error) {
	var m Market
	if err := pool.QueryRow(ctx,
		`SELECT id, source, title, COALESCE(category, ''), status, close_time, resolved_outcome_id
		   FROM markets WHERE id = $1`, id).Scan(
		&m.ID, &m.Source, &m.Title, &m.Category, &m.Status, &m.CloseTime, &m.ResolvedOutcomeID); err != nil {
		return Market{}, err
	}

	rows, err := pool.Query(ctx,
		`SELECT id, market_id, title, odds_milli, max_liability_nano, total_stake_nano, total_payout_nano
		   FROM outcomes WHERE market_id = $1 ORDER BY sort_order, id`, id)
	if err != nil {
		return Market{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var oc Outcome
		if err := rows.Scan(&oc.ID, &oc.MarketID, &oc.Title, &oc.OddsMilli,
			&oc.MaxLiabilityNano, &oc.TotalStakeNano, &oc.TotalPayoutNano); err != nil {
			return Market{}, err
		}
		m.Outcomes = append(m.Outcomes, oc)
	}
	return m, rows.Err()
}

// ListOpen returns markets currently open for betting, each with its outcomes.
func ListOpen(ctx context.Context, pool *pgxpool.Pool) ([]Market, error) {
	rows, err := pool.Query(ctx,
		`SELECT id, source, title, COALESCE(category, ''), status, close_time
		   FROM markets WHERE status = 'OPEN' ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []Market
	idx := map[int64]int{}
	var ids []int64
	for rows.Next() {
		var m Market
		if err := rows.Scan(&m.ID, &m.Source, &m.Title, &m.Category, &m.Status, &m.CloseTime); err != nil {
			return nil, err
		}
		idx[m.ID] = len(list)
		list = append(list, m)
		ids = append(ids, m.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return list, nil
	}

	orows, err := pool.Query(ctx,
		`SELECT id, market_id, title, odds_milli, max_liability_nano, total_stake_nano, total_payout_nano
		   FROM outcomes WHERE market_id = ANY($1) ORDER BY market_id, sort_order, id`, ids)
	if err != nil {
		return nil, err
	}
	defer orows.Close()
	for orows.Next() {
		var o Outcome
		if err := orows.Scan(&o.ID, &o.MarketID, &o.Title, &o.OddsMilli,
			&o.MaxLiabilityNano, &o.TotalStakeNano, &o.TotalPayoutNano); err != nil {
			return nil, err
		}
		if i, ok := idx[o.MarketID]; ok {
			list[i].Outcomes = append(list[i].Outcomes, o)
		}
	}
	return list, orows.Err()
}
