package model

import (
	"time"
)

type User struct {
	ID        int64     `json:"id" db:"id"`
	Email     string    `json:"email" db:"email"`
	Name      string    `json:"name" db:"name"`
	Role      string    `json:"role" db:"role"`
	LogtoSub  string    `json:"-" db:"logto_sub"`
	Balance   float64   `json:"balance" db:"balance"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

type Cluster struct {
	ID          int64     `json:"id" db:"id"`
	Name        string    `json:"name" db:"name"`
	DisplayName string    `json:"display_name" db:"display_name"`
	APIURL      string    `json:"api_url" db:"api_url"`
	Status      string    `json:"status" db:"status"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at" db:"updated_at"`
}

type VM struct {
	ID                  int64      `json:"id" db:"id"`
	Name                string     `json:"name" db:"name"`
	ClusterID           int64      `json:"cluster_id" db:"cluster_id"`
	UserID              int64      `json:"user_id" db:"user_id"`
	OrderID             *int64     `json:"order_id,omitempty" db:"order_id"`
	IP                  *string    `json:"ip,omitempty" db:"ip"`
	Status              string     `json:"status" db:"status"`
	CPU                 int        `json:"cpu" db:"cpu"`
	MemoryMB            int        `json:"memory_mb" db:"memory_mb"`
	DiskGB              int        `json:"disk_gb" db:"disk_gb"`
	OSImage             string     `json:"os_image" db:"os_image"`
	Node                string     `json:"node" db:"node"`
	Password            *string    `json:"password,omitempty" db:"password"`
	RescueState         string     `json:"rescue_state" db:"rescue_state"`
	RescueStartedAt     *time.Time `json:"rescue_started_at,omitempty" db:"rescue_started_at"`
	RescueSnapshotName  *string    `json:"rescue_snapshot_name,omitempty" db:"rescue_snapshot_name"`
	CreatedAt           time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at" db:"updated_at"`
}

type Product struct {
	ID           int64   `json:"id" db:"id"`
	Name         string  `json:"name" db:"name"`
	Slug         string  `json:"slug" db:"slug"`
	CPU          int     `json:"cpu" db:"cpu"`
	MemoryMB     int     `json:"memory_mb" db:"memory_mb"`
	DiskGB       int     `json:"disk_gb" db:"disk_gb"`
	BandwidthTB  int     `json:"bandwidth_tb" db:"bandwidth_tb"`
	PriceMonthly float64 `json:"price_monthly" db:"price_monthly"`
	Currency     string  `json:"currency" db:"currency"`
	Access       string  `json:"access" db:"access"`
	Active       bool    `json:"active" db:"active"`
	SortOrder    int     `json:"sort_order" db:"sort_order"`
}

type Quota struct {
	ID           int64 `json:"id" db:"id"`
	UserID       int64 `json:"user_id" db:"user_id"`
	MaxVMs       int   `json:"max_vms" db:"max_vms"`
	MaxVCPUs     int   `json:"max_vcpus" db:"max_vcpus"`
	MaxRAMMB     int   `json:"max_ram_mb" db:"max_ram_mb"`
	MaxDiskGB    int   `json:"max_disk_gb" db:"max_disk_gb"`
	MaxIPs       int   `json:"max_ips" db:"max_ips"`
	MaxSnapshots int   `json:"max_snapshots" db:"max_snapshots"`
}

type IPPool struct {
	ID        int64  `json:"id" db:"id"`
	ClusterID int64  `json:"cluster_id" db:"cluster_id"`
	CIDR      string `json:"cidr" db:"cidr"`
	Gateway   string `json:"gateway" db:"gateway"`
	VLANID    int    `json:"vlan_id" db:"vlan_id"`
}

type IPAddress struct {
	ID            int64      `json:"id" db:"id"`
	PoolID        int64      `json:"pool_id" db:"pool_id"`
	IP            string     `json:"ip" db:"ip"`
	VMID          *int64     `json:"vm_id,omitempty" db:"vm_id"`
	Status        string     `json:"status" db:"status"`
	CooldownUntil *time.Time `json:"cooldown_until,omitempty" db:"cooldown_until"`
}

type Order struct {
	ID        int64      `json:"id" db:"id"`
	UserID    int64      `json:"user_id" db:"user_id"`
	ProductID int64      `json:"product_id" db:"product_id"`
	ClusterID int64      `json:"cluster_id" db:"cluster_id"`
	Status    string     `json:"status" db:"status"`
	Amount    float64    `json:"amount" db:"amount"`
	Currency  string     `json:"currency" db:"currency"`
	ExpiresAt *time.Time `json:"expires_at,omitempty" db:"expires_at"`
	CreatedAt time.Time  `json:"created_at" db:"created_at"`
}

type Transaction struct {
	ID          int64     `json:"id" db:"id"`
	UserID      int64     `json:"user_id" db:"user_id"`
	Amount      float64   `json:"amount" db:"amount"`
	Type        string    `json:"type" db:"type"`
	Description string    `json:"description" db:"description"`
	InvoiceID   *int64    `json:"invoice_id,omitempty" db:"invoice_id"`
	CreatedBy   *int64    `json:"created_by,omitempty" db:"created_by"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
}

type AuditLog struct {
	ID         int64     `json:"id" db:"id"`
	UserID     *int64    `json:"user_id,omitempty" db:"user_id"`
	Action     string    `json:"action" db:"action"`
	TargetType string    `json:"target_type" db:"target_type"`
	TargetID   int64     `json:"target_id" db:"target_id"`
	Details    string    `json:"details" db:"details"`
	IPAddress  string    `json:"ip_address" db:"ip_address"`
	CreatedAt  time.Time `json:"created_at" db:"created_at"`
}

type Invoice struct {
	ID        int64      `json:"id" db:"id"`
	OrderID   int64      `json:"order_id" db:"order_id"`
	UserID    int64      `json:"user_id" db:"user_id"`
	Amount    float64    `json:"amount" db:"amount"`
	Currency  string     `json:"currency" db:"currency"`
	Status    string     `json:"status" db:"status"`
	DueAt     *time.Time `json:"due_at,omitempty" db:"due_at"`
	PaidAt    *time.Time `json:"paid_at,omitempty" db:"paid_at"`
	CreatedAt time.Time  `json:"created_at" db:"created_at"`
}

type APIToken struct {
	ID         int64      `json:"id" db:"id"`
	UserID     int64      `json:"user_id" db:"user_id"`
	Name       string     `json:"name" db:"name"`
	TokenHash  string     `json:"-" db:"token_hash"`
	Token      string     `json:"token,omitempty"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty" db:"last_used_at"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty" db:"expires_at"`
	CreatedAt  time.Time  `json:"created_at" db:"created_at"`
}

type SSHKey struct {
	ID          int64     `json:"id" db:"id"`
	UserID      int64     `json:"user_id" db:"user_id"`
	Name        string    `json:"name" db:"name"`
	PublicKey   string    `json:"public_key" db:"public_key"`
	Fingerprint string    `json:"fingerprint" db:"fingerprint"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
}

type Ticket struct {
	ID        int64     `json:"id" db:"id"`
	UserID    int64     `json:"user_id" db:"user_id"`
	Subject   string    `json:"subject" db:"subject"`
	Status    string    `json:"status" db:"status"`
	Priority  string    `json:"priority" db:"priority"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

type TicketMessage struct {
	ID        int64     `json:"id" db:"id"`
	TicketID  int64     `json:"ticket_id" db:"ticket_id"`
	UserID    int64     `json:"user_id" db:"user_id"`
	Body      string    `json:"body" db:"body"`
	IsStaff   bool      `json:"is_staff" db:"is_staff"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

type FloatingIP struct {
	ID          int64      `json:"id" db:"id"`
	ClusterID   int64      `json:"cluster_id" db:"cluster_id"`
	IP          string     `json:"ip" db:"ip"`
	BoundVMID   *int64     `json:"bound_vm_id,omitempty" db:"bound_vm_id"`
	Status      string     `json:"status" db:"status"`
	Description string     `json:"description" db:"description"`
	AllocatedAt time.Time  `json:"allocated_at" db:"allocated_at"`
	AttachedAt  *time.Time `json:"attached_at,omitempty" db:"attached_at"`
	DetachedAt  *time.Time `json:"detached_at,omitempty" db:"detached_at"`
}

type FirewallGroup struct {
	ID          int64     `json:"id" db:"id"`
	Slug        string    `json:"slug" db:"slug"`
	Name        string    `json:"name" db:"name"`
	Description string    `json:"description" db:"description"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at" db:"updated_at"`
}

type FirewallRule struct {
	ID              int64     `json:"id" db:"id"`
	GroupID         int64     `json:"group_id" db:"group_id"`
	// Direction is 'ingress' (default; matches phase-E behaviour) or 'egress'.
	// Forwarded verbatim into the Incus ACL rule.direction field.
	Direction       string    `json:"direction" db:"direction"`
	Action          string    `json:"action" db:"action"`
	Protocol        string    `json:"protocol" db:"protocol"`
	DestinationPort string    `json:"destination_port" db:"destination_port"`
	SourceCIDR      string    `json:"source_cidr" db:"source_cidr"`
	Description     string    `json:"description" db:"description"`
	SortOrder       int       `json:"sort_order" db:"sort_order"`
	CreatedAt       time.Time `json:"created_at" db:"created_at"`
}

type VMFirewallBinding struct {
	VMID      int64     `json:"vm_id" db:"vm_id"`
	GroupID   int64     `json:"group_id" db:"group_id"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

type OSTemplate struct {
	ID                int64     `json:"id" db:"id"`
	Slug              string    `json:"slug" db:"slug"`
	Name              string    `json:"name" db:"name"`
	Source            string    `json:"source" db:"source"`
	Protocol          string    `json:"protocol" db:"protocol"`
	ServerURL         string    `json:"server_url" db:"server_url"`
	DefaultUser       string    `json:"default_user" db:"default_user"`
	CloudInitTemplate string    `json:"cloud_init_template" db:"cloud_init_template"`
	SupportsRescue    bool      `json:"supports_rescue" db:"supports_rescue"`
	Enabled           bool      `json:"enabled" db:"enabled"`
	SortOrder         int       `json:"sort_order" db:"sort_order"`
	CreatedAt         time.Time `json:"created_at" db:"created_at"`
	UpdatedAt         time.Time `json:"updated_at" db:"updated_at"`
}

// ProvisioningJob 是一次 VM 创建/重装的异步执行单元。
// 失败 / 进程崩溃后由 worker sweeper 兜底退款，refund_done_at 是幂等 guard。
type ProvisioningJob struct {
	ID            int64                 `json:"id" db:"id"`
	Kind          string                `json:"kind" db:"kind"`
	UserID        int64                 `json:"user_id" db:"user_id"`
	ClusterID     int64                 `json:"cluster_id" db:"cluster_id"`
	OrderID       *int64                `json:"order_id,omitempty" db:"order_id"`
	VMID          *int64                `json:"vm_id,omitempty" db:"vm_id"`
	TargetName    string                `json:"target_name" db:"target_name"`
	Status        string                `json:"status" db:"status"`
	Error         *string               `json:"error,omitempty" db:"error"`
	RefundDoneAt  *time.Time            `json:"refund_done_at,omitempty" db:"refund_done_at"`
	CreatedAt     time.Time             `json:"created_at" db:"created_at"`
	StartedAt     *time.Time            `json:"started_at,omitempty" db:"started_at"`
	CompletedAt   *time.Time            `json:"completed_at,omitempty" db:"completed_at"`
	Steps         []ProvisioningJobStep `json:"steps,omitempty"`
}

type ProvisioningJobStep struct {
	ID          int64      `json:"id" db:"id"`
	JobID       int64      `json:"job_id" db:"job_id"`
	Seq         int        `json:"seq" db:"seq"`
	Name        string     `json:"name" db:"name"`
	Status      string     `json:"status" db:"status"`
	Detail      *string    `json:"detail,omitempty" db:"detail"`
	StartedAt   *time.Time `json:"started_at,omitempty" db:"started_at"`
	CompletedAt *time.Time `json:"completed_at,omitempty" db:"completed_at"`
}

const (
	RoleAdmin    = "admin"
	RoleCustomer = "customer"

	VMStatusCreating  = "creating"
	VMStatusRunning   = "running"
	VMStatusStopped   = "stopped"
	VMStatusSuspended = "suspended"
	VMStatusError     = "error"
	VMStatusDeleted   = "deleted"

	OrderPending      = "pending"
	OrderPaid         = "paid"
	OrderProvisioning = "provisioning"
	OrderActive       = "active"
	OrderExpired      = "expired"
	OrderCancelled    = "cancelled"

	IPAvailable = "available"
	IPAssigned  = "assigned"
	IPReserved  = "reserved"
	IPCooldown  = "cooldown"

	// PLAN-025 / INFRA-007 provisioning job
	JobKindVMCreate    = "vm.create"
	JobKindVMReinstall = "vm.reinstall"

	JobStatusQueued    = "queued"
	JobStatusRunning   = "running"
	JobStatusSucceeded = "succeeded"
	JobStatusFailed    = "failed"
	JobStatusPartial   = "partial"

	StepStatusPending   = "pending"
	StepStatusRunning   = "running"
	StepStatusSucceeded = "succeeded"
	StepStatusFailed    = "failed"
	StepStatusSkipped   = "skipped"
)
