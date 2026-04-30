package jobs

import "testing"

// TestJoinNodeStepRe 锁定 join-node.sh 段落 marker 的正则解析。脚本一旦改输出
// 格式（颜色、前后空格），这里会立刻失败提醒同步 executor。
func TestJoinNodeStepRe(t *testing.T) {
	cases := []struct {
		line     string
		wantSec  int
		wantName string
	}{
		{"\n====== 步骤 1/7: 前置检查 ======", 1, "前置检查"},
		{"====== 步骤 4/7: 加入 Incus 集群 ======", 4, "加入 Incus 集群"},
		{"random output line", -1, ""},
	}
	for _, c := range cases {
		m := joinNodeStepRe.FindStringSubmatch(c.line)
		if c.wantSec < 0 {
			if m != nil {
				t.Errorf("line %q matched unexpectedly: %v", c.line, m)
			}
			continue
		}
		if m == nil {
			t.Errorf("line %q did not match", c.line)
			continue
		}
		if got := parseSection(m[1]); got != c.wantSec {
			t.Errorf("line %q section=%d, want %d", c.line, got, c.wantSec)
		}
		if got := m[2]; got != c.wantName {
			t.Errorf("line %q name=%q, want %q", c.line, got, c.wantName)
		}
		// 段落 → seq 映射回环验证
		seq, _ := addNodeStepBySection(c.wantSec)
		if seq < 2 || seq > 8 {
			t.Errorf("section %d → seq %d out of [2,8] range", c.wantSec, seq)
		}
	}
}

func TestRemoveNodeStepRe(t *testing.T) {
	cases := []struct {
		line    string
		wantSec int
	}{
		// scale-node.sh 实际带 ANSI 颜色码，executor 内已 stripANSI 后再 match
		{"[STEP] 1/7 安全检查", 1},
		{"[STEP] 7/7 发送通知", 7},
		{"[INFO] 集群节点数: 3", -1},
	}
	for _, c := range cases {
		m := removeNodeStepRe.FindStringSubmatch(c.line)
		if c.wantSec < 0 {
			if m != nil {
				t.Errorf("line %q matched unexpectedly: %v", c.line, m)
			}
			continue
		}
		if m == nil {
			t.Errorf("line %q did not match", c.line)
			continue
		}
		if got := parseSection(m[1]); got != c.wantSec {
			t.Errorf("line %q section=%d, want %d", c.line, got, c.wantSec)
		}
		seq, _ := removeNodeStepBySection(c.wantSec)
		if seq < 0 || seq > 6 {
			t.Errorf("section %d → seq %d out of [0,6] range", c.wantSec, seq)
		}
	}
}

func TestStripANSI(t *testing.T) {
	cases := []struct{ in, want string }{
		{"\x1b[0;36m[STEP]\x1b[0m 3/7 疏散 VM", "[STEP] 3/7 疏散 VM"},
		{"plain text", "plain text"},
		{"\x1b[31mERROR\x1b[0m: foo", "ERROR: foo"},
	}
	for _, c := range cases {
		if got := ansiRe.ReplaceAllString(c.in, ""); got != c.want {
			t.Errorf("strip(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
