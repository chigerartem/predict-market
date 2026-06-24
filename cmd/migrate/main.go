// Command migrate applies pending database migrations.
//
//	DATABASE_URL=postgres://... go run ./cmd/migrate
package main

import (
	"context"
	"log"
	"os"

	"predict/internal/db"
)

func main() {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		log.Fatal("DATABASE_URL is not set")
	}
	if err := db.Migrate(context.Background(), url); err != nil {
		log.Fatalf("migrate: %v", err)
	}
	log.Println("migrations applied")
}
