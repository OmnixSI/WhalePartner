# 服务接口

`apps/api` 提供的 HTTP 接口，默认 `http://127.0.0.1:8787`。客户端只调这些接口，模型密钥只在服务端。出错时返回 `{ "error": "说明" }`。允许的跨域来源：Tauri 窗口和本地 Vite 开发页（浏览器开发走 Vite 代理，同源）。

## 健康检查

`GET /api/health`

```json
{ "ok": true, "service": "whalepartner-api", "provider": "deepseek", "model": "deepseek-flash",
  "fallbacks": ["codex"], "memory": { "enabled": true, "state": "ready" },
  "memoryQueue": { "pendingJobs": 0, "retryingJobs": 0, "pendingVectorIndexes": 0, "pendingFactVectorIndexes": 0 } }
```

`?probe=1` 会向主模型的 `/models` 确认模型名可用。不会返回任何密钥。

## 聊天

`POST /api/chat`，请求体 `{ "message": "…", "character": "deepseek", "sessionId": "…" }`。`character` 可选（`whale` 默认、`deepseek`、`claude`、`chatgpt`），`sessionId` 是本机已有会话标识且可省略，消息最长 2000 字。响应是 SSE，事件按到达顺序：

| 事件 | 数据 | 说明 |
|---|---|---|
| `recall` | `{ memories: string[] }` | 这一轮召回并用到的用户事实，没有就不发 |
| `video` | `{ stage: "reading"｜"watching"｜"failed", message, title? }` | 消息里有 B 站链接时的进度；`failed` 后角色会如实说没看成 |
| `web` | `{ stage: "reading"｜"summarizing"｜"failed", message, title? }` | 消息里有普通网页链接时的进度；失败后角色会如实说没读成 |
| `emotion` | `{ emotion: "neutral"｜"happy"｜"sad"｜"angry"｜"surprised"｜"relaxed" }` | 驱动形象表情；标签已从正文剥离 |
| `delta` | `{ text }` | 回复文字增量 |
| `done` | `{ messageId, sessionId, emotion, provider?, usage? }` | 结束；`provider` 是实际用到的模型提供方 |
| `error` | `{ message }` | 失败。一个字都没回出来时这条用户消息会被撤掉，重试不会重复 |

客户端断开连接会中止上游请求；被中止的半句回复不入库。

`GET /api/chat/sessions?character=deepseek` 返回该角色的本机会话；`POST /api/chat/sessions` 请求体 `{ "character": "deepseek" }` 新建会话。

`GET /api/chat/history?limit=50&character=deepseek&sessionId=…` 返回 `{ messages: [{ id, role, content, emotion, character, sessionId, createdAt }] }`。不传 `sessionId` 时保留旧接口行为，返回该角色最近记录。历史原文检索按角色隔离。`DELETE /api/chat/history` 清除全部聊天原文、会话、事实、会话观察、角色近况和聊天来源的学习/经历；视频、网页、日记和非聊天来源的学习经历保留。

## 账号

只开放给本机，登录状态保存在 `.local/bilibili-session.json`（权限 600），任何接口都不返回它。目前只有哔哩哔哩，其它平台返回 400。

- `GET /api/accounts` → `{ accounts: [{ platform: "bilibili", name, connected, valid, savedAt }] }`，`valid` 是登录是否还有效（离线时为 `null`）。
- `POST /api/accounts/bilibili/login` → `{ key, url, expiresInSeconds }`：`url` 是二维码内容，界面自己画成二维码。
- `GET /api/accounts/bilibili/login?key=…` → `{ status: "waiting"｜"scanned"｜"expired"｜"success"｜"error" }`；成功时服务端验证并保存登录态。
- `DELETE /api/accounts/bilibili` 退出登录并删除本机保存的登录态。

命令行的 `pnpm --dir apps/api run login | status | logout` 仍然可用，两边共用同一份登录态。

## 近况小记

`GET /api/note?character=deepseek` → `{ note: { text, updatedAt } | null }`。角色定期写给自己的一小段近况，没写过就是 `null`。说明见 [`PERSONALITY.md`](PERSONALITY.md)。

## 记忆

记忆保存在本机 SQLite 与现有 Mem0 本地文件中。用户事实以及视频、网页、日记经历可供角色共用；聊天会话、聊天片段和聊天来源的学习记录按角色隔离。SQLite 是原始聊天、会话摘要、带证据的事实版本和待处理任务的权威来源；Mem0 + 本地中文向量模型负责语义召回，SQLite FTS5 负责本地中文词项检索。聊天会话片段按消息 ID 链接到原文，B4 事实和经历的向量、全文索引可从 SQLite 来源重建；只保存在 B3 向量库中的旧记忆没有对应来源记录。

- `GET /api/memories` → `{ entries: [{ id, kind: "fact"｜"experience", text, createdAt, source?, title?, url?, sourceId?, status?, validFrom?, validTo?, confidence?, sources?, vectorIndexed?, lastError? }], vectorError? }`。`local:<id>` 是带来源消息、置信度和有效期的结构化事实；`status` 为 `active` 或 `superseded`。`local-exp:<id>` 是 SQLite 本地经历档案；`vectorIndexed=false` 表示全文档案可用，语义索引等待重试。语义索引关闭或暂不可用时，SQLite 记录仍会返回。
- `DELETE /api/memories/:id`
- `POST /api/memories/experience`，给视频和日记写入一段经历：

```json
{ "kind": "video", "title": "标题（≤120 字）", "text": "正文（≤4000 字）",
  "url": "https://…（可选，http/https）", "sourceId": "BV1…（可选，同一个 sourceId 会替换旧的）" }
```

`MEMORY=off` 时仍可读取、添加和删除 SQLite 事实与经历；Mem0 语义索引关闭，无法删除只存在于 Mem0 的条目。

`CHAT_CONTEXT_TOKENS` 设置聊天模型的上下文总预算估算，默认 32000；服务给回复和模型结构预留约 8000，按不同模型通用的保守字符估算装配输入。该值不是精确 tokenizer 计数。每轮包括完整角色设定、相关记忆、当前会话滚动观察、相关旧聊天证据和预算内的近期原文。原文与事实不按年龄自动删除；相关召回不使用“最近几条”作为唯一入口。

每轮完成后会在 SQLite 持久化事实提取、会话经历、向量索引、会话观察和既有 Mem0 更新任务。失败任务记录错误并延迟重试，重启后从未完成步骤恢复。缺少本地 `vectors.db` 时，会从 SQLite 中有来源的事实和经历重新建立向量索引。关闭 `MEMORY` 会停用 Mem0、语义索引及 B3 更新；SQLite 事实提取、经历档案、滚动观察和关键词召回仍在本地运行。

## 视频

`POST /api/videos/summarize`，请求体 `{ "url": "B 站链接、b23.tv 短链或 BV 号" }`，给日记页的“添加链接”用。处理一个视频约 1 到 1.5 分钟，同一时间只处理一个，忙时返回 502 和说明。

```json
{ "video": { "bvid": "BV1…", "title": "…", "uploader": "…", "url": "https://www.bilibili.com/video/BV1…",
             "durationSeconds": 928, "summary": "# 分享给你\n…\n# 来源与依据\n…",
             "hasTranscript": false, "frameCount": 8 },
  "remembered": true }
```

`remembered` 表示这段经历已写入 SQLite 本机档案；本地 Mem0 语义索引会单独更新，失败时仍可通过关键词检索。

## 定时日记

日记页把 B 站链接加入持久化待看队列。API 进程运行期间，计划任务按 `DIARY_CRON` 定时触发，每次最多开始处理一条；默认是本地时间每日 20:00。进程停止期间不会运行，重新启动后会接着处理未完成项目。

- `GET /api/diary` → `{ items: DiaryItem[] }`，按创建时间倒序，最多 100 条。
- `POST /api/diary/queue`，请求体 `{ "url": "B 站链接、b23.tv 短链或 BV 号" }` → `{ item, created }`。新项目返回 201，已加入过的规范化输入返回 200。
- `POST /api/diary/run` → `{ started }`，在后台触发同一个队列处理器；当前正在运行时 `started` 为 `false`。
- `POST /api/diary/items/:id/retry`，重试失败的视频/日记生成，或重试日记已保存但 mem0 写入失败的经历。

`DiaryItem` 包含 `id`、`inputUrl`、`bvid`、`title`、`sourceUrl`、`summary`、`diaryText`、`status`、`errorStage`、`error`、`memoryStatus`、`memoryError`、`createdAt`、`processedAt`、`duplicateOf`。队列状态为 `pending`、`processing`、`failed`、`done`、`duplicate`；记忆状态为 `pending`、`saved`、`failed` 或 `null`。`saved` 表示视频摘要和日记已进入本机 SQLite 经历档案。摘要在生成日记前落盘；重试会从已保存的阶段继续。已生成日记的同一 BV 号只保留一篇，记忆使用独立的 `diary:<BV号>` 来源标识。

## 配置（`apps/api/.env`，见 `.env.example`）

| 变量 | 说明 |
|---|---|
| `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL`、`DEEPSEEK_BASE_URL` | 主模型，默认 `deepseek-flash` |
| `BACKUP_LLM_BASE_URL`、`BACKUP_LLM_API_KEY`、`BACKUP_LLM_MODEL` | 备用 OpenAI 兼容接口，三项齐全才启用 |
| `CODEX_FALLBACK`、`CODEX_REASONING_EFFORT` | 本机 Codex 兜底（默认开）；推理强度默认 `none`，`gpt-6-luna` 不再接受 `minimal` |
| `MEMORY`、`MEMORY_DIR` | `MEMORY=off` 关闭 Mem0 与语义索引；SQLite 记忆档案继续运行。向量数据和模型默认在 `apps/api/.local/memory` |
| `API_HOST`、`API_PORT`、`APP_DB_PATH`、`LLM_TIMEOUT_MS` | 监听地址、端口、聊天/待看/日记共用的 SQLite 文件位置、等待模型首个响应的超时 |
| `DIARY_CRON` | 定时日记 cron 表达式，按 API 主机本地时区运行；默认 `0 20 * * *`（每日 20:00） |

模型链顺序：DeepSeek → 备用接口 → 本机 Codex。只在一个提供方还没输出任何文字时才会换下一个。
