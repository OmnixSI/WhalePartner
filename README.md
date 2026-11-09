# WhalePartner · 鲸汐

住在电脑里的鲸系 AI 角色：记得你说过的话，替你看 B 站视频、读网页，并把日常记成一本日记。当前版本 **v0.3.0**，更新记录见 [CHANGELOG.md](CHANGELOG.md)。

<p align="center">
  <img src="docs/redesign/shots/P1/chat-desktop.png" width="860" alt="聊天页：舞台上的她 + 对话框">
</p>

**结构**：界面（`apps/client`，Tauri 2 + React 19）+ 后端（`apps/api`，Node 26）。**桌面 App 自带后端**：双击打开就能用，不需要另开终端；**关掉窗口就是退出**，后端一起停。想让她在你关窗后继续去逛，在设置里打开「后台继续逛」。同一个用户的所有设备连同一个「家」后端，内容实时同步，手机和别的电脑可以用网页端扫码配对。界面只管显示，模型调用与数据都在后端。

仓库没有 CI，Release 只有源码，所以第一次用需要自己构建：先看「需要准备什么」，再按「快速开始」走一遍。

---

## 需要准备什么

| 工具 | 版本 | 用途 | 安装 |
|---|---|---|---|
| Node.js | **26**（`.node-version`；api 的 `engines` 为 `>=26 <27`） | 后端、前端构建 | `fnm install 26 && fnm use 26`，或 nvm / 官网 |
| pnpm | 10 或 12 | 包管理（各 app 自带 lockfile） | `npm i -g pnpm` |
| FFmpeg | 任意较新版 | 视频抽帧/转写（发 B 站链接时用） | macOS `brew install ffmpeg`；Windows `winget install ffmpeg`；Linux `apt install ffmpeg` |
| 模型来源 | 二选一 | 聊天用的大模型 | DeepSeek API Key（推荐，填 `.env`）；或本机已登录的 [Codex CLI](https://github.com/openai/codex)（兜底，目前仅 macOS 可靠） |
| Rust | ≥ 1.90 | 仅构建/运行桌面窗口（`tauri build/dev`） | [rustup.rs](https://rustup.rs) |
| Chromium | playwright 版本 | 仅「她自己去逛」（见闻）功能 | `pnpm --dir apps/api exec playwright-core install chromium` |

macOS 打包还需要 Xcode Command Line Tools（`xcode-select --install`）。

---

## 快速开始

通用的第一步（任何平台）：

```sh
git clone https://github.com/OmnixSI/WhalePartner.git && cd WhalePartner
cp apps/api/.env.example apps/api/.env      # Windows: copy apps\api\.env.example apps\api\.env
pnpm --dir apps/api install
pnpm --dir apps/client install
```

### 桌面 App（推荐）

```sh
pnpm --dir apps/client run tauri build      # 首次编译 Rust 约 3 分钟；会先把后端打进包里
```

- 产物在 `apps/client/src-tauri/target/release/bundle/`（macOS 是 `macos/鲸汐.app`，Linux 有 `deb`/`appimage`，Windows 有 `msi`/`nsis`）。
- 只要 `.app`、不想让命令因为打 DMG 失败：`pnpm --dir apps/client run tauri build --bundles app`。默认 `targets: all` 会顺带做 DMG，macOS 上 `hdiutil` 偶尔遇到卷卸不掉（`资源忙`）会整条命令报错，此时 `.app` 其实已经生成好了。
- 打开 App 即可：它自己选端口、生成随机令牌、启动后端，健康检查通过后才显示窗口。**不用先启动后端，也不会弹出终端。**
- 关窗口即退出，后端随之停止。「后台继续逛」打开后，关窗口只是隐藏，托盘菜单里可以「打开鲸汐 / 退出鲸汐」。
- 数据放在系统的应用数据目录（macOS：`~/Library/Application Support/com.omnixsi.whalepartner/`），日志放在应用日志目录的 `api.log`。模型密钥在 **设置 › 模型接入** 里填，保存在数据目录的 `.env`（打包版读它，不读仓库里的 `apps/api/.env`）。
- macOS 本机开发包使用 ad-hoc 签名，不与其他应用共用签名身份。重建后 macOS 可能再次询问麦克风等隐私权限；首次打开可在「隐私与安全性」中手动允许。此签名只用于本机开发，不提供公证或公开分发信任；正式分发仍需 Developer ID 与公证。需要稳定的本机 TCC 身份时，按[本机 macOS 签名说明](docs/MACOS_LOCAL_SIGNING.md)为 WhalePartner 单独创建证书。请在 Node 26 下打包，后端运行时取自打包时的 Node。
- 从 Finder 或 Dock 启动时，macOS 不会读取 shell profile；桌面后端会把 Homebrew 的 Apple Silicon (`/opt/homebrew/bin`) 和 Intel (`/usr/local/bin`) 目录加入 PATH，以解析本机 Codex CLI 等命令行工具。
- 开发调试：`pnpm --dir apps/client run tauri dev` 会自动拉起后端，不用另开终端（后端读 `apps/api/.env`）。

### 浏览器开发模式（所有平台）

只想改界面或后端时，可以单独跑：

```sh
pnpm --dir apps/api run serve               # 终端 1：后端
pnpm --dir apps/client run dev              # 终端 2：界面
```

浏览器打开 `http://127.0.0.1:1420`，Vite 会把 `/api` 代理到 8787。这是开发用法，普通使用请用桌面 App。

---

## 多设备与网页端

- 后端（hub）也能直接托管网页端：`pnpm --dir apps/client run build` 之后，后端会在 `/` 提供界面，手机浏览器可「添加到主屏幕」。
- 在装了桌面 App 的那台设备上打开 **设置 › 我的设备 › 添加设备**，会出现二维码和 6 位配对码（10 分钟有效、只能用一次）。手机扫码，或在另一台设备的 **设置 › 连接到我的鲸汐** 填地址和配对码，就能看到同样的内容，并且实时一起聊天。设备可以随时撤销。
- 外出也要用：把后端部署到云服务器，或用 cloudflared 隧道，见 [docs/DEPLOY.md](docs/DEPLOY.md)。

## 其他平台

桌面构建在 macOS 与 Linux（`deb`）上实机验证过；Windows 与托盘、后台运行的细节只做过代码审查。已知缺口：B 站扫码登录只支持 macOS。手机没有原生 App，用浏览器开 hub 的网页端扫码配对即可，需要 hub 能被手机访问（同一 Wi-Fi 下 `pnpm --dir apps/api run serve -- --lan`，或按部署文档上云）。

- Windows 需要 Node 26、pnpm、FFmpeg，以及 Rust 与 Visual Studio C++ 生成工具（WebView2 在 Win11 自带）。
- Linux 需要先按 [Tauri 官方文档](https://v2.tauri.app/start/prerequisites/#linux) 装 WebKitGTK 等系统库。

## 可选素材（不装也能聊天）

```sh
pnpm --dir apps/client run fetch-live2d     # 大肥鱼 Live2D 模型（CC BY-NC-SA 4.0，仅非商业）
```

Live2D 还需要专有的 Cubism Core，仓库不分发：从 [官方 SDK](https://www.live2d.com/en/sdk/download/web/) 取 `live2dcubismcore.min.js`，放到 `apps/client/public/live2d/libs/`。缺少时舞台使用兜底形象，聊天不受影响。

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
| `API_HOST` / `API_PORT` | `127.0.0.1` / `8787` | 否 | 监听地址。桌面 App 自己选端口（优先 8787），不受此影响 |
| `LLM_TIMEOUT_MS` | `30000` | 否 | 模型超时 |
| `CHAT_CONTEXT_TOKENS` | `32000` | 否 | 聊天上下文预算 |
| `DIARY_CRON` / `JOURNAL_CRON` | `0 20 * * *` / `30 20 * * *` | 否 | 日记计划（本机时区，仅后端运行时生效） |
| `MEMORY` | 开 | 否 | 设 `off` 关闭语义索引；首次启用会下载约 25 MB 向量模型到数据目录下的 `memory/models` |
| `SURF_ENABLED` | 开 | 否 | 设 `0` 关闭自主冲浪（代码支持，模板里未列出） |
| `QUOTA_ENFORCE` | 关 | 否 | 设 `1` 才会在超额时返回 402（代码支持，模板里未列出） |

数据（SQLite、记忆、封面、浏览器、B 站登录）统一放在 `WP_DATA_DIR`：桌面 App 指向系统应用数据目录，未设置时（浏览器开发模式）退回 `apps/api/.local/`。删掉它等于清空所有数据。检查实际在用哪家模型：`pnpm --dir apps/api run llm:ping`。

---

## 常见问题

- **聊天区显示「她马上就来」或「网络好像断了」**：桌面 App 里是后端还在启动或刚崩溃，等几秒会自动重试；持续出现请看应用日志目录里的 `api.log`（启动超时时窗口会弹出日志路径）。浏览器开发模式下是后端没开，执行 `pnpm --dir apps/api run serve`。验证：`curl http://127.0.0.1:8787/api/health`（桌面 App 的端口和令牌是随机的，用不到它）。
- **打包后一打开就弹「鲸汐没能启动 / 后端连续退出了 4 次」**：v0.3.0 早期的包有这个问题——`tauri build` 用 hardened runtime 重签内置的 `whale-node` 时没带 JIT 授权，日志里会出现 `Fatal process out of memory: Failed to reserve virtual memory for CodeRange`。仓库已修（`src-tauri/entitlements.plist`），拉最新代码重新打包即可。
- **端口被占用（1420 或 8787）**：桌面 App 会自动换端口，不用处理。浏览器开发模式下可用 `API_PORT` 换后端端口，同时改 `apps/client/vite.config.ts` 的代理。
- **怎么退出**：关掉窗口即可，后端随之退出。如果打开了「后台继续逛」，用托盘菜单的「退出鲸汐」。
- **没有形象 / 一直只有一条海平线**：没有 Live2D 模型文件，或缺 Cubism Core（只有大肥鱼有 Live2D 形象，其他角色固定显示自己的徽记），见「可选素材」；加载失败时舞台底部会出现「再试一次」。
- **`pnpm install` 报引擎不符或 `onnxruntime-node` 下载失败**：确认 `node -v` 为 v26.x；`onnxruntime-node` 的安装脚本需要联网下载二进制，换网络或设置代理后重试。
- **发视频链接失败**：确认 `ffmpeg -version` 可用（桌面包里自带）。B 站有限流，被限时后端会记录冷却时间，稍后再试；需登录的内容在非 macOS 上目前无法扫码登录。
- **「见闻」没有内容**：她需要浏览器才能去逛；没有 Chromium 时后端会自动下载，设置里「翻网页」下能看到进度。也可设 `SURF_ENABLED=0` 关闭该功能。
- **日记没按时生成**：定时任务只在后端运行时触发。桌面 App 关窗即退出，要在关窗后照常生成，请打开「后台继续逛」；电脑睡眠也会错过当天。

---

## 给 AI Agent

阅读顺序：[AGENTS.md](AGENTS.md) → [CONTRIBUTING.md](CONTRIBUTING.md) → [docs/PRODUCT_SCOPE.md](docs/PRODUCT_SCOPE.md) → 被指派的 GitHub Issue → Issue 引用的代码与文档。只实现当前 Issue 的范围。

| 目的 | 命令（均从仓库根目录执行） |
|---|---|
| 安装 | `pnpm --dir apps/api install && pnpm --dir apps/client install` |
| 后端 | `pnpm --dir apps/api run serve` |
| 前端开发 | `pnpm --dir apps/client run dev` |
| 桌面窗口开发（自动拉起后端） | `pnpm --dir apps/client run tauri dev` |
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
  src-tauri/         桌面壳（tauri.conf.json、Cargo.toml、entitlements.plist）
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
| 关系成长 | [docs/RELATIONSHIP.md](docs/RELATIONSHIP.md) |
| 界面设计与规范 | [docs/DESIGN.md](docs/DESIGN.md) · [docs/redesign/spec/](docs/redesign/spec/WhalePartner_UI重设计规范.md) |
| 人格与成长 | [docs/PERSONALITY.md](docs/PERSONALITY.md) |
| 记忆 | [docs/MEMORY_ARCHITECTURE.md](docs/MEMORY_ARCHITECTURE.md) · [docs/MEMORY_RESEARCH.md](docs/MEMORY_RESEARCH.md) |
| 日记与定时 | [docs/DAILY_JOURNAL.md](docs/DAILY_JOURNAL.md) |
| 技术选型 / Live2D 评估 | [docs/TECH_STACK_PROPOSAL.md](docs/TECH_STACK_PROPOSAL.md) · [docs/LIVE2D_ASSESSMENT.md](docs/LIVE2D_ASSESSMENT.md) |
| 连续语音与情绪语音 | [docs/VOICE_MODE.md](docs/VOICE_MODE.md) |
| 会话交接 | [docs/SESSION_HANDOFF.md](docs/SESSION_HANDOFF.md) · [docs/handoffs/](docs/handoffs/) |

## 许可与第三方

主要依赖：Tauri、React、Radix、motion、perfect-freehand、PixiJS 与 pixi-live2d-display、mem0（Apache-2.0）、transformers.js（Apache-2.0）、playwright-core（Apache-2.0）。模型素材不入库。

`apps/api/vendor/dsh-bilibili/` 与 `apps/api/vendor/shuorenhua/` 为 MIT，保留原许可。Live2D 模型为 CC BY-NC-SA 4.0，仅限非商业。大肥鱼、Claude 娘、ChatGPT 娘是社区二创角色，不代表对应公司官方角色；鲸汐是原创角色。
