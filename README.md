# WhalePartner · 鲸汐

住在电脑里的鲸系 AI 角色：记得你说过的话，替你看 B 站视频、读网页，并把日常记成一本日记。当前版本 **v0.2.6**，更新记录见 [CHANGELOG.md](CHANGELOG.md)。

<p align="center">
  <img src="docs/redesign/shots/P1/chat-desktop.png" width="860" alt="聊天页：舞台上的她 + 对话框">
</p>

**结构**：桌面/网页界面（`apps/client`，Tauri 2 + React）+ 本机后端（`apps/api`，Node，默认 `http://127.0.0.1:8787`）。界面只管显示，模型调用与数据都在后端。**必须先启动后端，界面才有用。**

---

## 快速开始

当前没有发布安装包（仓库无 CI，Release 只有源码），所有平台都需要从源码运行。先完成下一节"需要准备什么"。

通用的第一步（任何平台）：

```sh
git clone https://github.com/OmnixSI/WhalePartner.git && cd WhalePartner
cp apps/api/.env.example apps/api/.env      # Windows: copy apps\api\.env.example apps\api\.env
pnpm --dir apps/api install
pnpm --dir apps/client install
```

### 浏览器开发模式（所有平台，最简单）

```sh
pnpm --dir apps/api run serve               # 终端 1，保持运行
pnpm --dir apps/client run dev              # 终端 2
```

浏览器打开 `http://127.0.0.1:1420`。Vite 会把 `/api` 代理到 8787。

### macOS

1. 完成通用步骤，并执行 `pnpm --dir apps/client run tauri build`（首次编译 Rust 约 3 分钟）。
2. 产物在 `apps/client/src-tauri/target/release/bundle/macos/鲸汐.app`，拖到"应用程序"。未做公证，首次打开请右键 → 打开。
3. 双击仓库根目录的 `启动鲸汐.command`：它检查 `127.0.0.1:8787`，没有后端就在后台启动（日志 `/tmp/whalepartner-api.log`），然后打开"鲸汐"。
4. 不想构建：用上面的浏览器开发模式，或 `pnpm --dir apps/client run tauri dev` 打开桌面窗口（需先在另一终端启动后端）。

### Windows

仓库没有 Windows 启动脚本，也没有在 Windows 上验证过完整流程。已知缺口：Codex 兜底硬编码了 `/private/tmp`、B 站扫码登录只支持 macOS、`fetch-model` 依赖系统 `unzip`。

1. 安装 Node 26、pnpm、FFmpeg（见下表）；桌面窗口另需 Rust 与 Visual Studio C++ 生成工具（WebView2 在 Win11 自带）。
2. 完成通用步骤。
3. PowerShell 窗口 1：`pnpm --dir apps/api run serve`。
4. 窗口 2：`pnpm --dir apps/client run dev`，浏览器打开 `http://127.0.0.1:1420`；或改用 `pnpm --dir apps/client run tauri dev` 打开桌面窗口。

### Linux

同样没有验证过桌面构建。推荐用浏览器开发模式。

1. 安装 Node 26、pnpm、FFmpeg。
2. 完成通用步骤。
3. 终端 1：`pnpm --dir apps/api run serve`；终端 2：`pnpm --dir apps/client run dev`。
4. 浏览器打开 `http://127.0.0.1:1420`。若要 `tauri dev`，先按 [Tauri 官方文档](https://v2.tauri.app/start/prerequisites/#linux) 装 WebKitGTK 等系统库。

### 手机

**暂不支持。** iOS/Android 构建没有验证过。仅有的联调方式：同一局域网内用手机浏览器访问电脑，见"常见问题"，无登录保护，只在可信网络使用。

### 可选素材（不装也能聊天）

```sh
pnpm --dir apps/client run fetch-live2d     # 大肥鱼 Live2D 模型（CC BY-NC-SA 4.0，仅非商业）
pnpm --dir apps/client run fetch-model      # VRM 演示形象（需要系统有 unzip）
```

Live2D 还需要专有的 Cubism Core，仓库不分发：从 [官方 SDK](https://www.live2d.com/en/sdk/download/web/) 取 `live2dcubismcore.min.js`，放到 `apps/client/public/live2d/libs/`。缺少时舞台使用兜底形象，聊天不受影响。

---

## 需要准备什么

| 工具 | 版本 | 用途 | 安装 |
|---|---|---|---|
| Node.js | **26**（`.node-version`；api 的 `engines` 为 `>=26 <27`） | 后端、前端构建 | `fnm install 26 && fnm use 26`，或 nvm / 官网 |
| pnpm | 10 | 包管理（各 app 自带 lockfile） | `npm i -g pnpm` |
| FFmpeg | 任意较新版 | 视频抽帧/转写（发 B 站链接时用） | macOS `brew install ffmpeg`；Windows `winget install ffmpeg`；Linux `apt install ffmpeg` |
| 模型来源 | 二选一 | 聊天用的大模型 | DeepSeek API Key（推荐，填 `.env`）；或本机已登录的 [Codex CLI](https://github.com/openai/codex)（兜底，目前仅 macOS 可靠） |
| Rust | ≥ 1.90 | 仅构建/运行桌面窗口（`tauri build/dev`） | [rustup.rs](https://rustup.rs) |
| Chromium | playwright 版本 | 仅"她自己去逛"（见闻）功能 | `pnpm --dir apps/api exec playwright-core install chromium` |

---

## 配置

编辑 `apps/api/.env`（已被 git 忽略；密钥只由后端读取）。模板见 [`apps/api/.env.example`](apps/api/.env.example)。**不填任何键也能启动**，但没有模型可用时聊天会失败。

| 键 | 默认 | 必填 | 说明 |
|---|---|---|---|
| `DEEPSEEK_API_KEY` | 空 | 推荐 | 主模型 |
| `DEEPSEEK_MODEL` | `deepseek-flash` | 否 | 模型名 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | 否 | OpenAI 兼容接口 |
| `BACKUP_LLM_BASE_URL` / `_API_KEY` / `_MODEL` | 空 | 否 | 备用模型，三项都填才启用 |
| `CODEX_FALLBACK` | 开 | 否 | 设 `0` 关闭本机 Codex 兜底 |
| `API_HOST` / `API_PORT` | `127.0.0.1` / `8787` | 否 | 监听地址。桌面版界面写死 8787，改端口后桌面版连不上 |
| `LLM_TIMEOUT_MS` | `30000` | 否 | 模型超时 |
| `CHAT_CONTEXT_TOKENS` | `32000` | 否 | 聊天上下文预算 |
| `DIARY_CRON` / `JOURNAL_CRON` | `0 20 * * *` / `30 20 * * *` | 否 | 日记计划（本机时区，仅后端运行时生效） |
| `MEMORY` | 开 | 否 | 设 `off` 关闭语义索引；首次启用会下载约 25 MB 向量模型到 `apps/api/.local/memory/models` |
| `SURF_ENABLED` | 开 | 否 | 设 `0` 关闭自主冲浪（代码支持，模板里未列出） |
| `QUOTA_ENFORCE` | 关 | 否 | 设 `1` 才会在超额时返回 402（代码支持，模板里未列出） |

数据（SQLite、记忆、封面）默认存放在 `apps/api/.local/`，删除它等于清空所有数据。检查实际使用哪家模型：`pnpm --dir apps/api run llm:ping`。

---

## 常见问题

- **聊天区显示"网络好像断了，我在这儿等你"**：后端没在运行。执行 `pnpm --dir apps/api run serve`，或在 macOS 双击 `启动鲸汐.command`。验证：`curl http://127.0.0.1:8787/api/health`。
- **端口被占用（8787 或 1420）**：Mac/Linux 用 `lsof -ti:8787`（或 `:1420`）查看占用进程。后端可用 `API_PORT` 换端口，但桌面版固定连 8787，浏览器模式还需改 `apps/client/vite.config.ts` 的代理。
- **怎么彻底退出**：桌面 App 不托管后端，关窗口不会停止后端。后端在哪个终端启动就 `Ctrl-C`；用 `.command` 拉起的，执行 `lsof -ti:8787 | xargs kill`。Windows 用 `netstat -ano | findstr 8787` 找 PID 后 `taskkill /PID <PID> /F`。
- **没有形象 / 只显示默认鲸鱼**：没有 Live2D 或 VRM 文件，或缺 Cubism Core，见"可选素材"。
- **`pnpm install` 报引擎不符或 `onnxruntime-node` 下载失败**：确认 `node -v` 为 v26.x；`onnxruntime-node` 的安装脚本需要联网下载二进制，换网络或设置代理后重试。
- **发视频链接失败**：确认 `ffmpeg -version` 可用。B 站有限流，被限时后端会记录冷却时间，稍后再试；需登录的内容在非 macOS 上目前无法扫码登录。
- **"见闻"没有内容**：需安装 Chromium（上表）；或设 `SURF_ENABLED=0` 关闭该功能。
- **手机访问电脑上的界面**：`WP_LAN=1 pnpm --dir apps/client run dev` 加 `pnpm --dir apps/api run serve -- --lan`，手机浏览器访问 `http://<电脑IP>:1420`。该模式对局域网内所有人开放且无登录。
- **日记没按时生成**：定时任务只在后端运行时触发，电脑睡眠或后端未开会错过当天。

---

## 给 AI Agent

阅读顺序：[AGENTS.md](AGENTS.md) → [CONTRIBUTING.md](CONTRIBUTING.md) → [docs/PRODUCT_SCOPE.md](docs/PRODUCT_SCOPE.md) → 被指派的 GitHub Issue → Issue 引用的代码与文档。只实现当前 Issue 的范围。

| 目的 | 命令（均从仓库根目录执行） |
|---|---|
| 安装 | `pnpm --dir apps/api install && pnpm --dir apps/client install` |
| 后端 | `pnpm --dir apps/api run serve` |
| 前端开发 | `pnpm --dir apps/client run dev` |
| 桌面窗口开发 | `pnpm --dir apps/client run tauri dev` |
| 类型检查 | `pnpm --dir apps/api run typecheck && pnpm --dir apps/client run typecheck` |
| 测试 | `pnpm --dir apps/api test && pnpm --dir apps/client test` |
| 界面验收 | `node scripts/redesign/check.mjs`（`--static` 跳过浏览器，`--shots` 拍照） |
| 构建 | `pnpm --dir apps/client run build`（Web）；`pnpm --dir apps/client run tauri build`（桌面包） |
| 发布 | 无自动化。需同时改 `apps/client/package.json`、`apps/client/src-tauri/tauri.conf.json`、`apps/client/src-tauri/Cargo.toml` 的版本并更新 `CHANGELOG.md`；发布本身需开发者授权 |
| 模型连通 / 人格回归 | `pnpm --dir apps/api run llm:ping` / `pnpm --dir apps/api run persona:eval` |

仓库地图：

```
apps/api/            Node 后端（node:http + node:sqlite）
  src/routes/        HTTP 路由分发
  src/store/         数据仓储
  src/surf/          自主冲浪（Playwright）
  src/persona/       人格核心（身份、口吻、规则）
  test/              node:test 用例
apps/client/         React 19 + Vite + Tauri 2
  src/               界面；styles/tokens.css 是色彩与尺寸唯一来源
  src-tauri/         桌面壳（tauri.conf.json、Cargo.toml）
  scripts/           字体、模型下载、e2e 冒烟
docs/                产品、接口、设计文档；docs/redesign 为界面规范与验收记录
scripts/redesign/    界面验收脚本
implement-stage/     实施阶段的规格与假设记录
启动鲸汐.command      macOS 启动器（后端 + App）
```

规则：

- 不直接推 `main`，不合并自己的 PR；从最新 `main` 建分支 `feat|fix|docs/<issue>-<topic>`，一个 PR 对应一个 Issue，正文写 `Closes #N`。
- 提交前缀：`feat: fix: docs: refactor: test: chore:`。
- 不提交 `.env`、密钥、`node_modules`、构建产物；密钥只在后端读取。
- 规格位置：产品范围在 Notion 开发台和 `docs/PRODUCT_SCOPE.md`；界面规范在 `docs/redesign/spec/`；接口在 `docs/API.md`；执行进度以 GitHub Issue/PR 为准。
- 结束会话前按 [docs/SESSION_HANDOFF.md](docs/SESSION_HANDOFF.md) 在 Issue/PR 留交接记录。

---

## 文档索引

> 最新体验审查与修复清单：[docs/review/2026-11-08-体验审查.md](docs/review/2026-11-08-体验审查.md)

| 想了解 | 文档 |
|---|---|
| 协作流程、分支、PR | [CONTRIBUTING.md](CONTRIBUTING.md) · [AGENTS.md](AGENTS.md) |
| 产品边界 | [docs/PRODUCT_SCOPE.md](docs/PRODUCT_SCOPE.md) |
| 接口 | [docs/API.md](docs/API.md) |
| 界面设计与规范 | [docs/DESIGN.md](docs/DESIGN.md) · [docs/redesign/spec/](docs/redesign/spec/WhalePartner_UI重设计规范.md) |
| 人格与成长 | [docs/PERSONALITY.md](docs/PERSONALITY.md) |
| 记忆 | [docs/MEMORY_ARCHITECTURE.md](docs/MEMORY_ARCHITECTURE.md) · [docs/MEMORY_RESEARCH.md](docs/MEMORY_RESEARCH.md) |
| 日记与定时 | [docs/DAILY_JOURNAL.md](docs/DAILY_JOURNAL.md) |
| 技术选型 / Live2D 评估 | [docs/TECH_STACK_PROPOSAL.md](docs/TECH_STACK_PROPOSAL.md) · [docs/LIVE2D_ASSESSMENT.md](docs/LIVE2D_ASSESSMENT.md) |
| 会话交接 | [docs/SESSION_HANDOFF.md](docs/SESSION_HANDOFF.md) · [docs/handoffs/](docs/handoffs/) |

## 许可与第三方

`apps/api/vendor/dsh-bilibili/` 与 `apps/api/vendor/shuorenhua/` 为 MIT，保留原许可。Live2D 模型为 CC BY-NC-SA 4.0，仅限非商业。大肥鱼、Claude 娘、ChatGPT 娘是社区二创角色，不代表对应公司官方角色；鲸汐是原创角色。
