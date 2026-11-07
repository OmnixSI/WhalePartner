# 更新记录

## 0.2.4 — 桌面版按钮修好

桌面壳里点某些按钮会闪一行英文 `Load failed`，开关点了自己弹回去，昵称存不住。两个真因，都已修：

- **预检没放行 PUT**：`applyCors` 的方法表只有 GET/POST/PATCH/DELETE，而昵称、模型接入、逛设置三个接口是 PUT。开发时页面走 Vite 代理（同源、没有预检）所以测试全绿；装成 App 之后页面来自 `tauri://localhost`，跨源预检被拦，`fetch` 直接抛 `TypeError: Load failed`。方法表补上 `PUT`/`HEAD`，预检回显浏览器问的请求头，结果缓存 10 分钟
- **昵称字段两边不一致**：服务端是 `{ userName }`，客户端读写 `{ nickname }`——读回来永远空，点「记下」服务端拿到 `undefined` 回 400。客户端按线上字段收发，界面仍叫「昵称」；`userName: null` 现在表示「清掉」，不再报错
- **报错说人话**：`lib/net.ts` 把 `Load failed` / `Failed to fetch` 翻成「连不上本机后端（127.0.0.1:8787）。按「再试一次」；还不行就双击项目里的「启动鲸汐.command」」，昵称/逛设置/模型接入/导出/删除五处接上
- **不再让人重新点一遍**：逛设置存失败时记住那一次改动，行下面给「再试一次」按钮；回执写「没存上，已退回原来的样子」

新增两道闸：`test/cors.test.ts` 扫前端源码里每个 `method: "X"` 要求预检方法表全覆盖（以后前端加方法忘了改 `http.ts` 会直接红）；`test/profile.test.ts` 钉死 `userName` 字段与清空语义。`e2e-smoke.mjs` 新增 `--packaged`：dist 挂 `127.0.0.1:1420` + 页面里假装 `__TAURI_INTERNALS__`，`fetch` 真的跨源走预检——0.2.3 这类「只在桌面壳里犯」的错，以后开发环境也能抓住。

`apps/api` 测试 180/180；`check.mjs` 10 项 0 失败；`e2e-smoke.mjs --packaged` 22 项全过。

## 0.2.3 — 桌面版可用性修复

- **开场用真人**：引导第 1 步换成真实形象舞台（大肥鱼直接 Live2D），贴纸只在加载失败兜底
- **角色不再发白**：VRM 换 NeutralToneMapping + 曝光 0.9、主光/轮廓光下调，近白像素 claude 5.9%→0、chatgpt 0.44%→0
- **构图统一**：四个角色高度≈舞台 60%、水平居中、头顶留白 37–50px、对话框不盖腰以上（长对话框时自动缩到 463px）
- **开关整行可点**：老人模式、减少动画、让她自己逛、讲给我听都改成整行可点，并显示「HH:MM:SS 已保存 / 失败原因」
- **模型接入**：设置页新增「模型接入」——DeepSeek key（只回掩码、写 `.env` 前备份）、Codex 模型与推理强度（六档白名单）、测试连接
- **修好三个真 bug**：海星图标的 SVG NaN（记忆页控制台刷红）、导出下载成 `export.json` 而不是 zip、见闻页「今天逛了 N 个」与列表口径不一致、额度「下次刷新」显示成过去时间
- 新增 `apps/client/scripts/e2e-smoke.mjs`：四页面 + 关键交互 + 手机横滚 + 可选真发一条消息

`apps/api` 测试 170/170；`node scripts/redesign/check.mjs` 10 项 0 失败。

## 0.2.2

- 见闻页动效时长收进 tokens（P5 在 P4 之后合入带回的两个字面值），`check.mjs` 复跑 10 项全绿

## 0.2.1 — P-B 补齐

- **导出 / 删除全部**：纯 Node zip（deflate + crc32），`POST /api/export` → `GET /api/export?id=` 下载；`DELETE /api/data` 必须 `confirm: "DELETE_ALL"`；导出/删除期间聊天 409
- **日记心情与天气**：`diary_items` 加 `mood`/`weather`（旧库自动迁移），生成后一次短调用解析，白名单校验、失败留空；补文本不会抹掉已有值
- **额度**：`GET /api/quota` + `QUOTA_ENFORCE=1` 时用满返回 402
- **昵称**：`GET|PUT /api/profile`，并注入 system prompt
- **记忆编号**：`/api/memories` 每条带 `seq`（同一角色单调、删了不复用）
- **消息附件**：`messages.attachment_json` 迁移，历史消息带 `attachment`
- **排班**：health 增加 `schedule.journalTime`

`apps/api` 测试 161/161。

## 0.2.0 — 潮汐手帐 2.0 · 海边绘本日记

按 `docs/redesign/spec/WhalePartner_UI重设计规范.md`（2307 行）全量重做界面，分七个阶段推进，每阶段独立分支与 PR、独立验收。

### 设计系统（P0）
- 新 tokens：纸 `#F6EFE2` / 墨 `#2F3A4A`、4 档圆角、4px 间距、7 档字号、纸张投影两级；暗色只保留一份（`data-theme`）
- 纸纹作为背景图层（256px 瓦片，实测 std 6.06 / 均值偏移 0.5）
- 手绘基元：`ink.ts` 固定种子 + 模块级缓存 → `InkLine` / `InkFrame` / `Tape` / `Stamp` / `Tide`；19 个图标烘焙成静态字符串表；`WhaleSticker` 10 种 mood + `CompanionCorner`
- 首屏字体子集化：552KB → **195KB**（≤220KB 门）

### 聊天（P1）
- 她的回复 = 绘本字幕（文楷 17/1.9 + 名字牌 36 + 邮戳），你的话 = 手写便签（微旋、贴胶带、sending/failed 态）
- 流式「墨水渗入」，思考态 = 角色动作 + 小字 + 自画墨线；去掉三点 typing
- 往回翻 360 宽虚拟列表、日期分割；输入条 52→160 自增高、⌘Enter 发送、键盘 inset 处理
- `ConfirmDialog` 取代 `window.confirm`

### 日记 + 记忆（P2）
- 日记：Fraunces 日期戳、心情/天气涂鸦、周/月/年切换、横线本、日历弹层、视频区降级
- 记忆：五类分组、图鉴卡片（`No.00xx`）、搜索、时间段筛选、详情弹层
- 「忘掉」两步：480ms 折纸移出 → 5 秒内可撤回（期间不发 DELETE）→ 超时才真删

### 设置 / 引导 / 老人模式（P3）
- 设置页重做；额度、导出、删除全部、昵称走真实接口，拿不到就禁用并说明
- 首次引导 3 步可跳过；老人模式 root 20px、触控 56、导航 3 项、动效 calm

### 打磨（P4）
- 淘汰 token 清零、动效参数统一到 `src/motion/tokens.ts`、删除死代码
- `scripts/redesign/check.mjs`：10 项一键验收（对比度 / token / 禁用样式 / 触控 / 横滚 / axe …）

### 她自己去逛（P5）
- 后端：设置、选题去重、安全过滤、B 站搜索（自实现 WBI 签名）、网页阅读（playwright-core 无头）、总结、SSE、调度器
- 前端：见闻页（明信片、邮戳、打开/忘掉）、设置两组、聊天页舞台便签

### 后端（移植）
- `GET /api/quota`（读 `usage_ledger`）、`GET|PUT /api/profile` 按 main 的新路由结构重做

### 已知缺口
- P-B 的导出/删除全部、日记 mood 落库、记忆编号持久化仍待在 main 的新存储结构上重做（见 #44）
- 「她自己去逛 · 记忆第 5 类」需要 P-B 的 explorer 分类后才能归类
