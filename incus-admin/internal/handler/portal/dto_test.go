package portal

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/incuscloud/incus-admin/internal/cluster"
	"github.com/incuscloud/incus-admin/internal/config"
	"github.com/incuscloud/incus-admin/internal/model"
)

func strPtr(s string) *string { return &s }

func TestNewVMServiceDTO_OmitsPassword(t *testing.T) {
	password := "plaintext-secret"
	vm := model.VM{
		ID:       1,
		Name:     "vm-a",
		IP:       strPtr("10.0.0.5"),
		Password: &password,
	}

	dto := NewVMServiceDTO(vm, nil, "")
	b, err := json.Marshal(dto)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(b), password) {
		t.Errorf("DTO leaked password: %s", string(b))
	}
	if strings.Contains(string(b), "\"password\"") {
		t.Errorf("DTO contains password field: %s", string(b))
	}
}

func TestNewVMServiceDTO_ResolvesClusterName(t *testing.T) {
	// Build a manager by hand — NewManager needs TLS certs so we skip it for unit tests.
	m := &cluster.Manager{}
	mustSetIDViaConfig(t, m, "tokyo-a", 7, "Tokyo A")

	vm := model.VM{ID: 2, Name: "vm-b", ClusterID: 7}
	dto := NewVMServiceDTO(vm, m, "")

	if dto.ClusterName != "tokyo-a" {
		t.Errorf("ClusterName = %q, want tokyo-a", dto.ClusterName)
	}
	if dto.ClusterDisplayName != "Tokyo A" {
		t.Errorf("ClusterDisplayName = %q, want Tokyo A", dto.ClusterDisplayName)
	}
}

func TestNewVMServiceDTO_FallsBackToDefaultProject(t *testing.T) {
	vm := model.VM{ID: 3, Name: "vm-c"}
	dto := NewVMServiceDTO(vm, nil, "myproject")
	if dto.Project != "myproject" {
		t.Errorf("Project = %q, want myproject", dto.Project)
	}

	dto = NewVMServiceDTO(vm, nil, "")
	if dto.Project != "customers" {
		t.Errorf("Project fallback = %q, want customers", dto.Project)
	}
}

func TestNewVMServiceDTO_UnrollsIPPointer(t *testing.T) {
	vm := model.VM{ID: 4, Name: "vm-d", IP: nil}
	if dto := NewVMServiceDTO(vm, nil, ""); dto.IP != "" {
		t.Errorf("nil IP should render empty string, got %q", dto.IP)
	}

	vm.IP = strPtr("10.1.2.3")
	if dto := NewVMServiceDTO(vm, nil, ""); dto.IP != "10.1.2.3" {
		t.Errorf("IP = %q, want 10.1.2.3", dto.IP)
	}
}

func TestNewVMServiceDTOList_PreservesOrder(t *testing.T) {
	vms := []model.VM{{ID: 1, Name: "a"}, {ID: 2, Name: "b"}, {ID: 3, Name: "c"}}
	out := NewVMServiceDTOList(vms, nil, "")
	if len(out) != 3 {
		t.Fatalf("len=%d want 3", len(out))
	}
	if out[0].Name != "a" || out[1].Name != "b" || out[2].Name != "c" {
		t.Errorf("order changed: %+v", out)
	}
}

// mustSetIDViaConfig registers a cluster config + ID mapping on a bare Manager
// via the exported AddCluster + SetID path. Skips TLS by forging a valid cert
// path is not needed here — this helper instead bypasses AddCluster and uses
// the Manager's zero-value-safe setters.
func mustSetIDViaConfig(t *testing.T, m *cluster.Manager, name string, id int64, displayName string) {
	t.Helper()
	// The Manager zero value is not safe (nil maps). Build one through the
	// test-only helper below to mirror NewManager initialisation without TLS.
	*m = *newTestManager(name, displayName)
	m.SetID(name, id)
}

// newTestManager returns a Manager seeded with one config entry and no clients.
// It skips newClient() entirely so TLS certs aren't required.
func newTestManager(name, displayName string) *cluster.Manager {
	return cluster.NewTestManager([]config.ClusterConfig{{Name: name, DisplayName: displayName}})
}
