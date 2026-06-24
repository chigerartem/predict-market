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

	"predict/internal/betting"
	"predict/internal/deposits"
	"predict/internal/ledger"
	"predict/internal/markets"
	"predict/internal/rates"
	"predict/internal/tg"
)

// Server holds dependencies for the HTTP API.
type Server struct {
	pool          *pgxpool.Pool
	botToken      string
	tg            *tg.Client      // nil when no bot token → Stars deposit disabled
	rates         *rates.Provider // live TON/USD price for valuing Stars deposits
	webhookSecret string          // shared secret Telegram echoes on webhook calls
	webOrigin     string
	devUserID     int64 // when > 0, fallback identity for local dev
	allowInsecure bool  // when true and no bot token, accept initData WITHOUT verifying (testing only)
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
	authz := r.Header.Get("Authorization")
	if initData, ok := strings.CutPrefix(authz, "tma "); ok {
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
	bal, err := ledger.Balance(r.Context(), s.pool, acct)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "server error")
		return
	}
	writeJSON(w, http.StatusOK, meDTO{UserID: userID, BalanceNano: bal})
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
		out = append(out, marketDTO{ID: m.ID, Title: m.Title, Category: m.Category, CloseTime: m.CloseTime, Outcomes: od})
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
	UserID      int64 `json:"user_id"`
	BalanceNano int64 `json:"balance_nano"`
}

type starsQuoteDTO struct {
	Stars   int64 `json:"stars"`
	TonNano int64 `json:"ton_nano"`
}

type outcomeDTO struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	OddsMilli int64  `json:"odds_milli"`
}

type marketDTO struct {
	ID        int64        `json:"id"`
	Title     string       `json:"title"`
	Category  string       `json:"category"`
	CloseTime *time.Time   `json:"close_time"`
	Outcomes  []outcomeDTO `json:"outcomes"`
}

type betDTO struct {
	ID           int64     `json:"id"`
	MarketID     int64     `json:"market_id"`
	OutcomeID    int64     `json:"outcome_id"`
	StakeNano    int64     `json:"stake_nano"`
	OddsMilli    int64     `json:"odds_milli"`
	PayoutNano   int64     `json:"payout_nano"`
	Status       string    `json:"status"`
	PlacedAt     time.Time `json:"placed_at"`
	MarketTitle  string    `json:"market_title"`
	OutcomeTitle string    `json:"outcome_title"`
}

func toBetDTO(b betting.Bet) betDTO {
	return betDTO{
		ID:           b.ID,
		MarketID:     b.MarketID,
		OutcomeID:    b.OutcomeID,
		StakeNano:    b.StakeNano,
		OddsMilli:    b.OddsMilli,
		PayoutNano:   b.PayoutNano,
		Status:       b.Status,
		PlacedAt:     b.PlacedAt,
		MarketTitle:  b.MarketTitle,
		OutcomeTitle: b.OutcomeTitle,
	}
}
