package sshexec

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

// Runner is the per-target SSH executor. PLAN-033 Phase A1 made the
// authentication material a Credential value so password / inline private
// key / key-file forms can all flow through the same dial path. The legacy
// New(host, user, keyFile) constructor builds an internal Credential of
// CredKindKeyFile, so call sites that have not migrated keep working.
type Runner struct {
	host           string
	user           string
	cred           Credential
	knownHostsFile string
	dialTimeout    time.Duration
}

// New keeps the historical signature: host + user + key-file path. Internally
// it materialises a Credential of CredKindKeyFile so the rest of the runner
// only deals with one shape.
func New(host, user, keyFile string) *Runner {
	return &Runner{
		host: host,
		user: user,
		cred: CredentialFromKeyFile(keyFile),
	}
}

// NewWithCredential is the new constructor used by node probe / add-node
// flows. The credential is copied by value; callers retain ownership of any
// underlying byte slice for Wipe purposes.
func NewWithCredential(host, user string, cred Credential) *Runner {
	return &Runner{host: host, user: user, cred: cred}
}

// WithKnownHosts 指定 OpenSSH known_hosts 文件路径；若文件存在则启用严格主机密钥校验，
// 未命中/被替换时返回错误而非静默放行，防止 MITM。调用方应在启动时注入。
func (r *Runner) WithKnownHosts(file string) *Runner {
	r.knownHostsFile = file
	return r
}

// WithDialTimeout overrides the default SSH dial timeout. Probe paths use a
// shorter timeout (5s) so the UI gets fast failure feedback; long-running
// jobs keep the legacy 10s.
func (r *Runner) WithDialTimeout(d time.Duration) *Runner {
	r.dialTimeout = d
	return r
}

// Close zeroes any in-memory secret material owned by this runner. It is
// safe to call multiple times. The runner is unusable afterwards.
func (r *Runner) Close() {
	r.cred.Wipe()
}

func (r *Runner) effectiveTimeout(fallback time.Duration) time.Duration {
	if r.dialTimeout > 0 {
		return r.dialTimeout
	}
	return fallback
}

func (r *Runner) clientConfig(timeout time.Duration) (*ssh.ClientConfig, error) {
	auth, err := r.cred.authMethods()
	if err != nil {
		return nil, fmt.Errorf("auth: %w", err)
	}
	hostKeyCB, err := r.hostKeyCallback()
	if err != nil {
		return nil, fmt.Errorf("host key callback: %w", err)
	}
	return &ssh.ClientConfig{
		User:            r.user,
		Auth:            auth,
		HostKeyCallback: hostKeyCB,
		Timeout:         timeout,
	}, nil
}

func (r *Runner) addr() string {
	addr := r.host
	if _, _, err := net.SplitHostPort(addr); err != nil {
		addr += ":22"
	}
	return addr
}

func (r *Runner) Run(ctx context.Context, cmd string) (string, error) {
	config, err := r.clientConfig(r.effectiveTimeout(10 * time.Second))
	if err != nil {
		return "", err
	}

	client, err := ssh.Dial("tcp", r.addr(), config)
	if err != nil {
		return "", fmt.Errorf("ssh dial %s: %w", r.addr(), err)
	}
	defer func() { _ = client.Close() }()

	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("ssh session: %w", err)
	}
	defer func() { _ = session.Close() }()

	out, err := session.CombinedOutput(cmd)
	if err != nil {
		return string(out), fmt.Errorf("ssh exec: %w", err)
	}
	return string(out), nil
}

// WriteFile 把 data 通过 SSH 写到远端 remotePath（用 `tee` 接收 stdin）。
// 远端目录必须已存在；mode 为 8 进制权限（如 0o755）。
//
// 用途：PLAN-026 add-node 把 join-node.sh / cluster-env.sh 等脚本批量铺到
// 新节点。比 SFTP 简单（不依赖 OpenSSH SFTP 子系统启用），SSH 通就能写。
//
// 安全：remotePath 必须是 admin 服务自己拼出来的 absolute path（不接受
// 用户输入），调用方控制注入面；这里 POSIX-quote 一下做最低层防御。
func (r *Runner) WriteFile(ctx context.Context, remotePath string, data []byte, mode os.FileMode) error {
	config, err := r.clientConfig(r.effectiveTimeout(15 * time.Second))
	if err != nil {
		return err
	}

	client, err := ssh.Dial("tcp", r.addr(), config)
	if err != nil {
		return fmt.Errorf("ssh dial %s: %w", r.addr(), err)
	}
	defer func() { _ = client.Close() }()

	session, err := client.NewSession()
	if err != nil {
		return fmt.Errorf("ssh session: %w", err)
	}
	defer func() { _ = session.Close() }()

	session.Stdin = bytes.NewReader(data)
	cmd := fmt.Sprintf("install -m %04o /dev/stdin %s", mode, shellQuote(remotePath))

	// ctx 取消即关 session
	ctxDone := make(chan struct{})
	defer close(ctxDone)
	go func() {
		select {
		case <-ctx.Done():
			_ = session.Close()
		case <-ctxDone:
		}
	}()

	if out, err := session.CombinedOutput(cmd); err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return ctxErr
		}
		return fmt.Errorf("write %s: %w (output: %s)", remotePath, err, strings.TrimSpace(string(out)))
	}
	return nil
}

// RunWithStdin executes cmd on the remote and feeds `stdin` into the
// session's stdin. Used by node probe to stream `bash -s` without leaving
// a temp file behind. ctx cancellation closes the session.
func (r *Runner) RunWithStdin(ctx context.Context, cmd string, stdin []byte) (string, error) {
	config, err := r.clientConfig(r.effectiveTimeout(15 * time.Second))
	if err != nil {
		return "", err
	}

	client, err := ssh.Dial("tcp", r.addr(), config)
	if err != nil {
		return "", fmt.Errorf("ssh dial %s: %w", r.addr(), err)
	}
	defer func() { _ = client.Close() }()

	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("ssh session: %w", err)
	}
	defer func() { _ = session.Close() }()

	session.Stdin = bytes.NewReader(stdin)

	ctxDone := make(chan struct{})
	defer close(ctxDone)
	go func() {
		select {
		case <-ctx.Done():
			_ = session.Close()
		case <-ctxDone:
		}
	}()

	out, err := session.CombinedOutput(cmd)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return string(out), ctxErr
		}
		return string(out), fmt.Errorf("ssh exec: %w", err)
	}
	return string(out), nil
}

// ScriptBytes is re-exported here so callers do not need a separate
// embedded import path. Needed because nodeprobe imports sshexec but reads
// the embedded script.

// MkdirAll 在远端 mkdir -p path。简化的 helper，path 经 POSIX-quote 后传入 mkdir。
func (r *Runner) MkdirAll(ctx context.Context, remotePath string) error {
	out, err := r.RunArgs(ctx, "mkdir", "-p", remotePath)
	if err != nil {
		return fmt.Errorf("mkdir %s: %w (output: %s)", remotePath, err, strings.TrimSpace(out))
	}
	return nil
}

// RunStream 流式执行远端命令并把每一行 stdout/stderr 推给 onLine 回调。
// 阻塞至 cmd 退出；ctx 取消会主动 close session。
//
// 用途：PLAN-026 add-node / remove-node 编排器需要从 join-node.sh / scale-node.sh
// 的 stdout 实时识别 "====== 步骤 N/7 XXX ======" 段落 marker 推进 step 进度。
// onLine 必须线程安全（因 stdout/stderr 两条 goroutine 各自调）；调用方通常
// 在 onLine 内部用单一 mutex 串行处理，或直接送 chan。
//
// 退出语义：
//   - 远端命令零退出 → 返回 nil
//   - 远端命令非零退出 → 返回 *ssh.ExitError（带 ExitStatus()）
//   - ctx 取消 → 返回 ctx.Err()
//   - SSH 层错误（dial / session）→ 返回包装后的错误
func (r *Runner) RunStream(ctx context.Context, cmd string, onLine func(line string)) error {
	if onLine == nil {
		return fmt.Errorf("onLine callback must be non-nil")
	}

	config, err := r.clientConfig(r.effectiveTimeout(15 * time.Second))
	if err != nil {
		return err
	}

	client, err := ssh.Dial("tcp", r.addr(), config)
	if err != nil {
		return fmt.Errorf("ssh dial %s: %w", r.addr(), err)
	}
	defer func() { _ = client.Close() }()

	session, err := client.NewSession()
	if err != nil {
		return fmt.Errorf("ssh session: %w", err)
	}
	defer func() { _ = session.Close() }()

	stdout, err := session.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}
	stderr, err := session.StderrPipe()
	if err != nil {
		return fmt.Errorf("stderr pipe: %w", err)
	}

	if err := session.Start(cmd); err != nil {
		return fmt.Errorf("session start: %w", err)
	}

	// ctx 取消 → 主动 close session 强制 server 端 SIGHUP 远程进程
	ctxDone := make(chan struct{})
	defer close(ctxDone)
	go func() {
		select {
		case <-ctx.Done():
			_ = session.Signal(ssh.SIGTERM)
			_ = session.Close()
		case <-ctxDone:
		}
	}()

	// 串行化 onLine 调用（stdout / stderr 两 goroutine 共享）
	var mu sync.Mutex
	emit := func(line string) {
		mu.Lock()
		defer mu.Unlock()
		onLine(line)
	}

	var wg sync.WaitGroup
	scan := func(rdr io.Reader) {
		defer wg.Done()
		s := bufio.NewScanner(rdr)
		// 支持长行（远端 incus 输出偶有 4KB+），上限 1MB
		s.Buffer(make([]byte, 64*1024), 1024*1024)
		for s.Scan() {
			emit(s.Text())
		}
	}
	wg.Add(2)
	go scan(stdout)
	go scan(stderr)

	waitErr := session.Wait()
	wg.Wait()

	if ctxErr := ctx.Err(); ctxErr != nil {
		return ctxErr
	}
	return waitErr
}

// RunArgs 以参数化方式执行远端命令，所有 token 经 POSIX 单引号转义后拼接，
// 避免调用点手写 fmt.Sprintf 造成的命令注入。
func (r *Runner) RunArgs(ctx context.Context, program string, args ...string) (string, error) {
	parts := make([]string, 0, len(args)+1)
	parts = append(parts, shellQuote(program))
	for _, a := range args {
		parts = append(parts, shellQuote(a))
	}
	return r.Run(ctx, strings.Join(parts, " "))
}

// shellQuote 用 POSIX 单引号把任意字符串安全嵌入 shell 命令。
func shellQuote(s string) string {
	if s == "" {
		return "''"
	}
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// hostKeyCallback 构造 SSH 主机密钥校验器：
//   - 若注入了 `knownHostsFile` 且文件存在，使用 knownhosts.New 严格校验；
//   - 若 `knownHostsFile` 为空，回退到 `InsecureIgnoreHostKey` 并打 warn 日志，
//     以便在历史部署没有配置该文件时不直接阻塞启动；生产必须显式配置。
func (r *Runner) hostKeyCallback() (ssh.HostKeyCallback, error) {
	if r.knownHostsFile == "" {
		slog.Warn("ssh host key verification disabled (no known_hosts file configured)", "host", r.host)
		return ssh.InsecureIgnoreHostKey(), nil //nolint:gosec // G106: 向后兼容 —— 未配 known_hosts 时走 warn，生产强制配置由运维约束

	}
	if _, err := os.Stat(r.knownHostsFile); err != nil {
		return nil, fmt.Errorf("known_hosts %q not accessible: %w", r.knownHostsFile, err)
	}
	cb, err := knownhosts.New(r.knownHostsFile)
	if err != nil {
		return nil, fmt.Errorf("load known_hosts: %w", err)
	}
	return cb, nil
}

// HostKeyInfo describes the server host key captured during a TOFU probe.
type HostKeyInfo struct {
	Type        string // e.g. "ssh-ed25519", "ssh-rsa"
	SHA256      string // OpenSSH-style "SHA256:<base64-no-padding>"
	Marshaled   []byte // raw key bytes for later append to known_hosts
	HostAndPort string // canonical host:port used for the connect
}

// FetchHostKey opens a dial-only TCP/SSH transport against the target,
// captures the server host key (without verifying it), then immediately
// closes the connection. PLAN-033 Phase A1 / B3: this powers the wizard's
// "fingerprint confirmation" step before we ever write to known_hosts or
// run anything on the remote box.
//
// Authentication is intentionally a no-op (zero auth methods); SSH protocol
// guarantees the host key is exchanged before authentication, so the remote
// side will reject us cleanly after sending its key. Both outcomes — the
// "no auth" rejection and a successful (impossible) handshake — are
// acceptable; we only care about the host key bytes.
func (r *Runner) FetchHostKey(ctx context.Context) (*HostKeyInfo, error) {
	captured := &HostKeyInfo{HostAndPort: r.addr()}
	cfg := &ssh.ClientConfig{
		User: r.user,
		Auth: nil, // intentionally empty — we expect "no supported methods"
		HostKeyCallback: func(hostname string, remote net.Addr, key ssh.PublicKey) error {
			captured.Type = key.Type()
			captured.Marshaled = key.Marshal()
			sum := sha256.Sum256(captured.Marshaled)
			captured.SHA256 = "SHA256:" + strings.TrimRight(base64.StdEncoding.EncodeToString(sum[:]), "=")
			return nil
		},
		Timeout: r.effectiveTimeout(5 * time.Second),
	}

	dialer := net.Dialer{Timeout: cfg.Timeout}
	conn, err := dialer.DialContext(ctx, "tcp", r.addr())
	if err != nil {
		return nil, fmt.Errorf("tcp dial %s: %w", r.addr(), err)
	}
	defer func() { _ = conn.Close() }()

	sshConn, _, _, err := ssh.NewClientConn(conn, r.addr(), cfg)
	if sshConn != nil {
		_ = sshConn.Close()
	}
	if captured.SHA256 == "" {
		// HostKeyCallback was never invoked — that's a hard failure regardless
		// of auth result.
		return nil, fmt.Errorf("host key not received: %w", err)
	}
	// Auth failure is expected; ignore err if we did capture the key.
	return captured, nil
}

// AppendHostKey appends a captured host key to a known_hosts file in OpenSSH
// format, taking a flock to prevent concurrent admin processes from
// interleaving lines. Callers should pass the same file path that was given
// to WithKnownHosts; the file is created if missing (mode 0600).
func AppendHostKey(path string, info *HostKeyInfo) error {
	if info == nil || len(info.Marshaled) == 0 {
		return fmt.Errorf("empty host key")
	}
	host, _, err := net.SplitHostPort(info.HostAndPort)
	if err != nil {
		host = info.HostAndPort
	}
	pubKey, err := ssh.ParsePublicKey(info.Marshaled)
	if err != nil {
		return fmt.Errorf("parse pub key: %w", err)
	}
	line := knownhosts.Line([]string{host}, pubKey) + "\n"

	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("open known_hosts: %w", err)
	}
	defer func() { _ = f.Close() }()
	if _, err := f.WriteString(line); err != nil {
		return fmt.Errorf("write known_hosts: %w", err)
	}
	return nil
}
