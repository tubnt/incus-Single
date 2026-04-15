# IncusAdmin Architecture

## Overview

Single-binary Go service with embedded React SPA for managing a multi-node Incus + Ceph cloud cluster.

## Stack

- **Backend**: Go 1.22+ / Chi router / PostgreSQL / slog / go:embed
- **Frontend**: React 19 / TypeScript / Vite 8 / TanStack Router + Query / Tailwind CSS v4
- **Auth**: oauth2-proxy + Logto OIDC SSO + API Token Bearer
- **Infrastructure**: 5-node Incus cluster (202.151.179.224/27) / Ceph 29 OSD 25TiB / WireGuard tunnel

## Deployment

```
[Browser] → [Cloudflare CDN] → [oauth2-proxy :4180] → [incus-admin :8080]
                                                           ↓ mTLS
                                                    [Incus API :8443]
                                                    (via WireGuard 10.100.0.x)
```

Single binary at `/usr/local/bin/incus-admin`, systemd managed, frontend embedded via `go:embed`.

## Backend layout

```
cmd/server/main.go          Entry point, DI wiring
internal/
  config/                   Env-based configuration
  server/                   Chi router, middleware composition, SPA static handler
  middleware/               ProxyAuth, Bearer token, RBAC
  handler/portal/           HTTP handlers (13 files)
  service/                  VM lifecycle (create, state, delete, reinstall)
  repository/               PostgreSQL access (9 files)
  model/                    Domain types and constants
  cluster/                  Multi-cluster mTLS client, scheduler
db/migrations/              goose SQL migrations
```

## Frontend layout

```
web/src/
  main.tsx                  Entry point
  index.css                 Tailwind imports
  app/
    routes/                 18 TanStack Router file-based routes
    routeTree.gen.ts        Generated route tree
  features/
    console/                xterm.js terminal component
    monitoring/             VM metrics panel
    snapshots/              Snapshot management panel
  shared/
    lib/
      http.ts               Typed fetch wrapper
      query-client.ts       TanStack Query client
      auth.ts               User state helpers
```

## Database

17 tables: users, quotas, ssh_keys, products, product_clusters, orders, vms, snapshots, ip_pools, ip_addresses, invoices, transactions, tickets, ticket_messages, audit_logs, api_tokens, clusters.
