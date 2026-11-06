# 产品范围与当前 MVP

## 产品是什么

WhalePartner 是手机优先的原创鲸系 AI 陪伴产品。角色具有固定人格和长期记忆，定时处理用户添加或授权的内容，生成摘要和日记，并能在后续聊天中回忆相关经历。

完整产品方向和研究资料见 [Notion 开发台](https://app.notion.com/p/40db6ca756bc816cb187f164caf87fa4) 及 `ProjectMaterials/` 中的调研计划 PDF。当前开发阶段以 GitHub 第一周 MVP Issues 为准。

## 当前里程碑：第一周端到端原型

目标是在应用壳内跑通一次：

1. 用户能与基础角色聊天，聊天具备基本人格和记忆。
2. 用户添加一个视频链接；视频处理生成转写文本和关键帧，再用文本/图像模型生成摘要。
3. 定时任务读取待看列表，生成日记并将相关信息保存到记忆。
4. 用户能在日记页看到结果，之后聊天时角色能提起视频内容。
5. 双方在应用壳中联调；未跑通的部分记录为 GitHub Issue，不伪装成已完成。

## 第一周分工

- **Homing**：A1 Tauri 应用壳、A2 DeepSeek 后端、B1 聊天/形象、B2 人格提示词、B3 mem0 记忆。
- **Spdor**：C1 抽帧/转写、C2 视频摘要、D1 定时日记、D2 日记页与添加链接入口；之后实测视频处理成本和质量。
- **共同**：E1 端到端联调。

具体负责人、日期、依赖和完成条件以 GitHub 对应 Issue 为准。

## 当前进度（2026-11-05）

| 工作 | 状态 |
|---|---|
| A1 应用壳 | 完成：Tauri 2 + React 单页应用，桌面和手机共用界面（[PR #17](https://github.com/OmnixSI/WhalePartner/pull/17)）。 |
| A2 DeepSeek 后端 | 代码完成：流式聊天、DeepSeek → 备用 → 本机 Codex 回退链（[PR #18](https://github.com/OmnixSI/WhalePartner/pull/18)）。真实 DeepSeek 请求待验证，跟踪于 [Issue #2](https://github.com/OmnixSI/WhalePartner/issues/2)。 |
| B1 聊天与形象 | 完成：自写 React 聊天、Live2D 舞台与 three-vrm 演示形象；选型依据见 [Issue #3](https://github.com/OmnixSI/WhalePartner/issues/3) 和 [`LIVE2D_ASSESSMENT.md`](LIVE2D_ASSESSMENT.md)。 |
| B2 人格 | 完成：每个角色一份身份和脾气文件 + 共用的说话方式和底线规则，四个角色的 13 项回归问卷在 DeepSeek 上都是 13/13。 |
| 成长（人格延伸） | 完成：从看过的视频、读过的网页和用户的话里学新梗和新知识（自动入库，用户可删），定期写“近况小记”，记忆按清晰度衰减，聊天里发网页链接会读。设计与参考见 [`PERSONALITY.md`](PERSONALITY.md)。 |
| B3 记忆 | 完成：mem0 + 本地中文向量模型，写入、重启、召回已验证。 |
| B4 本地长期记忆与长会话上下文 | 已实现（[PR #32](https://github.com/OmnixSI/WhalePartner/pull/32)，[Issue #31](https://github.com/OmnixSI/WhalePartner/issues/31)）：本地 SQLite 原文档案、事实来源与时间版本、滚动会话观察、FTS5/向量/时间范围混合召回、上下文预算和可恢复任务队列。只做本机存储，不做云同步。 |
| C1/C2 视频链路 | 完成（Spdor）；已接入聊天：发 B 站链接，角色看完再讲并记住。 |
| 十条视频成本与质量基准 | 已记录 token 和阶段耗时（见 [构建记录](../implement-stage/BUILD_NOTE.md)）。人工评分和美元费用仍待完成，见 [Issue #12](https://github.com/OmnixSI/WhalePartner/issues/12)。 |
| 主应用界面与日记管理 | Issue #39 / PR #40：聊天工具栏、记忆分类与设置页已收紧；日记支持周/月/年范围和分页。API 日记任务已持久化，支持启动恢复及当天漏触发补跑。大肥鱼 Live2D 已接入主聊天舞台，支持待机、聊天情绪表情、视线跟随、点击互动和聊天时嘴型。模型素材为 CC BY-NC-SA 4.0 非商业许可；Cubism Core 为 Live2D 专有组件，需开发者从官方 SDK 获取并遵循许可。PR 待审查。 |
| D1 定时日记、D2 日记页与添加链接入口 | 已实现：B 站链接进入 SQLite 待看队列，计划任务每次处理一条，页面展示队列和生成的摘要/日记；日记经历写入共享 mem0。接口见 [`API.md`](API.md)。 |
| E1 端到端联调 | 聊天 → 视频 → 记忆 → 再聊已跑通；日记链路的真实视频联调见本分支 PR 验证记录。 |

PR 合并状态和任务验收以 GitHub 为准；本表用于快速交接，不替代 Issue 的完成条件。

## 演示角色与形象（内部展示，不是产品定稿）

首页提供大肥鱼（默认）、小克、小智和鲸汐四个陪伴角色。大肥鱼使用 A8Chann 发布的 Cubism 4 模型，角色形象源自上善无形，DeepSeek 女仆设计由 ZipZipPipe 完成，Live2D 绑定由氵六青完成；模型由固定版本脚本从 GitHub 下载，画面不叠加水印。模型素材许可为 CC BY-NC-SA 4.0，仅限非商业用途，改编素材须相同方式共享；商业使用前须取得各权利人授权。运行模型需要 Cubism Core；它是 Live2D 专有组件，开发者须从官方 SDK 单独获取并遵循适用许可，不随仓库分发。其余 VRM 形象只作内部展示。三个同人角色的人格设定明确写明其粉丝创作属性。VRM 来源与使用限制记在 `apps/client/models.manifest.json`；完整 Live2D 来源和运行方式见 [`LIVE2D_ASSESSMENT.md`](LIVE2D_ASSESSMENT.md)。

## 当前技术方向

- **客户端**：Tauri 2 + React + TypeScript + Vite 单页应用，共享 Windows、macOS、iOS、Android 的主要界面。当前在 MacBook 上开发；桌面与手机使用响应式布局。
- **原生集成**：Rust 限于 Tauri 外壳和操作系统能力；视频处理、摘要、记忆等业务逻辑放在 TypeScript 服务中，不与特定客户端绑定。
- **应用服务**：TypeScript + Node.js 26（`apps/api` 限定 `>=26 <27`），提供 HTTP API，并承载视频处理、AI 推理、记忆和定时任务。各端通过 HTTPS/JSON 调用；本地开发使用 loopback 服务。
- **本地模型调用**：Mac 开发原型通过 Node 服务调用本机 Codex CLI，使用 `gpt-6-luna` 和 `none` 推理强度。该适配器仅用于本地开发；正式多端运行时由服务端模型提供方实现，模型密钥只放在服务端，手机端不依赖 Codex CLI。
- **视频处理**：作为独立服务流程处理用户分享或授权的 Bilibili 链接。优先读取平台字幕；没有可用字幕时调用 Bilibili 必剪 ASR；FFmpeg 从播放流按字幕和全片间隔采样关键帧，不保存整段视频。摘要模型同时读取转写和关键帧；标题、简介、评论和弹幕只作辅助背景。业务逻辑放在 TypeScript 服务中，不放进客户端。
- **记忆**：B3 的 Mem0 与本地中文向量模型负责语义搜索；B4 在同一套 TypeScript/Node + SQLite 本地服务中保存原始聊天、会话、来源事实、有效时间和 Observer 观察。FTS5 负责中文词项检索，Mem0 向量索引负责语义召回，索引损坏时原始数据仍在 SQLite。会话上下文使用预算打包摘要、相关记忆、旧聊天来源证据和近期原文。实现细节见 [`MEMORY_ARCHITECTURE.md`](MEMORY_ARCHITECTURE.md)；当前范围不包含服务端部署或多设备同步。
- **日记链路**：SQLite 保存视频待看项、旧版单视频日记、综合日记与未完成任务阶段。综合日记按角色与本机日期汇集聊天、视频、网页、学习和反思经历，保留当前版本、来源关联与旧版本；API 进程默认本地时间 20:30 运行综合日记任务，可用 `JOURNAL_CRON` 调整。API 启动恢复未完成任务；若当天计划时间已过，为当天补跑一次，不批量补写停机期间的历史日期。旧版视频队列仍由 `DIARY_CRON` 每日 20:00 逐条处理。API 是独立于 Tauri 客户端的进程，停止期间计划任务不会运行。所有来源与正文保存在本机 SQLite，Mem0 只负责可重建的语义索引。行为见 [`DAILY_JOURNAL.md`](DAILY_JOURNAL.md)。
- **会话与记忆浏览**：已发送消息只读；会话支持重命名和单独删除。手动名称不会被自动标题覆盖。删除会话时清除其独有来源，并保留仍由其他会话支撑的事实和经历。记忆中心通过 SQLite 分页检索完整聊天档案，使用紧凑分类选择器和筛选浮层，可按角色、日期、发言人和事实状态过滤，支持中文检索、原话证据与来源回看。
- **macOS 语音输入**：聊天输入框使用 WKWebView 标准多行文本编辑器，系统听写文字直接写入草稿；未启用时界面指引用户到“系统设置 → 键盘 → 听写”开启并查看快捷键。不新增录音权限或云端语音识别，听写本身不触发发送。聊天模型仍按现有提供方配置推理。
- 页面与服务接口优先采用最小实现；遇到接口不清先在对应 Issue 写明，不做无关重构。

### C1/C2 本地视频摘要范围

`pnpm --dir apps/api run summarize -- <Bilibili 链接或 BV 号>` 会依次解析视频、读取字幕/转写和辅助文字资料、从播放流抽取最多 8 张关键帧，再调用本机 Codex CLI（GPT-6 Luna，推理强度 `none`）生成整条视频的连贯中文摘要。帧图缩至 768 像素宽；完整视频不保存到本地。CLI 将摘要、来源证据、帧图和模型 token 用量写入 `.local/video-summaries/<BV号>/`。

仓库根目录的 `启动视频摘要测试.command` 会启动本地网页测试台，复用同一采集与摘要流程，并展示阶段耗时、实际模型输入文字和帧图、token 用量及摘要。网页模式将结果保留在本次页面响应中，关键帧放在临时目录并在处理结束后删除；Bilibili 限流冷却状态仍由服务记录。两种本地模式都不写入长期记忆，也不代替用户在 B 站发布内容。

技术栈细节和官方平台构建要求见 [`TECH_STACK_PROPOSAL.md`](TECH_STACK_PROPOSAL.md)。

## 第一周不做

正式登录、充值和计费、年龄核验、AI 标识、多端同步、实时语音对话、家庭/老人模式，以及自动在第三方平台发布评论。macOS 系统听写只是把语音写进聊天草稿，不属于实时语音对话。

## 内容与许可约束

- 对外发布的角色必须原创或获得明确授权；不使用 DeepSeek 名称或 Logo。当前主界面的大肥鱼模型仅用于非商业演示，适用 CC BY-NC-SA 4.0；商业使用前必须取得相关权利人授权。
- 视频处理使用用户添加或明确授权的内容。当前原型默认只读，不代替用户在外部平台发言。
- 复用的应用代码使用 MIT 或 Apache-2.0 许可；GPL/AGPL 项目只可参考设计，不复制代码。Live2D 渲染包装库 `pixi-live2d-display` 与 PixiJS 为 MIT；Cubism Core 与角色模型是独立素材，只存放于开发者本机，不随仓库提交。当前大肥鱼角色模型为 CC BY-NC-SA 4.0 非商业素材，不可用于商业版或以商业方式分发。
- `dsh-bilibili` 与 `dsh-video-lens` 的仓库当前标注 MIT。FFmpeg 是本地外部运行时依赖；Bcut ASR 仅在平台字幕不可用时接收 Bilibili 音频流地址进行转写。

## 尚待在 Issue 中明确

- 视频摘要质量判定方式和成本实测的记录格式，见 [Issue #12](https://github.com/OmnixSI/WhalePartner/issues/12)。
