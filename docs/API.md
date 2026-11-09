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

`POST /api/chat`，请求体 `{ "message": "…", "character": "deepseek", "sessionId": "…" }`。`character` 选择本轮回复人格（`whale` 默认、`deepseek`、`claude`、`chatgpt`）；聊天会话和历史对所有人格共享。`sessionId` 是本机已有共享会话标识且可省略，消息最长 2000 字。响应是 SSE，事件按到达顺序：

| 事件 | 数据 | 说明 |
|---|---|---|
| `video` | `{ stage: "reading"｜"watching"｜"failed", message, title? }` | 消息里有 B 站链接时的进度；`failed` 后角色会如实说没看成 |
| `web` | `{ stage: "reading"｜"summarizing"｜"failed", message, title? }` | 消息里有普通网页链接时的进度；失败后角色会如实说没读成 |
| `emotion` | `{ emotion: "neutral"｜"happy"｜"sad"｜"angry"｜"surprised"｜"relaxed" }` | 驱动形象表情；标签已从正文剥离 |
| `delta` | `{ text }` | 回复文字增量 |
| `done` | `{ messageId, sessionId, emotion, provider?, usage? }` | 结束；`provider` 是实际用到的模型提供方 |
| `error` | `{ message }` | 失败。一个字都没回出来时这条用户消息会被撤掉，重试不会重复 |

客户端断开连接会中止上游请求；被中止的半句回复不入库。

`GET /api/relationship?character=deepseek` 返回共享关系进度与所选人格当前短期情绪：`{ points, level, label, effect, nextThreshold, progress, mood: { emotion, intensity, updatedAt } }`。好感度只由成功完成的大肥鱼对话增加，每轮 +1 点、本地日最多 10 点；重复事件不会重复计分。阶段阈值为 0、25、100、250，对应四档角色卡效果。情绪按人格分别保存并在 100 分钟内恢复到中性。详情见 [`RELATIONSHIP.md`](RELATIONSHIP.md)。

`GET /api/chat/sessions?character=deepseek` 返回全部共享会话，`character` 保留为兼容参数；条目含 `titleManual`。`POST /api/chat/sessions` 请求体 `{ "character": "deepseek" }` 新建共享会话并记录创建时的人格。`PATCH /api/chat/sessions/:id` 请求体 `{ "character": "deepseek", "title": "周末计划" }` 重命名并固定标题，后续消息不会覆盖手动标题。`DELETE /api/chat/sessions/:id?character=deepseek` 删除该共享会话，停止正在进行的回复并清理该会话独有的来源记忆；多会话共同来源的事实或经历保留。单条已发送消息没有编辑或删除接口。

`GET /api/chat/history?limit=50&character=deepseek&sessionId=…` 返回 `{ messages: [{ id, role, content, emotion, character, sessionId, createdAt, attachment }] }`。不传 `sessionId` 时返回全部共享聊天记录；`character` 保留为兼容参数，不过滤历史。追加 `aroundId=<message-id>` 后，必须同时指定 `sessionId`，接口会返回该消息前后的一段上下文供记忆来源定位。`attachment.type` 可为 `interrupted`、`surf` 或 `proactive`。`DELETE /api/chat/history` 清除全部聊天原文、会话、事实、会话观察、共享近况和聊天来源的学习/经历；视频、网页、日记和非聊天来源的学习经历保留。

## 主动陪伴

`GET /api/companion/settings` 返回 `{ enabled, frequency, quiet: { start, end } }`。`PUT` 接受同样字段的部分更新；频率为 `rare`（本地日最多 1 条、间隔至少 18 小时）或 `normal`（本地日最多 2 条、间隔至少 6 小时）。新安装默认为关闭，免打扰时段默认为本地 23:00–08:00。

主动跟进只从用户原话中已保存的 `plan` 事实触发，不猜测用户现实状态。匹配计划后延迟 20 分钟发送，触发 6 小时后失效；模型临时失败最多重试一次。服务重启时只恢复尚未到期的定时项；定时器迟到超过 5 分钟时会丢弃，不补发休眠期间的消息。发送前会检查免打扰、最近活动、进行中的回复、可见页面的人格和语音播放；当前人格不是大肥鱼时会取消该项。触发来源、计划证据和最终消息 ID 保存在共享 SQLite 中。主动消息以 `character: "deepseek"` 写入原聊天会话，并通过 `/api/events` 的 `message.created`、`message.done` 显示；附件为 `{ type: "proactive", source: "plan_follow_up", triggerId, speak: false }`。目前主动消息只发文字，不启动音频播放。

聊天页每 15 秒发送一次在线状态：`POST /api/chat/presence`，请求体 `{ clientId, character, visible, active, busy, voicePlaying }`，成功返回 204。服务端 45 秒未收到同一页面更新后会忘记该状态。此接口供主动消息在生成前判断当前页面，不保存用户身份或活动历史。

## 语音输入与回复

- `GET /api/voice/asr/status` 返回 X-ASR 运行状态与 `offlineRefinement` 精修模型状态；API 启动监听后会异步预热流式、离线模型，`POST /api/voice/asr/warm` 可查询并等待准备完成。`/api/voice/asr/stream` 是受 hub 令牌保护的 WebSocket：客户端先等含模型与精修状态的 `ready`，再持续发送 16 kHz、单声道、PCM16 二进制帧；服务端用应用 RMS VAD 在约 700 ms 静音后结束内部识别段，向流式模型补 400 ms 静音后以整句离线模型精修，再发最终 `final`；实时识别期间发送 `partial`，短于 500 ms 的片段用 `segment-end`，故障时发 `error`。用户再次点击麦克风时，客户端发送 JSON 控制消息 `{ "type": "finish" }`，服务端冲刷当前段，必要时发送最后一个 `final`，再发 `finished`；VAD 分段和中间稿都不会自动写入聊天历史。
- `GET /api/voice/tts/status` 返回本机模型、预置音色和运行状态；应用启动时会异步启动持久 worker 并预热，`POST /api/voice/tts/warm` 可查询并等待准备完成。`POST /api/voice/tts/stream` 接受 `{ "text": "…", "turnId": "…" }`，以 NDJSON 返回带相同 `turnId` 的 `meta`、若干 24 kHz PCM16 `audio` 块和 `done`，或 `error`。客户端断开会取消当前合成。
- 语音识别文本在用户确认结束后合并，并通过 `POST /api/chat` 写入共享历史。聊天模型和上下文沿用现有配置；TTS 只在大肥鱼人格及用户开启语音模式时自动播放。音频按回复句界提前送入 TTS；用户点击麦克风开始新录音时立即停止 PCM 播放、取消当前聊天和合成请求，并清空旧轮次队列。退出语音模式会释放麦克风与音频节点。

选型、模型存放、许可和本机实测见 [`VOICE_MODE.md`](VOICE_MODE.md)。

## 账号

只开放给本机，登录状态保存在 `.local/bilibili-session.json`（权限 600），任何接口都不返回它。目前只有哔哩哔哩，其它平台返回 400。

- `GET /api/accounts` → `{ accounts: [{ platform: "bilibili", name, connected, valid, savedAt }] }`，`valid` 是登录是否还有效（离线时为 `null`）。
- `POST /api/accounts/bilibili/login` → `{ key, url, expiresInSeconds }`：`url` 是二维码内容，界面自己画成二维码。
- `GET /api/accounts/bilibili/login?key=…` → `{ status: "waiting"｜"scanned"｜"expired"｜"success"｜"error" }`；成功时服务端验证并保存登录态。
- `DELETE /api/accounts/bilibili` 退出登录并删除本机保存的登录态。

命令行的 `pnpm --dir apps/api run login | status | logout` 仍然可用，两边共用同一份登录态。

## 近况小记

`GET /api/note?character=deepseek` → `{ note: { text, updatedAt } | null }`。近况小记跨人格共享，`character` 保留为兼容参数；旧版记录仍可读取。说明见 [`PERSONALITY.md`](PERSONALITY.md)。

## 记忆

记忆保存在本机 SQLite 与现有 Mem0 本地文件中。聊天、事实、经历、日记与见闻都对所有人格共享；`character` 字段保留记录来源，不作为读取隔离条件。切换角色只改变模型人格。SQLite 是原始聊天、会话摘要、带证据的事实版本和待处理任务的权威来源；Mem0 + 本地中文向量模型负责语义召回，SQLite FTS5 负责本地中文词项检索。聊天片段按消息 ID 链接到原文，B4 事实和经历的向量、全文索引可从 SQLite 来源重建；只保存在 B3 向量库中的旧记忆没有对应来源记录。

- `GET /api/memories` → `{ entries: [{ id, kind: "fact"｜"experience", text, createdAt, source?, title?, url?, sourceId?, status?, validFrom?, validTo?, confidence?, sources?, vectorIndexed?, lastError? }], vectorError? }`。`local:<id>` 是带来源消息、置信度和有效期的结构化事实；`status` 为 `active` 或 `superseded`。`local-exp:<id>` 是 SQLite 本地经历档案；`vectorIndexed=false` 表示全文档案可用，语义索引等待重试。语义索引关闭或暂不可用时，SQLite 记录仍会返回。
- `GET /api/memories/explorer?character=deepseek&category=conversation&q=鲸鱼&from=2026-10-01&to=2026-10-31&role=user&status=all&page=1&pageSize=30` → `{ items, total, page, pageSize, counts }`。`character` 保留为兼容参数，返回完整共享档案；类别为 `all|fact|conversation|video|web|diary|learned|reflection`；`from/to` 是包含首尾日期的本机日历日期；`role` 仅筛选聊天发言；`status` 可筛选当前/历史事实。类别数、全文中文二元词项搜索和分页均在 SQLite 上计算，覆盖完整可查档案。事实条目带所有原话来源，经历条目带来源会话、源消息 ID 和原链接；若来源会话已删除且内容作为独立资料保留，`sourceMissing` 为 `true`。
- `DELETE /api/memories/:id`
- `POST /api/memories/experience`，给视频和日记写入一段经历：

```json
{ "kind": "video", "title": "标题（≤120 字）", "text": "正文（≤4000 字）",
  "url": "https://…（可选，http/https）", "sourceId": "BV1…（可选，同一个 sourceId 会替换旧的）" }
```

`MEMORY=off` 时仍可读取、添加和删除 SQLite 事实与经历；Mem0 语义索引关闭，无法删除只存在于 Mem0 的条目。

`CHAT_CONTEXT_TOKENS` 设置聊天模型的上下文总预算估算，默认 32000；服务给回复和模型结构预留约 8000，按不同模型通用的保守字符估算装配输入。该值不是精确 tokenizer 计数。每轮包括完整角色设定、相关记忆、当前会话滚动观察、相关旧聊天证据和预算内的近期原文。原文与事实不按年龄自动删除；相关召回不使用“最近几条”作为唯一入口。

每轮完成后会在 SQLite 持久化事实提取、会话经历、向量索引、会话观察和既有 Mem0 更新任务。失败任务记录错误并延迟重试，重启后从未完成步骤恢复。缺少本地 `vectors.db` 时，会从 SQLite 中有来源的事实和经历重新建立向量索引。关闭 `MEMORY` 会停用 Mem0、语义索引及 B3 更新；SQLite 事实提取、经历档案、滚动观察和关键词召回仍在本地运行。角色人格不同，但其记忆检索和对话历史使用同一共享数据集。

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

综合日记独立于旧版单视频队列，按共享数据和 API 主机本机日期生成。它可以使用所有人格的聊天、已处理视频/网页、学习记录、会话观察与共享近况；纯聊天当天也可生成。写作时使用当前选择的人格；每个日期写入一个共享记录。旧版按角色保存的历史日记保留，列表在同一日期展示最近更新的一篇。素材无变化的定时重复触发保持当前版本，手动更新追加历史版本。新记录使用稳定 source ID `journal:shared:<YYYY-MM-DD>`，不会作为自己的输入。删除被引用的会话会移除受影响版本，并用当天剩余来源重建当前日记。API 启动会恢复持久化的未完成任务；正文已保存时从归档阶段继续，不重复请求模型。若本机当天计划时间已过，启动时会补跑当天一次。

- `GET /api/journals?character=deepseek&from=2026-11-01&to=2026-11-30&limit=30&offset=0` → `{ items: DailyJournal[], total }`，返回共享日记；`character` 为兼容参数。日期边界均包含在内，按日期倒序；同一日期只展示最近更新的一篇，旧版记录仍留在 SQLite。`from`、`to` 可省略，`limit` 默认为 100、最大为 366，`offset` 默认为 0。日记页按周、月、年传入范围；月视图按日期建索引，选择日期后阅读当天内容，年视图汇总月份数量。
- `POST /api/journals/generate` 请求体 `{ "character": "deepseek", "date": "2026-11-05", "force": true }` → `{ journal }`；`character` 选择写作人格，日记仍写入共享日期记录；`date` 可省略为本机今天，`force` 用于显式重新生成并留存旧版本。当天无素材时返回 `{ "journal": null, "reason": "no_sources" }`。
- `GET /api/journals/:id/revisions` → `{ revisions: DailyJournal[] }`，返回含正文和来源的版本记录。

更完整的来源、版本与删除规则见 [`DAILY_JOURNAL.md`](DAILY_JOURNAL.md)。

## 见闻

见闻内容在所有人格下共享。`GET /api/surf/feed?character=deepseek&page=1&pageSize=20&kind=video&q=鲸鱼` 返回 `{ items, total, page, pageSize }`；`character` 保留为兼容参数，不过滤内容。条目包含标题、摘要、评论、来源、标签和 `thumb`。视频与网页封面由 API 下载到本地 `SURF_DIR/thumbs/`，SQLite 保留原始封面 URL 和相对文件路径；API 启动时会检查已有缓存并修复缺失封面，不会重做摘要。失败记录通过 `thumbError` 返回，客户端显示占位状态。

- `GET /api/surf/items/:id` 返回一条共享见闻详情；`DELETE /api/surf/items/:id` 隐藏该条内容。
- `GET /api/surf/thumb/:id` 返回本地缓存图像及其图片 MIME 类型，桌面 App 通过 loopback API 加载封面。
- `/api/surf/settings`、`/api/surf/status` 与 `/api/surf/run` 保留当前人格参数用于设置、状态及启动阅读任务；产生的见闻条目进入共享列表。

## 配置（`apps/api/.env`，见 `.env.example`）

| 变量 | 说明 |
|---|---|
| `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL`、`DEEPSEEK_BASE_URL` | 主模型，默认 `deepseek-flash` |
| `BACKUP_LLM_BASE_URL`、`BACKUP_LLM_API_KEY`、`BACKUP_LLM_MODEL` | 备用 OpenAI 兼容接口，三项齐全才启用 |
| `CODEX_FALLBACK`、`CODEX_HOME`、`CODEX_REASONING_EFFORT` | 本机 Codex 兜底（默认开）；模型与推理强度按 `CODEX_HOME/config.toml`（默认 `~/.codex/config.toml`）读取，环境变量仅在配置文件未写推理强度时使用。设置界面只展示 `model/list` 返回的当前模型可用档位，下一轮请求按选项原样调用。 |
| `MEMORY`、`MEMORY_DIR` | `MEMORY=off` 关闭 Mem0 与语义索引；SQLite 记忆档案继续运行。向量数据和模型默认在 `apps/api/.local/memory` |
| `API_HOST`、`API_PORT`、`APP_DB_PATH`、`LLM_TIMEOUT_MS` | 监听地址、端口、聊天/待看/日记共用的 SQLite 文件位置、等待模型首个响应的超时 |
| `DIARY_CRON` | 定时日记 cron 表达式，按 API 主机本地时区运行；默认 `0 20 * * *`（每日 20:00） |
| `JOURNAL_CRON` | 综合日记 cron 表达式，按 API 主机本地时区运行；默认 `30 20 * * *`（每日 20:30） |

模型链顺序：DeepSeek → 备用接口 → 本机 Codex。只在一个提供方还没输出任何文字时才会换下一个。
