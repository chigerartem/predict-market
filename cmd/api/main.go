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

	"predict/internal/db"
	"predict/internal/deposits"
	"predict/internal/httpapi"
	"predict/internal/rates"
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

	if err := srv.RegisterWebhook(ctx, os.Getenv("TG_WEBHOOK_URL"), os.Getenv("TG_WEBHOOK_SECRET")); err != nil {
		log.Printf("webhook registration failed (continuing): %v", err)
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
