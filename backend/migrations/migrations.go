package migrations

import (
	"context"
	"embed"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed *.sql
var files embed.FS

var versions = []string{"0001_base.sql", "0002_automation.sql"}

// Apply runs each migration exactly once. The transaction-scoped advisory lock
// keeps concurrent Vercel service starts from racing on first deployment.
func Apply(ctx context.Context, pool *pgxpool.Pool) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(473291002)"); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "CREATE TABLE IF NOT EXISTS maoke_schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"); err != nil {
		return err
	}
	for _, name := range versions {
		var applied bool
		if err = tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM maoke_schema_migrations WHERE name=$1)", name).Scan(&applied); err != nil {
			return err
		}
		if applied {
			continue
		}
		body, readErr := files.ReadFile(name)
		if readErr != nil {
			return readErr
		}
		for _, statement := range strings.Split(string(body), ";") {
			statement = strings.TrimSpace(statement)
			if statement == "" {
				continue
			}
			if _, err = tx.Exec(ctx, statement); err != nil {
				return fmt.Errorf("%s: %w", name, err)
			}
		}
		if _, err = tx.Exec(ctx, "INSERT INTO maoke_schema_migrations(name) VALUES($1)", name); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
