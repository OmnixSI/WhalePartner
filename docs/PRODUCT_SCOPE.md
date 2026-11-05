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
| B1 聊天与形象 | 完成：自写 React 聊天 + three-vrm 形象，选型依据见 [Issue #3](https://github.com/OmnixSI/WhalePartner/issues/3)。 |
| B2 人格 | 完成：共用规则 + 每个角色一份口吻文件，四个角色回归问卷 10/10（本机 Codex）。 |
| B3 记忆 | 完成：mem0 + 本地中文向量模型，写入、重启、召回已验证。 |
| C1/C2 视频链路 | 完成（Spdor）；已接入聊天：发 B 站链接，角色看完再讲并记住。 |
| 十条视频成本与质量基准 | 已记录 token 和阶段耗时（见 [构建记录](../implement-stage/BUILD_NOTE.md)）。人工评分和美元费用仍待完成，见 [Issue #12](https://github.com/OmnixSI/WhalePartner/issues/12)。 |
| D1 定时日记、D2 日记页与添加链接入口 | 实现于本分支：B 站链接入 SQLite 待看队列，计划任务每次处理一条，页面展示队列和生成的摘要/日记；日记经历写入共享 mem0。接口见 [`API.md`](API.md)。 |
| E1 端到端联调 | 聊天 → 视频 → 记忆 → 再聊已跑通；日记链路的真实视频联调见本分支 PR 验证记录。 |

PR 合并状态和任务验收以 GitHub 为准；本表用于快速交接，不替代 Issue 的完成条件。

## 演示角色与形象（内部展示，不是产品定稿）

为了演示，首页现在提供四个角色：大肥鱼（DeepSeek 鲸鱼娘，默认）、小克（Claude 娘）、小智（ChatGPT 娘）和原创的鲸汐，形象用的是别人做好的现成 VRM 模型。这**偏离了下面“内容与许可约束”里的原创要求**，只作内部展示：授权没有核对，部分模型明确限制个人非商业使用、禁止再分发（模型文件不进仓库，各机器从作者的发布页自行下载）。对外发布前要换成原创或授权明确的角色，并先在 Notion 更新这条决定。三个同人角色的设定里写明自己是粉丝二创、不是官方，也不替背后的模型说话。模型清单与来源在 `apps/client/models.manifest.json`。

## 当前技术方向

- **客户端**：Tauri 2 + React + TypeScript + Vite 单页应用，共享 Windows、macOS、iOS、Android 的主要界面。当前在 MacBook 上开发；桌面与手机使用响应式布局。
- **原生集成**：Rust 限于 Tauri 外壳和操作系统能力；视频处理、摘要、记忆等业务逻辑放在 TypeScript 服务中，不与特定客户端绑定。
- **应用服务**：TypeScript + Node.js Active LTS，提供 HTTP API，并承载视频处理、AI 推理、记忆和定时任务。各端通过 HTTPS/JSON 调用；本地开发使用 loopback 服务。
- **本地模型调用**：Mac 开发原型通过 Node 服务调用本机 Codex CLI，使用 `gpt-6-luna` 和 `minimal` 推理强度。该适配器仅用于本地开发；正式多端运行时由服务端模型提供方实现，模型密钥只放在服务端，手机端不依赖 Codex CLI。
- **视频处理**：作为独立服务流程处理用户分享或授权的 Bilibili 链接。优先读取平台字幕；没有可用字幕时调用 Bilibili 必剪 ASR；FFmpeg 从播放流按字幕和全片间隔采样关键帧，不保存整段视频。摘要模型同时读取转写和关键帧；标题、简介、评论和弹幕只作辅助背景。业务逻辑放在 TypeScript 服务中，不放进客户端。
- **记忆**：第一周按 A2/B3 接口接入 mem0；视频摘要写入记忆的字段和调用约定等与负责记忆模块的开发者对齐后实现。
- **日记链路**：SQLite 保存待看项、视频摘要和日记；API 进程用 MIT 许可的 `cron` 定时器逐条处理队列。默认本地时间每日 20:00，可用 `DIARY_CRON` 设置；API 停止时计划任务不运行。日记先保存到 SQLite，再写成共享 mem0 经历；后续聊天通过最近经历读取。
- 页面与服务接口优先采用最小实现；遇到接口不清先在对应 Issue 写明，不做无关重构。

### C1/C2 本地视频摘要范围

`pnpm --dir apps/api run summarize -- <Bilibili 链接或 BV 号>` 会依次解析视频、读取字幕/转写和辅助文字资料、从播放流抽取最多 8 张关键帧，再调用本机 Codex CLI（GPT-6 Luna，minimal）生成整条视频的连贯中文摘要。帧图缩至 768 像素宽；完整视频不保存到本地。CLI 将摘要、来源证据、帧图和模型 token 用量写入 `.local/video-summaries/<BV号>/`。

仓库根目录的 `启动视频摘要测试.command` 会启动本地网页测试台，复用同一采集与摘要流程，并展示阶段耗时、实际模型输入文字和帧图、token 用量及摘要。网页模式将结果保留在本次页面响应中，关键帧放在临时目录并在处理结束后删除；Bilibili 限流冷却状态仍由服务记录。两种本地模式都不写入长期记忆，也不代替用户在 B 站发布内容。

技术栈细节和官方平台构建要求见 [`TECH_STACK_PROPOSAL.md`](TECH_STACK_PROPOSAL.md)。

## 第一周不做

正式登录、充值和计费、年龄核验、AI 标识、多端同步、语音对话、Live2D、家庭/老人模式，以及自动在第三方平台发布评论。向外发布内容的功能不在当前原型范围内。

## 内容与许可约束

- 角色必须是原创鲸系设定；不使用 DeepSeek 名称或 Logo，也不复制已有社区角色形象。
- 视频处理使用用户添加或明确授权的内容。当前原型默认只读，不代替用户在外部平台发言。
- 计划只复用 MIT 或 Apache-2.0 许可的代码。GPL/AGPL 项目只可参考设计，不复制代码。
- `dsh-bilibili` 与 `dsh-video-lens` 的仓库当前标注 MIT。FFmpeg 是本地外部运行时依赖；Bcut ASR 仅在平台字幕不可用时接收 Bilibili 音频流地址进行转写。

## 尚待在 Issue 中明确

- 视频摘要质量判定方式和成本实测的记录格式，见 [Issue #12](https://github.com/OmnixSI/WhalePartner/issues/12)。
