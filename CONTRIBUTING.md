# 协作约定

适用于 Spdor 和 Homing 在 `OmnixSI/WhalePartner` 中的日常开发。

## 单一事实来源

- Notion 开发台负责产品方向、研究资料和路线图。
- GitHub Issues 负责可执行工作、负责人、依赖、验收标准和阻塞记录。
- GitHub Pull Requests 负责代码讨论、审查和合并记录。
- 需求变更先更新 Notion，再更新对应 Issue；不要让代码、Issue 和产品范围各自漂移。

## 任务流程

1. 每项开发工作对应一个 GitHub Issue。Issue 写清目标、范围、依赖和可验证的完成条件。
2. 开始前把 Issue 指派给负责人，并将 Project 状态改为 `In progress`。
3. 从最新 `main` 建任务分支。分支名使用 `feat/<issue>-<topic>`、`fix/<issue>-<topic>` 或 `docs/<issue>-<topic>`。
4. 一个 Pull Request 尽量只完成一个 Issue；标题说明改动，正文关联 Issue（例如 `Closes #12`）。
5. Pull Request 至少由另一位开发者检查。处理反馈后合并到 `main`，再将 Issue 和 Project 状态更新为完成。
6. 遇到阻塞时，在 Issue 留下现象、已尝试的办法和需要谁协助；必要时拆出一个决策 Issue。

默认不直接向 `main` 推送功能改动。两位开发者互相审查；作者负责确认反馈已处理。

## 新会话与工作交接

- 新会话先打开或挂载仓库，再阅读根目录 `AGENTS.md` 和本文件；按 `docs/SESSION_HANDOFF.md` 中的提示恢复指定 Issue。
- 接续未完成任务时，沿用对应 Issue、任务分支和 PR；先查看 Issue 最新交接记录，并确认工作区未提交改动的归属。
- 会话结束或切换 Agent 前，在对应 Issue 或 PR 评论中记录当前状态、分支/提交/PR、已完成内容、验证情况、下一步和阻塞。使用 `docs/SESSION_HANDOFF.md` 的模板。
- 两个 Agent 并行处理不同任务时，使用各自独立的 clone 或 worktree 和分支。同一工作目录或分支不要同时写入；同一 Issue 的工作按顺序交接，除非开发者明确拆分了子任务。
- 不把仅存在于聊天记录中的决定当作工程约定；需要保留的结论写回 Issue、PR 或对应产品文档。

## 提交与审查

- 提交信息使用简短前缀：`feat:`、`fix:`、`docs:`、`refactor:`、`test:` 或 `chore:`。
- PR 说明解决的问题、主要改动、验证命令及结果。界面变更附截图。
- 修改视频处理、记忆或模型接口时，说明输入输出格式及与相邻模块的约定。
- 不把无关格式化或重命名混入功能 PR。

## 密钥和生成文件

- 本地密钥放在 `.env`；真实 `.env` 文件不会提交。
- 需要共享配置时提交不含密钥的 `.env.example`。
- 不提交 `.DS_Store`、依赖目录或构建产物。
- 模型 API 密钥只由服务端读取，不放进客户端代码。
