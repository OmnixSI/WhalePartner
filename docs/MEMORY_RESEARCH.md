# 记忆检索优化研究与验证

本记录对应 GitHub Issue [#37](https://github.com/OmnixSI/WhalePartner/issues/37)。优化以现有 SQLite、FTS5、Mem0 向量检索和可恢复任务为基础，没有另建记忆服务或客户端。

## DeepSeek SuperAgent 参考

研究对象为 DeepSeek 官方公开仓库 [`dsh-superagent-prototype`](https://github.com/deepseek-ai/dsh-superagent-prototype)，审阅版本为提交 [`8c32a9d`](https://github.com/deepseek-ai/dsh-superagent-prototype/commit/8c32a9dc5d72c033816c6a8110b37f40cf94fba4)，提交日期 2026-10-31。仓库采用 MIT 许可证。阅读了 README、设计文档 `docs/000-philosophy.md`、`001-domain.md`、`002-authorization.md`、`003-execution.md`、`004-prompts.md`、`007-architecture.md`，以及 `src/app/store.ts`、`src/app/store-read.ts`、`src/app/context.ts`、`src/app/versions.ts`、`src/core/memory.ts` 和 `src/core/tickets.ts`。

这是编码 Agent 的研究原型。它没有实现数字伴侣的用户事实版本、共同经历或情景记忆；README 也明确区分公开原型与内部系统。因此仅采纳与当前代码吻合的工程原则，没有复制源码。

| 上游依据 | 观察到的设计 | WhalePartner 中的处理 |
|---|---|---|
| [`001-domain.md`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/docs/001-domain.md)、[`tickets.ts`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/core/tickets.ts) | 事件以稳定标识去重，重复触发不会重复建立工作项。 | 延续 `memory_experiences.source_id` 唯一约束和已有 upsert；没有增加第二套去重键或写入路径。 |
| [`003-execution.md`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/docs/003-execution.md)、[`memory.ts`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/core/memory.ts) | 会话状态与持久状态分开；后台工作可记录并恢复。 | 继续使用 WhalePartner 的 SQLite `memory_jobs`、经历索引状态与启动恢复；本次没有另加任务框架。 |
| [`007-architecture.md`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/docs/007-architecture.md)、[`store-read.ts`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/store-read.ts) | 持久资料保留在存储层，运行上下文按需读取。 | 普通聊天不再枚举最近 500 条向量记忆；相关学习由现有 FTS5 / Mem0 搜索提供，近期经历优先读取角色范围内的 SQLite 记录。 |
| [`004-prompts.md`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/docs/004-prompts.md)、[`versions.ts`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/versions.ts)、[`context.ts`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/context.ts) | 提示资料有版本，运行上下文受控组装。 | 保留 WhalePartner 已有的人格 Markdown、上下文预算和来源分区；本次没有引入新的提示词管理器或版本框架。 |

## WhalePartner 改动

- `recallChatMemory` 不再在每轮调用 `memory.recentLearnings(4)`。Mem0 适配器原先会执行 `getAll({ topK: 500 })`、映射并按时间排序；现在只有 FTS5 或语义检索命中的学习记录进入上下文，并以外部内容标记、日期和来源 ID 呈现。
- 用户询问近期共同经历时，优先使用 SQLite 经历档案。只有当前角色没有近期归档经历时，才保留旧向量库最近经历回退；命中向量的归档记录会再验证会话角色范围。
- 后台反思优先从 SQLite 读取角色范围内的最近学习记录；已有档案为空时保留向量列表回退，以兼容早期数据。
- 用 `memory_experiences_kind_created_id(kind, created_at DESC, id DESC)` 支持最新记录顺序。打开既有数据库时创建新索引并移除旧的 `memory_experiences_kind_created`；迁移测试确认经历正文和来源数据保留。
- 角色隔离测试发现：语义搜索使用全局本地用户 ID，而归档视频在旧的向量结果分支没有核对会话角色。现已通过现有归档来源规则检查向量命中，不改变会话删除和共享来源的清理流程。
- 没有增加 C/C++。热点在多余列表读取、SQLite 排序和上下文装配；现有 SQLite 已由原生代码执行，实测的最新记录查询低于 0.15 ms。新增跨语言边界没有测得收益依据。

## 隔离基准

脚本 `apps/api/scripts/memory-recall-profile.mjs` 使用 Node 26.13、`:memory:` SQLite、合成记忆与假向量适配器；不读取主数据库、不写入 `MEMORY_DIR`、不调用模型提供方。基准模拟旧 Mem0 列表路径的 500 条上限和 JavaScript 排序，不包括实际 Mem0 存储 I/O。每次运行 50 次预热和 500 个热态样本；冷请求是在 `ChatStore` 建好后的首个召回请求，不含进程启动和模型加载。

| 指标 | 旧路径模拟 | 当前路径 | 条件 |
|---|---:|---:|---|
| 普通聊天每轮最近学习列表 | 1 次，500 条 | 0 次 | 500 次测量加 50 次预热；两次独立运行均如此 |
| 本地召回与上下文装配 p50 | 0.274 ms | 0.237–0.240 ms | 两次运行，每次 500 个样本 |
| 本地召回与上下文装配 p95 | 0.310–0.326 ms | 0.270–0.275 ms | 两次运行，每次 500 个样本 |
| 本地 token 估算 | 297 | 43 | 普通聊天合成提示；旧路径带入 4 条无关近期学习 |
| 角色范围最近学习查询 | — | p50 0.127 ms；p95 0.138–0.140 ms | 10,000 条合成归档，返回 4 条 |

同一 10,000 条 SQLite 查询在增加复合排序索引前 p50 为 7.368 ms、p95 为 7.656 ms，并使用临时 B-tree 排序；索引升级后查询计划使用 `memory_experiences_kind_created_id`，不再出现临时排序。两次独立运行将旧路径和当前路径分别排在首位，首次召回请求观察值为旧路径 16.7 ms、当前路径 5.6 ms；每个路径只有一个冷请求样本，仅作本地参考，不用于统计结论。

token 数是 WhalePartner 的本地估算器输出，不是提供方 tokenizer 用量。基准中的模型请求数为 0；本次没有取得真实提供方 token 用量、模型推理耗时或端到端首 token 时间。基准也没有运行本机 BGE 向量检索，因此不能据此声称实际 Mem0 I/O 或云端聊天耗时的绝对值。

运行方式：

```sh
pnpm --dir apps/api run memory:profile
```

## 验证边界

API 类型检查通过。完整 API 回归 96 项通过；HTTP 路由测试使用本机回环，测试数据为内存或临时 SQLite，模型与外部站点由替身处理。数据库升级测试在临时目录验证旧经历保留与索引替换。

仓库现有 `memory:smoke` 在系统临时目录验证了真实 Mem0 / 本地 BGE 链路：写入事实、同来源经历覆盖、创建新实例后语义召回、无关查询不召回、删除后不再出现，全部通过。当前配置的提供方是 Codex `gpt-6-luna`。单次事实提炼耗时 7,090 ms，其中提供方调用 5,500 ms，其余本地/桥接处理约 1,590 ms。该次提供方用量返回输入 24,446 tokens（其中缓存输入 11,520）、输出 118 tokens；WhalePartner 本地字符估算为 12,719。两者口径不同，单次样本不能代表聊天轮次的真实输入成本。此冒烟未运行真实聊天回复，因此没有真实首 token 延迟或聊天轮次用量。

所有回归与基准使用 `:memory:`、系统临时目录或该冒烟脚本自己的临时向量目录；没有打开或修改 `apps/api/.local/app.db` 或主向量索引。测试生成的合成数据未进入主数据库。
