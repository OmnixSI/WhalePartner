# 服务接口

`apps/api` 提供的 HTTP 接口，默认 `http://127.0.0.1:8787`。客户端只调这些接口，模型密钥只在服务端。出错时返回 `{ "error": "说明" }`。允许的跨域来源：Tauri 窗口和本地 Vite 开发页（浏览器开发走 Vite 代理，同源）。

## 健康检查

`GET /api/health`

```json
{ "ok": true, "service": "whalepartner-api", "provider": "deepseek", "model": "deepseek-flash",
  "fallbacks": ["codex"], "memory": { "enabled": true, "state": "ready" } }
```

`?probe=1` 会向主模型的 `/models` 确认模型名可用。不会返回任何密钥。

## 聊天

`POST /api/chat`，请求体 `{ "message": "…", "character": "deepseek" }`，`character` 可选（`whale` 默认、`deepseek`、`claude`、`chatgpt`），消息最长 2000 字。响应是 SSE，事件按到达顺序：

| 事件 | 数据 | 说明 |
|---|---|---|
| `recall` | `{ memories: string[] }` | 这一轮召回并用到的用户事实，没有就不发 |
| `video` | `{ stage: "reading"｜"watching"｜"failed", message, title? }` | 消息里有 B 站链接时的进度；`failed` 后角色会如实说没看成 |
| `web` | `{ stage: "reading"｜"summarizing"｜"failed", message, title? }` | 消息里有普通网页链接时的进度；失败后角色会如实说没读成 |
| `emotion` | `{ emotion: "neutral"｜"happy"｜"sad"｜"angry"｜"surprised"｜"relaxed" }` | 驱动形象表情；标签已从正文剥离 |
| `delta` | `{ text }` | 回复文字增量 |
| `done` | `{ messageId, emotion, provider?, usage? }` | 结束；`provider` 是实际用到的模型提供方 |
| `error` | `{ message }` | 失败。一个字都没回出来时这条用户消息会被撤掉，重试不会重复 |

客户端断开连接会中止上游请求；被中止的半句回复不入库。

`GET /api/chat/history?limit=50&character=deepseek` 返回 `{ messages: [{ id, role, content, emotion, character, createdAt }] }`，每个角色有自己的记录。`DELETE /api/chat/history` 清空全部。

## 近况小记

`GET /api/note?character=deepseek` → `{ note: { text, updatedAt } | null }`。角色定期写给自己的一小段近况，没写过就是 `null`。说明见 [`PERSONALITY.md`](PERSONALITY.md)。

## 记忆

记忆里有两类：**事实**（关于用户，由模型从对话里提炼）和**经历**（视频摘要、日记，原样保存）。所有角色共用。

- `GET /api/memories` → `{ entries: [{ id, kind: "fact"｜"experience", text, createdAt, source?, title?, url?, sourceId? }] }`
- `DELETE /api/memories/:id`
- `POST /api/memories/experience`，给视频和日记写入一段经历：

```json
{ "kind": "video", "title": "标题（≤120 字）", "text": "正文（≤4000 字）",
  "url": "https://…（可选，http/https）", "sourceId": "BV1…（可选，同一个 sourceId 会替换旧的）" }
```

记忆功能关闭（`MEMORY=off`）时这些接口返回 503。

## 视频

`POST /api/videos/summarize`，请求体 `{ "url": "B 站链接、b23.tv 短链或 BV 号" }`，给日记页的“添加链接”用。处理一个视频约 1 到 1.5 分钟，同一时间只处理一个，忙时返回 502 和说明。

```json
{ "video": { "bvid": "BV1…", "title": "…", "uploader": "…", "url": "https://www.bilibili.com/video/BV1…",
             "durationSeconds": 928, "summary": "# 分享给你\n…\n# 来源与依据\n…",
             "hasTranscript": false, "frameCount": 8 },
  "remembered": true }
```

`remembered` 表示这段经历已写入记忆。

## 定时日记

日记页把 B 站链接加入持久化待看队列。API 进程运行期间，计划任务按 `DIARY_CRON` 定时触发，每次最多开始处理一条；默认是本地时间每日 20:00。进程停止期间不会运行，重新启动后会接着处理未完成项目。

- `GET /api/diary` → `{ items: DiaryItem[] }`，按创建时间倒序，最多 100 条。
- `POST /api/diary/queue`，请求体 `{ "url": "B 站链接、b23.tv 短链或 BV 号" }` → `{ item, created }`。新项目返回 201，已加入过的规范化输入返回 200。
- `POST /api/diary/run` → `{ started }`，在后台触发同一个队列处理器；当前正在运行时 `started` 为 `false`。
- `POST /api/diary/items/:id/retry`，重试失败的视频/日记生成，或重试日记已保存但 mem0 写入失败的经历。

`DiaryItem` 包含 `id`、`inputUrl`、`bvid`、`title`、`sourceUrl`、`summary`、`diaryText`、`status`、`errorStage`、`error`、`memoryStatus`、`memoryError`、`createdAt`、`processedAt`、`duplicateOf`。队列状态为 `pending`、`processing`、`failed`、`done`、`duplicate`；记忆状态为 `pending`、`saved`、`failed` 或 `null`。摘要在生成日记前落盘；重试会从已保存的阶段继续。已生成日记的同一 BV 号只保留一篇，记忆使用独立的 `diary:<BV号>` 来源标识。

## 配置（`apps/api/.env`，见 `.env.example`）

| 变量 | 说明 |
|---|---|
| `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL`、`DEEPSEEK_BASE_URL` | 主模型，默认 `deepseek-flash` |
| `BACKUP_LLM_BASE_URL`、`BACKUP_LLM_API_KEY`、`BACKUP_LLM_MODEL` | 备用 OpenAI 兼容接口，三项齐全才启用 |
| `CODEX_FALLBACK`、`CODEX_REASONING_EFFORT` | 本机 Codex 兜底（默认开）；推理强度默认 `none`，`gpt-6-luna` 不再接受 `minimal` |
| `MEMORY`、`MEMORY_DIR` | `MEMORY=off` 关闭记忆；数据和向量模型默认在 `apps/api/.local/memory` |
| `API_HOST`、`API_PORT`、`APP_DB_PATH`、`LLM_TIMEOUT_MS` | 监听地址、端口、聊天/待看/日记共用的 SQLite 文件位置、等待模型首个响应的超时 |
| `DIARY_CRON` | 定时日记 cron 表达式，按 API 主机本地时区运行；默认 `0 20 * * *`（每日 20:00） |

模型链顺序：DeepSeek → 备用接口 → 本机 Codex。只在一个提供方还没输出任何文字时才会换下一个。
