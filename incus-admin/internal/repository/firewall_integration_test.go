//go:build integration

package repository_test

import (
	"context"
	"database/sql"
	"testing"

	"github.com/incuscloud/incus-admin/internal/repository"
	"github.com/incuscloud/incus-admin/internal/testhelper"
)

// 用 admin 共享组（owner_id=NULL）+ 两用户各绑一台自己的 VM 重现 PR #22 review
// 发现的泄漏：旧实现 COUNT(b.vm_id) 把别人挂的 VM 数也计入当前用户的 binding_count，
// 修后 COUNT(v.id) 只计当前用户 LEFT JOIN 实际命中的行。
func TestBindingCountsForUser_NoCrossUserLeak(t *testing.T) {
	db := testhelper.NewTestDB(t, "")
	repo := repository.NewFirewallRepo(db)

	u1 := mustInsertUser(t, db, "u1@bc")
	u2 := mustInsertUser(t, db, "u2@bc")
	cluster := mustInsertCluster(t, db, "test-cluster")

	// admin 共享组（owner_id NULL）
	groupID := mustInsertSharedGroup(t, db, "default-web-test", "Default Web", "shared")

	// u1 绑一台运行中 VM
	vm1 := mustInsertVM(t, db, "vm-u1", u1, cluster, "running")
	mustBind(t, db, vm1, groupID)

	// u2 也绑一台运行中 VM 到同一个共享组
	vm2 := mustInsertVM(t, db, "vm-u2", u2, cluster, "running")
	mustBind(t, db, vm2, groupID)

	// u1 视角：应该只看到自己的 1 台
	got, err := repo.BindingCountsForUser(context.Background(), u1)
	if err != nil {
		t.Fatalf("BindingCountsForUser u1: %v", err)
	}
	if got[groupID] != 1 {
		t.Errorf("u1 binding_count want 1 (self only) got %d (cross-user leak)", got[groupID])
	}

	// u2 视角：也应该只看到自己的 1 台
	got2, err := repo.BindingCountsForUser(context.Background(), u2)
	if err != nil {
		t.Fatalf("BindingCountsForUser u2: %v", err)
	}
	if got2[groupID] != 1 {
		t.Errorf("u2 binding_count want 1 (self only) got %d", got2[groupID])
	}
}

// trash / deleted / gone 状态的 VM 不应计入 binding_count。
func TestBindingCountsForUser_ExcludesTrashedAndDeleted(t *testing.T) {
	db := testhelper.NewTestDB(t, "")
	repo := repository.NewFirewallRepo(db)

	u := mustInsertUser(t, db, "u@bc-trash")
	cluster := mustInsertCluster(t, db, "test-cluster-trash")
	groupID := mustInsertSharedGroup(t, db, "shared-trash", "Shared Trash", "")

	running := mustInsertVM(t, db, "vm-running", u, cluster, "running")
	deleted := mustInsertVM(t, db, "vm-deleted", u, cluster, "deleted")
	gone := mustInsertVM(t, db, "vm-gone", u, cluster, "gone")
	trashed := mustInsertVM(t, db, "vm-trashed", u, cluster, "running")
	if _, err := db.Exec(`UPDATE vms SET trashed_at = NOW() WHERE id = $1`, trashed); err != nil {
		t.Fatalf("set trashed_at: %v", err)
	}

	for _, vm := range []int64{running, deleted, gone, trashed} {
		mustBind(t, db, vm, groupID)
	}

	got, err := repo.BindingCountsForUser(context.Background(), u)
	if err != nil {
		t.Fatalf("BindingCountsForUser: %v", err)
	}
	if got[groupID] != 1 {
		t.Errorf("only running+non-trashed should count; want 1 got %d", got[groupID])
	}
}

// helpers — 与 user_integration_test.go 中 seedUser 同风格但参数化 email 以避免冲突。

func mustInsertUser(t *testing.T, db *sql.DB, email string) int64 {
	t.Helper()
	var id int64
	if err := db.QueryRow(
		`INSERT INTO users (email, name, role) VALUES ($1, $1, 'customer') RETURNING id`,
		email,
	).Scan(&id); err != nil {
		t.Fatalf("insert user %s: %v", email, err)
	}
	return id
}

func mustInsertCluster(t *testing.T, db *sql.DB, name string) int64 {
	t.Helper()
	var id int64
	if err := db.QueryRow(
		`INSERT INTO clusters (name, api_url) VALUES ($1, 'https://localhost:8443') RETURNING id`,
		name,
	).Scan(&id); err != nil {
		t.Fatalf("insert cluster: %v", err)
	}
	return id
}

func mustInsertVM(t *testing.T, db *sql.DB, name string, userID, clusterID int64, status string) int64 {
	t.Helper()
	var id int64
	if err := db.QueryRow(
		`INSERT INTO vms (name, cluster_id, user_id, status, cpu, memory_mb, disk_gb, node)
		 VALUES ($1, $2, $3, $4, 1, 512, 10, 'test-node') RETURNING id`,
		name, clusterID, userID, status,
	).Scan(&id); err != nil {
		t.Fatalf("insert vm %s: %v", name, err)
	}
	return id
}

func mustInsertSharedGroup(t *testing.T, db *sql.DB, slug, name, description string) int64 {
	t.Helper()
	var id int64
	if err := db.QueryRow(
		`INSERT INTO firewall_groups (slug, name, description, owner_id)
		 VALUES ($1, $2, $3, NULL) RETURNING id`,
		slug, name, description,
	).Scan(&id); err != nil {
		t.Fatalf("insert shared group: %v", err)
	}
	return id
}

func mustBind(t *testing.T, db *sql.DB, vmID, groupID int64) {
	t.Helper()
	if _, err := db.Exec(
		`INSERT INTO vm_firewall_bindings (vm_id, group_id) VALUES ($1, $2)`,
		vmID, groupID,
	); err != nil {
		t.Fatalf("bind vm %d to group %d: %v", vmID, groupID, err)
	}
}
