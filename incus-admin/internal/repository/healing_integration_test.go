//go:build integration

package repository_test

import (
	"context"
	"database/sql"
	"strings"
	"testing"

	"github.com/incuscloud/incus-admin/internal/repository"
	"github.com/incuscloud/incus-admin/internal/testhelper"
)

// seedHealingEvent inserts the prerequisite cluster row and creates a single
// healing event the test can then query by ID. Returns (clusterID, eventID).
func seedHealingEvent(t *testing.T, db *sql.DB, repo *repository.HealingEventRepo, clusterName string) (int64, int64) {
	t.Helper()
	ctx := context.Background()
	var clusterID int64
	if err := db.QueryRowContext(ctx,
		`INSERT INTO clusters (name, api_url) VALUES ($1, 'https://x') RETURNING id`,
		clusterName).Scan(&clusterID); err != nil {
		t.Fatalf("seed cluster: %v", err)
	}
	eventID, err := repo.Create(ctx, clusterID, "node1", "manual", nil)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	return clusterID, eventID
}

func TestHealingEventRepo_GetByID_NotFound(t *testing.T) {
	db := testhelper.NewTestDB(t, "")
	repo := repository.NewHealingEventRepo(db)

	got, err := repo.GetByID(context.Background(), 99999)
	if err != nil {
		t.Fatalf("GetByID(missing): unexpected err: %v", err)
	}
	if got != nil {
		t.Fatalf("GetByID(missing): expected nil, got %+v", got)
	}
}

func TestHealingEventRepo_GetByID_HappyPath(t *testing.T) {
	db := testhelper.NewTestDB(t, "")
	repo := repository.NewHealingEventRepo(db)
	_, eventID := seedHealingEvent(t, db, repo, "c-happy")

	// Append two evacuated VMs so we exercise the JSON column path.
	if err := repo.AppendEvacuatedVM(context.Background(), eventID, repository.EvacuatedVM{
		VMID: 1, Name: "vm-a", FromNode: "node1", ToNode: "node2",
	}); err != nil {
		t.Fatalf("AppendEvacuatedVM 1: %v", err)
	}
	if err := repo.AppendEvacuatedVM(context.Background(), eventID, repository.EvacuatedVM{
		VMID: 2, Name: "vm-b", FromNode: "node1", ToNode: "node3",
	}); err != nil {
		t.Fatalf("AppendEvacuatedVM 2: %v", err)
	}

	got, err := repo.GetByID(context.Background(), eventID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got == nil {
		t.Fatal("GetByID: expected event, got nil")
	}
	if got.ID != eventID {
		t.Fatalf("ID mismatch: want %d, got %d", eventID, got.ID)
	}
	if got.NodeName != "node1" || got.Trigger != "manual" {
		t.Fatalf("metadata mismatch: node=%q trigger=%q", got.NodeName, got.Trigger)
	}
	if got.Status != "in_progress" {
		t.Fatalf("status: want in_progress, got %q", got.Status)
	}
	names := make([]string, 0, len(got.EvacuatedVMs))
	for _, v := range got.EvacuatedVMs {
		names = append(names, v.Name)
	}
	joined := strings.Join(names, ",")
	if !strings.Contains(joined, "vm-a") || !strings.Contains(joined, "vm-b") {
		t.Fatalf("EvacuatedVMs missing vm-a/vm-b, got %q", joined)
	}
}

func TestHealingEventRepo_GetByID_AfterComplete(t *testing.T) {
	db := testhelper.NewTestDB(t, "")
	repo := repository.NewHealingEventRepo(db)
	_, eventID := seedHealingEvent(t, db, repo, "c-complete")

	if err := repo.Complete(context.Background(), eventID); err != nil {
		t.Fatalf("Complete: %v", err)
	}

	got, err := repo.GetByID(context.Background(), eventID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got == nil {
		t.Fatal("expected event after complete, got nil")
	}
	if got.Status != "completed" {
		t.Fatalf("status: want completed, got %q", got.Status)
	}
	if got.CompletedAt == nil {
		t.Fatal("completed_at not set after Complete")
	}
}

func TestHealingEventRepo_GetByID_AfterFail(t *testing.T) {
	db := testhelper.NewTestDB(t, "")
	repo := repository.NewHealingEventRepo(db)
	_, eventID := seedHealingEvent(t, db, repo, "c-fail")

	if err := repo.Fail(context.Background(), eventID, "test reason"); err != nil {
		t.Fatalf("Fail: %v", err)
	}

	got, err := repo.GetByID(context.Background(), eventID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got == nil {
		t.Fatal("expected event after fail")
	}
	if got.Status != "failed" {
		t.Fatalf("status: want failed, got %q", got.Status)
	}
	if got.Error == nil || *got.Error != "test reason" {
		t.Fatalf("error: want 'test reason', got %v", got.Error)
	}
}
