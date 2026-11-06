# WhalePartner UI 重设计 · 执行计划（北极星与硬门）

> 本文件是**唯一的计划来源**。规范正文在 `docs/redesign/spec/WhalePartner_UI重设计规范.md`（冻结副本，行号稳定）。
> 任何会话不得把规范全文读进上下文；按 `TASKS.yaml` 里每条的 `spec_refs` 行区间读。

## 北极星

把 `apps/client` 按规范从「冷淡的后台工具」变成「潮汐手帐 2.0 · 海边绘本日记」，
并补齐 `apps/api` 的后端能力，最终让 **§12 全部验收**通过：

```
P0 tokens/纹理 → P-B 后端 → P1 聊天 → P2 日记+记忆 → P3 设置/引导/老人模式 → P4 打磨 → P5 自主冲浪
```

顺序不可调换：P2/P3/P5 依赖 P-B；P1 的昵称问候依赖 B5。

## 硬门（任一不满足 = 该阶段未完成）

| 门 | 内容 | 判定方式 |
|---|---|---|
| **G1** | §10.4 该阶段「完成定义」逐条满足 | 对照 `TASKS.yaml.done` 每一条，逐条 yes/no |
| **G2** | §12.3 量化阈值全绿 | `scripts/redesign/check.mjs`（P0 产出）+ grep 闸 |
| **G3** | §12.5「AI 味」16 问全为「否」 | 评审 Agent 逐条作答，任一「是」即不通过 |
| **G4** | §12.6 六维评分全部 ≥4 | 视觉评审 Agent 依截图打分，每分必须引用截图文件名 |
| **G5** | 每阶段迭代 ≤5 轮 | 超过则写「差距报告」进 PR 与 Issue，直接进下一阶段，不凑分 |

**G4 的评审者不得是实现者**：固定使用 Codex（`mcp__codex__codex`，`gpt-6-luna`，`model_reasoning_effort: max`），
只给截图 + `metrics.json`，不给实现说明，不给对话历史。

## 止损

- 同一检查项连续 **3 轮**不过 → 记为 blocker 写进 Issue 与 PR，该项暂挂，继续其余项；不允许靠改判分口径「过门」。
- 阶段超预算（§10.4 估算 ×2）仍不过 G1 → 出差距报告，进下一阶段。
- 出现「改规范」的提案一律拒绝：§0.2 十二条核心决定 Agent 不得擅改。

## 记忆边界

三层互不读对方的上下文，只通过文件交接。完整契约见 `docs/redesign/EXECUTION_RULES.md`：

```
监督层（日课插件 + 跟踪 Issue）
   └─ 只读 GitHub 状态 + ledger.jsonl；不读源码，不写代码
执行层（每次唤醒一条新 goal）
   └─ 只读：AGENTS.md / 本文件 / TASKS.yaml 当前一条 / 该条 spec_refs 行区间
   └─ 只写：自己 worktree 里的代码、notes/<phase>.md、ledger.jsonl 一行、PR
子代理层（每任务一个，生命周期 = 一次工具调用）
   └─ 输入：任务 ID + spec 行区间 + 允许改的路径 + 输出契约
   └─ 输出：≤15 行摘要（改了什么 / 改了哪些文件 / 怎么验证的 / 还差什么）
```

## 当前状态

见 `docs/redesign/ledger.jsonl`（一行一轮）与各阶段的 GitHub Issue。
不要在本文件里记进度——进度只属于 ledger 和 Issue。

## 收尾：合并与发版（开发者于 2026-11-07 明确授权）

全部阶段收尾后按此执行，顺序不跳：

1. 每个阶段 PR 的 G1–G5 全绿；未绿的写差距报告并在 PR 说明。
2. 按阶段顺序合并 PR（P0 → P-B → P1 → P2 → P3 → P4 → P5），合并前确认 `pnpm --dir apps/client build` 与 `pnpm --dir apps/api test` 仍绿。
3. 版本号：`apps/client/package.json` 与 `apps/client/src-tauri/tauri.conf.json` 同步 `0.1.0 → 0.2.0`。
4. 更新 `docs/DESIGN.md`（与实现一致）与 `CHANGELOG`（若无则新建，按阶段列）。
5. 打 tag `v0.2.0` 并 `gh release create v0.2.0 --generate-notes`，标题「潮汐手帐 2.0 · 海边绘本日记」。
6. 关闭跟踪 Issue #42 与各阶段 Issue。

> 仓库 `AGENTS.md` 默认禁止 Agent 自行合并与发布；本节是开发者对**本任务**的明确授权记录，仅对上述 7 个 PR 与一次 `v0.2.0` 发布有效。
