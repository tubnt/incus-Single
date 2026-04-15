package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"

	"github.com/incuscloud/incus-admin/internal/config"
	"github.com/incuscloud/incus-admin/internal/server"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))

	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	slog.Info("incus-admin starting",
		"listen", cfg.Server.Listen,
		"domain", cfg.Server.Domain,
		"clusters", len(cfg.Clusters),
	)

	// Placeholder user lookup — will be replaced by DB-backed lookup
	userLookup := func(ctx context.Context, email string) (int64, string, error) {
		for _, adminEmail := range cfg.Auth.AdminEmails {
			if email == adminEmail {
				return 1, "admin", nil
			}
		}
		return 0, "customer", nil
	}

	srv := server.New(cfg, userLookup)

	if err := srv.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "server error: %v\n", err)
		os.Exit(1)
	}
}
