package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"

	"github.com/incuscloud/incus-admin/internal/cluster"
	"github.com/incuscloud/incus-admin/internal/config"
	"github.com/incuscloud/incus-admin/internal/handler/portal"
	"github.com/incuscloud/incus-admin/internal/server"
	"github.com/incuscloud/incus-admin/internal/service"
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

	var clusterMgr *cluster.Manager
	var scheduler *cluster.Scheduler
	var vmSvc *service.VMService

	if len(cfg.Clusters) > 0 {
		clusterMgr, err = cluster.NewManager(cfg.Clusters)
		if err != nil {
			slog.Warn("cluster manager init failed, running without clusters", "error", err)
		} else {
			scheduler = cluster.NewScheduler(clusterMgr)
			vmSvc = service.NewVMService(clusterMgr)
			slog.Info("cluster manager ready", "clusters", len(clusterMgr.List()))
		}
	}

	userLookup := func(ctx context.Context, email string) (int64, string, error) {
		for _, adminEmail := range cfg.Auth.AdminEmails {
			if email == adminEmail {
				return 1, "admin", nil
			}
		}
		return 0, "customer", nil
	}

	adminHandler := portal.NewAdminVMHandler(vmSvc, clusterMgr, scheduler)
	portalHandler := portal.NewVMHandler(vmSvc)

	srv := server.New(cfg, userLookup, adminHandler, portalHandler)

	if err := srv.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "server error: %v\n", err)
		os.Exit(1)
	}
}
