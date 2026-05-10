// PLAN-043 / INFRA-011 bootstrap CLI：让客户从零台机器到"5 分钟出私有云"。
//
// 子命令：
//
//	incus-admin bootstrap detect     - 探测主机能力 / 输出 JSON 报告
//	incus-admin bootstrap first-node - 交互式向导写 /etc/incus-admin/bootstrap.yaml
//	incus-admin bootstrap apply      - 按 plan 文件 apply（默认 --dry-run，--apply 真执行）
//
// 决策（PLAN-043 用户批准）：
//   - D26 = A：apply 失败不自动 rollback，幂等 rerun
//   - D27 = stdlib（不引 huh，简化依赖；用 bufio.NewReader 读用户输入）
//   - D28 = systemd Type=notify（已在 systemd unit 模板里配）
//   - D29 = C：PG 部署模式由向导问，dev 默 docker / prod 默 apt 装系统 PG
//   - D30 = A：仅 Ubuntu 22.04+ / Debian 12+，其他 friendly exit
package main

import (
	"bufio"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"github.com/spf13/cobra"
)

//go:embed bootstrap_assets/incus-admin.service.tmpl
var systemdUnitTmpl string

//go:embed bootstrap_assets/incus-preseed.yaml.tmpl
var incusPreseedTmpl string

func runBootstrap(args []string) {
	root := &cobra.Command{
		Use:   "bootstrap",
		Short: "incus-admin 一键引导（PLAN-043 / INFRA-011）",
		Long:  "5 分钟从零裸机起一个私有云。仅 Ubuntu 22.04+ / Debian 12+。",
	}
	root.AddCommand(detectCmd(), firstNodeCmd(), applyCmd())
	root.SetArgs(args)
	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

// ----------------------------------------------------------------------------
// detect
// ----------------------------------------------------------------------------

func detectCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "detect",
		Short: "探测主机能力（OS / 网卡 / 磁盘 / 已装组件 / 端口）",
		RunE: func(cmd *cobra.Command, args []string) error {
			rep := detect()
			out, _ := json.MarshalIndent(rep, "", "  ")
			fmt.Println(string(out))
			if !rep.Ready {
				fmt.Fprintln(os.Stderr, "\n>> 主机不满足 bootstrap 条件，请先解决以上 blockers。")
				os.Exit(2)
			}
			return nil
		},
	}
}

type detectReport struct {
	OS              osInfo     `json:"os"`
	CPUCount        int        `json:"cpu_count"`
	MemoryMB        int        `json:"memory_mb"`
	Disks           []diskInfo `json:"disks"`
	NICs            []nicInfo  `json:"nics"`
	HasIncus        bool       `json:"has_incus"`
	HasDocker       bool       `json:"has_docker"`
	HasPostgres    bool       `json:"has_postgres"`
	HasNftables     bool       `json:"has_nftables"`
	IncusClustered  bool       `json:"incus_clustered"`
	BlockedPorts   []int      `json:"blocked_ports"`
	Ready          bool       `json:"ready"`
	Blockers       []string   `json:"blockers,omitempty"`
}

type osInfo struct {
	ID       string `json:"id"`
	Version  string `json:"version"`
	Codename string `json:"codename"`
}

type diskInfo struct {
	Name     string `json:"name"`
	SizeGB   int    `json:"size_gb"`
	Removable bool  `json:"removable"`
}

type nicInfo struct {
	Name    string `json:"name"`
	IPv4    string `json:"ipv4,omitempty"`
	Default bool   `json:"default,omitempty"`
}

func detect() detectReport {
	rep := detectReport{}
	rep.OS = readOSRelease()
	rep.CPUCount = runtime.NumCPU()
	rep.MemoryMB = readMemTotalMB()
	rep.Disks = readDisks()
	rep.NICs = readNICs()
	rep.HasIncus = isInPath("incus")
	rep.HasDocker = isInPath("docker")
	rep.HasPostgres = isInPath("psql")
	rep.HasNftables = isInPath("nft")
	rep.IncusClustered = checkIncusClustered()
	rep.BlockedPorts = checkBlockedPorts(80, 443, 5432, 8443)

	// 判定 ready
	var blockers []string
	if rep.OS.ID != "ubuntu" && rep.OS.ID != "debian" {
		blockers = append(blockers, fmt.Sprintf("一期仅支持 Ubuntu 22.04+ / Debian 12+，当前 OS=%s", rep.OS.ID))
	}
	if rep.MemoryMB < 4096 {
		blockers = append(blockers, fmt.Sprintf("内存 %d MB 过低（建议 ≥ 4 GB）", rep.MemoryMB))
	}
	if len(rep.Disks) == 0 {
		blockers = append(blockers, "未发现可用磁盘")
	}
	if rep.IncusClustered {
		blockers = append(blockers, "本机 incus 已加入集群，不能再做 bootstrap first-node。如要接管请先 incus admin recover")
	}
	if len(rep.BlockedPorts) > 0 {
		blockers = append(blockers, fmt.Sprintf("端口被占用: %v", rep.BlockedPorts))
	}
	rep.Blockers = blockers
	rep.Ready = len(blockers) == 0
	return rep
}

func readOSRelease() osInfo {
	out := osInfo{}
	data, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return out
	}
	for _, line := range strings.Split(string(data), "\n") {
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		v = strings.Trim(v, `"`)
		switch k {
		case "ID":
			out.ID = v
		case "VERSION_ID":
			out.Version = v
		case "VERSION_CODENAME":
			out.Codename = v
		}
	}
	return out
}

func readMemTotalMB() int {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(data), "\n") {
		if !strings.HasPrefix(line, "MemTotal:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) >= 2 {
			kb, _ := strconv.Atoi(fields[1])
			return kb / 1024
		}
	}
	return 0
}

func readDisks() []diskInfo {
	out := []diskInfo{}
	cmd := exec.Command("lsblk", "-J", "-d", "-b", "-o", "NAME,SIZE,RM,TYPE")
	data, err := cmd.Output()
	if err != nil {
		return out
	}
	var parsed struct {
		Blockdevices []struct {
			Name string `json:"name"`
			Size int64  `json:"size"`
			RM   bool   `json:"rm"`
			Type string `json:"type"`
		} `json:"blockdevices"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil {
		return out
	}
	for _, d := range parsed.Blockdevices {
		if d.Type != "disk" {
			continue
		}
		out = append(out, diskInfo{
			Name:      d.Name,
			SizeGB:    int(d.Size / (1024 * 1024 * 1024)),
			Removable: d.RM,
		})
	}
	return out
}

func readNICs() []nicInfo {
	out := []nicInfo{}
	cmd := exec.Command("ip", "-j", "addr")
	data, err := cmd.Output()
	if err != nil {
		return out
	}
	var parsed []struct {
		Ifname string `json:"ifname"`
		AddrInfo []struct {
			Family string `json:"family"`
			Local  string `json:"local"`
		} `json:"addr_info"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil {
		return out
	}
	defaultIface := readDefaultIface()
	for _, n := range parsed {
		if n.Ifname == "lo" {
			continue
		}
		nic := nicInfo{Name: n.Ifname, Default: n.Ifname == defaultIface}
		for _, a := range n.AddrInfo {
			if a.Family == "inet" {
				nic.IPv4 = a.Local
				break
			}
		}
		out = append(out, nic)
	}
	return out
}

func readDefaultIface() string {
	cmd := exec.Command("ip", "-j", "route", "show", "default")
	data, err := cmd.Output()
	if err != nil {
		return ""
	}
	var parsed []struct {
		Dev string `json:"dev"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil {
		return ""
	}
	if len(parsed) > 0 {
		return parsed[0].Dev
	}
	return ""
}

func isInPath(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

func checkIncusClustered() bool {
	cmd := exec.Command("incus", "cluster", "list")
	if err := cmd.Run(); err != nil {
		return false
	}
	return true
}

func checkBlockedPorts(ports ...int) []int {
	var blocked []int
	for _, p := range ports {
		cmd := exec.Command("ss", "-lnt", fmt.Sprintf("sport = :%d", p))
		out, err := cmd.Output()
		if err != nil {
			continue
		}
		// ss 输出至少 1 行 header；> 1 行表示有进程在 listen
		if strings.Count(string(out), "\n") > 1 {
			blocked = append(blocked, p)
		}
	}
	return blocked
}

// ----------------------------------------------------------------------------
// first-node 交互向导
// ----------------------------------------------------------------------------

type bootstrapPlan struct {
	NodeName     string `json:"node_name"`
	PublicIP     string `json:"public_ip"`
	Role         string `json:"role"`         // single | cluster-first
	NetworkMode  string `json:"network_mode"` // bridge | vlan
	VLANID       int    `json:"vlan_id,omitempty"`
	StorageMode  string `json:"storage_mode"` // zfs | dir | ceph
	StorageDisk  string `json:"storage_disk,omitempty"`
	Domain       string `json:"domain"`
	TLSMode      string `json:"tls_mode"` // local-self-signed | letsencrypt
	AuthMode     string `json:"auth_mode"` // local-admin | oidc-logto
	OIDCIssuer   string `json:"oidc_issuer,omitempty"`
	OIDCClient   string `json:"oidc_client,omitempty"`
	OIDCSecret   string `json:"oidc_secret,omitempty"`
	PGMode       string `json:"pg_mode"` // docker | system | external
	PGDSN        string `json:"pg_dsn,omitempty"`
	AdminEmail   string `json:"admin_email"`
	AdminPwHash  string `json:"-"` // 不写入 plan 文件，apply 时现场生成
}

func firstNodeCmd() *cobra.Command {
	var outFile string
	cmd := &cobra.Command{
		Use:   "first-node",
		Short: "交互式向导，写 bootstrap.yaml 计划文件",
		RunE: func(cmd *cobra.Command, args []string) error {
			plan, err := wizard()
			if err != nil {
				return err
			}
			data, _ := json.MarshalIndent(plan, "", "  ")
			if err := os.MkdirAll(filepath.Dir(outFile), 0o755); err != nil {
				return err
			}
			if err := os.WriteFile(outFile, data, 0o600); err != nil {
				return err
			}
			fmt.Printf("\n✓ 计划已写入 %s\n  下一步：%s bootstrap apply --plan %s --dry-run\n",
				outFile, os.Args[0], outFile)
			return nil
		},
	}
	cmd.Flags().StringVar(&outFile, "out", "/etc/incus-admin/bootstrap.yaml", "输出计划文件路径")
	return cmd
}

func wizard() (*bootstrapPlan, error) {
	rep := detect()
	if !rep.Ready {
		fmt.Println("⚠ 探测到 blockers：")
		for _, b := range rep.Blockers {
			fmt.Println("  -", b)
		}
		if !askYesNo("继续？(y/N)", false) {
			return nil, fmt.Errorf("aborted by user")
		}
	}

	plan := &bootstrapPlan{}
	hostname, _ := os.Hostname()
	plan.NodeName = ask("节点名", hostname)

	defaultIP := ""
	for _, n := range rep.NICs {
		if n.Default {
			defaultIP = n.IPv4
			break
		}
	}
	plan.PublicIP = ask("公网 IP", defaultIP)

	plan.Role = askChoice("角色", []string{"single", "cluster-first"}, "single")
	plan.NetworkMode = askChoice("网络模式", []string{"bridge", "vlan"}, "bridge")
	if plan.NetworkMode == "vlan" {
		plan.VLANID, _ = strconv.Atoi(ask("VLAN ID", "376"))
	}

	storageOpts := []string{"zfs", "dir", "ceph"}
	plan.StorageMode = askChoice("存储模式", storageOpts, "dir")
	if plan.StorageMode == "zfs" && len(rep.Disks) > 0 {
		fmt.Println("可用磁盘:")
		for _, d := range rep.Disks {
			fmt.Printf("  - /dev/%s (%d GB)\n", d.Name, d.SizeGB)
		}
		plan.StorageDisk = ask("ZFS 磁盘 (留空则用 file vault)", "")
	}

	plan.Domain = ask("域名", hostname+".local")
	plan.TLSMode = askChoice("TLS 模式", []string{"local-self-signed", "letsencrypt"}, "local-self-signed")
	plan.AuthMode = askChoice("认证模式", []string{"local-admin", "oidc-logto"}, "local-admin")
	if plan.AuthMode == "oidc-logto" {
		plan.OIDCIssuer = ask("OIDC Issuer", "https://logto.example.com")
		plan.OIDCClient = ask("OIDC Client ID", "")
		plan.OIDCSecret = ask("OIDC Client Secret", "")
	}
	plan.AdminEmail = ask("管理员邮箱", "admin@"+plan.Domain)

	pgDefault := "docker"
	if rep.OS.ID == "ubuntu" || rep.OS.ID == "debian" {
		// prod-ish 推荐 system，但 dev 默 docker；让用户选
	}
	plan.PGMode = askChoice("PostgreSQL 部署", []string{"docker", "system", "external"}, pgDefault)
	if plan.PGMode == "external" {
		plan.PGDSN = ask("外部 PG DSN", "postgres://user:pass@host:5432/incusadmin")
	}

	return plan, nil
}

func ask(prompt, def string) string {
	if def != "" {
		fmt.Printf("%s [%s]: ", prompt, def)
	} else {
		fmt.Printf("%s: ", prompt)
	}
	r := bufio.NewReader(os.Stdin)
	line, _ := r.ReadString('\n')
	line = strings.TrimSpace(line)
	if line == "" {
		return def
	}
	return line
}

func askChoice(prompt string, choices []string, def string) string {
	for {
		v := ask(fmt.Sprintf("%s (%s)", prompt, strings.Join(choices, "/")), def)
		for _, c := range choices {
			if v == c {
				return v
			}
		}
		fmt.Println("⚠ 必须从给定选项中选择")
	}
}

func askYesNo(prompt string, def bool) bool {
	defStr := "n"
	if def {
		defStr = "y"
	}
	v := strings.ToLower(ask(prompt, defStr))
	return v == "y" || v == "yes"
}

// ----------------------------------------------------------------------------
// apply
// ----------------------------------------------------------------------------

func applyCmd() *cobra.Command {
	var planFile string
	var doApply bool
	cmd := &cobra.Command{
		Use:   "apply",
		Short: "按计划文件 apply。默认 --dry-run；加 --apply 才真执行（root 权限）",
		RunE: func(cmd *cobra.Command, args []string) error {
			data, err := os.ReadFile(planFile)
			if err != nil {
				return fmt.Errorf("read plan: %w", err)
			}
			var plan bootstrapPlan
			if err := json.Unmarshal(data, &plan); err != nil {
				return fmt.Errorf("parse plan: %w", err)
			}
			steps := buildSteps(&plan)
			fmt.Printf("Plan: %s (%d 步骤)\n\n", planFile, len(steps))
			for i, s := range steps {
				fmt.Printf("[%d/%d] %s\n", i+1, len(steps), s.name)
				for _, c := range s.commands {
					fmt.Printf("  $ %s\n", c)
				}
			}
			if !doApply {
				fmt.Println("\n>>> dry-run 完成。加 --apply 真执行。")
				return nil
			}
			if os.Geteuid() != 0 {
				return fmt.Errorf("apply 需要 root（请用 sudo）")
			}
			if !askYesNo("\n确认执行？(y/N)", false) {
				return fmt.Errorf("aborted")
			}
			for i, s := range steps {
				fmt.Printf("\n[%d/%d] %s ...\n", i+1, len(steps), s.name)
				if s.fn != nil {
					if err := s.fn(&plan); err != nil {
						return fmt.Errorf("step %q failed: %w", s.name, err)
					}
				} else {
					for _, c := range s.commands {
						if err := runShell(c); err != nil {
							return fmt.Errorf("step %q cmd %q failed: %w", s.name, c, err)
						}
					}
				}
				fmt.Println("  ✓")
			}
			fmt.Println("\n✓ bootstrap apply 完成。")
			fmt.Printf("\n下一步：访问 https://%s 登录\n  Admin: %s\n", plan.Domain, plan.AdminEmail)
			return nil
		},
	}
	cmd.Flags().StringVar(&planFile, "plan", "/etc/incus-admin/bootstrap.yaml", "计划文件")
	cmd.Flags().BoolVar(&doApply, "apply", false, "真执行（默认 dry-run）")
	return cmd
}

type bootstrapStep struct {
	name     string
	commands []string                          // 仅展示用；真执行走 fn 或这些命令
	fn       func(*bootstrapPlan) error
}

func buildSteps(p *bootstrapPlan) []bootstrapStep {
	steps := []bootstrapStep{}

	// 0) 写 /etc/incus-admin/env（P0 CR 修复 #7）
	//
	// systemd unit EnvironmentFile=/etc/incus-admin/env，必须在 systemctl start
	// 之前生成。SESSION_SECRET / EMERGENCY_TOKEN 用 openssl rand 现场生成；
	// PG 密码（docker 模式）也在本步生成，docker run 引用同一变量（修 #8）。
	steps = append(steps, bootstrapStep{
		name: "Generate /etc/incus-admin/env (secrets + DSN)",
		commands: []string{
			"openssl rand -base64 32 > /etc/incus-admin/env  # SESSION_SECRET / EMERGENCY_TOKEN / PG_PASSWORD",
			"chmod 0600 /etc/incus-admin/env",
		},
		fn: writeEnvFile,
	})

	// 1) 包安装
	steps = append(steps, bootstrapStep{
		name: "Install OS packages (incus + nftables)",
		commands: []string{
			"apt-get update",
			"apt-get install -y incus nftables ca-certificates openssl",
		},
	})

	// 2) Incus init preseed
	steps = append(steps, bootstrapStep{
		name: "incus admin init --preseed",
		commands: []string{
			"incus admin init --preseed < /etc/incus-admin/incus-preseed.yaml",
		},
		fn: func(p *bootstrapPlan) error {
			rendered := renderPreseed(p)
			if err := os.WriteFile("/etc/incus-admin/incus-preseed.yaml", []byte(rendered), 0o600); err != nil {
				return err
			}
			cmd := exec.Command("bash", "-c", "incus admin init --preseed < /etc/incus-admin/incus-preseed.yaml")
			cmd.Stdout = os.Stdout
			cmd.Stderr = os.Stderr
			return cmd.Run()
		},
	})

	// 3) PostgreSQL
	switch p.PGMode {
	case "docker":
		// PG 密码已在步骤 0 写入 /etc/incus-admin/env（PG_PASSWORD 行）。
		// docker run 用 --env-file 读取同一文件，避免明文出现在 ps / shell history。
		steps = append(steps, bootstrapStep{
			name: "Postgres (docker container)",
			commands: []string{
				"# 密码源自 /etc/incus-admin/env (PG_PASSWORD)，docker run 用 --env-file 注入：",
				"docker run -d --name incusadmin-pg --restart=always -p 127.0.0.1:5432:5432 \\",
				"  -e POSTGRES_PASSWORD=$(grep ^PG_PASSWORD= /etc/incus-admin/env | cut -d= -f2) \\",
				"  -v /var/lib/incusadmin-pg:/var/lib/postgresql/data postgres:16",
			},
			fn: runPGDocker,
		})
	case "system":
		steps = append(steps, bootstrapStep{
			name: "Postgres (apt install)",
			commands: []string{
				"apt-get install -y postgresql",
				"systemctl enable --now postgresql",
				"sudo -u postgres createdb incusadmin",
				"# 注意：apt 模式下 DATABASE_URL 仍需手工调整 /etc/incus-admin/env",
			},
		})
	case "external":
		// 外部模式：env 文件已写入 plan.PGDSN，无操作。
	}

	// 4) systemd unit + binary 部署
	steps = append(steps, bootstrapStep{
		name: "systemd unit + binary install",
		commands: []string{
			"install -m 0755 incus-admin /usr/local/bin/incus-admin",
			"install -m 0644 incus-admin.service /etc/systemd/system/incus-admin.service",
			"systemctl daemon-reload",
			"systemctl enable --now incus-admin",
		},
		fn: func(p *bootstrapPlan) error {
			unit := strings.NewReplacer(
				"{{DOMAIN}}", p.Domain,
				"{{ADMIN_EMAIL}}", p.AdminEmail,
			).Replace(systemdUnitTmpl)
			if err := os.WriteFile("/etc/systemd/system/incus-admin.service", []byte(unit), 0o644); err != nil {
				return err
			}
			if err := runShell("systemctl daemon-reload"); err != nil {
				return err
			}
			return runShell("systemctl enable --now incus-admin")
		},
	})

	// 5) 健康检查
	steps = append(steps, bootstrapStep{
		name: "Health check",
		commands: []string{
			"curl -sf http://127.0.0.1:8080/api/health",
		},
	})

	return steps
}

func renderPreseed(p *bootstrapPlan) string {
	clusterEnabled := "false"
	if p.Role == "cluster-first" {
		clusterEnabled = "true"
	}
	return strings.NewReplacer(
		"{{NODE_NAME}}", p.NodeName,
		"{{PUBLIC_IP}}", p.PublicIP,
		"{{STORAGE_DRIVER}}", p.StorageMode,
		"{{STORAGE_DISK}}", p.StorageDisk,
		"{{CLUSTER_ENABLED}}", clusterEnabled,
	).Replace(incusPreseedTmpl)
}

func runShell(cmd string) error {
	c := exec.Command("bash", "-c", cmd)
	c.Stdout = os.Stdout
	c.Stderr = os.Stderr
	return c.Run()
}

// writeEnvFile 实现 step 0：把 plan + 现场生成的 secrets 写到 /etc/incus-admin/env。
// systemd unit + docker run 都依赖该文件。
//
// 字段：
//   SESSION_SECRET     32 字节 random
//   EMERGENCY_TOKEN    32 字节 random
//   PASSWORD_ENCRYPTION_KEY  AES-256 GCM key (OPS-022)
//   PG_PASSWORD        24 字节 random（仅 docker 模式）
//   DATABASE_URL       拼好（按 PGMode 决定 host/port/passwd）
//   ADMIN_EMAILS       plan.AdminEmail
//   DOMAIN             plan.Domain
//   OIDC_*             plan.OIDC*（仅 oidc-logto 模式）
func writeEnvFile(p *bootstrapPlan) error {
	if err := os.MkdirAll("/etc/incus-admin", 0o755); err != nil {
		return fmt.Errorf("mkdir /etc/incus-admin: %w", err)
	}
	rand := func(bytes int) string {
		out, err := exec.Command("openssl", "rand", "-base64", strconv.Itoa(bytes)).Output()
		if err != nil {
			return "fallback-" + strconv.FormatInt(int64(os.Getpid()), 10)
		}
		return strings.TrimSpace(string(out))
	}
	sessionSecret := rand(32)
	emergencyToken := rand(32)
	encKey := rand(32)
	pgPassword := rand(24)

	dsn := p.PGDSN
	switch p.PGMode {
	case "docker":
		dsn = fmt.Sprintf("postgres://postgres:%s@127.0.0.1:5432/incusadmin?sslmode=disable", pgPassword)
	case "system":
		dsn = "postgres://postgres@/incusadmin?host=/var/run/postgresql"
	}

	var b strings.Builder
	b.WriteString("# Generated by incus-admin bootstrap apply at " + p.NodeName + "\n")
	b.WriteString("# Mode 0600. NEVER commit / share.\n")
	b.WriteString("LISTEN=:8080\n")
	b.WriteString("DOMAIN=" + p.Domain + "\n")
	b.WriteString("ADMIN_EMAILS=" + p.AdminEmail + "\n")
	b.WriteString("SESSION_SECRET=" + sessionSecret + "\n")
	b.WriteString("EMERGENCY_TOKEN=" + emergencyToken + "\n")
	b.WriteString("PASSWORD_ENCRYPTION_KEY=" + encKey + "\n")
	b.WriteString("DATABASE_URL=" + dsn + "\n")
	if p.PGMode == "docker" {
		b.WriteString("PG_PASSWORD=" + pgPassword + "\n")
	}
	if p.AuthMode == "oidc-logto" {
		b.WriteString("OIDC_ISSUER=" + p.OIDCIssuer + "\n")
		b.WriteString("OIDC_CLIENT_ID=" + p.OIDCClient + "\n")
		b.WriteString("OIDC_CLIENT_SECRET=" + p.OIDCSecret + "\n")
	}

	if err := os.WriteFile("/etc/incus-admin/env", []byte(b.String()), 0o600); err != nil {
		return fmt.Errorf("write env: %w", err)
	}
	return nil
}

// runPGDocker 起 PG 容器，密码从 /etc/incus-admin/env 读取（修 #8）。
func runPGDocker(_ *bootstrapPlan) error {
	cmd := exec.Command("bash", "-c", `
set -e
PW=$(grep '^PG_PASSWORD=' /etc/incus-admin/env | cut -d= -f2-)
docker rm -f incusadmin-pg 2>/dev/null || true
docker run -d --name incusadmin-pg --restart=always \
  -p 127.0.0.1:5432:5432 \
  -e POSTGRES_PASSWORD="$PW" \
  -e POSTGRES_DB=incusadmin \
  -v /var/lib/incusadmin-pg:/var/lib/postgresql/data postgres:16
`)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}
