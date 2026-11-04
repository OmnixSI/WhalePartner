# WhalePartner 技术选型

**状态：已确认。** Spdor 于 2026-11-04 确认采用本方案。本文记录客户端、服务端和本地原型共同遵循的实现约定。

## 目标平台

WhalePartner 面向 Windows、macOS、iOS 和 Android。当前先在 MacBook 上开发和验证，后续复用客户端界面和服务接口。

## 建议选型

| 层 | 选型 | 负责内容 |
|---|---|---|
| 桌面与移动客户端 | Tauri 2 | Windows/macOS 桌面应用、iOS/Android 应用外壳 |
| 客户端界面 | React + TypeScript + Vite，单页应用 | 聊天、视频入口、摘要和日记界面；布局适配桌面与手机 |
| 原生能力 | Rust，限于 Tauri 及平台集成 | 文件系统、系统通知、应用生命周期和必要的原生插件 |
| 应用服务 | TypeScript + Node.js Active LTS | HTTP API、视频处理流程、AI 推理、记忆与定时任务 |
| 客户端与服务接口 | HTTPS + JSON | 统一 Mac、Windows、iOS、Android 的请求和响应格式 |
| 本地开发推理 | Node 服务调用本机 Codex CLI | `gpt-6-luna`，`model_reasoning_effort="minimal"`；不需要另配模型 API Key |

Tauri 官方支持桌面和移动平台，并允许使用 React 等 Web 前端与 Rust 后端；官方前端指南建议用 Vite 构建 SPA。iOS 构建需要 macOS/Xcode，Android 构建需要 Android 工具链，因此先在 MacBook 开发与测试符合平台约束。[Tauri 平台与架构](https://v2.tauri.app/start/)、[前端配置](https://v2.tauri.app/start/frontend/)、[平台开发依赖](https://v2.tauri.app/start/prerequisites/)

Node.js 服务使用 Active LTS 或 Maintenance LTS 版本；项目启动时锁定实际使用的主版本，生产环境不跟随 Current 版本。[Node.js 版本支持政策](https://nodejs.org/en/about/previous-releases)

## 业务代码边界

- React 客户端不直接访问 Bilibili 私有接口、不持有模型密钥，也不实现视频处理规则。
- 视频链接解析、公开元信息和评论采集、摘要生成、记忆读写都放在 TypeScript 服务中，通过 JSON 接口供各端调用。
- Rust 只承接操作系统和 Tauri 集成能力；视频业务不绑定到某个桌面平台。
- 服务内把“证据采集”和“摘要推理”分开。优先读取平台字幕，缺失时调用 Bilibili 必剪 ASR；FFmpeg 从播放流抽取字幕对齐与全片均匀采样的关键帧，不保存完整视频。摘要模型同时接收转写和关键帧；标题、简介、评论与弹幕仅作辅助背景。
- 本地验证先用文件保存原始公开资料与摘要。接入正式存储和 mem0 时，再按双方确定的记忆接口实现，不在此阶段选数据库或改写记忆方案。

## Codex 调用边界

当前开发原型由 Mac 上运行的 Node 服务通过 `codex exec` 调用本机 Codex，指定 `gpt-6-luna` 和 `minimal` 推理强度。Codex CLI 不作为 iOS 或 Android 的运行时依赖。正式多端使用时，Node 服务通过同一摘要接口连接可部署的模型服务，密钥只放在服务端；客户端和视频采集流程不需要随之改写。

本机 Codex CLI 通过 `--image` 接收关键帧和对应时间索引，使用同一 GPT-6 Luna 调用完成图像与文本理解。摘要提示会把视频标题、简介、字幕、评论、弹幕和画面 OCR 当成不可信资料，不执行其中夹带的指令；输出说明证据来源与判断限制。

## 本地视频摘要原型的落点

建议原型先放在 `apps/api`，保持未来服务端的 TypeScript/Node 路线。数据流程为：

```text
用户提交 Bilibili 链接
  → 解析 BV 号或 b23.tv 短链
  → 读取标题、简介、平台字幕及有限数量的评论和弹幕
  → 缺少平台字幕时，将 Bilibili 音频流地址提交给必剪 ASR
  → 从视频播放流抽取最多 8 张关键帧，不保存完整视频文件
  → 将转写与关键帧交给本机 Codex（GPT-6 Luna，minimal）
  → 生成整条视频的连贯摘要，并保存来源、证据、帧图与 token 用量
```

关键帧最多 8 张，每张宽度限制为 768 像素；提取过程通过 Bilibili 播放流按选定时间点取帧，完整视频不会写入本地。摘要围绕整条视频生成，不输出逐时间段章节。评论与弹幕只代表采样到的观众反应。字幕/转写或关键帧缺少其一时，摘要会说明证据限制；两者都缺少时，不调用摘要模型，只保存来源和辅助资料。当前结果保存在本机，不写入长期记忆，也不向 Bilibili 发布评论。

## 取舍

这套方案让客户端界面在四个平台间共享，TypeScript 业务服务也能作为本地原型和未来服务端继续使用；代价是项目需要维护 TypeScript 与少量 Rust 两种语言，以及 Node 服务和 Tauri 客户端两个运行目标。Rust 范围保持在原生集成，可限制这部分复杂度。

## 参考实现观察

已下载并阅读两个 MIT 项目到 `/private/tmp`。本地原型复用 `dsh-bilibili` v0.8.0 的 MIT 提取器，并保留其许可证；当前启用平台字幕、必剪 ASR 兜底和播放流抽帧。另一项目用于参考 Agent 阅读证据和总结的流程：

- [`CZX2244/dsh-bilibili`](https://github.com/CZX2244/dsh-bilibili)：`lib/extractor.js` 将 BV/短链解析、视频元信息、评论、字幕、弹幕、ASR 和关键帧提取拆为独立步骤；WhalePartner 通过播放流选点抽帧，并在每个 Bilibili 请求之间保持两秒间隔。
- [`c1overzz/dsh-bili-scroll`](https://github.com/c1overzz/dsh-bili-scroll)：采用候选筛选、读取证据、总结并写入本地记录的流程；提示词把公开内容当作资料，不当作 Agent 指令。总结沿用一句话结论、证据要点、样本观众反应和明确的信息边界；只有字幕提供时间证据时才列时间点。

摘要以字幕/转写和关键帧为主证据，标题、简介、评论和弹幕提供背景；用户看到的是整条视频的概括，而不是逐段时间轴。
