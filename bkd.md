## BKD 调度执行工作流

### 概述

通过 BKD 看板系统实现多子任务并行调度，结合 Logs Filter 质量评估、pma-cr 代码审核
和分支合并策略，形成从任务拆分到代码合并到人工确认的完整闭环。

支持两种模式：
- **Worktree 模式**：子任务在独立分支中工作，适用于多文件变更、子任务间可能有冲突的场景
- **简单模式**：子任务直接在主分支上工作，适用于修改文件少、子任务间无文件重叠的简单任务

---

### 流程总览

```
检查容量 → 创建调度 Issue → 拆分子任务 → 子任务执行
                                           ↓
                                     子任务自动进入 review
                                     + 向调度 Issue 回报
                                           ↓
                                    Logs Filter 质量评估（逐个，完成即评）
                                           ↓
                                      pma-cr 代码审核
                                           ↓
                                  [Worktree 模式] 代码合并
                                           ↓
                                      合并后构建/测试验证
                                           ↓
                                    调度 Issue → review → done (人工)
```

---

### 1. 前置检查

```bash
# 确认服务可用
curl -s "$BKD_URL/health" | jq

# 检查执行容量
curl -s "$BKD_URL/processes/capacity" | jq
```

- `$BKD_URL` 缺失时必须先向用户索取
- `availableSlots` 为 0 时等待，不强行创建任务
- 每次启动新子任务前重新检查容量

---

### 2. 创建调度 Issue

```bash
ORCH=$(curl -s -X POST "$BKD_URL/projects/{projectId}/issues" \
  -H 'Content-Type: application/json' \
  -d '{"title":"[调度] 任务总标题","statusId":"todo"}')

ORCH_ID=$(echo "$ORCH" | jq -r '.data.id')
```

发送任务详情：

```bash
curl -s -X POST "$BKD_URL/projects/{projectId}/issues/$ORCH_ID/follow-up" \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "## 任务目标\n{完整描述}\n\n## 子任务拆分\n1. {子任务A title} — {验收标准}\n2. {子任务B title} — {验收标准}\n3. {子任务C title} — {验收标准}\n\n## 模式\n{Worktree 模式 | 简单模式}\n\n## 约定\n- 每个子任务完成后必须 follow-up 回报本 Issue\n- 回报内容包括：完成状态、变更文件、关键决策、遇到的问题"
  }' | jq
```

启动调度：

```bash
curl -s -X PATCH "$BKD_URL/projects/{projectId}/issues/$ORCH_ID" \
  -H 'Content-Type: application/json' \
  -d '{"statusId":"working"}' | jq
```

---

### 3. 模式选择

在创建子任务前，根据任务特征选择模式：

| 条件 | 模式 | `useWorktree` |
|------|------|---------------|
| 子任务修改文件多，或子任务间可能有文件重叠 | Worktree 模式 | `true` |
| 子任务修改文件少（≤3 个），且子任务间无文件重叠 | 简单模式 | `false` |
| 需要并行开发同一模块的不同部分 | Worktree 模式 | `true` |
| 独立的小修复、配置变更、文档更新 | 简单模式 | `false` |

**简单模式限制：**
- 子任务间**不得修改相同文件**，否则后执行的子任务会覆盖先完成的修改
- 简单模式下子任务**必须串行执行**（一个完成后再启动下一个），或确保并行子任务无文件重叠
- 如果执行过程中发现文件冲突，应中止并切换到 Worktree 模式

---

### 4. 子任务创建与执行

对每个子任务重复以下流程：

#### 4.1 创建

**Worktree 模式：**

```bash
SUB=$(curl -s -X POST "$BKD_URL/projects/{projectId}/issues" \
  -H 'Content-Type: application/json' \
  -d '{"title":"{子任务标题}","statusId":"todo","useWorktree":true}')

SUB_ID=$(echo "$SUB" | jq -r '.data.id')
```

**简单模式：**

```bash
SUB=$(curl -s -X POST "$BKD_URL/projects/{projectId}/issues" \
  -H 'Content-Type: application/json' \
  -d '{"title":"{子任务标题}","statusId":"todo"}')

SUB_ID=$(echo "$SUB" | jq -r '.data.id')
```

#### 4.2 发送实现详情

follow-up 中**必须**包含完成回报指令：

```bash
curl -s -X POST "$BKD_URL/projects/{projectId}/issues/$SUB_ID/follow-up" \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "## 实现要求\n{详细实现说明}\n\n## 验收标准\n- {标准1}\n- {标准2}\n\n## 完成后必做\n完成后向调度 Issue '$ORCH_ID' 发送 follow-up，内容格式：\n\n```\n子任务 {id} ({title}) 执行完毕\n状态: 成功|失败|部分完成\n变更文件: file1, file2, ...\n关键决策: {说明}\n问题: {如有}\n```"
  }' | jq
```

#### 4.3 触发执行

```bash
# 再次检查容量
curl -s "$BKD_URL/processes/capacity" | jq '.data.availableSlots'

curl -s -X PATCH "$BKD_URL/projects/{projectId}/issues/$SUB_ID" \
  -H 'Content-Type: application/json' \
  -d '{"statusId":"working"}' | jq
```

#### 4.4 监控

```bash
curl -s "$BKD_URL/projects/{projectId}/issues/$SUB_ID/logs?limit=50" | jq
```

---

### 5. 子任务完成回报

子任务执行完毕后：

- **状态变更**：BKD 自动将完成的子任务从 `working` 移入 `review`（内置 `autoMoveToReview` 机制），无需手动操作
- **回报调度 Issue**：子任务向调度 Issue 发送 follow-up

```bash
curl -s -X POST "$BKD_URL/projects/{projectId}/issues/$ORCH_ID/follow-up" \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "子任务 '$SUB_ID' ({title}) 执行完毕。\n状态: 成功\n变更文件: src/foo.ts, src/bar.ts\n关键决策: 采用 XX 方案实现\n问题: 无"
  }' | jq
```

> 调度 Issue 处于 `working` 且空闲时，收到 follow-up 会立即处理；如果调度 Issue 正在执行中，follow-up 会排队等待当前 turn 结束。

---

### 6. 执行质量评估（Logs Filter）

**时机：每个子任务完成回报后立即评估，不等所有子任务完成。** 流水线式处理，先完成的先评估，评估通过的先进入 CR。

使用 filter API 精准拉取所需切片，不拉全量日志。

```
GET /projects/{projectId}/issues/{issueId}/logs/filter/{filter_path}
```

#### Filter 路径语法

| 维度 | 格式 | 示例 |
|------|------|------|
| 条目类型 | `types/{type1,type2}` | `types/tool-use` |
| 单个 turn | `turn/{n}` | `turn/3` |
| turn 范围 | `turn/{start-end}` | `turn/2-5` |
| 最后 turn | `turn/last` | `turn/last` |
| 最后 N turn | `turn/last{N}` | `turn/last3` |
| 组合 | 串联 | `types/tool-use/turn/last3` |

可用 entry types: `user-message` `assistant-message` `tool-use` `system-message` `thinking` `error-message` `token-usage`

#### 6.1 检查错误信号

```bash
curl -s "$BKD_URL/projects/{pid}/issues/{iid}/logs/filter/types/error-message" | jq
```

- 存在 error-message → 黄色信号，需结合后续步骤判断是否已恢复

#### 6.2 检查最终输出

```bash
curl -s "$BKD_URL/projects/{pid}/issues/{iid}/logs/filter/types/assistant-message/turn/last" | jq
```

- 输出与任务目标不匹配 → 红色
- 包含"失败"、"无法完成"、"放弃"等关键词 → 红色

#### 6.3 检查工具调用模式

```bash
curl -s "$BKD_URL/projects/{pid}/issues/{iid}/logs/filter/types/tool-use/turn/last3" | jq
```

- 相同工具 + 相似参数连续 ≥3 次 → 红色（盲目重试）
- 出现 `rm -rf`、`--force`、`git reset --hard` 无合理上下文 → 红色
- `file-edit` kind 涉及任务范围外文件 → 黄色

#### 6.4 检查执行规模

```bash
curl -s "$BKD_URL/projects/{pid}/issues/{iid}/logs/filter/types/user-message?limit=200" \
  | jq '.data | length'
```

- turn 总数超出预估复杂度 2 倍以上 → 黄色

#### 6.5 信号判定

| 信号 | 条件 | 处置 |
|------|------|------|
| 🔴 红色 | 最终输出偏离目标 / 盲目重试 / 危险操作 | 向子任务 follow-up 说明问题，退回 `working` 返工 |
| 🟡 黄色 | 有 error 但已恢复 / turn 过多 / 范围外文件变更 | 向调度 Issue follow-up 汇报，等待人工决策 |
| 🟢 绿色 | 无红黄信号 | 进入 pma-cr 代码审核 |

#### 6.6 评估结果回报

通过：

```bash
curl -s -X POST "$BKD_URL/projects/{pid}/issues/$ORCH_ID/follow-up" \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "子任务 {subIssueId} 质量评估完成。\n结果: 🟢 通过\nturn 数: 8\n错误: 0\n工具调用模式: 正常\n→ 进入 pma-cr 审核"
  }' | jq
```

返工：

```bash
curl -s -X POST "$BKD_URL/projects/{pid}/issues/$SUB_ID/follow-up" \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "质量评估不通过。\n🔴 红色信号: turn/last 输出为「无法安装依赖」，任务未完成。\n要求: 排查根因后重新执行，不要盲目重试。"
  }' | jq

curl -s -X PATCH "$BKD_URL/projects/{pid}/issues/$SUB_ID" \
  -H 'Content-Type: application/json' \
  -d '{"statusId":"working"}' | jq
```

---

### 7. 代码审核（pma-cr）

质量评估通过后，对子任务变更执行代码审核。

#### 7.1 执行审核

```
/pma-cr
```

#### 7.2 审核维度（按优先级）

1. 正确性与回归
2. 安全与信任边界
3. 数据完整性与错误处理
4. 并发、取消与资源生命周期
5. 性能与可扩展性
6. 可维护性与测试

#### 7.3 审核结果处置

- **通过** → 进入步骤 8（代码合并）或步骤 9（简单模式跳过合并，直接最终确认）
- **不通过** → 向子任务 follow-up 说明审核问题，退回 `working` 返工

```bash
# 审核不通过，退回子任务
curl -s -X POST "$BKD_URL/projects/{pid}/issues/$SUB_ID/follow-up" \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "pma-cr 审核不通过。\n问题:\n- P0: src/auth.ts:42 SQL 注入风险，用户输入未参数化\n- P1: src/api.ts:88 缺少错误处理\n要求: 修复以上问题后重新提交。"
  }' | jq

curl -s -X PATCH "$BKD_URL/projects/{pid}/issues/$SUB_ID" \
  -H 'Content-Type: application/json' \
  -d '{"statusId":"working"}' | jq
```

返工后重新从**步骤 5（回报）**开始流转。

---

### 8. 代码合并（仅 Worktree 模式）

> **简单模式跳过本步骤**，子任务直接在主分支上工作，无需合并。直接进入步骤 9。

子任务通过质量评估 + 代码审核后，将 worktree 分支合并到主分支。

#### 8.1 分支架构

**调度 Issue 始终在主分支上工作**，不使用 worktree。子任务使用 worktree 在独立分支中工作：

```
主分支 (main/master)          ← 调度 Issue 运行位置
  ├── bkd/{subIssueId-1}     ← 子任务 1 worktree 分支
  ├── bkd/{subIssueId-2}     ← 子任务 2 worktree 分支
  └── bkd/{subIssueId-3}     ← 子任务 3 worktree 分支
```

BKD 自动为 `useWorktree: true` 的子任务创建分支 `bkd/{issueId}`。

worktree 路径：`<WORKTREE_BASE>/<projectId>/<issueId>/`

基准分支优先级：`origin/main` > `origin/master` > `main` > `master`

#### 8.2 合并前处理主分支状态

由于调度 Issue 在主分支上运行，合并时主分支上**通常存在调度 Issue 产生的未提交修改**（如调度逻辑、配置变更、文档更新等）。合并前必须先处理。

```bash
cd {project_directory}

# 检查主分支工作区状态
git status --porcelain
```

**主分支有未提交修改时的处理流程：**

```bash
# Step 1: 检查调度 Issue 的修改与子任务变更是否有文件重叠
# 查看子任务变更文件
curl -s "$BKD_URL/projects/{pid}/issues/$SUB_ID/changes" | jq '.data[].path'

# 对比主分支未提交修改
git diff --name-only
git diff --cached --name-only
```

```bash
# Step 2: 根据重叠情况选择方案

# 方案 A：无文件重叠（常见场景）
# 调度 Issue 的修改先提交，再合并子任务分支
git add -A
git commit -m "feat: {调度 Issue 本轮工作描述}"
# 然后执行 8.3 合并策略

# 方案 B：有文件重叠
# 调度 Issue 的修改暂存，合并子任务后再恢复并手动解决冲突
git stash push -m "orchestrator work before merge bkd/{subIssueId}"
# 执行 8.3 合并策略
# 合并完成后恢复
git stash pop
# 解决冲突（如有）→ git add → git commit
```

**规则：主分支工作区不干净时禁止执行 merge。** 必须先 commit 或 stash，否则合并会失败或污染变更。

#### 8.3 合并策略

根据子任务间的文件重叠情况选择策略：

**策略 A：无冲突，逐个合并（默认）**

子任务间变更文件无重叠时，每个子任务通过审核后立即合并（流水线式）：

```bash
cd {project_directory}
git fetch origin

# 对每个通过审核的子任务，通过一个合并一个
git merge bkd/{subIssueId} --no-ff -m "merge: {子任务标题} (bkd/{subIssueId})"
```

**策略 B：有重叠，顺序合并 + 冲突解决**

子任务间变更文件有重叠时，按依赖顺序合并，每次合并后解决冲突：

```bash
# 先合并基础子任务
git merge bkd/{baseSubIssueId} --no-ff -m "merge: {基础子任务标题}"

# 再合并依赖子任务，手动解决冲突
git merge bkd/{dependentSubIssueId} --no-ff
# 如有冲突：解决 → git add → git commit
```

**策略 C：统一集成分支**

大量子任务或复杂依赖时，先创建集成分支：

```bash
# 记录合并前的 commit，用于后续验证
MERGE_BASE=$(git rev-parse HEAD)

git checkout -b integrate/{orchestratorId} main

# 按顺序合并所有子任务
for SUB_BRANCH in bkd/{sub1} bkd/{sub2} bkd/{sub3}; do
  git merge $SUB_BRANCH --no-ff
  # 解决冲突（如有）
done

# 集成分支测试通过后，合并回主分支
git checkout main
git merge integrate/{orchestratorId} --no-ff -m "merge: {调度任务标题}"
```

#### 8.4 合并后验证

```bash
# 查看本轮合并引入的全部变更
git diff ${MERGE_BASE}..HEAD --stat

# 构建验证
npm run build  # 或项目对应的构建命令

# 测试验证
npm run test
```

> 策略 A/B 中 `MERGE_BASE` 为合并前最后一次 commit 的 hash，需在合并前记录：
> `MERGE_BASE=$(git rev-parse HEAD)`

#### 8.5 合并失败处置

- **冲突无法自动解决** → 先 `git merge --abort` 回滚到合并前状态，再向调度 Issue follow-up 汇报，等待人工介入
- **构建/测试不通过** → 用 `git revert -m 1 HEAD` 回滚合并 commit，向相关子任务 follow-up 说明问题，退回 `working` 返工

```bash
# 合并冲突时回滚
git merge --abort

# 合并成功但验证失败时回滚
git revert -m 1 HEAD --no-edit
```

返工的子任务需要基于当前主分支 rebase 后重新执行：

```bash
# 向子任务发送返工指令
curl -s -X POST "$BKD_URL/projects/{pid}/issues/$SUB_ID/follow-up" \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "合并后构建失败，已回滚。\n错误: {构建/测试错误信息}\n要求: 基于最新主分支修复问题后重新提交。"
  }' | jq

curl -s -X PATCH "$BKD_URL/projects/{pid}/issues/$SUB_ID" \
  -H 'Content-Type: application/json' \
  -d '{"statusId":"working"}' | jq
```

#### 8.6 Worktree 清理

合并完成后无需手动清理 worktree。BKD 内置清理机制：
- Issue 进入 `done` 状态 **1 天后**自动清理对应 worktree
- 清理周期：每 30 分钟检查一次
- 开关：`worktree:autoCleanup` 应用设置
- 如需提前清理：
  ```bash
  curl -s -X DELETE "$BKD_URL/projects/{pid}/worktrees/{subIssueId}" | jq
  ```

---

### 9. 最终确认

所有子任务通过质量评估 + 代码审核（+ Worktree 模式下的代码合并和验证）后：

```bash
# 调度 Issue 移入 review
curl -s -X PATCH "$BKD_URL/projects/{pid}/issues/$ORCH_ID" \
  -H 'Content-Type: application/json' \
  -d '{"statusId":"review"}' | jq
```

人工确认后统一关闭：

```bash
# 调度 Issue 和所有子任务移入 done
curl -s -X PATCH "$BKD_URL/projects/{pid}/issues/$ORCH_ID" \
  -H 'Content-Type: application/json' \
  -d '{"statusId":"done"}' | jq

curl -s -X PATCH "$BKD_URL/projects/{pid}/issues/$SUB_ID" \
  -H 'Content-Type: application/json' \
  -d '{"statusId":"done"}' | jq
```

---

### 状态流转

#### Worktree 模式

```
调度 Issue:  todo → working → (等待子任务) → 合并分支 → review → done (人工确认)

子任务:      todo → working → review (自动)
                               ↓
                         Logs Filter 质量评估（完成即评）
                          ↙    ↓       ↘
                     🔴退回   🟡人工    🟢通过
                    working   决策       ↓
                                    pma-cr 审核
                                     ↙       ↘
                                 不通过      通过
                                   ↓          ↓
                              退回 working    ↓
                                              ↓
                                    合并 bkd/{issueId} 分支
                                     ↙       ↘
                                 冲突/失败    合并成功
                                   ↓          ↓
                              merge --abort   构建/测试验证
                              + 人工介入       ↙       ↘
                                          失败      通过
                                           ↓          ↓
                                    revert + 退回   → done (随调度 Issue)
                                       working
```

#### 简单模式

```
调度 Issue:  todo → working → (等待子任务) → review → done (人工确认)

子任务:      todo → working → review (自动)
                               ↓
                         Logs Filter 质量评估（完成即评）
                          ↙    ↓       ↘
                     🔴退回   🟡人工    🟢通过
                    working   决策       ↓
                                    pma-cr 审核
                                     ↙       ↘
                                 不通过      通过
                                   ↓          ↓
                              退回 working   → done (随调度 Issue)
```

---

### 关键约束

1. **不用 `/execute`** — 始终通过状态移动到 `working` 触发执行
2. **follow-up 队列机制** — 发给 `todo` 或 `done` 状态 Issue 的 follow-up 会排队，不立即执行；`working` 且空闲时立即处理
3. **回报指令必写** — 子任务 follow-up 详情中必须包含完成回报指令
4. **容量先行** — 每次启动新子任务前检查 `/processes/capacity`
5. **autoMoveToReview** — 子任务完成后 BKD 自动移入 `review`，不要手动操作状态
6. **流水线式评估** — 每个子任务完成后立即评估质量 + CR，不等所有子任务完成
7. **质量评估先于代码审核** — Logs Filter 是 pma-cr 的预筛，不合格的直接打回，不浪费审核成本
8. **pma-cr 只审增量** — 只审核本轮变更引入的问题，不追溯历史债务
9. **合并前必须通过审核** — 只有质量评估 + pma-cr 双重通过的子任务才能合并分支（Worktree 模式）
10. **合并用 `--no-ff`** — 保留分支历史，便于追溯每个子任务的变更
11. **合并前记录 `MERGE_BASE`** — 合并前 `git rev-parse HEAD`，用于合并后 diff 验证
12. **合并失败先回滚** — 冲突用 `merge --abort`，验证失败用 `revert -m 1`，不要在脏状态上继续操作
13. **简单模式串行约束** — 简单模式下子任务必须串行执行或确保无文件重叠，否则切换 Worktree 模式
14. **分支命名固定** — 子任务分支为 `bkd/{issueId}`，集成分支为 `integrate/{orchestratorId}`
15. **不手动清理 worktree** — BKD 在 `done` 状态 1 天后自动清理，除非需要提前释放空间
16. **review 不等于 done** — `review` 等待人工确认，只有人工确认后才移入 `done`
17. **软删除** — 项目和 Issue 的删除默认是软删除
