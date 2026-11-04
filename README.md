# WhalePartner

鲸系 AI 陪伴产品的协作开发仓库，当前先实现一周 MVP 原型。

**AI Agent 开始工作前，先读仓库根目录的 [`AGENTS.md`](AGENTS.md)。**

## MVP 目标

在应用壳里打通聊天、记忆、视频处理和日记：用户添加视频链接，系统用转写与关键帧生成摘要和日记，角色之后能在聊天中回忆相关内容。

当前产品方案和阶段规划见 [Notion 开发台](https://app.notion.com/p/40db6ca756bc816cb187f164caf87fa4)。研究计划原稿保存在 `ProjectMaterials/`。

## 本地视频摘要原型

`apps/api` 当前支持从 Bilibili 链接读取字幕/转写和辅助文字资料，从播放流抽取关键帧，并调用本机 Codex（GPT-6 Luna）生成整条视频摘要。需要本机安装 FFmpeg，并已登录 Codex CLI；可选运行 B 站扫码登录以读取账号可访问的字幕。

```sh
pnpm --dir apps/api run summarize -- <Bilibili 视频链接或 BV 号>
```

摘要、证据、关键帧和 token 用量保存在 `.local/video-summaries/<BV号>/`。程序不会把整段视频保存到本地。

C1/C2 的实现状态、实测样例和未完成事项见 [本地视频流水线记录](implement-stage/BUILD_NOTE.md)。

## 协作方式

产品范围见 [`docs/PRODUCT_SCOPE.md`](docs/PRODUCT_SCOPE.md)；分支命名、Issue 和 Pull Request 约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

第一周计划中，Homing 负责壳、后端、聊天/形象、人格和记忆；Spdor 负责视频处理、定时日记和日记页；双方一起完成端到端联调。

Notion 保留产品调研与范围决策；GitHub 管代码、Issue、Pull Request 和执行进度。
