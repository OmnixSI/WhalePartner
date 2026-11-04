# WhalePartner

鲸系 AI 陪伴产品的协作开发仓库，当前先实现一周 MVP 原型。

**AI Agent 开始工作前，先读仓库根目录的 [`AGENTS.md`](AGENTS.md)。**

新开会话或更换 Agent 时，先在新会话中打开/挂载本仓库，再按 [`docs/SESSION_HANDOFF.md`](docs/SESSION_HANDOFF.md) 的提示恢复任务。工程约定和进度以仓库及 GitHub Issue/PR 为准，不依赖之前的聊天记录。

## MVP 目标

在应用壳里打通聊天、记忆、视频处理和日记：用户添加视频链接，系统用转写与关键帧生成摘要和日记，角色之后能在聊天中回忆相关内容。

当前产品方案和阶段规划见 [Notion 开发台](https://app.notion.com/p/40db6ca756bc816cb187f164caf87fa4)。研究计划原稿保存在 `ProjectMaterials/`。

## 协作方式

产品范围见 [`docs/PRODUCT_SCOPE.md`](docs/PRODUCT_SCOPE.md)；分支命名、Issue 和 Pull Request 约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

第一周计划中，Homing 负责壳、后端、聊天/形象、人格和记忆；Spdor 负责视频处理、定时日记和日记页；双方一起完成端到端联调。

Notion 保留产品调研与范围决策；GitHub 管代码、Issue、Pull Request 和执行进度。
