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

## Anthropic Claude 记忆整理机制

本节对应 GitHub Issue [#121](https://github.com/OmnixSI/WhalePartner/issues/121)。资料访问日期为 2026-11-09；实现保留 WhalePartner 的本机 SQLite 权威库和当前模型设置，没有接入 Claude 托管 Dreams、云端记忆或新收费服务。

| 官方资料 | 阅读位置 | 适配结论 |
|---|---|---|
| Lance Martin，Anthropic，[The components of agent memory](https://www.anthropic.com/research/components-of-agent-memory)，2026-11-06 | “Memory notes”“Dreaming can correct memory”“Thinking backward, looking forward” | 采用原始记录、笔记、主题表示和注入上下文的分层；把后台整理用于校正和组织，不以不断追加摘要代替事实核验。 |
| Claude Platform Docs，[Dreams](https://platform.claude.com/docs/en/managed-agents/dreams)，无标注发布日期 | “How it works”“Steer with instructions”；页面标注 Research Preview | 参考异步整理与输入/输出分离的边界。WhalePartner 继续在本机 SQLite 单写者中事务发布，不复制托管服务。 |
| Brad Abrams，[Dreaming with a dynamic workflow](https://platform.claude.com/cookbook/managed-agents-cma-dreaming-with-a-dynamic-workflow)，2026-11-02；Notebook：`managed_agents/CMA_dreaming_with_a_dynamic_workflow.ipynb` | “Load your sessions”“Create the agents”“Use the memory”“Dream every night” | 采用分析与后续只读消费分离的思路；不照搬依赖已结束会话和每夜时间窗的样例，因为本产品支持持续多日会话。 |
| anthropics/claude-cookbooks，[analyzer_system.md](https://github.com/anthropics/claude-cookbooks/blob/main/managed_agents/example_data/memory_distill/prompts/analyzer_system.md) | “Verify”“Enrich”“Organize”“Work in as few turns as you can” | 没有新证据不等于旧事实为假；明确矛盾才更新；证据不确定时不提升为已确认事实。 |
| anthropics/claude-cookbooks，[organizer_system.md](https://github.com/anthropics/claude-cookbooks/blob/main/managed_agents/example_data/memory_distill/prompts/organizer_system.md)、[lead_system.md](https://github.com/anthropics/claude-cookbooks/blob/main/managed_agents/example_data/memory_distill/prompts/lead_system.md)、[work_request.md](https://github.com/anthropics/claude-cookbooks/blob/main/managed_agents/example_data/memory_distill/prompts/work_request.md) | Organizer 的合并、历史保留、来源和单写者约定 | 主题笔记保留根消息来源；同一整理器串行发布，避免多写者覆盖。 |
| anthropics/claude-cookbooks，[dreaming_nightly.py](https://github.com/anthropics/claude-cookbooks/blob/main/managed_agents/dreaming_nightly.py)、[memory_distill_utils.py](https://github.com/anthropics/claude-cookbooks/blob/main/managed_agents/memory_distill_utils.py) | `main` 的时间窗推进；`read_results`、`report_run`、`raise_if_problems` | 任务进度与内容正确性分开验证；对连续聊天使用消息 ID 和可恢复任务，不以会话创建时间作游标。 |
| anthropics/claude-quickstarts，[knowledge-wiki README](https://github.com/anthropics/claude-quickstarts/blob/main/managed-agents/knowledge-wiki/README.md) 及 analyzer / organizer prompts | README 的适用语料、构建与查询分离；提示词的来源和索引约定 | 陪伴聊天的资料持续变化，首期选择少量 SQLite 主题摘要，不创建全量文件 Wiki。 |
| Claude Platform Docs，[Memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) | “How it works”“Implement the memory handler” | 持久化由应用负责；该工具协议不是 WhalePartner 必需的新依赖。 |

### 实现

- `memory_jobs` 每次合并同一聊天会话最多 8 轮、合计不超过 12,000 个字符的相邻任务；输入再按查询裁剪为相关事实、最多 4 条主题及精简核心。每批只发起一次整理请求，并在 `WP_DEBUG` 下记录批次数、输入字符数和请求数，不记录原文。
- 新整理器从本批用户原话提取带消息 ID、逐字引用、有效状态和纠正标记的事实，并同时产出主题、核心入口和会话观察。通过活动事实 ID 明确指向被同义键纠正取代的版本；计划标注进行中、已完成或已取消，终态会取代对应计划并抑制其提醒，终态记录保留为历史；同一主体仍有活动计划但缺少有效关联 ID 时，批次不会发布并留待重试。不同主体的计划不会互相阻塞。助手发言不作为用户事实；输出来源不在允许集合、引用不匹配或格式无效时不会提交事实。未找到新证据不会使旧事实失效。
- SQLite 事务同时发布结构化事实、`memory_topics` / `memory_topic_sources`、`memory_core` / `memory_core_sources`、会话观察和任务进度。摘要必须有仍存在的消息根来源。来源会话删除、事实手动删除或事实被明确取代时，受影响的主题/核心同步失效。
- 新事实的 SQLite 记录是权威版本；Mem0 仅接收 `infer:false` 的派生索引。无 SQLite 来源映射的旧 Mem0 事实从当前召回排除，只能在明确的历史问题中作为未核验材料出现。
- 前台聊天开始时，后台整理与学习/近况请求收到取消信号。记忆批次回到可立即续跑状态，已事务发布的进度保留；聊天完成后恢复调度。任务仍保存在现有本机 `memory_jobs`，重启后继续。
- 核心入口及相关主题只占用现有聊天上下文预算。没有增加 UI、用户操作、远端存储或新的模型提供方。

### 验证与边界

定向隔离回归覆盖：一批两轮聊天只发起一次整理、带来源事实/主题/核心发布、前台聊天中止并续跑、同义键纠正、纠正后旧观察失效、取消计划抑制旧提醒、缺少活动计划关联 ID 时拒绝完成、不同主体的计划互不阻塞、手动删除和来源会话删除，以及批次缺少新证据时保留旧事实。`memory.test.ts` 覆盖无来源旧 Mem0 事实只进入明确历史查询。测试使用 `:memory:` SQLite 与假 provider，不读取用户数据库或调用真实模型。

确定性测试确认事务、来源过滤和任务恢复；定向记忆回归 10 项通过，API 类型检查通过，完整 API 回归 273 项通过；Tauri macOS `.app` 构建通过，ad-hoc 签名和 `com.omnixsi.whalepartner` bundle ID 校验通过，并已从任务分支产物启动。回归覆盖同义键纠正、纠正后会话观察失效、取消计划时旧提醒抑制、终态缺少活动计划 ID 时拒绝发布，以及不同主体互不阻塞。没有在真实模型或用户数据库上写入聊天内容。模型对临时与稳定偏好、并存兴趣、摘要误读和真实回答质量仍需由用户在当前应用中人工验收。
