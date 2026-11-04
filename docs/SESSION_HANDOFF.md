# 新会话启动与 Agent 交接

仓库与 GitHub 记录是跨会话的工程上下文。新会话不依赖之前的聊天记忆。

## 新会话启动

1. 在新会话中打开或挂载私有仓库 `OmnixSI/WhalePartner`。如果 Agent 看不到仓库文件，先为它提供仓库工作区或访问权限，再开始开发。
2. 让 Agent 从仓库根目录读取 `AGENTS.md`、`README.md`、`CONTRIBUTING.md` 和 `docs/PRODUCT_SCOPE.md`。
3. 指定本次 GitHub Issue。若是接续已有工作，提供对应 Issue 链接；分支、PR 和进度应记录在该 Issue 中。
4. 编辑前确认当前分支和工作区状态，阅读 Issue 最近的交接评论、关联 PR 与验收条件。保留已有未提交改动，不要覆盖其他 Agent 的工作。

可复制以下提示词到新会话：

```text
我们在私有 GitHub 仓库 OmnixSI/WhalePartner 开发。请先确认当前工作区是该仓库根目录，阅读 AGENTS.md、README.md、CONTRIBUTING.md 和 docs/PRODUCT_SCOPE.md。

当前任务：Issue #<编号或链接>
若为续接任务：先阅读该 Issue 最新交接记录、关联 PR 和任务分支。

开始编辑前，核对当前分支、未提交改动、Issue 范围、依赖和验收条件；保留已有改动，不超出该 Issue 的授权范围。完成后按仓库约定更新 Issue/PR，并留下交接记录。若我没有提供 Issue 或续接说明，请先向我确认任务。
```

## 会话交接

工作进度、决定、接口约定和阻塞记在对应 GitHub Issue 或 PR 中。不要把唯一一份进度留在私聊或 Agent 会话里，也不要用一个全局“当前任务”文件代替各自的 Issue；两位开发者可能同时推进不同任务。

结束会话或交给另一个 Agent 时，在对应 Issue 评论中使用以下格式；若已有 PR，可在 PR 描述或评论中记录并回链 Issue：

```markdown
### Agent handoff
- 状态：未开始 / 进行中 / 已实现 / 待审查 / 已完成
- 分支 / 最近提交 / PR：
- 已完成：
- 已修改的关键文件：
- 决定或接口约定：
- 验证：执行过的检查及结果；未执行则写明
- 下一步：
- 阻塞或需要开发者决定：无 / 具体说明
```

接手的 Agent 以仓库当前内容和 GitHub 上最新的 Issue/PR 记录为准；如工作区状态与交接记录不一致，先保留现有改动并在 Issue 说明差异，再继续。
