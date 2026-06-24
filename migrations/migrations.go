// Package migrations embeds the SQL migration files so they ship inside the binary.
package migrations

import "embed"

// FS holds all *.sql migration files, applied in lexicographic order.
//
//go:embed *.sql
var FS embed.FS
