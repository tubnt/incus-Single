package sshexec

import (
	"embed"
	"io/fs"
)

// embeddedFS 携带集群运维脚本进二进制。canonical 副本在 repo 根 `cluster/`，
// 这里是用于 admin 服务运行时通过 SSH 推送到目标节点的镜像。修改 canonical
// 后需手工 cp 同步过来（或用 Taskfile cluster-sync 自动化）。
//
// 同时携带 cluster-env.sh —— join-node.sh 内 `source ../configs/cluster-env.sh`
// 的相对路径假设保留，所以远端解压时也按原结构 scripts/ + configs/ 展开。
//
//go:embed embedded/scripts/*.sh embedded/configs/*.sh
var embeddedFS embed.FS

// EmbeddedScripts 把 embedded/ 子树暴露成 fs.FS，供 executor 遍历 + 上传。
func EmbeddedScripts() fs.FS {
	sub, err := fs.Sub(embeddedFS, "embedded")
	if err != nil {
		// embed.FS 已知子目录结构，理论上不会失败；fail-fast
		panic("embedded scripts FS broken: " + err.Error())
	}
	return sub
}

// ScriptBytes 按文件名（不含路径，例如 "join-node.sh"）从 scripts/ 取内容。
// 文件不存在返回 fs.ErrNotExist。
func ScriptBytes(name string) ([]byte, error) {
	return fs.ReadFile(embeddedFS, "embedded/scripts/"+name)
}

// ConfigBytes 同上，从 configs/ 取。
func ConfigBytes(name string) ([]byte, error) {
	return fs.ReadFile(embeddedFS, "embedded/configs/"+name)
}
