// Package notify 实现告警通道发送。
//
// 安全模型：
//   - 自定义 http.Client（newSafeClient）禁用 redirect + 拒绝私有 IP（防 SSRF）
//   - 钉钉 / 飞书 / 企微 host 白名单
//   - webhook 通用通道：必须 https + 私有/链路本地/loopback/CGNAT 拒绝
//
// 拒绝列表参考 IANA Special-Purpose Address Registry，覆盖：
//   - IPv4: 0.0.0.0/8, 10/8, 100.64/10 (CGNAT), 127/8, 169.254/16, 172.16/12,
//           192.0.0/24, 192.0.2/24, 192.168/16, 198.18/15, 198.51.100/24,
//           203.0.113/24, 224/4 (multicast), 240/4, 255.255.255.255/32
//   - IPv6: ::/128, ::1/128, ::ffff:0:0/96 (mapped IPv4), 64:ff9b::/96 (NAT64),
//           100::/64 (discard), fc00::/7 (ULA), fe80::/10 (link-local), ff00::/8
//
// 不引入 code.dny.dev/ssrf 外部依赖（可选下次迭代换库）；当前实现覆盖
// 上述所有典型 SSRF 向量，单元测试覆盖每个段。

package notify

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"
)

const (
	defaultRequestTimeout = 10 * time.Second
)

// 三家国内机器人服务的 host 白名单。生产 webhook 一般来自这三个域名之一；
// 误填外站 → 直接拒绝，避免被借机做 SSRF。
var dingtalkHosts = []string{"oapi.dingtalk.com"}
var feishuHosts = []string{"open.feishu.cn", "open.larksuite.com"}
var wecomHosts = []string{"qyapi.weixin.qq.com"}

// blockedIPNets 是 SSRF 拒绝段。包初始化时一次性 parse，运行时只比对。
var blockedIPNets []netip.Prefix
var blockedOnce sync.Once

func initBlockedIPNets() {
	prefixes := []string{
		// IPv4
		"0.0.0.0/8",
		"10.0.0.0/8",
		"100.64.0.0/10",
		"127.0.0.0/8",
		"169.254.0.0/16",
		"172.16.0.0/12",
		"192.0.0.0/24",
		"192.0.2.0/24",
		"192.168.0.0/16",
		"198.18.0.0/15",
		"198.51.100.0/24",
		"203.0.113.0/24",
		"224.0.0.0/4",
		"240.0.0.0/4",
		"255.255.255.255/32",
		// IPv6
		"::/128",
		"::1/128",
		"::ffff:0:0/96",
		"64:ff9b::/96",
		"100::/64",
		"2001:db8::/32",
		"fc00::/7",
		"fe80::/10",
		"ff00::/8",
	}
	for _, p := range prefixes {
		pre, err := netip.ParsePrefix(p)
		if err != nil {
			continue // shouldn't happen with hardcoded list
		}
		blockedIPNets = append(blockedIPNets, pre)
	}
}

// isBlockedIP 检查 IP 是否落在 SSRF 拒绝段。
func isBlockedIP(addr netip.Addr) bool {
	blockedOnce.Do(initBlockedIPNets)
	for _, p := range blockedIPNets {
		if p.Contains(addr) {
			return true
		}
	}
	return false
}

// errBlockedIP 是被 SSRF 拦截的标志错误。dialer 返回它后，sender 把 last_error
// 标 "ssrf blocked: <ip>" 让 admin 排查。
var errBlockedIP = errors.New("ssrf: address blocked")

// safeDialContext 在 dial 前 resolve 全部 IP，逐个校验后才连接。
// 不做 DNS rebinding 防护（一期接受风险，与配置好的钉钉/飞书域名配合即可）。
func safeDialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("parse address: %w", err)
	}
	resolver := net.DefaultResolver
	ips, err := resolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		return nil, fmt.Errorf("lookup %s: %w", host, err)
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("no IP for %s", host)
	}
	// 任一 IP 在拒绝段就整体拒绝，避免 RR-DNS 中混入私有 IP 绕过。
	for _, ip := range ips {
		if isBlockedIP(ip) {
			return nil, fmt.Errorf("%w: %s -> %s", errBlockedIP, host, ip)
		}
	}
	d := net.Dialer{Timeout: 5 * time.Second}
	return d.DialContext(ctx, network, net.JoinHostPort(ips[0].String(), port))
}

// newSafeClient 返回一个 http.Client：
//   - dial 前校验 IP（safeDialContext）
//   - 禁止跟随 redirect（防止 redirect 到私有 IP 绕过；调用方需要自己处理 30x）
//   - 全局超时 10s
func newSafeClient() *http.Client {
	tr := &http.Transport{
		DialContext:           safeDialContext,
		MaxIdleConns:          10,
		IdleConnTimeout:       60 * time.Second,
		TLSHandshakeTimeout:   5 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		ResponseHeaderTimeout: 5 * time.Second,
	}
	return &http.Client{
		Transport: tr,
		Timeout:   defaultRequestTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			// 拒绝跟随重定向：safeDialContext 只校验首次目标，redirect
			// 可能指向私有 IP 绕过校验。强制让调用方显式处理。
			return http.ErrUseLastResponse
		},
	}
}

// requireHTTPS 给 webhook 通道用：URL 必须是 https，避免明文凭据 / 中间人。
func requireHTTPS(rawURL string) error {
	if !strings.HasPrefix(rawURL, "https://") {
		return errors.New("webhook url must be https")
	}
	return nil
}

// requireHostInList 给固定厂商通道用：host 必须在白名单内。
func requireHostInList(rawURL string, hosts []string) error {
	// 解析 URL 中 host 部分，支持 https://host/path?query
	u, err := parseURLHost(rawURL)
	if err != nil {
		return err
	}
	for _, h := range hosts {
		if u == h {
			return nil
		}
	}
	return fmt.Errorf("host %s not in allowlist", u)
}

// parseURLHost 简单提取 https:// 后的 host（不引 net/url 减小签名）。
func parseURLHost(rawURL string) (string, error) {
	if !strings.HasPrefix(rawURL, "https://") {
		return "", errors.New("url must be https")
	}
	rest := rawURL[len("https://"):]
	if i := strings.IndexAny(rest, "/?#"); i >= 0 {
		rest = rest[:i]
	}
	if rest == "" {
		return "", errors.New("empty host")
	}
	// 去掉端口
	if h, _, err := net.SplitHostPort(rest); err == nil {
		return h, nil
	}
	return rest, nil
}
