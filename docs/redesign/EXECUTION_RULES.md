# 记忆隔离契约（监督 / 执行 / 子代理 三层）

违反本文件的任何一条，任务视为未完成——因为污染上下文会让后面的轮次全错。

## 1. 三层的可读 / 可写范围

| 层 | 谁 | 可以读 | 只能写 | 绝对不读 |
|---|---|---|---|---|
| **监督层** | 日课插件 + 跟踪 Issue | GitHub Issue/PR 状态、`ledger.jsonl`、本目录的 PLAN | `~/.dsh/state/daily-loop/loops.json`（插件自动）、Issue 评论 | 源码、规范全文、实现细节 |
| **执行层** | 每次唤醒的主会话 | `AGENTS.md`、`PLAN.md`、`TASKS.yaml` 的**当前一条**、这条的 `spec_refs` 行区间、`docs/PRODUCT_SCOPE.md` | 代码、`notes/<phase>.md`、`ledger.jsonl` 追加一行、分支与 PR | 其它阶段的 spec 章节、其它阶段的 notes |
| **子代理层** | 每次派发一个 | 任务卡（下方模板）里的路径与行区间 | 它自己 worktree 里的文件、`notes/<phase>.md` 里属于它的那一节 | `ledger.jsonl`、其它子代理的输出、评审意见 |

## 2. 文件即记忆（唯一的跨层通道）

```
docs/redesign/
  PLAN.md                 # 不变的东西：北极星 + 硬门 + 止损
  TASKS.yaml              # 做什么、按什么顺序、读哪几行规范
  EXECUTION_RULES.md      # 本文件：谁能读什么
  ledger.jsonl            # 发生了什么：一轮一行，只记结果，不记过程
  notes/<phase>.md        # 细节沉淀：决策、坑、命令、失败原因
  spec/…                  # 规范冻结副本（行号稳定）
```

- **ledger 只写结论**：`{at, phase, round, verdict, gates:{...}, score, note, pr}`。
- **notes 只写以后还要用的东西**：踩过的坑、为何这样改、验证命令。不写"我认为"。
- 上下文可以丢；这四个文件不能丢。

## 3. 一次唤醒 = 一条新 goal

唤醒任务书（`【日课】…`）已经在插件里写死流程。执行层必须：

1. 只取 `TASKS.yaml` 里**第一个 `status: todo`** 的阶段；
2. 只读它 `spec_refs` 列出的行区间（用 `sed -n 'A,Bp'`，不要 `cat` 整份）；
3. 建 goal：`objective = 该阶段 done 的第一条`，`max_goal_rounds = 8`；
4. 收工必须 append 一行 ledger，并把 `TASKS.yaml` 里该阶段 `status` 改成 `doing`/`done`。

## 4. worktree 规则（防并行互踩）

- 一个阶段一个 worktree：`git worktree add ../whale-P0 -b redesign/P0`。
- 同一分支同一时间**只有一个写入者**；执行层与子代理不得共享工作目录。
- 子代理只放行「本任务允许改的路径」，其余路径它无权写；发现需要跨文件改动时，回来在 notes 里登记，由执行层统一改。

## 5. 子代理任务卡（复制即用）

```
[TASK] <phase>-<n>  <一句目标>
[SPEC] docs/redesign/spec/WhalePartner_UI重设计规范.md 第 <A>-<B> 行（只读这一段）
[READ] <允许读的现有文件清单>
[WRITE] <允许改的路径清单；其它一律不许动>
[RULE] 遵守仓库 AGENTS.md；不改 §0.2 十二条核心决定；不新增依赖除非规范 §10.2 已列
[OUT]  ≤15 行：改了什么 / 改了哪些文件 / 怎么验证（命令+结果）/ 还差什么 / 风险
```

子代理**不得**输出完整 diff、不得复述规范、不得贴大段日志——执行层只消费那 15 行。

## 6. 视觉评审 Agent 的隔离

- 固定 Codex：`model: gpt-6-luna`，`config: {"model_reasoning_effort":"max"}`，**每个阶段新开 thread**。
- 输入只有：§12.1 截图矩阵、`metrics.json`、§12.5 的 16 问、§12.6 的评分表。
- 不给：需求描述、实现说明、对话历史、代码。
- 输出：逐条问题（blocker/major/minor）+ 六维评分（每分引用截图文件名）。

## 7. 反污染红线（见到即停）

1. 执行层把规范全文或其它阶段章节读进上下文；
2. 子代理读 `ledger.jsonl` 或别的子代理输出；
3. 评审 Agent 拿到实现说明或代码；
4. 两个写入者同时改同一分支/同一工作目录；
5. 用「改验收口径」让检查变绿；
6. 把进度写进 PLAN.md 而不是 ledger/Issue。
