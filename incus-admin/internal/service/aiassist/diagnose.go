package aiassist

import (
	"context"
	"encoding/json"
	"fmt"
)

// PLAN-038 / OPS-041 Phase C Tier 3 — LLM 失败诊断。
//
// 触发：cluster.node.add job 终态 failed 时，前端 JobProgress 失败卡片下方
// 出现折叠"AI 诊断"按钮。运维点击才调（非自动），避免每次失败都付费。

// DiagnoseInput Tier 3 输入。
type DiagnoseInput struct {
	StepFailed       string `json:"step_failed"`        // 例 "network_config" / "join_ceph"
	LastStderrLines  string `json:"last_stderr_lines"`  // 最后 ~200 行（已脱敏）
	NodeOSReleaseID  string `json:"node_os_release_id"` // ubuntu / debian
	NodeOSVersionID  string `json:"node_os_version_id"` // 24.04
	IncusVersion     string `json:"incus_version,omitempty"`
}

const diagnoseSystemPrompt = `你是 Linux 集群运维诊断助手。给定一段 join-node.sh 的失败日志（已脱敏），
判断根因并给出修复建议。

推理步骤（按 TerraShark 2026 模式严格遵守）：
1. 分类失败属于哪类：auth / network / apt_lock / netplan_revert /
   ceph_osd_prepare / fingerprint_mismatch / disk_busy / kernel_module /
   timeout / config_conflict / unknown
2. 写一句话根因（< 200 字）
3. 给出 3-5 步修复建议，每步可附 command_template（运维参考用，不会自动执行）
4. 判断是否安全自动重试：仅 apt_lock / 临时网络抖动 / 偶发 timeout 可设 true，
   其余一律 false
5. 列出"requires_manual"：需运维登机手工做的步骤

输出严格符合提供的 JSON schema。不要写任何额外文本。`

const diagnoseSchema = `{
  "type": "object",
  "required": ["category", "root_cause", "suggested_fix_steps", "safe_to_auto_retry", "requires_manual"],
  "properties": {
    "category": {"type": "string", "enum": [
      "auth", "network", "apt_lock", "netplan_revert", "ceph_osd_prepare",
      "fingerprint_mismatch", "disk_busy", "kernel_module", "timeout",
      "config_conflict", "unknown"
    ]},
    "root_cause": {"type": "string", "maxLength": 200},
    "suggested_fix_steps": {
      "type": "array",
      "maxItems": 5,
      "items": {
        "type": "object",
        "required": ["step"],
        "properties": {
          "step": {"type": "string", "maxLength": 200},
          "command_template": {"type": "string", "maxLength": 200}
        }
      }
    },
    "safe_to_auto_retry": {"type": "boolean"},
    "requires_manual": {"type": "string", "maxLength": 300}
  }
}`

// DiagnoseResponse 解析 LLM JSON。
type DiagnoseResponse struct {
	Category         string         `json:"category"`
	RootCause        string         `json:"root_cause"`
	SuggestedFixSteps []DiagnoseStep `json:"suggested_fix_steps"`
	SafeToAutoRetry  bool           `json:"safe_to_auto_retry"`
	RequiresManual   string         `json:"requires_manual"`
}

type DiagnoseStep struct {
	Step             string `json:"step"`
	CommandTemplate  string `json:"command_template,omitempty"`
}

// Diagnose 调 provider 拿失败诊断。stderr 必须已脱敏（建议调 RedactString）。
func Diagnose(ctx context.Context, p Provider, input DiagnoseInput) (*DiagnoseResponse, *Suggestion, error) {
	if p == nil {
		return nil, nil, ErrAIDisabled
	}
	// 防 prompt 超长：截断 stderr 到 ~200 行（每行 ≤ 200 char ≈ 40KB）
	if len(input.LastStderrLines) > 40_000 {
		input.LastStderrLines = input.LastStderrLines[len(input.LastStderrLines)-40_000:]
	}
	userJSON, err := json.Marshal(input)
	if err != nil {
		return nil, nil, fmt.Errorf("marshal input: %w", err)
	}
	sug, err := p.Suggest(ctx, diagnoseSystemPrompt, userJSON, []byte(diagnoseSchema))
	if err != nil {
		return nil, nil, err
	}
	var resp DiagnoseResponse
	if err := json.Unmarshal(sug.JSON, &resp); err != nil {
		return nil, sug, fmt.Errorf("%w: %v", ErrAISchemaInvalid, err)
	}
	return &resp, sug, nil
}
