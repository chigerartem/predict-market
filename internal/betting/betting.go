// Package betting implements placing and settling bets against the house, using
// the ledger's escrow + liability-reserve model so the house stays solvent.
package betting

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"predict/internal/ledger"
)

// MinStakeNano is the minimum bet (0.1 TON) for Phase 1.
const MinStakeNano = int64(100_000_000)

var (
	ErrOutcomeNotFound = errors.New("betting: outcome not found")
	ErrMarketNotFound  = errors.New("betting: market not found")
	ErrMarketClosed    = errors.New("betting: market is not open")
	ErrMarketCancelled = errors.New("betting: market is cancelled")
	ErrStakeTooSmall   = errors.New("betting: stake too small")
	ErrLimitExceeded   = errors.New("betting: outcome liability limit exceeded")
	ErrAlreadyBet      = errors.New("betting: already have an active bet on this market")
)

// Bet is a placed bet. MarketTitle/OutcomeTitle are filled by ListUserBets (joined
// for display); PlaceBet leaves them empty (the client already has them).
type Bet struct {
	ID           int64
	UserID       int64
	MarketID     int64
	OutcomeID    int64
	StakeNano    int64
	OddsMilli    int64
	PayoutNano   int64
	Status       string
	PlacedAt     time.Time
	MarketTitle  string
	OutcomeTitle string
	// Детали рынка для экрана ставки (как в ленте): картинка, «как резолвится»,
	// превью события, время начала/закрытия.
	ImageURL           string
	Description        string
	ContextDescription string
	CloseTime          *time.Time
	GameStart          *time.Time
}

// payoutNano = floor(stake * oddsMilli / 1000), computed in big.Int to avoid overflow.
func payoutNano(stakeNano, oddsMilli int64) int64 {
	p := new(big.Int).Mul(big.NewInt(stakeNano), big.NewInt(oddsMilli))
	p.Quo(p, big.NewInt(1000))
	if !p.IsInt64() {
		return 0 // overflow guard (balance-gated; unreachable in practice)
	}
	return p.Int64()
}

// PlaceBet places a bet for userID on outcomeID at the outcome's current odds.
// Stake is moved to escrow and the house's potential profit is reserved, all in
// one transaction; the DB rejects the bet if the user or the house can't cover it.
func PlaceBet(ctx context.Context, pool *pgxpool.Pool, userID, outcomeID, stakeNano int64) (Bet, error) {
	if stakeNano < MinStakeNano {
		return Bet{}, ErrStakeTooSmall
	}

	userAcct, err := ledger.EnsureUserBalance(ctx, pool, userID)
	if err != nil {
		return Bet{}, err
	}
	escrow, err := ledger.SystemAccountID(ctx, pool, ledger.TypeBetEscrow)
	if err != nil {
		return Bet{}, err
	}
	reserve, err := ledger.SystemAccountID(ctx, pool, ledger.TypeLiabilityReserve)
	if err != nil {
		return Bet{}, err
	}
	treasury, err := ledger.SystemAccountID(ctx, pool, ledger.TypeHouseTreasury)
	if err != nil {
		return Bet{}, err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return Bet{}, err
	}
	defer tx.Rollback(ctx)

	var (
		marketID    int64
		oddsMilli   int64
		totalPayout int64
		maxLiab     *int64
		status      string
		closeTime   *time.Time
	)
	err = tx.QueryRow(ctx,
		`SELECT o.market_id, o.odds_milli, o.total_payout_nano, o.max_liability_nano,
		        m.status, m.close_time
		   FROM outcomes o
		   JOIN markets m ON m.id = o.market_id
		  WHERE o.id = $1
		  FOR UPDATE OF o, m`, outcomeID).Scan(
		&marketID, &oddsMilli, &totalPayout, &maxLiab, &status, &closeTime)
	if errors.Is(err, pgx.ErrNoRows) {
		return Bet{}, ErrOutcomeNotFound
	} else if err != nil {
		return Bet{}, err
	}

	if status != "OPEN" {
		return Bet{}, ErrMarketClosed
	}
	if closeTime != nil && !time.Now().Before(*closeTime) {
		return Bet{}, ErrMarketClosed
	}

	// Одна активная ставка на рынок на пользователя: нельзя поставить ни на второй исход,
	// ни второй раз в ту же сторону. Строка рынка залочена выше (FOR UPDATE OF m), поэтому
	// две параллельные ставки одного юзера на РАЗНЫЕ исходы одного рынка сериализуются —
	// проверка остаётся корректной (вторая увидит первую уже зафиксированной).
	var hasActive bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM bets WHERE user_id = $1 AND market_id = $2 AND status = 'PLACED')`,
		userID, marketID).Scan(&hasActive); err != nil {
		return Bet{}, err
	}
	if hasActive {
		return Bet{}, ErrAlreadyBet
	}

	payout := payoutNano(stakeNano, oddsMilli)
	profit := payout - stakeNano
	if profit <= 0 {
		return Bet{}, ErrStakeTooSmall
	}
	if maxLiab != nil && totalPayout+payout > *maxLiab {
		return Bet{}, ErrLimitExceeded
	}

	placeTxID, err := ledger.PostTx(ctx, tx, ledger.Posting{
		Kind:      "bet_place",
		Reference: fmt.Sprintf("market:%d", marketID),
		Entries: []ledger.Entry{
			{AccountID: userAcct, AmountNano: -stakeNano},
			{AccountID: escrow, AmountNano: stakeNano},
			{AccountID: treasury, AmountNano: -profit},
			{AccountID: reserve, AmountNano: profit},
		},
	})
	if err != nil {
		return Bet{}, err
	}

	b := Bet{
		UserID:     userID,
		MarketID:   marketID,
		OutcomeID:  outcomeID,
		StakeNano:  stakeNano,
		OddsMilli:  oddsMilli,
		PayoutNano: payout,
		Status:     "PLACED",
	}
	if err := tx.QueryRow(ctx,
		`INSERT INTO bets (user_id, market_id, outcome_id, stake_nano, odds_milli, payout_nano, status, ledger_tx_place)
		 VALUES ($1, $2, $3, $4, $5, $6, 'PLACED', $7)
		 RETURNING id, placed_at`,
		userID, marketID, outcomeID, stakeNano, oddsMilli, payout, placeTxID).Scan(&b.ID, &b.PlacedAt); err != nil {
		return Bet{}, err
	}

	if _, err := tx.Exec(ctx,
		`UPDATE outcomes SET total_stake_nano = total_stake_nano + $1,
		        total_payout_nano = total_payout_nano + $2
		  WHERE id = $3`,
		stakeNano, payout, outcomeID); err != nil {
		return Bet{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Bet{}, err
	}
	return b, nil
}

// SettleMarket resolves a market to winningOutcomeID and settles every placed
// bet. Idempotent: re-running after resolution is a no-op, and each bet settles
// exactly once (guarded by status and a per-bet ledger idempotency key).
func SettleMarket(ctx context.Context, pool *pgxpool.Pool, marketID, winningOutcomeID int64) error {
	escrow, err := ledger.SystemAccountID(ctx, pool, ledger.TypeBetEscrow)
	if err != nil {
		return err
	}
	reserve, err := ledger.SystemAccountID(ctx, pool, ledger.TypeLiabilityReserve)
	if err != nil {
		return err
	}
	treasury, err := ledger.SystemAccountID(ctx, pool, ledger.TypeHouseTreasury)
	if err != nil {
		return err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var status string
	err = tx.QueryRow(ctx, `SELECT status FROM markets WHERE id = $1 FOR UPDATE`, marketID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrMarketNotFound
	} else if err != nil {
		return err
	}
	switch status {
	case "RESOLVED":
		return nil // already settled
	case "CANCELLED":
		return ErrMarketCancelled
	}

	var belongs bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM outcomes WHERE id = $1 AND market_id = $2)`,
		winningOutcomeID, marketID).Scan(&belongs); err != nil {
		return err
	}
	if !belongs {
		return ErrOutcomeNotFound
	}

	type pending struct {
		id, userID, outcomeID, stake, payout int64
	}
	var bets []pending
	rows, err := tx.Query(ctx,
		`SELECT id, user_id, outcome_id, stake_nano, payout_nano
		   FROM bets WHERE market_id = $1 AND status = 'PLACED' FOR UPDATE`, marketID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.id, &p.userID, &p.outcomeID, &p.stake, &p.payout); err != nil {
			rows.Close()
			return err
		}
		bets = append(bets, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, p := range bets {
		profit := p.payout - p.stake
		userAcct, err := ledger.UserBalanceID(ctx, tx, p.userID)
		if err != nil {
			return err
		}

		var entries []ledger.Entry
		var newStatus string
		if p.outcomeID == winningOutcomeID {
			// Return stake from escrow and pay profit from reserve.
			entries = []ledger.Entry{
				{AccountID: escrow, AmountNano: -p.stake},
				{AccountID: userAcct, AmountNano: p.stake},
				{AccountID: reserve, AmountNano: -profit},
				{AccountID: userAcct, AmountNano: profit},
			}
			newStatus = "WON"
		} else {
			// House keeps the stake; reserved profit is released back to treasury.
			entries = []ledger.Entry{
				{AccountID: escrow, AmountNano: -p.stake},
				{AccountID: treasury, AmountNano: p.stake},
				{AccountID: reserve, AmountNano: -profit},
				{AccountID: treasury, AmountNano: profit},
			}
			newStatus = "LOST"
		}

		settleTxID, err := ledger.PostTx(ctx, tx, ledger.Posting{
			Kind:           "bet_settle",
			Reference:      fmt.Sprintf("bet:%d", p.id),
			IdempotencyKey: fmt.Sprintf("settle:%d", p.id),
			Entries:        entries,
		})
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx,
			`UPDATE bets SET status = $1, settled_at = now(), ledger_tx_settle = $2 WHERE id = $3`,
			newStatus, settleTxID, p.id); err != nil {
			return err
		}
	}

	if _, err := tx.Exec(ctx,
		`UPDATE markets SET status = 'RESOLVED', resolved_outcome_id = $1, updated_at = now() WHERE id = $2`,
		winningOutcomeID, marketID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ListUserBets returns a user's bets, newest first.
func ListUserBets(ctx context.Context, pool *pgxpool.Pool, userID int64) ([]Bet, error) {
	rows, err := pool.Query(ctx,
		`SELECT b.id, b.user_id, b.market_id, b.outcome_id, b.stake_nano, b.odds_milli,
		        b.payout_nano, b.status, b.placed_at, m.title, o.title,
		        -- Прячем «общую» картинку Polymarket (один генерик-мячик на десятки
		        -- рынков) — как лента: если image_url у >2 рынков, отдаём пусто.
		        CASE WHEN m.image_url IS NULL OR m.image_url = '' THEN ''
		             WHEN (SELECT count(*) FROM markets mi WHERE mi.image_url = m.image_url) > 2 THEN ''
		             ELSE m.image_url END,
		        COALESCE(m.description, ''),
		        COALESCE(m.context_description, ''), m.close_time, m.game_start_time
		   FROM bets b
		   JOIN markets m ON m.id = b.market_id
		   JOIN outcomes o ON o.id = b.outcome_id
		  WHERE b.user_id = $1 ORDER BY b.placed_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Bet
	for rows.Next() {
		var b Bet
		if err := rows.Scan(&b.ID, &b.UserID, &b.MarketID, &b.OutcomeID,
			&b.StakeNano, &b.OddsMilli, &b.PayoutNano, &b.Status, &b.PlacedAt,
			&b.MarketTitle, &b.OutcomeTitle,
			&b.ImageURL, &b.Description, &b.ContextDescription, &b.CloseTime, &b.GameStart); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}
