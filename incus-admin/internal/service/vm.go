package service

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/incuscloud/incus-admin/internal/cluster"
	"github.com/incuscloud/incus-admin/internal/model"
)

// reinstallImageProbeClient 给 Reinstall pre-check 用的短超时 HTTP client。
// 单独定义而不复用全局 http.DefaultClient，避免被外部修改默认 timeout 影响。
var reinstallImageProbeClient = &http.Client{Timeout: 8 * time.Second}

// prePullImage 在 Reinstall 删除原 VM 之前主动把镜像拉到本地缓存。这样即使
// probe → recreate 之间上游挂掉，create 仍能命中本地 cache；同时把"server 可达
// 但 alias 不存在"的边缘情况提前到删除前暴露 —— 拉失败 → return early，原 VM
// 完整保留。
//
// 复用 Incus images API（POST /1.0/images with source spec）。镜像若已在本地
// 缓存，Incus 会无操作返回；otherwise 触发一次拉取。任一情况下 op 完成都说明
// 镜像可用，create 阶段可放心引用。
func prePullImage(ctx context.Context, client *cluster.Client, project, serverURL, protocol, alias string) error {
	body, _ := json.Marshal(map[string]any{
		"source": map[string]any{
			"type":     "image",
			"mode":     "pull",
			"server":   serverURL,
			"protocol": protocol,
			"alias":    alias,
		},
	})
	path := fmt.Sprintf("/1.0/images?project=%s", project)
	resp, err := client.APIPost(ctx, path, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("submit image pull: %w", err)
	}
	if resp == nil || resp.Type != "async" {
		// 非 async 通常意味着已经命中缓存或返回错误状态；前者就是成功。
		return nil
	}
	var op struct{ ID string }
	_ = json.Unmarshal(resp.Metadata, &op)
	if op.ID == "" {
		return nil
	}
	pullCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	if err := client.WaitForOperation(pullCtx, op.ID); err != nil {
		return fmt.Errorf("wait image pull: %w", err)
	}
	return nil
}

// probeImageServer 在 Reinstall 删除原 VM 之前探测 simplestreams 镜像服务器。
// 不可达 → 立即 abort 整个 Reinstall（不删原 VM）。可达不保证 alias 一定存在，
// 但能挡住 99% 的"上游服务挂了"导致用户数据被永久销毁的最常见场景（OPS-008 #8）。
func probeImageServer(ctx context.Context, serverURL string) error {
	if serverURL == "" {
		return nil
	}
	probeURL := strings.TrimRight(serverURL, "/") + "/streams/v1/index.json"
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, probeURL, nil)
	if err != nil {
		return fmt.Errorf("probe request: %w", err)
	}
	resp, err := reinstallImageProbeClient.Do(req)
	if err != nil {
		return fmt.Errorf("image server unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 && resp.StatusCode != http.StatusMethodNotAllowed {
		// 405 Method Not Allowed 表示服务器在线但不支持 HEAD（比如某些 CDN），
		// 这种情况视为可达；其他 4xx/5xx 都视为不可达。
		return fmt.Errorf("image server returned %d", resp.StatusCode)
	}
	return nil
}

type VMService struct {
	clusters *cluster.Manager
}

func NewVMService(clusters *cluster.Manager) *VMService {
	return &VMService{clusters: clusters}
}

type CreateVMParams struct {
	ClusterName string
	Project     string
	UserID      int64
	VMName      string
	CPU         int
	MemoryMB    int
	DiskGB      int
	OSImage     string
	SSHKeys     []string
	IP          string
	Gateway     string
	SubnetCIDR  string
	StoragePool string
	Network     string
}

type CreateVMResult struct {
	VMName   string `json:"vm_name"`
	IP       string `json:"ip"`
	Username string `json:"username"`
	Password string `json:"password"`
	Node     string `json:"node"`
}

func (s *VMService) Create(ctx context.Context, params CreateVMParams) (*CreateVMResult, error) {
	client, ok := s.clusters.Get(params.ClusterName)
	if !ok {
		return nil, fmt.Errorf("cluster %q not found", params.ClusterName)
	}

	password := generatePassword()
	vmName := params.VMName
	if vmName == "" {
		b := make([]byte, 3)
		rand.Read(b)
		vmName = fmt.Sprintf("vm-%s", hex.EncodeToString(b))
	}

	cloudInit := buildCloudInit(password, params.SSHKeys)
	networkConfig := buildNetworkConfig(params.IP, params.SubnetCIDR, params.Gateway)

	imageAlias := params.OSImage
	if len(imageAlias) > 7 && imageAlias[:7] == "images:" {
		imageAlias = imageAlias[7:]
	}

	body := map[string]any{
		"name": vmName,
		"type": "virtual-machine",
		"source": map[string]any{
			"type":     "image",
			"alias":    imageAlias,
			"server":   "https://images.linuxcontainers.org",
			"protocol": "simplestreams",
		},
		"config": map[string]any{
			"limits.cpu":                fmt.Sprintf("%d", params.CPU),
			"limits.memory":            fmt.Sprintf("%dMiB", params.MemoryMB),
			"user.cloud-init":          cloudInit,
			"cloud-init.network-config": networkConfig,
			"security.secureboot":       "false",
			// Enable live migration (stateful) so MigrateVM can use --live without
			// having to cold-migrate (stop → migrate → start). OPS-008 #5: Incus
			// rejects live migration without this flag; OPS-008 cold-migrate fix
			// stays as fallback for VMs that lacked this at create time.
			"migration.stateful": "true",
		},
		"devices": map[string]any{
			"root": map[string]any{
				"type": "disk",
				"pool": params.StoragePool,
				"path": "/",
				"size": fmt.Sprintf("%dGiB", params.DiskGB),
			},
			"eth0": map[string]any{
				"type":                    "nic",
				"nictype":                 "bridged",
				"parent":                  params.Network,
				"ipv4.address":            params.IP,
				"security.ipv4_filtering": "true",
				"security.mac_filtering":  "true",
			},
		},
	}

	bodyJSON, _ := json.Marshal(body)
	path := fmt.Sprintf("/1.0/instances?project=%s", params.Project)
	resp, err := client.APIPost(ctx, path, bytes.NewReader(bodyJSON))
	if err != nil {
		return nil, fmt.Errorf("create instance: %w", err)
	}

	if resp.Type == "async" {
		var op struct{ ID string }
		_ = json.Unmarshal(resp.Metadata, &op)
		if op.ID != "" {
			if err := client.WaitForOperation(ctx, op.ID); err != nil {
				slog.Error("wait for create operation failed", "vm", vmName, "error", err)
			}
		}
	}

	startBody, _ := json.Marshal(map[string]any{"action": "start", "timeout": 60})
	startPath := fmt.Sprintf("/1.0/instances/%s/state?project=%s", vmName, params.Project)
	startResp, err := client.APIPut(ctx, startPath, bytes.NewReader(startBody))
	if err != nil {
		slog.Error("start instance failed", "vm", vmName, "error", err)
	} else if startResp.Type == "async" {
		var op struct{ ID string }
		_ = json.Unmarshal(startResp.Metadata, &op)
		if op.ID != "" {
			_ = client.WaitForOperation(ctx, op.ID)
		}
	}

	node := ""
	if instanceData, err := client.GetInstance(ctx, params.Project, vmName); err == nil {
		var inst struct{ Location string }
		_ = json.Unmarshal(instanceData, &inst)
		node = inst.Location
	}

	slog.Info("vm created", "name", vmName, "ip", params.IP, "node", node, "cluster", params.ClusterName)

	return &CreateVMResult{
		VMName:   vmName,
		IP:       params.IP,
		Username: "ubuntu",
		Password: password,
		Node:     node,
	}, nil
}

func (s *VMService) ChangeState(ctx context.Context, clusterName, project, vmName, action string, force bool) error {
	client, ok := s.clusters.Get(clusterName)
	if !ok {
		return fmt.Errorf("cluster %q not found", clusterName)
	}

	body := map[string]any{"action": action, "timeout": 30, "force": force}
	bodyJSON, _ := json.Marshal(body)
	path := fmt.Sprintf("/1.0/instances/%s/state?project=%s", vmName, project)

	resp, err := client.APIPut(ctx, path, bytes.NewReader(bodyJSON))
	if err != nil {
		return fmt.Errorf("%s vm: %w", action, err)
	}

	if resp.Type == "async" {
		var op struct{ ID string }
		_ = json.Unmarshal(resp.Metadata, &op)
		if op.ID != "" {
			return client.WaitForOperation(ctx, op.ID)
		}
	}

	return nil
}

func (s *VMService) Delete(ctx context.Context, clusterName, project, vmName string) error {
	_ = s.ChangeState(ctx, clusterName, project, vmName, "stop", true)

	client, ok := s.clusters.Get(clusterName)
	if !ok {
		return fmt.Errorf("cluster %q not found", clusterName)
	}

	path := fmt.Sprintf("/1.0/instances/%s?project=%s", vmName, project)
	_, err := client.APIDelete(ctx, path)
	return err
}

// ReinstallParams is resolved by the handler — callers pick a template_slug
// or a legacy os_image string, and the handler translates that into the four
// fields below so this service stays oblivious to the os_templates table.
type ReinstallParams struct {
	ClusterName string
	Project     string
	VMName      string
	ImageSource string // e.g. "ubuntu/24.04/cloud"; required
	ServerURL   string // defaults to https://images.linuxcontainers.org
	Protocol    string // defaults to simplestreams
	DefaultUser string // defaults to "ubuntu"
}

type ReinstallResult struct {
	Password string `json:"password"`
	Username string `json:"username"`
}

func (s *VMService) Reinstall(ctx context.Context, params ReinstallParams) (*ReinstallResult, error) {
	if params.ImageSource == "" {
		return nil, fmt.Errorf("image_source is required")
	}
	serverURL := params.ServerURL
	if serverURL == "" {
		serverURL = "https://images.linuxcontainers.org"
	}
	protocol := params.Protocol
	if protocol == "" {
		protocol = "simplestreams"
	}
	defaultUser := params.DefaultUser
	if defaultUser == "" {
		defaultUser = "ubuntu"
	}

	client, ok := s.clusters.Get(params.ClusterName)
	if !ok {
		return nil, fmt.Errorf("cluster %q not found", params.ClusterName)
	}

	instData, err := client.GetInstance(ctx, params.Project, params.VMName)
	if err != nil {
		return nil, fmt.Errorf("get instance: %w", err)
	}

	var inst struct {
		Config   map[string]string         `json:"config"`
		Devices  map[string]map[string]any `json:"devices"`
		Location string                    `json:"location"`
	}
	if err := json.Unmarshal(instData, &inst); err != nil {
		return nil, fmt.Errorf("parse instance: %w", err)
	}

	// OPS-012 (probe): 删除原 VM 之前先探测镜像服务器，挡住"上游挂掉 → VM 已删但
	// 重建失败 → 用户数据永久销毁"的最常见数据丢失路径（OPS-008 Bug #8 教训）。
	if err := probeImageServer(ctx, serverURL); err != nil {
		return nil, fmt.Errorf("镜像服务器 %s 不可达，已取消重装以保护原 VM 数据: %w", serverURL, err)
	}

	// OPS-016 (pre-pull): 主动把镜像拉到本地缓存。这样即使 probe 之后到 recreate
	// 之前上游挂掉，create 也能命中本地 cache。残留 1% 的"server 可达但 alias
	// 不存在"风险也在这一步暴露 —— 拉失败 → return 早，原 VM 不动。
	if err := prePullImage(ctx, client, params.Project, serverURL, protocol, params.ImageSource); err != nil {
		return nil, fmt.Errorf("镜像 %s 预拉取失败，已取消重装以保护原 VM 数据: %w", params.ImageSource, err)
	}

	_ = s.ChangeState(ctx, params.ClusterName, params.Project, params.VMName, "stop", true)

	delPath := fmt.Sprintf("/1.0/instances/%s?project=%s", params.VMName, params.Project)
	delResp, err := client.APIDelete(ctx, delPath)
	if err != nil {
		return nil, fmt.Errorf("delete instance: %w", err)
	}
	// Wait for the async delete to complete; otherwise the recreate POST
	// races with Incus's still-running cleanup and returns "already exists".
	if delResp != nil && delResp.Type == "async" {
		var op struct{ ID string }
		_ = json.Unmarshal(delResp.Metadata, &op)
		if op.ID != "" {
			if err := client.WaitForOperation(ctx, op.ID); err != nil {
				slog.Warn("wait for reinstall delete failed", "vm", params.VMName, "error", err)
			}
		}
	}

	password := generatePassword()
	sshKeys := []string{}
	cloudInit := buildCloudInit(password, sshKeys)

	// Strip volatile.* keys: same reason as resetPasswordOffline. The new
	// instance gets fresh volatile state from Incus on first start.
	stripVolatileConfig(inst.Config)
	inst.Config["user.cloud-init"] = cloudInit

	body := map[string]any{
		"name": params.VMName,
		"type": "virtual-machine",
		"source": map[string]any{
			"type":     "image",
			"alias":    params.ImageSource,
			"server":   serverURL,
			"protocol": protocol,
		},
		"config":  inst.Config,
		"devices": inst.Devices,
	}

	bodyJSON, _ := json.Marshal(body)
	createPath := fmt.Sprintf("/1.0/instances?project=%s&target=%s", params.Project, inst.Location)
	resp, err := client.APIPost(ctx, createPath, bytes.NewReader(bodyJSON))
	if err != nil {
		return nil, fmt.Errorf("recreate instance: %w", err)
	}

	if resp.Type == "async" {
		var op struct{ ID string }
		_ = json.Unmarshal(resp.Metadata, &op)
		if op.ID != "" {
			if err := client.WaitForOperation(ctx, op.ID); err != nil {
				slog.Error("wait for reinstall create failed", "vm", params.VMName, "error", err)
			}
		}
	}

	startBody, _ := json.Marshal(map[string]any{"action": "start", "timeout": 60})
	startPath := fmt.Sprintf("/1.0/instances/%s/state?project=%s", params.VMName, params.Project)
	startResp, err := client.APIPut(ctx, startPath, bytes.NewReader(startBody))
	if err != nil {
		slog.Error("start reinstalled instance failed", "vm", params.VMName, "error", err)
	} else if startResp.Type == "async" {
		var op struct{ ID string }
		_ = json.Unmarshal(startResp.Metadata, &op)
		if op.ID != "" {
			_ = client.WaitForOperation(ctx, op.ID)
		}
	}

	slog.Info("vm reinstalled", "name", params.VMName, "source", params.ImageSource, "cluster", params.ClusterName)

	return &ReinstallResult{
		Password: password,
		Username: defaultUser,
	}, nil
}

func (s *VMService) ListInstances(ctx context.Context, clusterName, project string) ([]json.RawMessage, error) {
	client, ok := s.clusters.Get(clusterName)
	if !ok {
		return nil, fmt.Errorf("cluster %q not found", clusterName)
	}
	return client.GetInstances(ctx, project)
}

func (s *VMService) GetInstanceState(ctx context.Context, clusterName, project, vmName string) (json.RawMessage, error) {
	client, ok := s.clusters.Get(clusterName)
	if !ok {
		return nil, fmt.Errorf("cluster %q not found", clusterName)
	}
	return client.GetInstanceState(ctx, project, vmName)
}

// ResetPasswordMode selects between online (guest-agent exec) and offline
// (cloud-init reboot) reset paths. "auto" tries online first and falls back
// on failure; this is the default and works for running-but-broken VMs too.
type ResetPasswordMode string

const (
	ResetPasswordAuto    ResetPasswordMode = "auto"
	ResetPasswordOnline  ResetPasswordMode = "online"
	ResetPasswordOffline ResetPasswordMode = "offline"
)

// ResetPasswordResult carries both the new password and the channel that
// actually delivered it so the caller / audit can record which path ran.
// Fallback=true means auto mode tried online, failed, then went offline.
type ResetPasswordResult struct {
	Password string            `json:"password"`
	Username string            `json:"username"`
	Channel  ResetPasswordMode `json:"channel"`
	Fallback bool              `json:"fallback"`
}

// ResetPassword sets a new password for `username` inside the VM. The online
// path runs `chpasswd` via the Incus guest agent (works for healthy running
// VMs). The offline path rewrites cloud-init vendor-data + bumps the
// instance-id so cloud-init re-runs on next boot; suitable for stopped or
// unresponsive VMs.
func (s *VMService) ResetPassword(ctx context.Context, clusterName, project, vmName, username string, mode ResetPasswordMode) (*ResetPasswordResult, error) {
	client, ok := s.clusters.Get(clusterName)
	if !ok {
		return nil, fmt.Errorf("cluster %q not found", clusterName)
	}
	if !isValidLinuxUsername(username) {
		return nil, fmt.Errorf("invalid username %q", username)
	}
	if mode == "" {
		mode = ResetPasswordAuto
	}

	newPassword := generatePassword()
	result := &ResetPasswordResult{Password: newPassword, Username: username}

	if mode == ResetPasswordOnline || mode == ResetPasswordAuto {
		if err := s.resetPasswordOnline(ctx, client, project, vmName, username, newPassword); err == nil {
			result.Channel = ResetPasswordOnline
			slog.Info("vm password reset", "vm", vmName, "user", username, "channel", "online")
			return result, nil
		} else if mode == ResetPasswordOnline {
			return nil, fmt.Errorf("online reset: %w", err)
		} else {
			slog.Warn("online reset failed, falling back to offline", "vm", vmName, "error", err)
			result.Fallback = true
		}
	}

	if err := s.resetPasswordOffline(ctx, client, project, vmName, username, newPassword); err != nil {
		return nil, fmt.Errorf("offline reset: %w", err)
	}
	result.Channel = ResetPasswordOffline
	slog.Info("vm password reset", "vm", vmName, "user", username, "channel", "offline", "fallback", result.Fallback)
	return result, nil
}

func (s *VMService) resetPasswordOnline(ctx context.Context, client *cluster.Client, project, vmName, username, password string) error {
	payload := shellSingleQuote(username + ":" + password)
	cmd := []string{"sh", "-c", "echo " + payload + " | chpasswd"}
	retCode, err := client.ExecNonInteractive(ctx, project, vmName, cmd)
	if err != nil {
		return fmt.Errorf("exec chpasswd: %w", err)
	}
	if retCode != 0 {
		return fmt.Errorf("chpasswd exited with code %d", retCode)
	}
	return nil
}

// resetPasswordOffline reboots the VM into a cloud-init pass that runs
// chpasswd on first re-boot. Preserves existing user-data (SSH keys, etc.) by
// injecting into cloud-init.vendor-data instead of user-data.
//
// Flow: stop (best-effort, ignore if already stopped) → PATCH config with
// new vendor-data + new instance-id → start → return. We don't poll guest
// agent to confirm because offline is by definition used when the agent
// isn't cooperative; an audit row is enough for the admin to re-verify.
func (s *VMService) resetPasswordOffline(ctx context.Context, client *cluster.Client, project, vmName, username, password string) error {
	// Best-effort stop; ChangeState handles already-stopped cleanly.
	_ = s.ChangeState(ctx, clusterNameFromClient(client), project, vmName, "stop", true)

	// PATCH-only-config: just the two cloud-init keys we need to flip.
	// PUT-whole-instance broke `volatile.uuid` on 2026-04-25; PATCH lets
	// Incus keep its managed volatile state untouched.
	patchBody := map[string]any{
		"config": map[string]string{
			"cloud-init.vendor-data":  offlineChpasswdCloudConfig(username, password),
			"cloud-init.instance-id":  newInstanceID(),
		},
	}
	bodyJSON, err := json.Marshal(patchBody)
	if err != nil {
		return fmt.Errorf("marshal patch: %w", err)
	}
	path := fmt.Sprintf("/1.0/instances/%s?project=%s", vmName, project)
	resp, err := client.APIPatch(ctx, path, bytes.NewReader(bodyJSON))
	if err != nil {
		return fmt.Errorf("update instance config: %w", err)
	}
	if resp.Type == "async" {
		var op struct{ ID string }
		_ = json.Unmarshal(resp.Metadata, &op)
		if op.ID != "" {
			if err := client.WaitForOperation(ctx, op.ID); err != nil {
				slog.Warn("wait for instance update failed", "vm", vmName, "error", err)
			}
		}
	}

	if err := s.ChangeState(ctx, clusterNameFromClient(client), project, vmName, "start", false); err != nil {
		return fmt.Errorf("restart instance: %w", err)
	}
	return nil
}

// offlineChpasswdCloudConfig emits a cloud-config that resets ONE user's
// password. Deliberately minimal: no ssh_pwauth override, no chpasswd expire
// change, no runcmd echoing secrets (cloud-init writes the user-data path to
// /var/log/cloud-init.log with mode 600). The cloud-init `chpasswd.users`
// module is idempotent on re-run and keyed on user+password hash, so a
// repeated reset without a new instance-id would be a no-op — that's why the
// caller also bumps cloud-init.instance-id.
func offlineChpasswdCloudConfig(username, password string) string {
	// Use YAML literal block for the password to avoid shell-escaping issues
	// when cloud-init reads vendor-data. The password is hex (generatePassword
	// returns hex.Encode), so it has no YAML special characters, but the
	// double-quoted form keeps the shape explicit for future refactors that
	// might relax the password generator.
	return fmt.Sprintf(`#cloud-config
chpasswd:
  expire: false
  users:
    - name: %q
      password: %q
      type: text
ssh_pwauth: true
`, username, password)
}

// newInstanceID returns a random ID suitable for cloud-init.instance-id so
// cloud-init treats the next boot as a fresh instance and re-runs modules.
func newInstanceID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return "iid-" + hex.EncodeToString(b)
}

// clusterNameFromClient reads back the cluster name via the Name field on
// the client struct. Dedicated helper to keep the call site readable.
func clusterNameFromClient(c *cluster.Client) string {
	return c.Name
}

// stripVolatileConfig removes Incus-managed `volatile.*` keys from the
// instance config map. Incus 6.x rejects PUT bodies that include these
// keys ("Setting volatile.X is forbidden") even when the values are
// unchanged. Any code path that does GET-instance → modify → PUT-instance
// must call this before the PUT.
func stripVolatileConfig(config map[string]string) {
	for k := range config {
		if strings.HasPrefix(k, "volatile.") {
			delete(config, k)
		}
	}
}

// isValidLinuxUsername matches POSIX/Debian user_valid_name: start with [a-z_],
// then [a-z0-9_-], max 32 chars.
func isValidLinuxUsername(name string) bool {
	if len(name) == 0 || len(name) > 32 {
		return false
	}
	for i, c := range name {
		switch {
		case c >= 'a' && c <= 'z':
		case c == '_':
		case c >= '0' && c <= '9':
			if i == 0 {
				return false
			}
		case c == '-':
			if i == 0 {
				return false
			}
		default:
			return false
		}
	}
	return true
}

// shellSingleQuote wraps s in single quotes, escaping any embedded single quote
// with the standard '\'' sequence so the result is safe to concatenate into a
// sh -c command.
func shellSingleQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func generatePassword() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func buildCloudInit(password string, sshKeys []string) string {
	ci := fmt.Sprintf("#cloud-config\npassword: %s\nchpasswd:\n  expire: false\nssh_pwauth: true\n", password)
	if len(sshKeys) > 0 {
		ci += "ssh_authorized_keys:\n"
		for _, key := range sshKeys {
			ci += fmt.Sprintf("  - %s\n", key)
		}
	}
	return ci
}

func buildNetworkConfig(ip, cidr, gateway string) string {
	return fmt.Sprintf(`version: 2
ethernets:
  enp5s0:
    addresses:
      - %s/%s
    routes:
      - to: default
        via: %s
    nameservers:
      addresses:
        - 1.1.1.1
        - 8.8.8.8`, ip, cidr, gateway)
}

// Ensure VMService implements status constants from model
var _ = model.VMStatusCreating

// PLAN-025 / INFRA-007 桥接：异步 jobs runner 在 internal/service/jobs/
// 子包内调用以下辅助函数。直接导出（GeneratePassword 等）会破坏旧调用方，
// 这里以小包装函数的形式提供 stable API。
func GeneratePassword() string                                 { return generatePassword() }
func BuildCloudInit(password string, sshKeys []string) string  { return buildCloudInit(password, sshKeys) }
func BuildNetworkConfig(ip, cidr, gateway string) string       { return buildNetworkConfig(ip, cidr, gateway) }
func StripVolatileConfig(config map[string]string)             { stripVolatileConfig(config) }
func ProbeImageServer(ctx context.Context, serverURL string) error {
	return probeImageServer(ctx, serverURL)
}
func PrePullImage(ctx context.Context, client *cluster.Client, project, serverURL, protocol, alias string) error {
	return prePullImage(ctx, client, project, serverURL, protocol, alias)
}

// GenerateVMName 给 handler 同步路径用：用户没填名字时生成 vm-{6hex}。
// 与 VMService.Create 内部生成规则一致，保证异步 / 同步路径产物同形态。
func GenerateVMName() string {
	b := make([]byte, 3)
	rand.Read(b)
	return fmt.Sprintf("vm-%s", hex.EncodeToString(b))
}
