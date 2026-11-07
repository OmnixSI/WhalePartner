# 本地交接：陪伴体验修复

- 状态：本地构建与开发者人工验收已通过；等待 GitHub Issue / PR 独立审查。
- 分支 / 基线：`codex/companion-experience-fixes` / `a611609`。本次改动包含本地验收范围内的客户端、API、测试及文档修改；沿用既有数据库与配置。
- Live2D：动作从当前模型实际定义中加载，仅保留不超过 3.5 秒的非待机片段；播放前关闭循环，完成后由渲染器 `motionFinish` 事件恢复待机和当前聊天情绪；动作播放中忽略重复点击。说话嘴型、输入框换行稳定性及帧率修复保持。
- 日记：页面按周/月/年日期范围读取 `/api/journals`，与旧版 `/api/diary` 视频日记合并展示；共享日记按本机 `localDate` 显示，按日期去重，正文和来源可查看。手动生成接入 `/api/journals/generate` 并刷新；读取失败显示错误和重试，不进入空态。角色切换仍只切人格，共用聊天、记忆、日记和见闻数据。
- 见闻：Tauri opener 前端和 Rust 插件均已注册，capability 只允许打开 HTTP(S) URL。卡片、详情链接和详情按钮共用 `lib/external-url.ts`；Web 开发版使用新标签，弹窗被拦截时显示错误提示。新窗口的 `opener` 会被清除。旧 `openOriginal` WebView 调用和 `PostcardMini` 的直接 `window.open` 兜底已移除。
- 设置：模型和推理强度控件在 Codex 设置行内统一高度、字号、内边距；保存按钮对齐并保留窄屏单列布局。字号设置仍先改草稿，确认后应用；页面提示已明确区分即时生效设置与需确认的字号。
- 数据：沿用 `apps/api/.local/` 原数据库和用户配置，未写入测试记录、未清库。现有 API 监听于 `127.0.0.1:8787`，仓库 `.env` 不存在。
- 验收环境：当前 API 进程设置 `SURF_ENABLED=0`，会暂停自主 Surf 调度，也会拒绝手动 `/api/surf/run`；已有见闻列表和来源链接仍可检查。`DIARY_CRON` 与 `JOURNAL_CRON` 均设为本机 23:59，计划任务仍启用。本轮没有触发真实模型或自主 Surf。该临时总闸不代表 Surf 修复结果。
- 验证：客户端 TypeScript 检查通过；客户端测试 7/7 通过；日记 API 测试 7/7 通过（临时 SQLite、模拟 provider）；Tauri `cargo check` 通过；最终 `.app` 目标构建成功。`tauri.conf.json` 将 macOS `signingIdentity` 配为 `-`；`codesign --verify --deep --strict` 通过，bundle identifier 为 `com.omnixsi.whalepartner`。
- 构建产物：`apps/client/src-tauri/target/release/bundle/macos/鲸汐.app`。
- 人工验收：开发者已确认本机验收通过。验收范围包括 Live2D 互动、共享日记显示与日期范围、见闻链接打开和设置控件布局。
- GitHub 跟踪：[Issue #78](https://github.com/OmnixSI/WhalePartner/issues/78)。本地自审检查了 Live2D 动作完成事件、共享日记日期筛选与去重、外链失败提示及 Tauri 权限注册；未发现数据清理或本地配置变更。
- 后续：推送任务分支并创建关联 Issue #78 的 PR，附自审和验证记录，请求另一位开发者审查；PR 合并后再按授权处理 Release 与云端同步。
