package server

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"

	"github.com/incuscloud/incus-admin/internal/config"
	"github.com/incuscloud/incus-admin/internal/middleware"
)

type Server struct {
	cfg    *config.Config
	router *chi.Mux
}

func New(cfg *config.Config, userLookup func(ctx context.Context, email string) (int64, string, error)) *Server {
	r := chi.NewRouter()

	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Timeout(60 * time.Second))
	r.Use(slogMiddleware)

	r.Get("/api/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.ProxyAuth)
		r.Use(middleware.UserFromEmail(userLookup))

		r.Route("/api/portal", func(r chi.Router) {
			// Portal routes registered by handler packages
		})

		r.Route("/api/admin", func(r chi.Router) {
			r.Use(middleware.RequireRole("admin"))
			// Admin routes registered by handler packages
		})
	})

	return &Server{cfg: cfg, router: r}
}

func (s *Server) Router() *chi.Mux {
	return s.router
}

func (s *Server) Run() error {
	mainSrv := &http.Server{
		Addr:         s.cfg.Server.Listen,
		Handler:      s.router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	emergencySrv := &http.Server{
		Addr:    s.cfg.Server.EmergencyListen,
		Handler: s.emergencyRouter(),
	}

	errCh := make(chan error, 2)

	go func() {
		slog.Info("main server starting", "addr", s.cfg.Server.Listen)
		errCh <- mainSrv.ListenAndServe()
	}()

	go func() {
		slog.Info("emergency server starting", "addr", s.cfg.Server.EmergencyListen)
		errCh <- emergencySrv.ListenAndServe()
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-quit:
		slog.Info("shutdown signal received", "signal", sig)
	case err := <-errCh:
		slog.Error("server error", "error", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	mainSrv.Shutdown(ctx)
	emergencySrv.Shutdown(ctx)

	slog.Info("server stopped")
	return nil
}

func (s *Server) emergencyRouter() http.Handler {
	r := chi.NewRouter()
	r.Get("/auth/emergency", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte(`<!DOCTYPE html>
<html><head><title>Emergency Login</title></head>
<body style="font-family:sans-serif;max-width:400px;margin:100px auto">
<h2>Emergency Admin Login</h2>
<form method="POST" action="/auth/emergency">
<input name="token" type="password" placeholder="Emergency Token" style="width:100%;padding:8px;margin:8px 0">
<button type="submit" style="width:100%;padding:8px;background:#dc2626;color:#fff;border:none;cursor:pointer">Login</button>
</form></body></html>`))
	})

	r.Post("/auth/emergency", func(w http.ResponseWriter, r *http.Request) {
		token := r.FormValue("token")
		if token != s.cfg.Auth.EmergencyToken {
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}
		// In production: set session cookie for the first admin email
		slog.Warn("emergency login used", "ip", r.RemoteAddr)
		http.Redirect(w, r, "/", http.StatusSeeOther)
	})

	r.Get("/api/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"status":"ok","mode":"emergency"}`))
	})

	return r
}

func slogMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		slog.Info("http",
			"method", r.Method,
			"path", r.URL.Path,
			"status", ww.Status(),
			"duration_ms", time.Since(start).Milliseconds(),
			"ip", r.RemoteAddr,
		)
	})
}
