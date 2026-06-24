// Package httpapi exposes the prediction-market HTTP API consumed by the
// Telegram Mini App. Authentication is Telegram initData (Authorization: tma ...).
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"predict/internal/betting"
	"predict/internal/ledger"
	"predict/internal/markets"
)

// Server holds dependencies for the HTTP API.
type Server struct {
	pool      *pgxpool.Pool
	botToken  string
	webOrigin string
	devUserID int64 // when > 0, used as a fallback identity for local development
}

// New builds a Server.
func New(pool *pgxpool.Pool, botToken, webOrigin string, devUserID int64) *Server {
	return &Server{pool: pool, botToken: botToken, webOrigin: webOrigin, devUserID: devUserID}
}

// Handler returns the configured HTTP handler (with CORS).
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /api/me", s.auth(s.handleMe))
	mux.HandleFunc("GET /api/markets", s.auth(s.handleMarkets))
	mux.HandleFunc("GET /api/bets", s.auth(s.handleMyBets))
	mux.HandleFunc("POST /api/bets", s.auth(s.handlePlaceBet))
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
		if u, err := validateInitData(initData, s.botToken, 24*time.Hour); err == nil {
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
	ID         int64     `json:"id"`
	MarketID   int64     `json:"market_id"`
	OutcomeID  int64     `json:"outcome_id"`
	StakeNano  int64     `json:"stake_nano"`
	OddsMilli  int64     `json:"odds_milli"`
	PayoutNano int64     `json:"payout_nano"`
	Status     string    `json:"status"`
	PlacedAt   time.Time `json:"placed_at"`
}

func toBetDTO(b betting.Bet) betDTO {
	return betDTO{
		ID:         b.ID,
		MarketID:   b.MarketID,
		OutcomeID:  b.OutcomeID,
		StakeNano:  b.StakeNano,
		OddsMilli:  b.OddsMilli,
		PayoutNano: b.PayoutNano,
		Status:     b.Status,
		PlacedAt:   b.PlacedAt,
	}
}
