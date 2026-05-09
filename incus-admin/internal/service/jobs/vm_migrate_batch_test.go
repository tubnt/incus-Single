package jobs

import (
	"context"
	"testing"

	"github.com/incuscloud/incus-admin/internal/model"
)

// PLAN-037 / OPS-040 vm_migrate_batch executor 关键前置条件测试。
//
// 完整 executor 路径（并发 + Marker + DB）由真机 e2e 覆盖；这里只锁
// "关键防御性检查"，避免回归把它们误删。

type stubMigrator struct {
	calls int
}

func (s *stubMigrator) Migrate(ctx context.Context, cluster, project, vm, target, mode string) (*MigrateOutcome, error) {
	s.calls++
	if mode == "" {
		mode = "auto"
	}
	return &MigrateOutcome{WasRunning: true, Target: target, Mode: mode}, nil
}

func TestVMMigrateBatch_MissingParams(t *testing.T) {
	rt := NewRuntime(Deps{})
	exec := &vmMigrateBatchExecutor{}
	job := &model.ProvisioningJob{ID: 1, Kind: model.JobKindClusterVMMigrateBatch}
	err := exec.Run(context.Background(), rt, job)
	if err == nil || !contains(err.Error(), "params missing") {
		t.Fatalf("expected params missing error, got %v", err)
	}
}

func TestVMMigrateBatch_MigratorNil(t *testing.T) {
	rt := NewRuntime(Deps{})
	rt.setParams(2, Params{
		ClusterName: "c0",
		BatchItems:  []MigrateBatchItem{{VMName: "vm-a", Project: "customers", TargetNode: "n2"}},
	})
	exec := &vmMigrateBatchExecutor{}
	job := &model.ProvisioningJob{ID: 2, Kind: model.JobKindClusterVMMigrateBatch}
	err := exec.Run(context.Background(), rt, job)
	if err == nil || !contains(err.Error(), "migrator not configured") {
		t.Fatalf("expected migrator nil error, got %v", err)
	}
}

func TestVMMigrateBatch_EmptyItems(t *testing.T) {
	rt := NewRuntime(Deps{Migrator: &stubMigrator{}})
	rt.setParams(3, Params{ClusterName: "c0"})
	exec := &vmMigrateBatchExecutor{}
	job := &model.ProvisioningJob{ID: 3, Kind: model.JobKindClusterVMMigrateBatch}
	err := exec.Run(context.Background(), rt, job)
	if err == nil || !contains(err.Error(), "batch items empty") {
		t.Fatalf("expected empty batch error, got %v", err)
	}
}

// TestAuditActionByKind_MigrateBatch 锁 audit label 命名格式 —— 一旦命名变更，
// audit 日志查询会断（vm.migrate-batch.{started,succeeded,failed} 是契约）。
func TestAuditActionByKind_MigrateBatch(t *testing.T) {
	cases := []struct {
		kind, suffix, want string
	}{
		{model.JobKindClusterVMMigrateBatch, "started", "vm.migrate-batch.started"},
		{model.JobKindClusterVMMigrateBatch, "succeeded", "vm.migrate-batch.succeeded"},
		{model.JobKindClusterVMMigrateBatch, "failed", "vm.migrate-batch.failed"},
	}
	for _, c := range cases {
		if got := auditActionByKind(c.kind, c.suffix); got != c.want {
			t.Errorf("auditActionByKind(%q,%q) = %q; want %q", c.kind, c.suffix, got, c.want)
		}
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || indexOf(s, sub) >= 0)
}
func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
