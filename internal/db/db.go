// Package db provides database connection and migration helpers.
package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Connect opens a connection pool with default (extended-protocol) settings,
// suitable for application queries.
func Connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	// Bound the pool so one abusive client can't exhaust Postgres connections.
	if cfg.MaxConns < 1 || cfg.MaxConns > 25 {
		cfg.MaxConns = 25
	}
	return pgxpool.NewWithConfig(ctx, cfg)
}
