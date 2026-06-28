// Command api serves the prediction-market HTTP API for the Telegram Mini App.
//
//	DATABASE_URL=postgres://... TG_BOT_TOKEN=... go run ./cmd/api
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"predict/internal/db"
	"predict/internal/deposits"
	"predict/internal/dice"
	"predict/internal/httpapi"
	"predict/internal/polymarket"
	"predict/internal/rates"
	"predict/internal/rocket"
	"predict/internal/ton"
	"predict/internal/withdrawals"
)

func main() {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		log.Fatal("DATABASE_URL is not set")
	}
	botToken := os.Getenv("TG_BOT_TOKEN")
	webOrigin := os.Getenv("WEB_ORIGIN")
	if webOrigin == "" {
		webOrigin = "https://market.kopix.online"
	}
	devUserID, _ := strconv.ParseInt(os.Getenv("DEV_USER_ID"), 10, 64)
	allowInsecure := os.Getenv("ALLOW_INSECURE_INITDATA") == "1"
	port := os.Getenv("PORT")
	if port == "" {
		port = "8000"
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

	if allowInsecure && botToken == "" {
		log.Println("WARNING: ALLOW_INSECURE_INITDATA=1 and no TG_BOT_TOKEN — initData is NOT verified (testing only)")
	}
	srv := httpapi.New(pool, botToken, webOrigin, devUserID, allowInsecure)

	// Live TON/USD price for valuing Stars deposits. Fallback (conservative/high)
	// is used only on cold start if CoinGecko is unreachable. Optional env overrides
	// for the per-star USD anchor and the deposit buffer.
	srv.SetRates(rates.New(envFloat("TON_USD_FALLBACK", 3.0)))
	if v := envFloat("STAR_USD_WITHDRAW", 0); v > 0 {
		deposits.StarUSDWithdraw = v
	}
	if v := envFloat("STARS_DEPOSIT_BUFFER", 0); v > 0 {
		deposits.DepositBuffer = v
	}

	// House TON address users deposit to (TON Connect). Empty → TON deposit
	// endpoint disabled. The watcher that credits inbound transfers is wired below.
	srv.SetTonDeposit(os.Getenv("TON_DEPOSIT_ADDRESS"))

	// Test-phase: one-time bonus (nano-TON) credited to each user on first /api/me so
	// people can try the games without depositing. 0 (default) disables it. Set e.g.
	// SIGNUP_BONUS_NANO=100000000000 for 100 TON. Idempotent per user.
	srv.SetSignupBonus(envInt("SIGNUP_BONUS_NANO", 0))

	if err := srv.RegisterWebhook(ctx, os.Getenv("TG_WEBHOOK_URL"), os.Getenv("TG_WEBHOOK_SECRET")); err != nil {
		log.Printf("webhook registration failed (continuing): %v", err)
	}

	// Background: mirror real Polymarket markets into our DB on an interval.
	if envBool("POLY_INGEST_ENABLED", true) {
		go runIngestLoop(ctx, pool,
			int(envInt("POLY_INGEST_LIMIT", 1000)),
			envFloat("HOUSE_EDGE", 0.05),
			envFloat("POLY_MAX_PROB", 0.97),
			envFloat("POLY_MIN_VOL24H", 50000),
			envInt("POLY_INGEST_INTERVAL_SEC", 600))
	}

	// Background: settle our markets that resolved on Polymarket (pays/charges bets).
	if envBool("POLY_RESOLVE_ENABLED", true) {
		go runResolveLoop(ctx, pool, envInt("POLY_RESOLVE_INTERVAL_SEC", 300))
	}

	// Background: watch the house TON address and credit inbound deposits by memo.
	if addr := os.Getenv("TON_DEPOSIT_ADDRESS"); addr != "" && envBool("TON_DEPOSIT_ENABLED", true) {
		go runTonWatchLoop(ctx, ton.NewWatcher(pool, addr, os.Getenv("TONCENTER_API_KEY")),
			envInt("TON_WATCH_INTERVAL_SEC", 20))
	}

	// House hot wallet for TON withdrawals (auto-payout). Empty mnemonic disables
	// the feature. Wallet init does a network call, so a failure here only disables
	// withdrawals — the API still starts.
	if mnemonic := os.Getenv("TON_HOT_WALLET_MNEMONIC"); mnemonic != "" && envBool("TON_WITHDRAW_ENABLED", true) {
		sender, err := ton.NewSender(ctx, mnemonic)
		if err != nil {
			log.Printf("ton withdraw disabled: hot wallet init failed: %v", err)
		} else {
			log.Printf("ton withdraw enabled: hot wallet %s", sender.Address())
			srv.SetWithdrawSender(sender)
			go runWithdrawLoop(ctx, pool, sender, envInt("TON_WITHDRAW_INTERVAL_SEC", 15))
		}
	}

	// Rocket crash game: one shared round loop in the background, live state over
	// SSE. Reuses the ledger; needs a funded HOUSE_TREASURY to cover cashout profits.
	if envBool("ROCKET_ENABLED", true) {
		store, err := rocket.NewStore(ctx, pool)
		if err != nil {
			log.Printf("rocket disabled: %v", err)
		} else {
			cfg := rocket.DefaultConfig()
			if v := envInt("ROCKET_EDGE_BP", 0); v > 0 {
				cfg.EdgeBp = v
			}
			if v := envFloat("ROCKET_GROWTH", 0); v > 0 {
				cfg.GrowthPerSec = v
			}
			if v := envInt("ROCKET_MAX_MILLI", 0); v > 0 {
				cfg.MaxMilli = v
			}
			if v := envInt("ROCKET_MAX_STAKE_NANO", 0); v > 0 {
				cfg.MaxStakeNano = v
			}
			eng := rocket.New(store, cfg)
			eng.Warm(ctx)
			srv.SetRocket(eng)
			go eng.Run(ctx)
			log.Printf("rocket enabled (edge %dbp, cap %dx)", cfg.EdgeBp, cfg.MaxMilli/1000)
		}
	}

	// Dice: instant single-player game. Reuses the ledger; needs a funded
	// HOUSE_TREASURY to cover wins (same as rocket — the non-negative CHECK rejects
	// a payout it can't cover).
	if envBool("DICE_ENABLED", true) {
		cfg := dice.DefaultConfig()
		if v := envInt("DICE_EDGE_BP", 0); v > 0 {
			cfg.EdgeBp = v
		}
		if v := envInt("DICE_MAX_STAKE_NANO", 0); v > 0 {
			cfg.MaxStakeNano = v
		}
		store, err := dice.NewStore(ctx, pool, cfg)
		if err != nil {
			log.Printf("dice disabled: %v", err)
		} else {
			srv.SetDice(store)
			log.Printf("dice enabled (edge %dbp)", cfg.EdgeBp)
		}
	}

	httpSrv := &http.Server{
		Addr:         ":" + port,
		Handler:      srv.Handler(),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}
	log.Printf("api listening on :%s (web origin %s)", port, webOrigin)
	log.Fatal(httpSrv.ListenAndServe())
}

func envFloat(key string, def float64) float64 {
	if v, err := strconv.ParseFloat(os.Getenv(key), 64); err == nil {
		return v
	}
	return def
}

func envInt(key string, def int64) int64 {
	if v, err := strconv.ParseInt(os.Getenv(key), 10, 64); err == nil {
		return v
	}
	return def
}

func envBool(key string, def bool) bool {
	switch os.Getenv(key) {
	case "1", "true":
		return true
	case "0", "false":
		return false
	default:
		return def
	}
}

func runIngestLoop(ctx context.Context, pool *pgxpool.Pool, limit int, edge, maxProb, minVol24h float64, intervalSec int64) {
	tick := func() {
		n, err := polymarket.Ingest(ctx, pool, limit, edge, maxProb, minVol24h)
		if err != nil {
			log.Printf("polymarket ingest: %v", err)
			return
		}
		log.Printf("polymarket ingest: %d markets", n)
	}
	tick() // once at startup
	t := time.NewTicker(time.Duration(intervalSec) * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			tick()
		}
	}
}

func runTonWatchLoop(ctx context.Context, wc *ton.Watcher, intervalSec int64) {
	tick := func() {
		n, err := wc.Poll(ctx)
		if err != nil {
			log.Printf("ton watcher: %v", err)
			return
		}
		if n > 0 {
			log.Printf("ton watcher: credited %d deposit(s)", n)
		}
	}
	tick() // once at startup
	t := time.NewTicker(time.Duration(intervalSec) * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			tick()
		}
	}
}

func runWithdrawLoop(ctx context.Context, pool *pgxpool.Pool, sender withdrawals.Sender, intervalSec int64) {
	tick := func() {
		n, err := withdrawals.ProcessPending(ctx, pool, sender, 20)
		if err != nil {
			log.Printf("withdrawals: %v", err)
			return
		}
		if n > 0 {
			log.Printf("withdrawals: sent %d payout(s)", n)
		}
	}
	tick() // once at startup
	t := time.NewTicker(time.Duration(intervalSec) * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			tick()
		}
	}
}

func runResolveLoop(ctx context.Context, pool *pgxpool.Pool, intervalSec int64) {
	tick := func() {
		n, err := polymarket.ResolveSettled(ctx, pool)
		if err != nil {
			log.Printf("polymarket resolve: %v", err)
			return
		}
		if n > 0 {
			log.Printf("polymarket resolve: settled %d markets", n)
		}
	}
	tick()
	t := time.NewTicker(time.Duration(intervalSec) * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			tick()
		}
	}
}
