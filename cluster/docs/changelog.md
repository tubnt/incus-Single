# Changelog

## 2026-04-15 21:45 [progress]

IncusAdmin Phase 1+2 complete (14 commits):
- Go backend: config, cluster manager, VM service, scheduler, user/VM repos, IP pool handler
- React frontend: Dashboard, Clusters (5 nodes real-time), All VMs, Create VM, My VMs, IP Pools, Monitoring, Users
- Auth: oauth2-proxy + Logto SSO, emergency login :8081
- Deploy: 9.4MB single binary, systemd, PostgreSQL, WireGuard tunnel (27ms SG↔TW)
- Live at https://vmc.5ok.co — SSO login, 3 VMs running, 19 IPs available

## 2026-04-15 09:00 [decision]

Confirmed IncusAdmin architecture (PLAN-004):
- Go + React single SPA, PostgreSQL, Logto SSO via oauth2-proxy
- oauth2-proxy as front gate with Logto OIDC + org 23hldzpnetw6 restriction
- Emergency login path for Logto outage scenarios
- Balance-based billing (admin top-up first, Stripe later)
- Multi-dimension quotas (VMs/vCPU/RAM/Disk/IPs/Snapshots)
- Control server: 139.162.24.177 (Linode SG), domain: vmc.5ok.co (CF CDN)

## 2026-04-15 03:00 [progress]

Incus Extension for Paymenter v1.4.7 completed:
- Full VM lifecycle: create/start/stop/restart/terminate
- cloud-init.network-config for static public IP
- User panel shows VM info (hostname/IP/username/password) + action buttons
- End-to-end test passed: order → payment → VM created on cluster

## 2026-04-14 20:00 [progress]

QA testing completed (16 bugs found, critical ones fixed):
- P0: APP_URL localhost, Livewire 404, Vite manifest missing (all fixed)
- P1: server_tokens, CSP headers, Permissions-Policy (all fixed)
- Security: XSS blocked, .env 403, CORS clean, TRACE 405

## 2026-04-14 16:00 [progress]

Paymenter v1.4.7 deployed on node1 (Docker Compose):
- PHP 8.3 + Nginx + MySQL + Redis
- Incus mTLS restricted certificate (customers project)
- Public IP 202.151.179.233

## 2026-04-14 12:00 [progress]

Infrastructure deployment completed:
- 5-node Incus cluster (3 voter + 2 standby)
- Ceph: 29 OSD / 25TiB / 3-replica / dmcrypt
- 4-plane network: management + Ceph + public (VLAN 376) + OVN
- nftables firewall + VM isolation + RFC1918 blocking
- Monitoring: Prometheus + Grafana + Loki + Alertmanager
