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
	"predict/internal/httpapi"
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

	srv := httpapi.New(pool, botToken, webOrigin, devUserID)
	httpSrv := &http.Server{
		Addr:         ":" + port,
		Handler:      srv.Handler(),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}
	log.Printf("api listening on :%s (web origin %s)", port, webOrigin)
	log.Fatal(httpSrv.ListenAndServe())
}
