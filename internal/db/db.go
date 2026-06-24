// Package db provides database connection and migration helpers.
package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Connect opens a connection pool with default (extended-protocol) settings,
// suitable for application queries.
func Connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	return pgxpool.New(ctx, url)
}
