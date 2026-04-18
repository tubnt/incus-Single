# PLAN-017 QA-006 用户端 E2E N1-N11 修复

- **status**: done
- **priority**: P1
- **owner**: claude
- **createdAt**: 2026-04-18 21:20
- **completedAt**: 2026-04-18 21:30
- **relatedTask**: QA-006

## Context

QA-006 在生产 `vmc.5ok.co` 执行用户端全量 E2E 后发现 N1-N11 真实 bug(外加 G1-G5 功能缺口列入 backlog)。本计划收敛 N1-N11,一次性部署。

## Decisions

- **缓存 key 路径维度化**:portal/admin 使用不同 React Query key 前缀,但同一 VM 的 mutation(start/stop/restart/snapshot delete)需要同时 invalidate portal key 与 admin key,避免 stale。
- **Console Back 链路由感知**:复用 UX-002 已建立的「perspective」概念(`location.pathname.startsWith('/admin')` → admin);console 页 entry 携带 `from` 参数时优先使用,否则按 perspective 默认。
- **i18n 补齐**:N5-N10 全部走 `t()`,不走硬编码。locales/zh 与 en 同步。
- **Reset Password 复制按钮**:toast 内置 `navigator.clipboard.writeText` 触发,失败回退 `document.execCommand('copy')`。

## Phases

### Phase A — 缓存/路由修复(N1-N4)

- [x] **N3 改走后端根因**:portal/admin `VMAction`/`ChangeVMState` 成功后 `vmRepo.UpdateStatus` 同步 DB,彻底消除 stale(PLAN-014 反向同步 worker 未完成的替代路径)
- [x] **N4 后端修复**:`snapshot.go` Delete handler 增加 `WaitForOperation` 处理 Incus 异步 op,对齐 Create/Restore 写法
- [x] `app/routes/console.tsx` + 4 个调用端:统一通过 URL `?from=admin|portal` 判定 Back 链,缺省按用户角色回退
- [x] `features/monitoring/vm-metrics-panel.tsx`:loading/error/empty/标签全部 `t()` 化(`vm.memory` `vm.disk` `vm.network` + `monitoring.*`)

### Phase B — i18n 补齐(N5-N10)

- [x] `ssh-keys.tsx`:`sshKey.addedAt` → `sshKey.createdAt`(对齐 locale)
- [x] `api-tokens.tsx`:locale 的 `apiToken.create` 剥离 `+ ` 前缀消除双 `+`;code 对齐 `submit/submitting/lastUsedAt`
- [x] `app-header.tsx`:title 改为 `topbar.language` `topbar.logout` `topbar.theme.{dark,light,system}`
- [x] `public/locales/{zh,en}/common.json`:新增 `topbar.*` / `apiToken.createdSaveNow`

### Phase C — UX 润色(N11)

- [x] `app/routes/vm-detail.tsx`:`toast.success` 的 `action` 槽接入 navigator.clipboard 复制密码,locale 新增 `vm.passwordCopy/Copied/CopyFailed`

### Phase D — Verification

- [x] `bun run typecheck` 通过
- [x] `bun run build` 通过
- [x] 生产部署到 139.162.24.177 并 restart incus-admin

### Phase E — Docs

- [x] 关闭 QA-006 + PLAN-017(本次提交)

## Non-goals

- 不做 G1-G5 功能缺口(另立计划)
- 不触碰后端/数据库
