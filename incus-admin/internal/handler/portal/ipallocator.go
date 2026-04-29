package portal

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/incuscloud/incus-admin/internal/config"
	"github.com/incuscloud/incus-admin/internal/repository"
)

var ipAddrRepo *repository.IPAddrRepo

func SetIPAddrRepo(repo *repository.IPAddrRepo) {
	ipAddrRepo = repo
}

// attachIPToVM back-fills ip_addresses.vm_id after the VM row has been
// inserted and its ID is known. A nil repo, empty IP, or zero vmID is a no-op.
func attachIPToVM(ctx context.Context, ip string, vmID int64) {
	if ipAddrRepo == nil || ip == "" || vmID <= 0 {
		return
	}
	if err := ipAddrRepo.AttachVM(ctx, ip, vmID); err != nil {
		slog.Error("attach IP to VM failed", "ip", ip, "vm_id", vmID, "error", err)
	}
}

func allocateIP(ctx context.Context, cc config.ClusterConfig, vmID int64) (ip, gateway, cidr string, err error) {
	if len(cc.IPPools) == 0 {
		return "", "", "", fmt.Errorf("cluster has no IP pools configured")
	}
	if ipAddrRepo == nil {
		return "", "", "", fmt.Errorf("ip address repository not initialized")
	}

	// PLAN-021 Phase F: walk pools in config order, skipping exhausted ones.
	// An exhausted pool is detected by "no available IPs" from AllocateNext;
	// any other error bubbles up immediately.
	var lastErr error
	for i, p := range cc.IPPools {
		ip, err = allocateFromPool(ctx, p, vmID)
		if err == nil {
			return ip, p.Gateway, extractCIDR(p.CIDR), nil
		}
		lastErr = err
		if !isPoolExhausted(err) {
			// Hard failure (DB unreachable, bad CIDR, etc) — don't silently
			// fall through, surface it.
			return "", p.Gateway, extractCIDR(p.CIDR), fmt.Errorf("allocate IP from pool %s: %w", p.CIDR, err)
		}
		slog.Warn("IP pool exhausted, trying next", "index", i, "cidr", p.CIDR)
	}

	// All pools exhausted.
	first := cc.IPPools[0]
	return "", first.Gateway, extractCIDR(first.CIDR), fmt.Errorf("all IP pools exhausted: %w", lastErr)
}

// allocateFromPool ensures the pool row + seed, then asks the repo for the
// next available IP in that pool only.
func allocateFromPool(ctx context.Context, p config.IPPoolConfig, vmID int64) (string, error) {
	poolID, err := ipAddrRepo.GetPoolID(ctx, p.CIDR)
	if err != nil {
		return "", fmt.Errorf("get IP pool: %w", err)
	}
	if poolID == 0 {
		poolID, err = ipAddrRepo.EnsurePool(ctx, 1, p.CIDR, p.Gateway, p.VLAN)
		if err != nil {
			return "", fmt.Errorf("ensure IP pool: %w", err)
		}
		if n, seedErr := ipAddrRepo.SeedPool(ctx, poolID, p.Range); seedErr != nil {
			slog.Error("seed IP pool failed", "pool_id", poolID, "error", seedErr)
		} else {
			slog.Info("seeded IP pool", "pool_id", poolID, "count", n)
		}
	}
	return ipAddrRepo.AllocateNext(ctx, poolID, vmID, p.Range)
}

// isPoolExhausted matches the AllocateNext "no available IPs" wording. We
// don't use errors.Is here because the repo wraps a plain fmt.Errorf —
// promoting it to a typed error would churn other callers for no gain.
func isPoolExhausted(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "no available IPs")
}
