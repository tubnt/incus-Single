package portal

import (
	"context"
	"fmt"
	"log/slog"

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

	p := cc.IPPools[0]
	gateway = p.Gateway
	cidr = extractCIDR(p.CIDR)

	if ipAddrRepo == nil {
		return "", gateway, cidr, fmt.Errorf("ip address repository not initialized")
	}

	poolID, err := ipAddrRepo.GetPoolID(ctx, p.CIDR)
	if err != nil {
		return "", gateway, cidr, fmt.Errorf("get IP pool: %w", err)
	}
	if poolID == 0 {
		poolID, err = ipAddrRepo.EnsurePool(ctx, 1, p.CIDR, p.Gateway, p.VLAN)
		if err != nil {
			return "", gateway, cidr, fmt.Errorf("ensure IP pool: %w", err)
		}
		n, seedErr := ipAddrRepo.SeedPool(ctx, poolID, p.Range)
		if seedErr != nil {
			slog.Error("seed IP pool failed", "pool_id", poolID, "error", seedErr)
		} else {
			slog.Info("seeded IP pool", "pool_id", poolID, "count", n)
		}
	}

	ip, err = ipAddrRepo.AllocateNext(ctx, poolID, vmID, p.Range)
	if err != nil {
		return "", gateway, cidr, fmt.Errorf("allocate IP: %w", err)
	}
	return ip, gateway, cidr, nil
}
