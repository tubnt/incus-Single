package portal

import (
	"time"

	"github.com/incuscloud/incus-admin/internal/cluster"
	"github.com/incuscloud/incus-admin/internal/model"
)

// VMServiceDTO is the public JSON shape for portal-side VMs. It joins
// the DB VM row with runtime cluster info (name / display_name / project)
// so the frontend never has to hardcode cluster or project values.
//
// NOTE: Password is intentionally omitted. Credentials are returned only in
// create/reset-password responses (CreateVMResult, PasswordResetResult).
type VMServiceDTO struct {
	ID                 int64     `json:"id"`
	Name               string    `json:"name"`
	ClusterName        string    `json:"cluster"`
	ClusterDisplayName string    `json:"cluster_display_name"`
	Project            string    `json:"project"`
	IP                 string    `json:"ip"`
	Status             string    `json:"status"`
	CPU                int       `json:"cpu"`
	MemoryMB           int       `json:"memory_mb"`
	DiskGB             int       `json:"disk_gb"`
	OSImage            string    `json:"os_image"`
	Node               string    `json:"node"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

// NewVMServiceDTO builds a DTO. clusterMgr may be nil (display_name falls
// back to name). defaultProject is applied when the VM row has no explicit
// project (legacy rows).
func NewVMServiceDTO(vm model.VM, mgr *cluster.Manager, defaultProject string) VMServiceDTO {
	name := ""
	display := ""
	if mgr != nil {
		name = mgr.NameByID(vm.ClusterID)
		if name != "" {
			display = mgr.DisplayNameByName(name)
		}
	}
	project := defaultProject
	if project == "" {
		project = "customers"
	}
	ip := ""
	if vm.IP != nil {
		ip = *vm.IP
	}
	return VMServiceDTO{
		ID:                 vm.ID,
		Name:               vm.Name,
		ClusterName:        name,
		ClusterDisplayName: display,
		Project:            project,
		IP:                 ip,
		Status:             vm.Status,
		CPU:                vm.CPU,
		MemoryMB:           vm.MemoryMB,
		DiskGB:             vm.DiskGB,
		OSImage:            vm.OSImage,
		Node:               vm.Node,
		CreatedAt:          vm.CreatedAt,
		UpdatedAt:          vm.UpdatedAt,
	}
}

// NewVMServiceDTOList maps a slice of VM rows to DTOs.
func NewVMServiceDTOList(vms []model.VM, mgr *cluster.Manager, defaultProject string) []VMServiceDTO {
	out := make([]VMServiceDTO, 0, len(vms))
	for _, v := range vms {
		out = append(out, NewVMServiceDTO(v, mgr, defaultProject))
	}
	return out
}
