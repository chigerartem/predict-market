// Package httpapi exposes the prediction-market HTTP API consumed by the
// Telegram Mini App. Authentication is Telegram initData (Authorization: tma ...).
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"predict/internal/basket"
	"predict/internal/betting"
	"predict/internal/casegame"
	"predict/internal/deposits"
	"predict/internal/dice"
	"predict/internal/ledger"
	"predict/internal/markets"
	"predict/internal/rates"
	"predict/internal/rocket"
	"predict/internal/tg"
	"predict/internal/withdrawals"
)

// Server holds dependencies for the HTTP API.
type Server struct {
	pool            *pgxpool.Pool
	botToken        string
	tg              *tg.Client      // nil when no bot token → Stars deposit disabled
	rates           *rates.Provider // live TON/USD price for valuing Stars deposits
	webhookSecret   string          // shared secret Telegram echoes on webhook calls
	webOrigin       string
	devUserID       int64              // when > 0, fallback identity for local dev
	allowInsecure   bool               // when true and no bot token, accept initData WITHOUT verifying (testing only)
	tonDepositAddr  string             // house TON address users deposit to (TON Connect); "" → TON deposit disabled
	withdrawSender  withdrawals.Sender // house hot wallet for TON payouts; nil → withdrawals disabled
	rocket          *rocket.Engine     // crash game engine; nil → rocket endpoints disabled
	dice            *dice.Store        // dice game; nil → dice endpoints disabled
	caseStore       *casegame.Store    // case-opening game; nil → case endpoints disabled
	basket          *basket.Store      // basketball game; nil → basket endpoints disabled
	signupBonusNano int64              // one-time test bonus per user on first /api/me; 0 → off
}

// New builds a Server.
func New(pool *pgxpool.Pool, botToken, webOrigin string, devUserID int64, allowInsecure bool) *Server {
	s := &Server{pool: pool, botToken: botToken, webOrigin: webOrigin, devUserID: devUserID, allowInsecure: allowInsecure}
	if botToken != "" {
		s.tg = tg.New(botToken)
	}
	return s
}

// SetRates wires the live TON/USD price provider used to value Stars deposits.
func (s *Server) SetRates(r *rates.Provider) { s.rates = r }

// SetTonDeposit wires the house TON address users send deposits to. Empty disables
// the TON deposit endpoint (it returns 503).
func (s *Server) SetTonDeposit(addr string) { s.tonDepositAddr = addr }

// SetWithdrawSender wires the house hot wallet that pays TON withdrawals. nil
// disables the withdraw endpoint (it returns 503).
func (s *Server) SetWithdrawSender(sender withdrawals.Sender) { s.withdrawSender = sender }

// SetRocket wires the crash-game engine. nil disables the rocket endpoints (503).
func (s *Server) SetRocket(e *rocket.Engine) { s.rocket = e }

// SetDice wires the dice-game store. nil disables the dice endpoints (503).
func (s *Server) SetDice(d *dice.Store) { s.dice = d }

// SetCase wires the case-opening game store. nil disables the case endpoints (503).
func (s *Server) SetCase(c *casegame.Store) { s.caseStore = c }

// SetBasket wires the basketball game store. nil disables the basket endpoints (503).
func (s *Server) SetBasket(b *basket.Store) { s.basket = b }

// SetSignupBonus sets the one-time test bonus (nano-TON) each user is credited on
// first /api/me. 0 disables it. Test-phase only (withdrawals are off).
func (s *Server) SetSignupBonus(nano int64) { s.signupBonusNano = nano }

// Handler returns the configured HTTP handler (with CORS).
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /api/me", s.auth(s.handleMe))
	mux.HandleFunc("GET /api/markets", s.auth(s.handleMarkets))
	mux.HandleFunc("GET /api/bets", s.auth(s.handleMyBets))
	mux.HandleFunc("POST /api/bets", s.auth(s.handlePlaceBet))
	mux.HandleFunc("POST /api/deposit/stars/invoice", s.auth(s.handleStarsInvoice))
	mux.HandleFunc("GET /api/deposit/stars/quote", s.auth(s.handleStarsQuote))
	mux.HandleFunc("GET /api/deposit/ton/address", s.auth(s.handleTonDepositAddress))
	mux.HandleFunc("POST /api/withdraw", s.auth(s.handleWithdraw))
	mux.HandleFunc("GET /api/rocket/state", s.auth(s.handleRocketState))
	mux.HandleFunc("GET /api/rocket/stream", s.auth(s.handleRocketStream))
	mux.HandleFunc("POST /api/rocket/bet", s.auth(s.handleRocketBet))
	mux.HandleFunc("POST /api/rocket/cashout", s.auth(s.handleRocketCashout))
	mux.HandleFunc("GET /api/dice/state", s.auth(s.handleDiceState))
	mux.HandleFunc("POST /api/dice/roll", s.auth(s.handleDiceRoll))
	mux.HandleFunc("POST /api/dice/rotate", s.auth(s.handleDiceRotate))
	mux.HandleFunc("GET /api/case/state", s.auth(s.handleCaseState))
	mux.HandleFunc("POST /api/case/open", s.auth(s.handleCaseOpen))
	mux.HandleFunc("POST /api/case/rotate", s.auth(s.handleCaseRotate))
	mux.HandleFunc("GET /api/basket/state", s.auth(s.handleBasketState))
	mux.HandleFunc("POST /api/basket/throw", s.auth(s.handleBasketThrow))
	mux.HandleFunc("POST /api/basket/rotate", s.auth(s.handleBasketRotate))
	mux.HandleFunc("POST /api/tg/webhook", s.handleTgWebhook)
	return s.cors(mux)
}

type authedHandler func(w http.ResponseWriter, r *http.Request, userID int64)

func (s *Server) auth(h authedHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, err := s.authenticate(r)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		h(w, r, userID)
	}
}

func (s *Server) authenticate(r *http.Request) (int64, error) {
	// initData normally rides the Authorization header; the SSE stream falls back to
	// an `auth` query param because the browser EventSource can't set headers.
	initData, ok := strings.CutPrefix(r.Header.Get("Authorization"), "tma ")
	if !ok {
		if q := r.URL.Query().Get("auth"); q != "" {
			initData, ok = q, true
		}
	}
	if ok {
		var u TgUser
		var err error
		switch {
		case s.botToken != "":
			u, err = validateInitData(initData, s.botToken, 24*time.Hour)
		case s.allowInsecure:
			u, err = parseInitDataUnverified(initData) // testing only — no signature check
		default:
			err = errInvalidInitData
		}
		if err == nil {
			if err := s.upsertUser(r.Context(), u); err != nil {
				return 0, err
			}
			return u.ID, nil
		}
	}
	if s.devUserID > 0 {
		if err := s.upsertUser(r.Context(), TgUser{ID: s.devUserID, FirstName: "dev"}); err != nil {
			return 0, err
		}
		return s.devUserID, nil
	}
	return 0, errors.New("unauthorized")
}

func (s *Server) upsertUser(ctx context.Context, u TgUser) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO users (id, username, first_name)
		 VALUES ($1, NULLIF($2, ''), NULLIF($3, ''))
		 ON CONFLICT (id) DO UPDATE
		   SET username = EXCLUDED.username, first_name = EXCLUDED.first_name, last_seen = now()`,
		u.ID, u.Username, u.FirstName)
	return err
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request, userID int64) {
	acct, err := ledger.EnsureUserBalance(r.Context(), s.pool, userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "server error")
		return
	}
	// Test-phase: credit a one-time bonus so newcomers can try the games. Idempotent
	// per user, so this only credits the very first time. Non-fatal — a failure here
	// must not block reading the balance.
	if s.signupBonusNano > 0 {
		if err := deposits.GrantSignupBonus(r.Context(), s.pool, userID, s.signupBonusNano); err != nil {
			log.Printf("signup bonus user %d: %v", userID, err)
		}
	}
	bal, err := ledger.Balance(r.Context(), s.pool, acct)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "server error")
		return
	}
	writeJSON(w, http.StatusOK, meDTO{
		UserID:          userID,
		BalanceNano:     bal,
		WithdrawEnabled: s.withdrawSender != nil,
		MinWithdrawNano: withdrawals.MinWithdrawNano,
		WithdrawFeeNano: withdrawals.FeeNano,
	})
}

func (s *Server) handleMarkets(w http.ResponseWriter, r *http.Request, _ int64) {
	ms, err := markets.ListOpen(r.Context(), s.pool)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "server error")
		return
	}
	out := make([]marketDTO, 0, len(ms))
	for _, m := range ms {
		od := make([]outcomeDTO, 0, len(m.Outcomes))
		for _, o := range m.Outcomes {
			od = append(od, outcomeDTO{ID: o.ID, Title: o.Title, OddsMilli: o.OddsMilli})
		}
		out = append(out, marketDTO{
			ID: m.ID, Title: m.Title, Category: m.Category, CloseTime: m.CloseTime,
			GameStart: m.GameStart, ImageURL: m.ImageURL,
			Description: m.Description, ContextDescription: m.ContextDescription, Outcomes: od,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleMyBets(w http.ResponseWriter, r *http.Request, userID int64) {
	bs, err := betting.ListUserBets(r.Context(), s.pool, userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "server error")
		return
	}
	out := make([]betDTO, 0, len(bs))
	for _, b := range bs {
		out = append(out, toBetDTO(b))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handlePlaceBet(w http.ResponseWriter, r *http.Request, userID int64) {
	var req struct {
		OutcomeID int64 `json:"outcome_id"`
		StakeNano int64 `json:"stake_nano"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request")
		return
	}
	bet, err := betting.PlaceBet(r.Context(), s.pool, userID, req.OutcomeID, req.StakeNano)
	if err != nil {
		switch {
		case errors.Is(err, betting.ErrOutcomeNotFound):
			writeErr(w, http.StatusNotFound, "outcome not found")
		case errors.Is(err, betting.ErrMarketClosed):
			writeErr(w, http.StatusBadRequest, "market is closed")
		case errors.Is(err, betting.ErrStakeTooSmall):
			writeErr(w, http.StatusBadRequest, "stake too small")
		case errors.Is(err, betting.ErrLimitExceeded):
			writeErr(w, http.StatusBadRequest, "bet limit exceeded")
		default:
			writeErr(w, http.StatusBadRequest, "could not place bet (check balance)")
		}
		return
	}
	writeJSON(w, http.StatusOK, toBetDTO(bet))
}

// MinDepositStars / MaxDepositStars bound a single Stars top-up.
const (
	MinDepositStars = 50 // 0.25 TON at the 200⭐ = 1 TON peg
	MaxDepositStars = 1_000_000
)

// handleStarsInvoice creates a Stars invoice link the Mini App opens via
// Telegram.WebApp.openInvoice. The balance credit happens later, on the
// successful_payment update (payments webhook), not here.
func (s *Server) handleStarsInvoice(w http.ResponseWriter, r *http.Request, userID int64) {
	if s.tg == nil {
		writeErr(w, http.StatusServiceUnavailable, "stars deposit unavailable")
		return
	}
	var req struct {
		Stars int64 `json:"stars"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request")
		return
	}
	if req.Stars < MinDepositStars || req.Stars > MaxDepositStars {
		writeErr(w, http.StatusBadRequest, "invalid amount")
		return
	}
	link, err := s.tg.CreateStarsInvoiceLink(r.Context(),
		"Пополнение баланса",
		fmt.Sprintf("Пополнение баланса · %d⭐", req.Stars),
		fmt.Sprintf("dep:%d", userID),
		req.Stars)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "could not create invoice")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"link": link})
}

// handleStarsQuote returns how much TON a given Stars amount credits right now, so
// the Mini App can show an honest live equivalent before the user pays.
func (s *Server) handleStarsQuote(w http.ResponseWriter, r *http.Request, _ int64) {
	if s.rates == nil {
		writeErr(w, http.StatusServiceUnavailable, "rate unavailable")
		return
	}
	stars, _ := strconv.ParseInt(r.URL.Query().Get("stars"), 10, 64)
	if stars < MinDepositStars || stars > MaxDepositStars {
		writeErr(w, http.StatusBadRequest, "invalid amount")
		return
	}
	nano := deposits.StarsToNano(stars, s.rates.TonUSD(r.Context()))
	writeJSON(w, http.StatusOK, starsQuoteDTO{Stars: stars, TonNano: nano})
}

// handleTonDepositAddress returns the house TON deposit address and the caller's
// unique memo. The Mini App builds a TON Connect transfer to {address} carrying
// {memo} as the transfer comment; the chain watcher then credits the confirmed
// inbound amount 1:1 to this user. We credit what actually arrives on-chain, not
// any requested amount, so a user editing the amount in their wallet is harmless.
func (s *Server) handleTonDepositAddress(w http.ResponseWriter, r *http.Request, userID int64) {
	if s.tonDepositAddr == "" {
		writeErr(w, http.StatusServiceUnavailable, "ton deposit unavailable")
		return
	}
	memo, err := deposits.EnsureTonMemo(r.Context(), s.pool, userID)
	if err != nil {
		log.Printf("ton deposit memo for user %d: %v", userID, err)
		writeErr(w, http.StatusInternalServerError, "could not prepare deposit")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"address":  s.tonDepositAddr,
		"memo":     memo,
		"min_nano": deposits.MinTonDepositNano,
	})
}

// handleWithdraw books a TON payout: it debits the user's balance and queues a
// pending withdrawal the background sender broadcasts on-chain. The user receives
// amount_nano minus the network fee. Returns the queued withdrawal so the Mini App
// can confirm it's in flight.
func (s *Server) handleWithdraw(w http.ResponseWriter, r *http.Request, userID int64) {
	if s.withdrawSender == nil {
		writeErr(w, http.StatusServiceUnavailable, "withdrawals unavailable")
		return
	}
	var req struct {
		ToAddress  string `json:"to_address"`
		AmountNano int64  `json:"amount_nano"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request")
		return
	}
	wd, err := withdrawals.Request(r.Context(), s.pool, userID, req.ToAddress, req.AmountNano)
	if err != nil {
		switch {
		case errors.Is(err, withdrawals.ErrBadAddress):
			writeErr(w, http.StatusBadRequest, "invalid address")
		case errors.Is(err, withdrawals.ErrAmountTooSmall):
			writeErr(w, http.StatusBadRequest, "amount too small")
		case errors.Is(err, withdrawals.ErrInsufficient):
			writeErr(w, http.StatusBadRequest, "insufficient balance")
		default:
			log.Printf("withdraw user %d: %v", userID, err)
			writeErr(w, http.StatusInternalServerError, "server error")
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id":          wd.ID,
		"status":      wd.Status,
		"amount_nano": wd.AmountNano,
		"fee_nano":    wd.FeeNano,
		"send_nano":   wd.SendNano,
	})
}

// handleRocketState returns the current crash-game state (one-shot, for initial
// load or polling fallback).
func (s *Server) handleRocketState(w http.ResponseWriter, _ *http.Request, _ int64) {
	if s.rocket == nil {
		writeErr(w, http.StatusServiceUnavailable, "rocket unavailable")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(s.rocket.SnapshotJSON())
}

// handleRocketStream pushes live round state over Server-Sent Events. Auth comes
// from the `auth` query param (the browser EventSource can't set headers). The
// per-connection write deadline is cleared so the long-lived stream isn't killed by
// the server's default WriteTimeout.
func (s *Server) handleRocketStream(w http.ResponseWriter, r *http.Request, _ int64) {
	if s.rocket == nil {
		writeErr(w, http.StatusServiceUnavailable, "rocket unavailable")
		return
	}
	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Time{}) // no write timeout for this connection

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // disable proxy buffering, if any
	w.WriteHeader(http.StatusOK)

	ch, cancel := s.rocket.Subscribe()
	defer cancel()

	// Send the current snapshot immediately so a fresh client renders without waiting.
	if _, err := fmt.Fprintf(w, "data: %s\n\n", s.rocket.SnapshotJSON()); err != nil {
		return
	}
	_ = rc.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			if _, err := fmt.Fprintf(w, "data: %s\n\n", msg); err != nil {
				return
			}
			if err := rc.Flush(); err != nil {
				return
			}
		}
	}
}

// handleRocketBet places a stake in the current round's betting window.
func (s *Server) handleRocketBet(w http.ResponseWriter, r *http.Request, userID int64) {
	if s.rocket == nil {
		writeErr(w, http.StatusServiceUnavailable, "rocket unavailable")
		return
	}
	var req struct {
		StakeNano int64 `json:"stake_nano"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request")
		return
	}
	roundID, betID, err := s.rocket.PlaceBet(r.Context(), userID, req.StakeNano)
	if err != nil {
		switch {
		case errors.Is(err, rocket.ErrStakeTooSmall):
			writeErr(w, http.StatusBadRequest, "stake too small")
		case errors.Is(err, rocket.ErrStakeTooLarge):
			writeErr(w, http.StatusBadRequest, "stake too large")
		case errors.Is(err, rocket.ErrBettingClosed):
			writeErr(w, http.StatusBadRequest, "betting is closed")
		case errors.Is(err, rocket.ErrAlreadyInRound):
			writeErr(w, http.StatusBadRequest, "already in this round")
		case errors.Is(err, rocket.ErrInsufficient):
			writeErr(w, http.StatusBadRequest, "insufficient balance")
		default:
			log.Printf("rocket bet user %d: %v", userID, err)
			writeErr(w, http.StatusInternalServerError, "server error")
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"round_id": roundID, "bet_id": betID})
}

// handleRocketCashout cashes the caller out of the current flight at the live
// multiplier.
func (s *Server) handleRocketCashout(w http.ResponseWriter, r *http.Request, userID int64) {
	if s.rocket == nil {
		writeErr(w, http.StatusServiceUnavailable, "rocket unavailable")
		return
	}
	multMilli, payoutNano, err := s.rocket.Cashout(r.Context(), userID)
	if err != nil {
		switch {
		case errors.Is(err, rocket.ErrNotFlying):
			writeErr(w, http.StatusBadRequest, "round not in flight")
		case errors.Is(err, rocket.ErrTooLate):
			writeErr(w, http.StatusBadRequest, "too late")
		case errors.Is(err, rocket.ErrNoActiveBet):
			writeErr(w, http.StatusBadRequest, "no active bet")
		default:
			log.Printf("rocket cashout user %d: %v", userID, err)
			writeErr(w, http.StatusInternalServerError, "server error")
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"multiplier_milli": multMilli,
		"payout_nano":      payoutNano,
	})
}

// handleDiceState returns the player's fairness commitment (seed hash, client seed,
// nonce), the economics (edge, stake bounds), the multiplier table, and recent rolls.
func (s *Server) handleDiceState(w http.ResponseWriter, r *http.Request, userID int64) {
	if s.dice == nil {
		writeErr(w, http.StatusServiceUnavailable, "dice unavailable")
		return
	}
	st, err := s.dice.State(r.Context(), userID)
	if err != nil {
		log.Printf("dice state user %d: %v", userID, err)
		writeErr(w, http.StatusInternalServerError, "server error")
		return
	}
	cfg := s.dice.Config()
	exact := make(map[string]int64, 11)
	for t := 2; t <= 12; t++ {
		exact[strconv.Itoa(t)] = dice.MultMilli(cfg.EdgeBp, dice.Ways(dice.BetExact, t))
	}
	writeJSON(w, http.StatusOK, diceStateDTO{
		ServerSeedHash: st.ServerSeedHash,
		ClientSeed:     st.ClientSeed,
		Nonce:          st.Nonce,
		EdgeBp:         cfg.EdgeBp,
		MinStakeNano:   cfg.MinStakeNano,
		MaxStakeNano:   cfg.MaxStakeNano,
		MultLow:        dice.MultMilli(cfg.EdgeBp, dice.Ways(dice.BetLow, 0)),
		MultHigh:       dice.MultMilli(cfg.EdgeBp, dice.Ways(dice.BetHigh, 0)),
		MultExact:      exact,
		Recent:         st.Recent,
	})
}

// handleDiceRoll plays one instant roll on the player's chosen bet.
func (s *Server) handleDiceRoll(w http.ResponseWriter, r *http.Request, userID int64) {
	if s.dice == nil {
		writeErr(w, http.StatusServiceUnavailable, "dice unavailable")
		return
	}
	var req struct {
		BetKind   string `json:"bet_kind"`
		BetTarget int    `json:"bet_target"`
		StakeNano int64  `json:"stake_nano"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request")
		return
	}
	res, err := s.dice.Roll(r.Context(), userID, req.BetKind, req.BetTarget, req.StakeNano)
	if err != nil {
		switch {
		case errors.Is(err, dice.ErrInvalidBet):
			writeErr(w, http.StatusBadRequest, "invalid bet")
		case errors.Is(err, dice.ErrStakeTooSmall):
			writeErr(w, http.StatusBadRequest, "stake too small")
		case errors.Is(err, dice.ErrStakeTooLarge):
			writeErr(w, http.StatusBadRequest, "stake too large")
		case errors.Is(err, dice.ErrInsufficient):
			writeErr(w, http.StatusBadRequest, "insufficient balance")
		case errors.Is(err, dice.ErrHouseCantCover):
			writeErr(w, http.StatusBadRequest, "stake too large for bankroll")
		default:
			log.Printf("dice roll user %d: %v", userID, err)
			writeErr(w, http.StatusInternalServerError, "server error")
		}
		return
	}
	writeJSON(w, http.StatusOK, diceRollDTO{
		RollID:         res.RollID,
		Nonce:          res.Nonce,
		Die1:           res.Die1,
		Die2:           res.Die2,
		Sum:            res.Sum,
		Won:            res.Won,
		MultMilli:      res.MultMilli,
		PayoutNano:     res.PayoutNano,
		BalanceNano:    res.BalanceNano,
		ServerSeedHash: res.ServerSeedHash,
	})
}

// handleDiceRotate reveals the player's current server seed and commits a fresh one
// (resetting the nonce), so they can verify all rolls drawn under the old seed.
func (s *Server) handleDiceRotate(w http.ResponseWriter, r *http.Request, userID int64) {
	if s.dice == nil {
		writeErr(w, http.StatusServiceUnavailable, "dice unavailable")
		return
	}
	var req struct {
		ClientSeed string `json:"client_seed"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req) // body optional
	rot, err := s.dice.RotateSeed(r.Context(), userID, req.ClientSeed)
	if err != nil {
		log.Printf("dice rotate user %d: %v", userID, err)
		writeErr(w, http.StatusInternalServerError, "server error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"old_server_seed":  rot.OldServerSeed,
		"old_server_hash":  rot.OldServerHash,
		"rolled_nonce":     rot.RolledNonce,
		"server_seed_hash": rot.NewServerHash,
		"client_seed":      rot.NewClientSeed,
	})
}

// handleCaseState returns the player's fairness commitment (seed hash, client seed,
// nonce), the spin price, the prize table (rarity + multiplier; weights stay hidden),
// and recent spins.
func (s *Server) handleCaseState(w http.ResponseWriter, r *http.Request, userID int64) {
	if s.caseStore == nil {
		writeErr(w, http.StatusServiceUnavailable, "case unavailable")
		return
	}
	st, err := s.caseStore.State(r.Context(), userID)
	if err != nil {
		log.Printf("case state user %d: %v", userID, err)
		writeErr(w, http.StatusInternalServerError, "server error")
		return
	}
	writeJSON(w, http.StatusOK, caseStateDTO{
		ServerSeedHash: st.ServerSeedHash,
		ClientSeed:     st.ClientSeed,
		Nonce:          st.Nonce,
		MinStakeNano:   st.MinStakeNano,
		MaxStakeNano:   st.MaxStakeNano,
		Prizes:         st.Prizes,
		Recent:         st.Recent,
	})
}

// handleCaseOpen plays one instant case open at the player's chosen stake: locks the
// stake, draws a prize, settles stake × multiplier.
func (s *Server) handleCaseOpen(w http.ResponseWriter, r *http.Request, userID int64) {
	if s.caseStore == nil {
		writeErr(w, http.StatusServiceUnavailable, "case unavailable")
		return
	}
	var req struct {
		StakeNano int64 `json:"stake_nano"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request")
		return
	}
	res, err := s.caseStore.Open(r.Context(), userID, req.StakeNano)
	if err != nil {
		switch {
		case errors.Is(err, casegame.ErrStakeTooSmall):
			writeErr(w, http.StatusBadRequest, "stake too small")
		case errors.Is(err, casegame.ErrStakeTooLarge):
			writeErr(w, http.StatusBadRequest, "stake too large")
		case errors.Is(err, casegame.ErrInsufficient):
			writeErr(w, http.StatusBadRequest, "insufficient balance")
		case errors.Is(err, casegame.ErrHouseCantCover):
			writeErr(w, http.StatusBadRequest, "house can't cover payout")
		default:
			log.Printf("case open user %d: %v", userID, err)
			writeErr(w, http.StatusInternalServerError, "server error")
		}
		return
	}
	writeJSON(w, http.StatusOK, caseSpinDTO{
		SpinID:         res.SpinID,
		Nonce:          res.Nonce,
		PrizeIndex:     res.PrizeIndex,
		Rarity:         res.Rarity,
		MultMilli:      res.MultMilli,
		StakeNano:      res.StakeNano,
		PayoutNano:     res.PayoutNano,
		BalanceNano:    res.BalanceNano,
		ServerSeedHash: res.ServerSeedHash,
	})
}

// handleCaseRotate reveals the player's current server seed and commits a fresh one
// (resetting the nonce), so they can verify all spins drawn under the old seed.
func (s *Server) handleCaseRotate(w http.ResponseWriter, r *http.Request, userID int64) {
	if s.caseStore == nil {
		writeErr(w, http.StatusServiceUnavailable, "case unavailable")
		return
	}
	var req struct {
		ClientSeed string `json:"client_seed"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req) // body optional
	rot, err := s.caseStore.RotateSeed(r.Context(), userID, req.ClientSeed)
	if err != nil {
		log.Printf("case rotate user %d: %v", userID, err)
		writeErr(w, http.StatusInternalServerError, "server error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"old_server_seed":  rot.OldServerSeed,
		"old_server_hash":  rot.OldServerHash,
		"spun_nonce":       rot.SpunNonce,
		"server_seed_hash": rot.NewServerHash,
		"client_seed":      rot.NewClientSeed,
	})
}

// handleBasketState returns the player's fairness commitment, the economics (chance,
// edge, multiplier), stake bounds and recent throws.
func (s *Server) handleBasketState(w http.ResponseWriter, r *http.Request, userID int64) {
	if s.basket == nil {
		writeErr(w, http.StatusServiceUnavailable, "basket unavailable")
		return
	}
	st, err := s.basket.State(r.Context(), userID)
	if err != nil {
		log.Printf("basket state user %d: %v", userID, err)
		writeErr(w, http.StatusInternalServerError, "server error")
		return
	}
	writeJSON(w, http.StatusOK, basketStateDTO{
		ServerSeedHash: st.ServerSeedHash,
		ClientSeed:     st.ClientSeed,
		Nonce:          st.Nonce,
		HitProbBp:      st.HitProbBp,
		EdgeBp:         st.EdgeBp,
		MultMilli:      st.MultMilli,
		MinStakeNano:   st.MinStakeNano,
		MaxStakeNano:   st.MaxStakeNano,
		Recent:         st.Recent,
	})
}

// handleBasketThrow plays one instant shot at the player's chosen stake.
func (s *Server) handleBasketThrow(w http.ResponseWriter, r *http.Request, userID int64) {
	if s.basket == nil {
		writeErr(w, http.StatusServiceUnavailable, "basket unavailable")
		return
	}
	var req struct {
		StakeNano int64 `json:"stake_nano"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request")
		return
	}
	res, err := s.basket.Throw(r.Context(), userID, req.StakeNano)
	if err != nil {
		switch {
		case errors.Is(err, basket.ErrStakeTooSmall):
			writeErr(w, http.StatusBadRequest, "stake too small")
		case errors.Is(err, basket.ErrStakeTooLarge):
			writeErr(w, http.StatusBadRequest, "stake too large")
		case errors.Is(err, basket.ErrInsufficient):
			writeErr(w, http.StatusBadRequest, "insufficient balance")
		case errors.Is(err, basket.ErrHouseCantCover):
			writeErr(w, http.StatusBadRequest, "stake too large for bankroll")
		default:
			log.Printf("basket throw user %d: %v", userID, err)
			writeErr(w, http.StatusInternalServerError, "server error")
		}
		return
	}
	writeJSON(w, http.StatusOK, basketThrowDTO{
		ThrowID:        res.ThrowID,
		Nonce:          res.Nonce,
		Roll:           res.Roll,
		Hit:            res.Hit,
		MultMilli:      res.MultMilli,
		StakeNano:      res.StakeNano,
		PayoutNano:     res.PayoutNano,
		BalanceNano:    res.BalanceNano,
		ServerSeedHash: res.ServerSeedHash,
	})
}

// handleBasketRotate reveals the player's current server seed and commits a fresh one.
func (s *Server) handleBasketRotate(w http.ResponseWriter, r *http.Request, userID int64) {
	if s.basket == nil {
		writeErr(w, http.StatusServiceUnavailable, "basket unavailable")
		return
	}
	var req struct {
		ClientSeed string `json:"client_seed"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req) // body optional
	rot, err := s.basket.RotateSeed(r.Context(), userID, req.ClientSeed)
	if err != nil {
		log.Printf("basket rotate user %d: %v", userID, err)
		writeErr(w, http.StatusInternalServerError, "server error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"old_server_seed":  rot.OldServerSeed,
		"old_server_hash":  rot.OldServerHash,
		"thrown_nonce":     rot.ThrownNonce,
		"server_seed_hash": rot.NewServerHash,
		"client_seed":      rot.NewClientSeed,
	})
}

// RegisterWebhook stores the secret used to authenticate incoming webhook calls
// and (if url is non-empty) registers it with Telegram. No-op without a bot token.
func (s *Server) RegisterWebhook(ctx context.Context, url, secret string) error {
	s.webhookSecret = secret
	if s.tg == nil || url == "" {
		return nil
	}
	return s.tg.SetWebhook(ctx, url, secret)
}

// handleTgWebhook receives Telegram updates (Stars payments). It is NOT behind
// Mini App auth — Telegram calls it directly — so it's guarded by the secret token
// set at setWebhook time. We answer 200 once handled so Telegram stops retrying;
// non-2xx is returned only on transient errors we want retried.
func (s *Server) handleTgWebhook(w http.ResponseWriter, r *http.Request) {
	if s.tg == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if s.webhookSecret != "" && r.Header.Get("X-Telegram-Bot-Api-Secret-Token") != s.webhookSecret {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	var u tg.Update
	if err := json.NewDecoder(r.Body).Decode(&u); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	// Pre-checkout: approve within 10s or the payment fails. The amount is already
	// fixed by the invoice we issued, so we accept unconditionally.
	if q := u.PreCheckoutQuery; q != nil {
		if err := s.tg.AnswerPreCheckoutQuery(r.Context(), q.ID, true, ""); err != nil {
			log.Printf("answerPreCheckoutQuery: %v", err)
		}
		w.WriteHeader(http.StatusOK)
		return
	}

	// Successful payment → credit the payer, idempotent by charge id.
	if m := u.Message; m != nil && m.SuccessfulPayment != nil && m.From != nil {
		sp := m.SuccessfulPayment
		if sp.Currency == "XTR" && sp.TelegramPaymentChargeID != "" {
			if err := s.upsertUser(r.Context(), TgUser{ID: m.From.ID, Username: m.From.Username, FirstName: m.From.FirstName}); err != nil {
				log.Printf("webhook upsert user %d: %v", m.From.ID, err)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			tonUSD := 0.0
			if s.rates != nil {
				tonUSD = s.rates.TonUSD(r.Context())
			}
			if err := deposits.CreditStars(r.Context(), s.pool, m.From.ID, sp.TotalAmount, sp.TelegramPaymentChargeID, tonUSD); err != nil {
				log.Printf("webhook credit stars user %d charge %s: %v", m.From.ID, sp.TelegramPaymentChargeID, err)
				w.WriteHeader(http.StatusInternalServerError) // let Telegram retry
				return
			}
		}
	}
	w.WriteHeader(http.StatusOK)
}

func (s *Server) cors(next http.Handler) http.Handler {
	origin := s.webOrigin
	if origin == "" {
		origin = "*"
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

type meDTO struct {
	UserID          int64 `json:"user_id"`
	BalanceNano     int64 `json:"balance_nano"`
	WithdrawEnabled bool  `json:"withdraw_enabled"`
	MinWithdrawNano int64 `json:"min_withdraw_nano"`
	WithdrawFeeNano int64 `json:"withdraw_fee_nano"`
}

type starsQuoteDTO struct {
	Stars   int64 `json:"stars"`
	TonNano int64 `json:"ton_nano"`
}

type diceStateDTO struct {
	ServerSeedHash string           `json:"server_seed_hash"`
	ClientSeed     string           `json:"client_seed"`
	Nonce          int64            `json:"nonce"`
	EdgeBp         int64            `json:"edge_bp"`
	MinStakeNano   int64            `json:"min_stake_nano"`
	MaxStakeNano   int64            `json:"max_stake_nano"`
	MultLow        int64            `json:"mult_low"`
	MultHigh       int64            `json:"mult_high"`
	MultExact      map[string]int64 `json:"mult_exact"` // keys "2".."12"
	Recent         []dice.RollRow   `json:"recent"`
}

type diceRollDTO struct {
	RollID         int64  `json:"roll_id"`
	Nonce          int64  `json:"nonce"`
	Die1           int    `json:"die1"`
	Die2           int    `json:"die2"`
	Sum            int    `json:"sum"`
	Won            bool   `json:"won"`
	MultMilli      int64  `json:"mult_milli"`
	PayoutNano     int64  `json:"payout_nano"`
	BalanceNano    int64  `json:"balance_nano"`
	ServerSeedHash string `json:"server_seed_hash"`
}

type caseStateDTO struct {
	ServerSeedHash string             `json:"server_seed_hash"`
	ClientSeed     string             `json:"client_seed"`
	Nonce          int64              `json:"nonce"`
	MinStakeNano   int64              `json:"min_stake_nano"`
	MaxStakeNano   int64              `json:"max_stake_nano"`
	Prizes         []casegame.Prize   `json:"prizes"` // order = reel tiers; weights hidden
	Recent         []casegame.SpinRow `json:"recent"`
}

type caseSpinDTO struct {
	SpinID         int64  `json:"spin_id"`
	Nonce          int64  `json:"nonce"`
	PrizeIndex     int    `json:"prize_index"`
	Rarity         string `json:"rarity"`
	MultMilli      int64  `json:"mult_milli"`
	StakeNano      int64  `json:"stake_nano"`
	PayoutNano     int64  `json:"payout_nano"`
	BalanceNano    int64  `json:"balance_nano"`
	ServerSeedHash string `json:"server_seed_hash"`
}

type basketStateDTO struct {
	ServerSeedHash string            `json:"server_seed_hash"`
	ClientSeed     string            `json:"client_seed"`
	Nonce          int64             `json:"nonce"`
	HitProbBp      int64             `json:"hit_prob_bp"` // score chance, 5000 = 50%
	EdgeBp         int64             `json:"edge_bp"`
	MultMilli      int64             `json:"mult_milli"` // win multiplier ×1000
	MinStakeNano   int64             `json:"min_stake_nano"`
	MaxStakeNano   int64             `json:"max_stake_nano"`
	Recent         []basket.ThrowRow `json:"recent"`
}

type basketThrowDTO struct {
	ThrowID        int64  `json:"throw_id"`
	Nonce          int64  `json:"nonce"`
	Roll           int    `json:"roll"`
	Hit            bool   `json:"hit"`
	MultMilli      int64  `json:"mult_milli"`
	StakeNano      int64  `json:"stake_nano"`
	PayoutNano     int64  `json:"payout_nano"`
	BalanceNano    int64  `json:"balance_nano"`
	ServerSeedHash string `json:"server_seed_hash"`
}

type outcomeDTO struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	OddsMilli int64  `json:"odds_milli"`
}

type marketDTO struct {
	ID                 int64        `json:"id"`
	Title              string       `json:"title"`
	Category           string       `json:"category"`
	CloseTime          *time.Time   `json:"close_time"`
	GameStart          *time.Time   `json:"game_start_time,omitempty"`
	ImageURL           string       `json:"image_url,omitempty"`
	Description        string       `json:"description,omitempty"`
	ContextDescription string       `json:"context_description,omitempty"`
	Outcomes           []outcomeDTO `json:"outcomes"`
}

type betDTO struct {
	ID                 int64      `json:"id"`
	MarketID           int64      `json:"market_id"`
	OutcomeID          int64      `json:"outcome_id"`
	StakeNano          int64      `json:"stake_nano"`
	OddsMilli          int64      `json:"odds_milli"`
	PayoutNano         int64      `json:"payout_nano"`
	Status             string     `json:"status"`
	PlacedAt           time.Time  `json:"placed_at"`
	MarketTitle        string     `json:"market_title"`
	OutcomeTitle       string     `json:"outcome_title"`
	ImageURL           string     `json:"image_url,omitempty"`
	Description        string     `json:"description,omitempty"`
	ContextDescription string     `json:"context_description,omitempty"`
	CloseTime          *time.Time `json:"close_time,omitempty"`
	GameStart          *time.Time `json:"game_start_time,omitempty"`
}

func toBetDTO(b betting.Bet) betDTO {
	return betDTO{
		ID:                 b.ID,
		MarketID:           b.MarketID,
		OutcomeID:          b.OutcomeID,
		StakeNano:          b.StakeNano,
		OddsMilli:          b.OddsMilli,
		PayoutNano:         b.PayoutNano,
		Status:             b.Status,
		PlacedAt:           b.PlacedAt,
		MarketTitle:        b.MarketTitle,
		OutcomeTitle:       b.OutcomeTitle,
		ImageURL:           b.ImageURL,
		Description:        b.Description,
		ContextDescription: b.ContextDescription,
		CloseTime:          b.CloseTime,
		GameStart:          b.GameStart,
	}
}
