package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
)

// 配置常量
const (
	idleTimeout    = 30 * time.Minute // 空闲超时
	maxConnTimeout = 1 * time.Hour    // 最大连接时长
	tokenTTL       = 5 * time.Minute  // Token 有效期
	maxGlobalConns = 100              // 全局最大并发连接数
)

// 环境变量配置
var (
	listenAddr     = envOrDefault("LISTEN_ADDR", ":6080")
	incusEndpoint  = envOrDefault("INCUS_ENDPOINT", "https://localhost:8443")
	jwtSecret      = os.Getenv("JWT_SECRET")
	tlsCertFile    = envOrDefault("INCUS_TLS_CERT", "/etc/console-proxy/client.crt")
	tlsKeyFile     = envOrDefault("INCUS_TLS_KEY", "/etc/console-proxy/client.key")
	tlsCAFile      = envOrDefault("INCUS_TLS_CA", "/etc/console-proxy/ca.crt")
	allowedOrigins = envOrDefault("ALLOWED_ORIGINS", "") // 逗号分隔的允许 Origin 列表
)

// 并发连接追踪
var (
	activeConns   = make(map[string]bool)
	activeConnsMu sync.Mutex
	globalConns   int // 全局连接计数
)

// ConsoleClaims JWT 声明
type ConsoleClaims struct {
	VMName string `json:"vm_name"`
	UserID string `json:"user_id"`
	jwt.RegisteredClaims
}

// incusOperation Incus 异步操作响应
type incusOperation struct {
	Type       string `json:"type"`
	Status     string `json:"status"`
	StatusCode int    `json:"status_code"`
	Operation  string `json:"operation"`
	Metadata   struct {
		ID  string            `json:"id"`
		FDs map[string]string `json:"fds"`
	} `json:"metadata"`
}

var wsUpgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin:     checkOrigin,
}

func main() {
	if jwtSecret == "" {
		log.Fatal("环境变量 JWT_SECRET 未设置")
	}

	r := mux.NewRouter()
	r.HandleFunc("/console/{vm}", handleConsole)
	r.PathPrefix("/static/").Handler(
		http.StripPrefix("/static/", http.FileServer(http.Dir("static"))),
	)
	r.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "ok")
	})

	srv := &http.Server{
		Addr:              listenAddr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
		// 注意：不设 ReadTimeout/WriteTimeout，因为 WebSocket 升级后它们会截断长连接
	}

	log.Printf("Console 代理服务启动，监听 %s", listenAddr)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("服务启动失败: %v", err)
	}
}

// handleConsole 处理 WebSocket 控制台连接
func handleConsole(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	vmName := vars["vm"]

	// 验证 token
	tokenStr := r.URL.Query().Get("token")
	if tokenStr == "" {
		http.Error(w, "缺少 token 参数", http.StatusUnauthorized)
		return
	}

	claims, err := validateToken(tokenStr, vmName)
	if err != nil {
		log.Printf("Token 验证失败: %v", err)
		http.Error(w, "Token 无效", http.StatusForbidden)
		return
	}

	// 并发连接检查
	connKey := claims.UserID + ":" + claims.VMName
	if !acquireConn(connKey) {
		http.Error(w, "该 VM 已有活跃的控制台连接", http.StatusConflict)
		return
	}
	defer releaseConn(connKey)

	// 升级到 WebSocket
	clientConn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket 升级失败: %v", err)
		return
	}
	defer clientConn.Close()

	log.Printf("用户 %s 连接 VM %s 的控制台", claims.UserID, vmName)

	// 连接 Incus console API
	incusConn, err := connectIncusConsole(vmName)
	if err != nil {
		log.Printf("连接 Incus 控制台失败: %v", err)
		msg := fmt.Sprintf("\r\n连接失败: %v\r\n", err)
		clientConn.WriteMessage(websocket.TextMessage, []byte(msg))
		return
	}
	defer incusConn.Close()

	// 双向转发
	ctx, cancel := context.WithTimeout(context.Background(), maxConnTimeout)
	defer cancel()

	bridgeWebSockets(ctx, clientConn, incusConn)
	log.Printf("用户 %s 断开 VM %s 的控制台", claims.UserID, vmName)
}

// validateToken 验证 JWT token
func validateToken(tokenStr, vmName string) (*ConsoleClaims, error) {
	claims := &ConsoleClaims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("不支持的签名方法: %v", token.Header["alg"])
		}
		return []byte(jwtSecret), nil
	})
	if err != nil {
		return nil, fmt.Errorf("解析 token 失败: %w", err)
	}
	if !token.Valid {
		return nil, fmt.Errorf("token 无效")
	}

	// 验证 VM 名称匹配
	if claims.VMName != vmName {
		return nil, fmt.Errorf("token VM 名称 (%s) 与请求不匹配 (%s)", claims.VMName, vmName)
	}

	return claims, nil
}

// connectIncusConsole 通过 mTLS 连接 Incus console API
func connectIncusConsole(vmName string) (*websocket.Conn, error) {
	tlsConfig, err := buildTLSConfig()
	if err != nil {
		return nil, fmt.Errorf("TLS 配置失败: %w", err)
	}

	httpClient := &http.Client{
		Transport: &http.Transport{TLSClientConfig: tlsConfig},
		Timeout:   30 * time.Second,
	}

	// POST /1.0/instances/{vm}/console 请求 console 操作
	consoleURL := fmt.Sprintf("%s/1.0/instances/%s/console",
		incusEndpoint, url.PathEscape(vmName))

	req, err := http.NewRequest("POST", consoleURL,
		strings.NewReader(`{"type":"console"}`))
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Incus API 请求失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("Incus API 返回 %d: %s", resp.StatusCode, body)
	}

	var op incusOperation
	if err := json.NewDecoder(resp.Body).Decode(&op); err != nil {
		return nil, fmt.Errorf("解析 Incus 响应失败: %w", err)
	}

	// 获取 console fd 的 WebSocket secret
	wsSecret := op.Metadata.FDs["0"]
	if wsSecret == "" {
		return nil, fmt.Errorf("未获取到 WebSocket secret")
	}

	// 构建 WebSocket URL：将 operation 路径拼接到 Incus endpoint
	wsURL := fmt.Sprintf("%s%s/websocket?secret=%s",
		incusEndpoint, op.Operation, url.QueryEscape(wsSecret))
	// https:// → wss://
	wsURL = "wss" + strings.TrimPrefix(wsURL, "https")

	dialer := websocket.Dialer{TLSClientConfig: tlsConfig}
	wsConn, wsResp, err := dialer.Dial(wsURL, nil)
	if wsResp != nil && wsResp.Body != nil {
		wsResp.Body.Close()
	}
	if err != nil {
		return nil, fmt.Errorf("WebSocket 连接失败: %w", err)
	}

	return wsConn, nil
}

// bridgeWebSockets 双向转发两个 WebSocket 连接
func bridgeWebSockets(ctx context.Context, client, incus *websocket.Conn) {
	done := make(chan struct{}, 2)
	activity := make(chan struct{}, 1) // 活动信号（非阻塞发送避免积压）

	// 客户端 → Incus
	go func() {
		defer func() { done <- struct{}{} }()
		for {
			msgType, msg, err := client.ReadMessage()
			if err != nil {
				return
			}
			select {
			case activity <- struct{}{}:
			default:
			}
			if err := incus.WriteMessage(msgType, msg); err != nil {
				return
			}
		}
	}()

	// Incus → 客户端
	go func() {
		defer func() { done <- struct{}{} }()
		for {
			msgType, msg, err := incus.ReadMessage()
			if err != nil {
				return
			}
			select {
			case activity <- struct{}{}:
			default:
			}
			if err := client.WriteMessage(msgType, msg); err != nil {
				return
			}
		}
	}()

	// 空闲超时由主 goroutine 独占管理，避免 Timer 并发竞态
	idleTimer := time.NewTimer(idleTimeout)
	defer idleTimer.Stop()

	for {
		select {
		case <-done:
			return
		case <-activity:
			if !idleTimer.Stop() {
				select {
				case <-idleTimer.C:
				default:
				}
			}
			idleTimer.Reset(idleTimeout)
		case <-idleTimer.C:
			log.Println("空闲超时，关闭连接")
			return
		case <-ctx.Done():
			log.Println("最大连接时长到达，关闭连接")
			return
		}
	}
}

// buildTLSConfig 构建 mTLS 配置
func buildTLSConfig() (*tls.Config, error) {
	cert, err := tls.LoadX509KeyPair(tlsCertFile, tlsKeyFile)
	if err != nil {
		return nil, fmt.Errorf("加载客户端证书失败: %w", err)
	}

	cfg := &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS12,
	}

	if tlsCAFile != "" {
		caCert, err := os.ReadFile(tlsCAFile)
		if err != nil {
			return nil, fmt.Errorf("读取 CA 证书 %s 失败: %w", tlsCAFile, err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(caCert) {
			return nil, fmt.Errorf("CA 证书 %s 中无有效 PEM 数据", tlsCAFile)
		}
		cfg.RootCAs = pool
	}

	return cfg, nil
}

func acquireConn(key string) bool {
	activeConnsMu.Lock()
	defer activeConnsMu.Unlock()
	if activeConns[key] {
		return false
	}
	if globalConns >= maxGlobalConns {
		return false
	}
	activeConns[key] = true
	globalConns++
	return true
}

func releaseConn(key string) {
	activeConnsMu.Lock()
	defer activeConnsMu.Unlock()
	if activeConns[key] {
		delete(activeConns, key)
		globalConns--
	}
}

// checkOrigin 校验 WebSocket 请求的 Origin，防止跨站 WebSocket 劫持
func checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true // 非浏览器客户端无 Origin
	}
	if allowedOrigins == "" {
		// 未配置时，仅允许同源请求
		u, err := url.Parse(origin)
		if err != nil {
			return false
		}
		return strings.EqualFold(u.Host, r.Host)
	}
	for _, allowed := range strings.Split(allowedOrigins, ",") {
		allowed = strings.TrimSpace(allowed)
		if allowed == "*" {
			return true
		}
		if strings.EqualFold(origin, allowed) {
			return true
		}
	}
	return false
}

func envOrDefault(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}
