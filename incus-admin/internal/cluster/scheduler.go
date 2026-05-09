package cluster

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// NodeInfo 是 scheduler 缓存的单节点画像。
//
// PLAN-039 / OPS-042 多维度调度：在 mem 之上叠加 cpu load + cluster disk 维度，
// 并显式过滤 maintenance / evacuated 节点，避免新 VM 落到不应放置的位置。
type NodeInfo struct {
	Name      string  `json:"server_name"`
	Status    string  `json:"status"`
	Message   string  `json:"message"`
	CPUTotal  int     `json:"cpu_total"`
	MemTotal  int64   `json:"mem_total"`
	MemUsed   int64   `json:"mem_used"`
	MemFree   int64   `json:"mem_free"`
	FreeRatio float64 `json:"free_ratio"` // mem free ratio（保留旧字段兼容前端）

	// PLAN-039 / OPS-042 新字段
	LoadAverage5Min float64 `json:"load_5min"`        // /1.0/resources load.Average5Min
	CPUFreeRatio    float64 `json:"cpu_free_ratio"`   // 1 - min(load/cpu_total, 1)
	DiskFreeRatio   float64 `json:"disk_free_ratio"`  // cluster-wide（Ceph 共享存储）
	Maintenance     bool    `json:"maintenance"`      // scheduler.instance == "manual"
	Evacuated       bool    `json:"evacuated"`        // status == "Evacuated"
	Score           float64 `json:"score"`            // scoreNode 综合得分（0..1）
}

// schedWeights 评分权重；env SCHEDULER_WEIGHTS=mem,cpu,disk 可调。
// 默认 0.5 / 0.4 / 0.1：mem 主导（启动硬约束）+ cpu load 实测（防热点节点饥饿），
// disk 仅 0.1 因为 vmc.5ok.co 用 Ceph 共享存储 → 所有节点 disk_free_ratio 相同，
// 在该场景下 disk 维度不区分节点。保留权重用于将来引入本地存储多 cluster。
type schedWeights struct {
	mem, cpu, disk float64
}

func loadWeights() schedWeights {
	w := schedWeights{mem: 0.5, cpu: 0.4, disk: 0.1}
	raw := os.Getenv("SCHEDULER_WEIGHTS")
	if raw == "" {
		return w
	}
	parts := strings.Split(raw, ",")
	if len(parts) != 3 {
		slog.Warn("invalid SCHEDULER_WEIGHTS, using defaults", "raw", raw)
		return w
	}
	parsed := [3]float64{}
	for i, p := range parts {
		v, err := strconv.ParseFloat(strings.TrimSpace(p), 64)
		if err != nil || v < 0 {
			slog.Warn("invalid SCHEDULER_WEIGHTS component, using defaults", "raw", raw, "idx", i)
			return schedWeights{mem: 0.5, cpu: 0.4, disk: 0.1}
		}
		parsed[i] = v
	}
	sum := parsed[0] + parsed[1] + parsed[2]
	if sum == 0 {
		return w
	}
	// 归一化（用户传 5,4,1 等同 0.5,0.4,0.1）
	return schedWeights{mem: parsed[0] / sum, cpu: parsed[1] / sum, disk: parsed[2] / sum}
}

// scoreNode 纯函数：把 NodeInfo 转成 0..1 的综合得分。
// maintenance / evacuated / 非 Online 节点直接 0 分（不参与新 VM 放置）。
func scoreNode(n NodeInfo, w schedWeights) float64 {
	if n.Maintenance || n.Evacuated || n.Status != "Online" {
		return 0
	}
	mem := clamp01(n.FreeRatio)
	cpu := clamp01(n.CPUFreeRatio)
	disk := clamp01(n.DiskFreeRatio)
	if disk == 0 {
		// disk 数据未拉到 → 中性 0.5，避免 disk 权重把节点压成 0
		disk = 0.5
	}
	return w.mem*mem + w.cpu*cpu + w.disk*disk
}

func clamp01(v float64) float64 {
	if math.IsNaN(v) || v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

type Scheduler struct {
	mu      sync.RWMutex
	cache   map[string][]NodeInfo // cluster name -> nodes
	mgr     *Manager
	weights schedWeights
}

func NewScheduler(mgr *Manager) *Scheduler {
	s := &Scheduler{
		cache:   make(map[string][]NodeInfo),
		mgr:     mgr,
		weights: loadWeights(),
	}
	go s.refreshLoop()
	return s
}

// PickNode 选最高 score 节点；tie-break 按绝对 mem free 降序（避免相同分被反复
// 挑中同一台小内存节点）。无候选返 error。
func (s *Scheduler) PickNode(clusterName string) (string, error) {
	s.mu.RLock()
	nodes := s.cache[clusterName]
	s.mu.RUnlock()

	if len(nodes) == 0 {
		if err := s.refreshCluster(clusterName); err != nil {
			return "", fmt.Errorf("refresh nodes: %w", err)
		}
		s.mu.RLock()
		nodes = s.cache[clusterName]
		s.mu.RUnlock()
	}

	var candidates []NodeInfo
	for _, n := range nodes {
		// 显式过滤：维护态 / 已疏散 / 非 Online
		if n.Maintenance || n.Evacuated || n.Status != "Online" || n.Message != "Fully operational" {
			continue
		}
		candidates = append(candidates, n)
	}

	if len(candidates) == 0 {
		return "", fmt.Errorf("no available nodes in cluster %s", clusterName)
	}

	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].Score != candidates[j].Score {
			return candidates[i].Score > candidates[j].Score
		}
		return candidates[i].MemFree > candidates[j].MemFree
	})

	return candidates[0].Name, nil
}

func (s *Scheduler) GetNodes(clusterName string) []NodeInfo {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cache[clusterName]
}

func (s *Scheduler) refreshLoop() {
	s.refreshAll()
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		s.refreshAll()
	}
}

func (s *Scheduler) refreshAll() {
	for _, client := range s.mgr.List() {
		if err := s.refreshCluster(client.Name); err != nil {
			slog.Warn("refresh cluster nodes failed", "cluster", client.Name, "error", err)
		}
	}
}

func (s *Scheduler) refreshCluster(clusterName string) error {
	client, ok := s.mgr.Get(clusterName)
	if !ok {
		return fmt.Errorf("cluster %q not found", clusterName)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	members, err := client.GetClusterMembers(ctx)
	if err != nil {
		return err
	}

	// 拉一次 cluster-wide disk free ratio（Ceph driver / 单池假设；多池场景取
	// cluster.config.StoragePool 配置的主池）。失败时各节点 DiskFreeRatio 留 0
	// → scoreNode 用 0.5 中性值。
	clusterDiskFree := s.fetchClusterDiskFree(ctx, client)

	var nodes []NodeInfo
	for _, raw := range members {
		var member struct {
			ServerName string            `json:"server_name"`
			Status     string            `json:"status"`
			Message    string            `json:"message"`
			Config     map[string]string `json:"config"`
		}
		_ = json.Unmarshal(raw, &member)

		info := NodeInfo{
			Name:    member.ServerName,
			Status:  member.Status,
			Message: member.Message,
		}

		// PLAN-037 维护 / 疏散标记同步
		if v, ok := member.Config["scheduler.instance"]; ok && strings.EqualFold(v, "manual") {
			info.Maintenance = true
		}
		if strings.EqualFold(member.Status, "Evacuated") {
			info.Evacuated = true
		}

		resPath := fmt.Sprintf("/1.0/resources?target=%s", member.ServerName)
		if resp, err := client.APIGet(ctx, resPath); err == nil {
			var res struct {
				CPU struct {
					Total int `json:"total"`
				} `json:"cpu"`
				Memory struct {
					Total int64 `json:"total"`
					Used  int64 `json:"used"`
				} `json:"memory"`
				Load struct {
					Average5Min float64 `json:"Average5Min"`
				} `json:"load"`
			}
			_ = json.Unmarshal(resp.Metadata, &res)
			info.CPUTotal = res.CPU.Total
			info.MemTotal = res.Memory.Total
			info.MemUsed = res.Memory.Used
			info.MemFree = res.Memory.Total - res.Memory.Used
			if res.Memory.Total > 0 {
				info.FreeRatio = float64(info.MemFree) / float64(res.Memory.Total)
			}
			info.LoadAverage5Min = res.Load.Average5Min
			if info.CPUTotal > 0 {
				pressure := info.LoadAverage5Min / float64(info.CPUTotal)
				info.CPUFreeRatio = clamp01(1.0 - pressure)
			} else {
				info.CPUFreeRatio = 0.5 // 数据缺失 → 中性
			}
		}

		info.DiskFreeRatio = clusterDiskFree
		info.Score = scoreNode(info, s.weights)

		nodes = append(nodes, info)
	}

	s.mu.Lock()
	s.cache[clusterName] = nodes
	s.mu.Unlock()

	return nil
}

// fetchClusterDiskFree 拉主存储池剩余比例。Ceph driver 共享 → cluster-wide；
// 拉失败返 0（scoreNode 用 0.5 中性兜底）。
//
// pma-cr F4：直接调 /resources 端点；早先版本多打一次 /storage-pools/{pool}
// 但解析的 p.Status 从未使用，每 60s scheduler refresh 浪费一次 Incus API。
func (s *Scheduler) fetchClusterDiskFree(ctx context.Context, client *Client) float64 {
	pool := ""
	if cfg, ok := s.mgr.ConfigByName(client.Name); ok {
		pool = cfg.StoragePool
	}
	if pool == "" {
		pool = "ceph-pool" // 历史默认；与 cluster-env.sh 一致
	}
	resp, err := client.APIGet(ctx, fmt.Sprintf("/1.0/storage-pools/%s/resources", pool))
	if err != nil {
		return 0
	}
	var r struct {
		Space struct {
			Total int64 `json:"total"`
			Used  int64 `json:"used"`
		} `json:"space"`
	}
	if err := json.Unmarshal(resp.Metadata, &r); err != nil {
		return 0
	}
	if r.Space.Total <= 0 {
		return 0
	}
	free := r.Space.Total - r.Space.Used
	return float64(free) / float64(r.Space.Total)
}
