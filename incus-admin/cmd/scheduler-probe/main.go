// scheduler-probe — 一次性诊断工具：实例化与 server 同款 cluster.Manager +
// Scheduler，强制 refreshAll，然后打印每节点 NodeInfo + PickNode 的最终选择。
//
// 使用：
//
//	scheduler-probe -cluster cn-sz-01
//
// 配置走 env（与 server 同款）：CLUSTER_NAME / CLUSTER_API_URL / CLUSTER_CERT_FILE /
// CLUSTER_KEY_FILE / CLUSTER_DEFAULT_PROJECT / CLUSTER_STORAGE_POOL / CLUSTER_NETWORK
//
// PLAN-039 / OPS-042 验证用，非 release 部署组件。
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/incuscloud/incus-admin/internal/cluster"
	"github.com/incuscloud/incus-admin/internal/config"
	"github.com/incuscloud/incus-admin/internal/service"
)

func main() {
	cluster_ := flag.String("cluster", os.Getenv("CLUSTER_NAME"), "cluster name to probe")
	testStateful := flag.String("test-stateful", "", "F8 验证用：尝试 EnableStateful(<vm-name>)，看 isStateful err 是否被 warn log 而非吞掉")
	flag.Parse()
	if *cluster_ == "" {
		fmt.Fprintln(os.Stderr, "missing -cluster or CLUSTER_NAME env")
		os.Exit(2)
	}

	cc := config.ClusterConfig{
		Name:           *cluster_,
		APIURL:         os.Getenv("CLUSTER_API_URL"),
		CertFile:       os.Getenv("CLUSTER_CERT_FILE"),
		KeyFile:        os.Getenv("CLUSTER_KEY_FILE"),
		DefaultProject: getenvOr("CLUSTER_DEFAULT_PROJECT", "customers"),
		StoragePool:    getenvOr("CLUSTER_STORAGE_POOL", "ceph-pool"),
		Network:        getenvOr("CLUSTER_NETWORK", "br-pub"),
	}
	mgr, err := cluster.NewManager([]config.ClusterConfig{cc}, nil)
	if err != nil {
		slog.Error("create manager failed", "error", err)
		os.Exit(1)
	}

	sched := cluster.NewScheduler(mgr)
	// 触发 PickNode 内部 refreshCluster 同步路径，保证 nodes 已就绪
	_, _ = sched.PickNode(*cluster_)
	// 再等一次 background refresh 把 score 算回来
	time.Sleep(2 * time.Second)

	nodes := sched.GetNodes(*cluster_)
	out := struct {
		Cluster string             `json:"cluster"`
		Nodes   []cluster.NodeInfo `json:"nodes"`
		Picked  string             `json:"picked"`
		Err     string             `json:"err,omitempty"`
	}{Cluster: *cluster_, Nodes: nodes}

	picked, perr := sched.PickNode(*cluster_)
	out.Picked = picked
	if perr != nil {
		out.Err = perr.Error()
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(out)

	// F8 验证：直接调 vmSvc.EnableStateful 探测不存在的 VM，看 warn 日志
	if *testStateful != "" {
		fmt.Fprintln(os.Stderr, "\n=== F8 EnableStateful 探测（期望看到 isStateful warn 日志） ===")
		vmSvc := service.NewVMService(mgr)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		err := vmSvc.EnableStateful(ctx, *cluster_, "customers", *testStateful)
		fmt.Fprintf(os.Stderr, "EnableStateful(%q) returned err: %v\n", *testStateful, err)
	}
}

func getenvOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
