package cluster

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/incuscloud/incus-admin/internal/config"
)

type Client struct {
	Name        string
	DisplayName string
	APIURL      string
	Projects    []config.ProjectConfig
	IPPools     []config.IPPoolConfig
	httpClient  *http.Client
	// longClient 没有 client-level Timeout，仅由 ctx 控制；专门给
	// /operations/{id}/wait?timeout=... 这种"客户端要忍受很长 op"的端点用。
	// 普通短请求继续走 httpClient（10s 兜底）防止 dead-stuck。
	longClient *http.Client
}

func newClient(cc config.ClusterConfig, store FingerprintStore) (*Client, error) {
	hc, err := buildHTTPClient(cc, store)
	if err != nil {
		return nil, err
	}
	lc, err := buildLongHTTPClient(cc, store)
	if err != nil {
		return nil, err
	}

	c := &Client{
		Name:        cc.Name,
		DisplayName: cc.DisplayName,
		APIURL:      strings.TrimRight(cc.APIURL, "/"),
		Projects:    cc.Projects,
		IPPools:     cc.IPPools,
		httpClient:  hc,
		longClient:  lc,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := c.APIGet(ctx, "/1.0"); err != nil {
		return nil, fmt.Errorf("health check failed: %w", err)
	}

	return c, nil
}

type IncusResponse struct {
	Type       string          `json:"type"`
	Status     string          `json:"status"`
	StatusCode int             `json:"status_code"`
	Operation  string          `json:"operation"`
	ErrorCode  int             `json:"error_code"`
	Error      string          `json:"error"`
	Metadata   json.RawMessage `json:"metadata"`
}

func (c *Client) apiRequest(ctx context.Context, method, path string, body io.Reader) (*IncusResponse, error) {
	return c.apiRequestWith(ctx, c.httpClient, method, path, body)
}

// apiRequestWith 是 apiRequest 的可替换 transport 版本，给 WaitForOperation
// 这种长 polling 调用用 longClient，避免 client-level 10s timeout 误杀。
func (c *Client) apiRequestWith(ctx context.Context, hc *http.Client, method, path string, body io.Reader) (*IncusResponse, error) {
	url := c.APIURL + path
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}

	var incusResp IncusResponse
	if err := json.Unmarshal(data, &incusResp); err != nil {
		return nil, fmt.Errorf("parse response: %w", err)
	}

	if incusResp.Error != "" {
		return &incusResp, fmt.Errorf("incus error: %s", incusResp.Error)
	}

	return &incusResp, nil
}

func (c *Client) APIGet(ctx context.Context, path string) (*IncusResponse, error) {
	return c.apiRequest(ctx, http.MethodGet, path, nil)
}

func (c *Client) APIPost(ctx context.Context, path string, body io.Reader) (*IncusResponse, error) {
	return c.apiRequest(ctx, http.MethodPost, path, body)
}

func (c *Client) APIPut(ctx context.Context, path string, body io.Reader) (*IncusResponse, error) {
	return c.apiRequest(ctx, http.MethodPut, path, body)
}

func (c *Client) APIDelete(ctx context.Context, path string) (*IncusResponse, error) {
	return c.apiRequest(ctx, http.MethodDelete, path, nil)
}

// APIPatch is the partial-update sibling of APIPut. Used for endpoints that
// accept HTTP PATCH (e.g. /1.0/projects/{name}) where we want to set just
// one config key without re-marshaling the whole object back.
func (c *Client) APIPatch(ctx context.Context, path string, body io.Reader) (*IncusResponse, error) {
	return c.apiRequest(ctx, http.MethodPatch, path, body)
}

func (c *Client) RawGet(ctx context.Context, path string) (string, error) {
	url := c.APIURL + path
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read body: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(data))
	}
	return string(data), nil
}

// operationMetadata 是 /1.0/operations/{id}/wait 返回 metadata 的最小子集。
// Status: "Pending" / "Running" / "Success" / "Failure" / "Cancelled" 等
// （Incus 6.x op.status_code 200 是 Success，400+ 是各种 Failure）。
type operationMetadata struct {
	Status     string `json:"status"`
	StatusCode int    `json:"status_code"`
	Err        string `json:"err"`
}

// WaitForOperation 阻塞直到 op 真正达到终态。
//
// 历史 bug 修复（PLAN-025）：
//
//  1. 走 longClient（无 client-level Timeout），让 ctx 决定上限。原 httpClient
//     10s 兜底会比 ?timeout=120 的服务端 long-poll 早超时，导致 op 仍 Running
//     就把"WaitForOperation 失败"返给调用方，handler 误判失败继续 start
//     instance，再撞"already in use"等下游错误。
//
//  2. 解析 metadata 取 op.status，"Success" 才视为成功。原版只看 HTTP 200
//     就 return nil —— Incus 在 op 仍 Running 时也是 200，那相当于 fake-wait。
//
// timeout=60s 是单次 long-poll 上限；外层 for 循环让总等待由 ctx 控制，
// 镜像拉取 5min+ 也能正常等到。
func (c *Client) WaitForOperation(ctx context.Context, operationID string) error {
	path := fmt.Sprintf("/1.0/operations/%s/wait?timeout=60", operationID)
	for {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("wait operation %s: %w", operationID, err)
		}

		resp, err := c.apiRequestWith(ctx, c.longClient, http.MethodGet, path, nil)
		if err != nil {
			return fmt.Errorf("wait operation %s: %w", operationID, err)
		}

		var op operationMetadata
		if len(resp.Metadata) > 0 {
			if jerr := json.Unmarshal(resp.Metadata, &op); jerr != nil {
				return fmt.Errorf("parse operation %s metadata: %w", operationID, jerr)
			}
		}

		switch op.Status {
		case "Success":
			return nil
		case "Failure", "Cancelled":
			msg := op.Err
			if msg == "" {
				msg = op.Status
			}
			return fmt.Errorf("operation %s failed: %s", operationID, msg)
		case "Running", "Pending", "":
			// 服务端 60s long-poll 超时返回；继续下一轮，由 ctx 决定整体何时放弃。
			continue
		default:
			return fmt.Errorf("operation %s unexpected status %q", operationID, op.Status)
		}
	}
}

// GetClusterMembers returns all cluster members (nodes).
func (c *Client) GetClusterMembers(ctx context.Context) ([]json.RawMessage, error) {
	resp, err := c.APIGet(ctx, "/1.0/cluster/members?recursion=1")
	if err != nil {
		return nil, err
	}
	var members []json.RawMessage
	if err := json.Unmarshal(resp.Metadata, &members); err != nil {
		return nil, fmt.Errorf("parse members: %w", err)
	}
	return members, nil
}

// GetInstances returns all instances in a project.
func (c *Client) GetInstances(ctx context.Context, project string) ([]json.RawMessage, error) {
	path := fmt.Sprintf("/1.0/instances?recursion=2&project=%s", project)
	resp, err := c.APIGet(ctx, path)
	if err != nil {
		return nil, err
	}
	var instances []json.RawMessage
	if err := json.Unmarshal(resp.Metadata, &instances); err != nil {
		return nil, fmt.Errorf("parse instances: %w", err)
	}
	return instances, nil
}

// GetInstance returns a single instance.
func (c *Client) GetInstance(ctx context.Context, project, name string) (json.RawMessage, error) {
	path := fmt.Sprintf("/1.0/instances/%s?project=%s", name, project)
	resp, err := c.APIGet(ctx, path)
	if err != nil {
		return nil, err
	}
	return resp.Metadata, nil
}

// GetInstanceState returns the runtime state of an instance.
func (c *Client) GetInstanceState(ctx context.Context, project, name string) (json.RawMessage, error) {
	path := fmt.Sprintf("/1.0/instances/%s/state?project=%s", name, project)
	resp, err := c.APIGet(ctx, path)
	if err != nil {
		return nil, err
	}
	return resp.Metadata, nil
}

// ExecNonInteractive runs a command inside an instance without WebSocket.
// Returns the operation's return code and any error. On non-zero return or
// wait failure, the command's recorded stdout/stderr references (if provided
// by Incus) are logged to aid debugging. The wait timeout is driven by ctx
// plus the underlying HTTP client timeout; no hard-coded wait cap here.
func (c *Client) ExecNonInteractive(ctx context.Context, project, instance string, command []string) (int, error) {
	body, err := json.Marshal(map[string]any{
		"command":            command,
		"interactive":        false,
		"wait-for-websocket": false,
		"record-output":      true,
	})
	if err != nil {
		return -1, fmt.Errorf("marshal exec body: %w", err)
	}

	path := fmt.Sprintf("/1.0/instances/%s/exec?project=%s", instance, project)
	resp, err := c.APIPost(ctx, path, strings.NewReader(string(body)))
	if err != nil {
		return -1, fmt.Errorf("exec request: %w", err)
	}
	if resp.Type != "async" || resp.Operation == "" {
		return -1, fmt.Errorf("expected async operation, got type=%s", resp.Type)
	}

	parts := strings.Split(resp.Operation, "/")
	opID := parts[len(parts)-1]

	// Rely on ctx + HTTP client timeout for bounding; no hard-coded ?timeout.
	waitResp, err := c.APIGet(ctx, fmt.Sprintf("/1.0/operations/%s/wait", opID))
	if err != nil {
		return -1, fmt.Errorf("wait for exec: %w", err)
	}

	var meta struct {
		Return int `json:"return"`
		Output map[string]string `json:"output"`
	}
	if waitResp.Metadata != nil {
		if err := json.Unmarshal(waitResp.Metadata, &meta); err != nil {
			return -1, fmt.Errorf("decode exec metadata: %w", err)
		}
	}

	if meta.Return != 0 {
		slog.Warn("exec non-zero return",
			"project", project,
			"instance", instance,
			"return", meta.Return,
			"stdout_log", meta.Output["stdout"],
			"stderr_log", meta.Output["stderr"],
		)
	}

	return meta.Return, nil
}
