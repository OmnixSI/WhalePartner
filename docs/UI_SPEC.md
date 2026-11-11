# WhalePartner（鲸汐）客户端 UI 重设计规范 —「潮汐手帐 2.0 · 海边绘本日记」

> 本规范冻结于 2026-11-07，实现现状以 [DESIGN.md](DESIGN.md) 为准。文中提到的脚本和文件路径是当时的计划，部分已调整：界面检查脚本现在是 `apps/client/scripts/ui-check.mjs` 与 `contrast-check.mjs`。
>
> 文档版本 2.0（已按产品负责人的最终决定修订）· 2026-11-07 · 适用仓库 `OmnixSI/WhalePartner` 的 `apps/client`
> 读者：任何编码 Agent（Claude Code、Codex 等）。读完本文即可端到端实现，不需要其他上下文。
> 本文所有颜色对比度均为按 WCAG 2.x 相对亮度公式**实算**的结果（见 §4.3），不是估计。
> 行号均指 `apps/client/src/` 下的当前文件（审计于 2026-11-07）。

---

## 0. 一页摘要 + 阅读顺序

### 0.1 一句话
上一轮「潮汐手帐」正确地去掉了毛玻璃、渐变、发光，但**减过头了**：细线 + 灰字 + 纯文字导航 + 角色只在首页，结果像冷淡的后台工具。本轮**不推倒重来**，保留「纸 / 墨 / 海平线 / 霞鹜文楷」的骨架，加上**温度**：更暖的纸、更软的墨、纸的颗粒、手绘不完美的线、邮戳和胶带、水彩平涂的浪、**每一页都有她**。同时补齐后端（额度、导出与删除、日记心情天气、记忆编号、昵称）并新增「她自己去逛」（自主刷视频 + 网上冲浪）。

### 0.2 十二条核心决定（Agent 不得擅改）

| # | 决定 | 具体值 |
|---|---|---|
| 1 | 纸色 / 墨色 | 亮 `#F6EFE2` / `#2F3A4A`；暗（深海夜）`#0F1C2A` / `#EDE6D6` |
| 2 | 强调色 | 仍然每个角色一种，且只有一种；**珊瑚 `#E8765E` 只用作大面积装饰和“危险/注意”的底色，永远不做小字**（它在纸上只有 2.56:1） |
| 3 | 聊天 | 她的话 = 贴在舞台下方的**绘本字幕 / 视觉小说对话框**（文楷 17px，带“名字牌”）；你的话 = 一张**手写小纸条**；历史在“往回翻”里 |
| 4 | 流式输出 | 新字“墨水渗入”（opacity+2px 位移，240ms）；**不再有三点 typing**，换成“角色思考动作 + 一行小字 + 会自己画线的墨线” |
| 5 | 手绘 | `perfect-freehand` 固定种子生成分隔线、下划线、边框、图标；不用 `filter` 去“抖动”大面积元素 |
| 6 | 字体 | 她的声音/标题/日记 = 霞鹜文楷；界面 chrome = 霞鹜新晰黑；日期数字 = Fraunces |
| 7 | 动效 | `motion`（`motion/react`）+ 弹簧；只动画 `transform` 与 `opacity`；所有常驻动效在 `prefers-reduced-motion`、安静模式、老人模式下关闭 |
| 8 | 无障碍 | 正文对比度 ≥7:1，任何文字 ≥4.5:1；触控 ≥44px，老人模式 ≥56px；正文 ≥16px、聊天 17px；老人模式整体 ×1.25 |
| 9 | 禁止 | `window.confirm`、`backdrop-filter`、任何 `gradient`、发光/彩色/模糊半径 >12px 的阴影、emoji 当图标、“AI 助手 / 智能 / 为您生成”类文案 |
| 10 | 形象 | 鲸汐继续使用 `characters.ts` 里现有的 VRoid 示例模型（紫发，`modelId: "avatar-b"`）；`WhaleSticker`（代码绘制的小鲸）只有两个用途：舞台形象加载失败时的兜底，以及非聊天页右下角的 `CompanionCorner` 小贴纸 |
| 11 | 后端 | 本规范包含后端实现任务（阶段 P-B）：额度、导出/删除全部数据、日记心情与天气、记忆图鉴编号、昵称注入。全部按 `apps/api` 现有风格（`node:http` 路由 + `node:sqlite` + `node:test`）实现 |
| 12 | 新功能 | 「她自己去逛」（阶段 P5）：她按计划自己刷 B 站视频、用无头浏览器上网冲浪，结果进入记忆、日记，并在聊天里主动分享 |

### 0.3 给 Agent 的阅读顺序
1. **必读**：§0 → §1（知道要消灭什么）→ §2（原则）→ §4（tokens，可直接粘贴）。
2. **按阶段读**：做 P0 读 §5、§10.1–10.4；做 P-B 读 §10.5；做 P1 读 §6（聊天相关）、§7.1、§8；做 P2 读 §7.2/7.3；做 P3 读 §7.4/7.5、§9；做 P5 读 §7.7、§10.6。
3. **每个阶段结束必读**：§12（验收与迭代循环）。
4. **需要提示词时**：§13 整段复制。**需要查某个决定的最终答案时**：§14。
5. 先读仓库的 `AGENTS.md`、`CONTRIBUTING.md`、`docs/PRODUCT_SCOPE.md`、`docs/DESIGN.md`、`docs/API.md`；改完风格**同步更新 `docs/DESIGN.md`**，改完接口**同步更新 `docs/API.md`**。

### 0.4 已定的产品前提
- 聊天页名字牌里保留一个小的“AI 角色”标签，作为设计元素（邮戳样式），不再作为需要逐条核对的规则。
- 界面不出现 API Key / 模型 / 后端 / token 等词（“详情”折叠内除外）；不用“她会难过”催充值；不做抽卡；这些是文案与体验取向，在 §12.5 自检表中检查。
- 引入依赖只看是否好用：版本在 §10.2 固定写明，直接安装，不需要额外的核对步骤。
- PR 由项目负责人本人合并；Agent 只负责开分支、提交、开 PR，不推 `main`。

---


## 1. 现状诊断

### 1.1 总判断
`grep` 显示全仓库只有 3 处 `box-shadow`、`WhaleFigure.tsx` 里 3 个渐变，视觉上的“AI 渐变味”已经不重。**剩下的问题是另一种“味”：克制到冷淡的后台工具味**。陪伴感全靠立绘一人承担，其余是文档式界面。

### 1.2 剩余的“AI 味”清单（逐条要消灭）

| # | AI 味特征 | 位置 | 处理 |
|---|---|---|---|
| A1 | 三点 typing 指示 | `styles/layout.css:62-66`（`.typing i`），`components/ChatPanel.tsx:198` | 删除。换角色“思考”动作 + 一行轮换小字 + 自画墨线（§6.6） |
| A2 | 暴露模型名/后端状态：“在线 · deepseek-flash”“后端未连接”“正在连接…” | `ChatPanel.tsx:179`；输入框 placeholder `ChatPanel.tsx:212`；`Accounts.tsx:20`；`SettingsPage.tsx:82` | 正常时**什么都不显示**；异常时角色化（“她睡着了/有点连不上”，§7.1.6） |
| A3 | 模板化空状态：“这里还没有记录 / 试试其他分类…”“这段时间没有日记。”“没有视频记录” | `MemoryPage.tsx:207`；`DailyJournalList.tsx:241`；`DiaryPage.tsx:196`；聊天空态仅一条 greeting `ChatPanel.tsx:195` | 全部换成角色 + 文案 + 一个主动作（§7 各页、§7.6 汇总表） |
| A4 | 渐变占位鲸（通用吉祥物脸） | `components/WhaleFigure.tsx:6-18`（`wf-body`、`wf-belly`、`wf-shine`），全仓库仅有的渐变 | 用平涂 + 手绘描边的 `WhaleSticker` 重画（§5.7） |
| A5 | `window.confirm`（Tauri WebView 不可靠） | `pages/MemoryPage.tsx:135`、`components/ChatSessionControls.tsx:35`；而 `SettingsPage.tsx:21` 自己注释了它不可靠，`SettingsPage.tsx:23`、`Accounts.tsx:85` 又各用一种“二次点击” | 统一为 Radix `AlertDialog`（§6.9），三种确认形态合并为一种 |
| A6 | 技术/运维语言外露 | “第 N 版” `DailyJournalList.tsx:115,123`；“立即处理一条/自动处理” `DiaryPage.tsx:173`；“演示形象 · 仅内部展示” `ChatPage.tsx:37` | 改成她的口吻（§7.2、§7.4） |
| A7 | 通用药丸标签 + 与 DESIGN.md 矛盾 | `.tag` `border-radius:999px` `layout.css:28`（DESIGN.md 却写“没有胶囊徽标”） | “AI 角色”改为名字牌里的小邮戳（§6.7），圆角体系收敛（§4.6） |
| A8 | 原生控件当主控件 | 会话 `<select>` + `<details>` “···”（无外点关闭/焦点管理）`ChatSessionControls.tsx:42-46`、`layout.css:37-44`；原生 `date` input `layout.css:221` | Radix DropdownMenu / Popover + 自制月历（§6.10、§7.2） |

### 1.3 “不温馨”的证据

| # | 问题 | 位置 / 数据 |
|---|---|---|
| W1 | 角色只在首页；日记/记忆/设置三页无角色 | `App.tsx` 路由 + `Ocean.tsx:7` 仅 `/` 画浪；其余页纯纸 |
| W2 | 灰字过淡：`--ink-faint #858E96` 在 `#F4F1E8` 上**仅 2.95:1**（低于 AA 4.5），暗色 `#7B858D` 在 `#0E1A26` 上 4.67:1；用在 11–13px 小字上 | `tokens.css:11,36`；`layout.css:34,118,150,153,... ` |
| W3 | 全站“文字即按钮”，主操作识别度低；同页出现深色实心 / 下划线链接 / 细边框三种按钮 | `layout.css:73,107,183-187` |
| W4 | 导航只有 15–17px 文字，无图标 | `Nav.tsx:15-17`；`layout.css:8-11,248` |
| W5 | 页面标题模板：每页“大衬线标题 + 灰副标题” | `layout.css:80-84` |
| W6 | 聊天：角色与对话分离，她的话是“侧栏里的一段文字 + 2px 竖线”；无头像/时间/复制/显式重试 | `layout.css:30,58-60`；`ChatPanel.tsx:196` |
| W7 | 记忆页像数据库浏览器：8 类 select + 筛选浮层 + 时间线 + 分页 | `MemoryPage.tsx`；`layout.css:128-161` |
| W8 | 设置页是表单：原生 select 列出 24+ 个 VRM 名称（噪音）；无预览、无额度、无导出 | `SettingsPage.tsx:50-60`；`layout.css:163-175` |
| W9 | 日记像日志列表：无日期大字、无心情图、无“翻页”感 | `layout.css:228-230`；`DailyJournalList.tsx:123` |

### 1.4 “不好用”的证据
- 触控目标 <44px：`.chat__new`/会话 select 36px（`layout.css:37,48`）、日记步进 32px（`:218`）、“···” 32px（`:39`）。与 `docs/DESIGN.md` 自己写的“≥44px”不符。
- 手机键盘弹起时舞台不收缩，聊天区被挤没（`layout.css:250`，`.home` 固定 `40dvh`）。
- 视频分享入口藏在日记页折叠里，聊天里发链接才生效却无任何提示（`ChatPanel.tsx:212` 的 placeholder 只有“和X说点什么…”）。
- 失败消息只变红字，“重试”是把文字塞回输入框（`ChatPanel.tsx:158-159`）。
- 全屏噪点 `body::after` 固定在 `z-index:50` 并用 `mix-blend-mode`，叠在 Live2D 画布之上，WebView/移动端有合成成本（`base.css:17-22`）→ 本轮改成背景图层（§5.1）。
- `index.html` 的 `theme-color #0b2540` 是旧深蓝，与 tokens 不一致。
- 圆角实际有 4/5/6/8/10/999/50% 七种，不是“只有 6 和 10”。

---

## 2. 设计原则（7 条，每条“做 / 不做”）

**P1 她在场（Presence）**——每一页都有她，且会因状态变化。
- 做：聊天页是舞台；日记/记忆/设置页右下角有 `<CompanionCorner/>`（桌面 112px、手机 64px 的贴纸角色），随页面状态切换姿势（写字、捧瓶子、挥手、睡着）。
- 不做：把她只关在首页；或在小角里再起一个 Live2D 实例（§5.7）。

**P2 纸与手（Paper & Hand）**——一切像印在纸上、用手画的，不像渲染出来的。
- 做：纸纹背景图层、`InkLine` 手绘分隔线、胶带、邮戳；卡片允许 ±1° 微旋转（老人模式关闭）。
- 不做：渐变、毛玻璃、发光、模糊大阴影、统一大圆角卡片矩阵。阴影只有“纸张投影”（§4.7）。

**P3 说话像说话（Voice）**——文案是她在说，不是系统在报。
- 做：“我想想哦…”“网络好像断了，我在这儿等你。”
- 不做：“正在生成”“后端未连接”“AI 助手”“为您”。错误码放进“详情”。

**P4 一屏一件事（Clarity）**——每屏一个主动作，位置固定，颜色固定（强调色实心按钮）。
- 做：主按钮 = 强调色实底 + 反色字 + 图标；次要 = 纸底描边；危险 = `--alert` 实底。
- 不做：同页三种按钮风格；把运维功能（“立即处理一条”）放在主视线。

**P5 看得清、点得到（Legible）**——对比度和尺寸是硬指标。
- 做：正文 ≥7:1；最小字号 13px 仅限邮戳/编号/时间；触控 ≥44px。
- 不做：用 `ink-faint` 级灰字写需要读的内容；珊瑚小字。

**P6 小小的奖励（Cozy feedback）**——借 Animal Crossing / 旅行青蛙 / Finch 的“收到了”的手感，但不做抽卡、不催充值。
- 做：新记忆“落进瓶子”的 400ms 动画、日记写好后“邮戳落下”、角色点一下会回应。
- 不做：弹窗奖励、红点轰炸、倒计时、“她会难过”。

**P7 慢而稳（Calm）**——动效少、软、可关。
- 做：弹簧默认无回弹（stiffness 300 / damping 30），常驻动效只有呼吸、眨眼、浪漂。
- 不做：自动轮播、闪烁、位移 >24px 的入场、任何 >600ms 的 UI 动画（翻页除外）。

---

## 3. 风格参考

**主方向：A「海边手帐 · 绘本日记」**（`research/references.md` §2.A，推荐方向）。借 B 的“游戏式反馈”（幅度减半），借 C 的“图鉴编号”。**明确反面：ChatGPT / Character.ai / Replika 的布局**（居中窄列 + 灰蓝气泡 + 头像小圆 + 底部长输入框；暗色渐变 + 发光描边）。

以下链接作情绪板与出处参考。

| 参考 | 链接 | 具体借什么 | 不借什么 |
|---|---|---|---|
| Finch 自我关怀宠物 | https://screensdesign.com/showcase/finch-self-care-pet | 角色常驻、对话式引导、**每步有进度**、完成后的小奖励 | 其设置/任务页选项过多（Pratt 批评，https://ixd.prattsi.org/2026/02/design-critique-finch-self-care-pet-ios-app/）→ 我们设置每组 ≤5 项 |
| 旅行青蛙 | https://zh.wikipedia.org/wiki/旅行青蛙 | “等待”本身是体验；明信片/日记式回看；极简 UI | 不做离线放置数值 |
| Animal Crossing NookPhone / 对话框 | https://animal-crossing.com/new-horizons/ | 名字牌对话框、按钮按下收缩的手感、图鉴式收集 | 不做大量音效和彩色圆底图标 |
| 视觉小说 ADV 对话框 + Backlog | https://www.renpy.org | 底部对话框 + 名字牌；**Backlog（往回翻）**把“现场”和“历史”分开 | 不做点击逐字推进（保证可整页阅读） |
| Day One | https://dayoneapp.com | 日期大数字 + 条目排版、一天一页 | 不做富媒体编辑器 |
| Spiritfarer | https://thunderlotusgames.com/spiritfarer | 手绘温柔、告别主题的克制情绪、角色与环境同框 | 不模仿其角色造型 |
| Unpacking | https://unpacking.game | 手作小物件的摆放感 → 记忆“拾到的东西” | 像素风格 |
| 崖上的波妞（水彩海） | https://www.ghibli.jp/works/ponyo/ | 平涂水彩的海浪层次与留白 | 不使用任何官方素材 |
| Apple 辅助访问 Assistive Access | https://support.apple.com/guide/iphone/assistive-access-iph77bd4f6e5/ios | 老人模式：大按钮、少入口、单任务 | — |
| Emil Kowalski 动效 | https://animations.dev | UI 动效 ≤300ms、ease-out、按下 scale 0.97 | — |
| AI 味清单 | https://www.925studios.co/blog/ai-slop-design-tells ；https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website | §12.5 自检表的来源（Inter、紫蓝渐变、居中 hero、三个等宽卡片、sparkle 图标） | — |
| Dribbble 检索 | https://dribbble.com/search/journal-app-illustration ；https://dribbble.com/search/watercolor-ocean-ui | 只作情绪板，**不临摹、不使用素材** | — |

**从方向 C 借的**：记忆页的“图鉴编号 No.0042”、小型大写标签、克制的网格。**从方向 B 借的**：按下反馈（scale 0.97 + 弹簧 400/17 仅用于“收藏/邮戳”类可爱场景）、角色点击回应。**拒绝的**：B 的彩色圆底图标和粗描边（与老人模式的低信息密度冲突）；C 的“冷”（角色会被 UI 压过）。

---

## 4. 设计 tokens

### 4.1 决策摘要
- **颜色**：纸 `#F6EFE2` 家族、墨 `#2F3A4A` 家族；暗色“深海夜”是**暖黄灯光下的深蓝夜**（纸 `#0F1C2A`、墨 `#EDE6D6`、灯 `#F2C14E`），不是纯黑加霓虹。
- **暗色只声明一次**：旧 `tokens.css:25-52` 把暗色写了两份（媒体查询 + `[data-theme=dark]`）。新方案由 JS 把“跟随系统”**解析**成 `data-theme="light|dark"` 写在 `<html>` 上，CSS 只有一份暗色（§4.9）。
- **字号用 rem**：这样“字号滑块”和“老人模式 ×1.25”只改 `html{font-size}` 一个值（`--scale`）。
- **间距 4px 体系**，圆角收敛为 4 档，线条 2 档，阴影只有“纸张投影”2 档。

### 4.2 `apps/client/src/styles/tokens.css`（完整替换，可直接粘贴）

```css
/* 潮汐手帐 2.0 · design tokens
   纸 / 墨 / 一种强调色（随角色）/ 珊瑚只做装饰与危险底色。
   禁止：任何 gradient、backdrop-filter、发光阴影。 */
@layer tokens {
:root {
  /* ---- 字体 ---- */
  --font-voice: "LXGW WenKai", "LXGW WenKai Subset", "Songti SC", "Noto Serif CJK SC", serif;      /* 她的声音/标题/日记 */
  --font-ui: "LXGW Neo XiHei", system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; /* 界面 chrome */
  --font-num: "Fraunces Variable", "LXGW WenKai", Georgia, serif;                                  /* 日期/编号数字 */

  /* ---- 字号（rem；1rem = 16px × --scale） ---- */
  --fs-micro: .8125rem;   /* 13px  邮戳/编号/时间，唯一允许 <14px 的档，且只用 --ink-mute 及更深 */
  --fs-small: .875rem;    /* 14px  辅助说明 */
  --fs-body: 1rem;        /* 16px  UI 正文 */
  --fs-chat: 1.0625rem;   /* 17px  她的话（文楷） */
  --fs-diary: 1.125rem;   /* 18px  日记正文（文楷） */
  --fs-h3: 1.25rem;       /* 20px */
  --fs-h2: 1.5rem;        /* 24px */
  --fs-h1: 2rem;          /* 32px */
  --fs-display: 2.75rem;  /* 44px  页面大标题（仅桌面） */
  --fs-date: 3.5rem;      /* 56px  日记日期大数字（Fraunces） */
  --lh-tight: 1.25; --lh-ui: 1.5; --lh-body: 1.7; --lh-voice: 1.9; --lh-diary: 2; /* 18px×2 = 36px 横线本行距 */
  --ls-voice: .02em; --ls-label: .06em;

  /* ---- 颜色 · 晨光（亮）---- */
  color-scheme: light;
  --paper: #F6EFE2;      /* 底 */
  --paper-2: #EDE3D0;    /* 次级纸：输入底、凹陷、选中底 */
  --sheet: #FBF7EE;      /* 抬起的纸：对话框、卡片、弹层 */
  --ink: #2F3A4A;        /* 正文 */
  --ink-soft: #3F4A5C;   /* 次要正文（仍 ≥7:1） */
  --ink-mute: #525D70;   /* 时间/编号/说明，≥5.2:1，用于 ≥13px */
  --line: rgb(47 58 74 / .20);        /* 装饰性细线（不承载信息） */
  --line-strong: #7D8795;             /* 输入框/开关等“控件边界”，≥3:1 */
  --accent: #1A6670;                  /* 随角色，见 characters.css */
  --accent-ink: #FBF7EE;              /* 实心强调色上的字 */
  --accent-wash: color-mix(in oklab, var(--accent) 14%, var(--sheet)); /* 名字牌/选中底；其上用 --ink 或 --accent */
  --coral: #E8765E;      /* 仅：胶带/邮戳大图形/插画；严禁文字 */
  --coral-soft: #F4B9A8; /* 其上可放 --ink（6.77:1） */
  --alert: #A8372B;      /* 危险/错误：文字、实心按钮、点 */
  --alert-ink: #FBF7EE;
  --alert-wash: #F3E4DB; /* 错误纸条底，其上 --alert 5.2:1、--ink 9.3:1 */
  --ok: #2F6B3F;
  --lamp: #F2C14E;       /* 灯塔黄：仅装饰（星、灯、胶带） */
  --lamp-text: #7A5200;  /* 需要黄色系文字时用它 */
  --slip: #FFF1B8;       /* 你的话：手写便签底 */
  --tape-a: #F2B8A8; --tape-b: #BFE0DC; --tape-c: #F2D58A; --tape-d: #D9C7E8; /* 4 色胶带 */
  --sea-1: color-mix(in oklab, var(--accent) 14%, var(--paper)); /* 远浪 */
  --sea-2: color-mix(in oklab, var(--accent) 22%, var(--paper)); /* 中浪 */
  --sea-3: color-mix(in oklab, var(--accent) 34%, var(--paper)); /* 近浪，其上 --ink ≥5.8:1 */
  --shadow-1: 0 1px 0 rgb(47 58 74 / .10), 0 2px 4px -1px rgb(47 58 74 / .14);  /* 平放的纸 */
  --shadow-2: 0 1px 0 rgb(47 58 74 / .10), 0 8px 12px -6px rgb(47 58 74 / .26); /* 被拿起的纸（拖拽/弹层） */

  /* ---- 间距 4px 体系 ---- */
  --sp-1: .25rem; --sp-2: .5rem; --sp-3: .75rem; --sp-4: 1rem; --sp-5: 1.25rem; --sp-6: 1.5rem;
  --sp-8: 2rem; --sp-10: 2.5rem; --sp-12: 3rem; --sp-16: 4rem; --sp-20: 5rem;

  /* ---- 圆角：只有 4 档 + 1 个圆 ---- */
  --r-xs: 4px;    /* 胶带、kbd、焦点环 */
  --r-sm: 8px;    /* 输入框、芯片、小按钮 */
  --r-md: 14px;   /* 按钮、便签、卡片 */
  --r-lg: 20px;   /* 对话框、底部抽屉 */
  --r-round: 999px; /* 仅：开关轨道、头像、徽点 */

  /* ---- 线条与焦点 ---- */
  --stroke-1: 1.5px; --stroke-2: 2.5px;
  --focus-ring: 0 0 0 2px var(--paper), 0 0 0 5px var(--accent); /* 双环：任何底色上都可见 */

  /* ---- 布局与触控 ---- */
  --hit: 44px;               /* 触控最小目标；老人模式 56px */
  --nav-w: 112px; --backlog-w: 360px; --tabbar-h: 64px; --scene-min: 480px;
  --page-max: 760px; --memory-max: 960px;

  /* ---- 层级 ---- */
  --z-bg: 0; --z-stage: 1; --z-ui: 10; --z-nav: 20; --z-sheet: 30; --z-dialog: 40; --z-toast: 50;

  /* ---- 动效 ---- */
  --dur-press: 120ms; --dur-hover: 160ms; --dur-fade: 200ms; --dur-panel: 280ms; --dur-ink: 240ms; --dur-page: 520ms;
  --ease-out: cubic-bezier(.23, 1, .32, 1);
  --ease-inout: cubic-bezier(.65, 0, .35, 1);
  --breath: 4.5s; /* 呼吸周期，4–5s */
}

/* ---- 深海夜（暗）：唯一一份 ---- */
:root[data-theme="dark"] {
  color-scheme: dark;
  --paper: #0F1C2A; --paper-2: #17283A; --sheet: #13222F;
  --ink: #EDE6D6; --ink-soft: #CBD2D7; --ink-mute: #A0ACB6;
  --line: rgb(237 230 214 / .18); --line-strong: #6B7A88;
  --accent-ink: #0F1C2A;
  --accent-wash: color-mix(in oklab, var(--accent) 16%, var(--sheet));
  --coral: #F08A72; --coral-soft: #5C3A34;
  --alert: #FF9C86; --alert-ink: #0F1C2A; --alert-wash: #3A2A2A;
  --ok: #8FD3A0; --lamp: #F2C14E; --lamp-text: #F2C14E;
  --slip: #3A3420;
  --tape-a: #8A5A52; --tape-b: #3F6B6B; --tape-c: #8A7440; --tape-d: #5E4F78;
  --sea-1: color-mix(in oklab, var(--accent) 14%, var(--paper));
  --sea-2: color-mix(in oklab, var(--accent) 22%, var(--paper));
  --sea-3: color-mix(in oklab, var(--accent) 34%, var(--paper));
  --shadow-1: 0 1px 0 rgb(0 0 0 / .35), 0 2px 4px -1px rgb(0 0 0 / .45);
  --shadow-2: 0 1px 0 rgb(0 0 0 / .35), 0 8px 12px -6px rgb(0 0 0 / .6);
}

/* ---- 老人模式 / 高对比 / 安静 ---- */
:root[data-elder="on"] {
  --hit: 56px;
  --ink-mute: var(--ink-soft);           /* 取消最浅的一档灰 */
  --line-strong: var(--ink-mute);        /* 控件边界升到 ≥5:1 */
  --stroke-1: 2px; --stroke-2: 3px;
  --r-md: 16px;
  --page-max: 680px;
}
:root[data-contrast="high"] { --ink-mute: var(--ink-soft); --line-strong: var(--ink-mute); }
:root[data-motion="calm"] { --dur-press: 1ms; --dur-hover: 1ms; --dur-panel: 120ms; --dur-page: 120ms; }

html { font-size: calc(16px * var(--scale, 1)); }
:root { -webkit-text-size-adjust: 100%; }

@media (prefers-reduced-motion: reduce) {
  :root { --dur-press: 1ms; --dur-hover: 1ms; --dur-panel: 120ms; --dur-page: 120ms; --dur-ink: 120ms; }
}
}
```

### 4.3 对比度（实算，WCAG 相对亮度公式）

“底”列为文字所在背景。**任何新增颜色组合必须先用 §12.2 的脚本验算再使用。**

**晨光（亮）**

| 前景 | 色值 | paper `#F6EFE2` | paper-2 `#EDE3D0` | sheet `#FBF7EE` | slip `#FFF1B8` | 用途 |
|---|---|---|---|---|---|---|
| ink | `#2F3A4A` | 10.06 | 9.04 | 10.76 | 10.15 | 正文 |
| ink-soft | `#3F4A5C` | 7.83 | 7.03 | 8.37 | 7.90 | 次要正文 |
| ink-mute | `#525D70` | 5.81 | 5.22 | 6.22 | 5.87 | 时间/编号/说明（≥13px） |
| 鲸汐 accent | `#1A6670` | 5.78 | 5.19 | 6.18 | 5.83 | 链接/强调 |
| 大肥鱼 accent | `#2E4BB8` | 6.52 | 5.86 | 6.98 | 6.58 | 同上 |
| 小克 accent | `#9F4326` | 5.56 | 4.99 | 5.94 | 5.61 | 同上 |
| 小智 accent | `#0A6B53` | 5.67 | 5.09 | 6.06 | 5.72 | 同上 |
| alert | `#A8372B` | 5.66 | 5.08 | 6.05 | 5.71 | 错误文字/危险按钮 |
| lamp-text | `#7A5200` | 6.05 | 5.44 | 6.47 | 6.11 | 黄色系文字 |
| ok | `#2F6B3F` | 5.57 | 5.01 | 5.96 | 5.62 | 成功文字 |
| **coral（禁止做文字）** | `#E8765E` | **2.56** | 2.30 | 2.73 | — | 仅装饰；其上放 ink 仅 3.94（只允许 ≥24px 粗体或纯图形） |

| 组合 | 比值 |
|---|---|
| `--accent-ink #FBF7EE` 在实心 accent 上：鲸汐 / 大肥鱼 / 小克 / 小智 | 6.18 / 6.98 / 5.94 / 6.06 |
| accent 文字在 `--accent-wash`（14% 混 sheet）上：鲸汐 `#DCE3DC` / 大肥鱼 `#DEDFE6` / 小克 `#EEDED2` / 小智 `#D9E3D8` | 5.05 / 5.61 / 4.85 / 4.92 |
| `--ink` 在上述 wash 上 | 8.66–8.80 |
| `--alert` 在 `--alert-wash #F3E4DB` 上；`--ink` 在其上 | 5.22；9.28 |
| `--alert-ink #FBF7EE` 在 `--alert` 上 | 6.05 |
| `--ink` 在 coral-soft `#F4B9A8` / 胶带 b `#BFE0DC` / c `#F2D58A` 上 | 6.77 / 8.17 / 8.03 |
| `--line-strong #7D8795`（控件边界，非文字 ≥3:1）在 paper / sheet 上 | 3.18 / 3.40 |
| 旧 `--ink-faint #858E96` 在旧 `#F4F1E8` 上（**淘汰**） | 2.95 |

**深海夜（暗）**

| 前景 | 色值 | paper `#0F1C2A` | paper-2 `#17283A` | sheet `#13222F` | slip `#3A3420` |
|---|---|---|---|---|---|
| ink | `#EDE6D6` | 13.85 | 12.06 | 13.02 | 9.98 |
| ink-soft | `#CBD2D7` | 11.26 | 9.81 | 10.59 | 8.12 |
| ink-mute | `#A0ACB6` | 7.44 | 6.47 | 6.99 | 5.36 |
| 鲸汐 accent | `#7CCBD2` | 9.29 | 8.09 | 8.73 | 6.70 |
| 大肥鱼 accent | `#9DB2FF` | 8.40 | 7.31 | 7.90 | 6.06 |
| 小克 accent | `#F2A582` | 8.59 | 7.48 | 8.08 | 6.19 |
| 小智 accent | `#79D9BC` | 10.22 | 8.90 | 9.61 | 7.37 |
| alert | `#FF9C86` | 8.49 | 7.39 | 7.98 | 6.12 |
| lamp | `#F2C14E` | 10.26 | 8.93 | 9.64 | 7.40 |
| ok | `#8FD3A0` | 9.83 | 8.56 | 9.24 | 7.09 |

暗色实心按钮：`--accent-ink #0F1C2A` 在 accent 上 = 9.29 / 8.40 / 8.59 / 10.22；在 `--alert` 上 8.49。accent 在暗色 wash（16% 混 sheet）上 5.71–6.66；`--line-strong #6B7A88` 在 paper / sheet 上 3.91 / 3.67。

**老人模式**：`--ink-mute` 被替换为 `--ink-soft`，所以全站最浅文字亮色 ≥7.0（paper-2 上 7.03）、暗色 ≥8.1。

### 4.4 角色强调色 `styles/characters.css`（完整替换）

```css
/* 每个角色一种强调色；亮色取深、暗色取浅。整套界面（名字牌、按钮、浪、胶带高光）随之变化。 */
:root[data-character="whale"]    { --accent: #1A6670; }
:root[data-character="deepseek"] { --accent: #2E4BB8; }
:root[data-character="claude"]   { --accent: #9F4326; }
:root[data-character="chatgpt"]  { --accent: #0A6B53; }
:root[data-theme="dark"][data-character="whale"]    { --accent: #7CCBD2; }
:root[data-theme="dark"][data-character="deepseek"] { --accent: #9DB2FF; }
:root[data-theme="dark"][data-character="claude"]   { --accent: #F2A582; }
:root[data-theme="dark"][data-character="chatgpt"]  { --accent: #79D9BC; }
```
（原 `characters.css` 的 `:root[data-character=whale]` 默认值在 `tokens.css` 里的 `--accent: #1A6670` 兜底。）

### 4.5 字体与字阶

**字体决策（含理由）**

| 用途 | 字体 | 理由 |
|---|---|---|
| 她的话、标题、日记、记忆标题、名字牌 | **霞鹜文楷**（LXGW WenKai，已在依赖 `lxgw-wenkai-webfont`） | 手写感是“绘本字幕”的核心；仓库已有；注意它**字重很少**，层级靠字号/颜色/位置，不要依赖 `font-weight`；`font-synthesis: none` 禁止假粗体；仅 ≥20px 的标题用 Bold 文件 |
| 界面 chrome（按钮、标签、输入、你的话、设置行说明） | **霞鹜新晰黑**（LXGW Neo XiHei，https://github.com/lxgw/LxgwNeoXiHei ） | 与文楷同源，笔画气质统一；比系统字体在 Windows/Android/macOS 之间更一致；子集化后首屏体积可控（§12.3 上限 220 KB）。直接使用；`--font-ui` 里系统字体栈只作为字体文件加载前的 CSS 回退 |
| 日期、图鉴编号、额度数字 | **Fraunces Variable**（依赖 `@fontsource-variable/fraunces`，本轮启用：`@import "@fontsource-variable/fraunces/index.css"`） | 有“旧书”气质的数字；只加载 latin 子集，约几十 KB；`font-variant-numeric: lining-nums tabular-nums` |
| 代码/等宽 | 不引入 | 本产品没有代码块需求；`streamdown` 的代码块用 `--font-ui` |

**字阶表（亮暗相同；老人模式整体 ×1.25 即 rem 放大）**

| Token | px | 行高 | 字体 | 用在哪里 |
|---|---|---|---|---|
| `--fs-micro` | 13 | 1.4 | UI/Fraunces | 邮戳、图鉴编号、时间；只许用 ink-mute 及更深 |
| `--fs-small` | 14 | 1.5 | UI | 辅助说明、芯片、表单提示 |
| `--fs-body` | 16 | 1.7 | UI | UI 正文、你的话、按钮 |
| `--fs-chat` | **17** | **1.9** | 文楷 | **她的话（对话框 + 往回翻）** |
| `--fs-diary` | 18 | 2.0（=36px 横线） | 文楷 | 日记正文、记忆正文 |
| `--fs-h3` | 20 | 1.4 | 文楷 | 小节标题、设置行标题 |
| `--fs-h2` | 24 | 1.35 | 文楷 | 对话框标题、页内大节 |
| `--fs-h1` | 32（手机 28） | 1.25 | 文楷 | 页面标题 |
| `--fs-display` | 44 | 1.15 | 文楷 | 仅桌面首屏标题（可不用） |
| `--fs-date` | 56 | 1 | Fraunces | 日记日期数字 |

**子集化与加载（cn-font-split 7.4.3）**
- 新增脚本 `apps/client/scripts/build-fonts.mjs`：输入 LXGW Neo XiHei 的 TTF（放 `apps/client/fonts-src/`，**不入库**，`.gitignore`），调用 `fontSplit({ input, outDir: "public/fonts/neo-xihei", css: { fontFamily: "LXGW Neo XiHei" }, targetType: "woff2" })`（`import { fontSplit } from "cn-font-split"`），输出按 unicode-range 分片的 woff2 与一份 `result.css`。
- 额外生成一份“**首屏常驻集**”（常用 3500 字 + 本文档全部文案字符，由脚本从 `src/**/*.tsx` 里扫中文字符并集）：`neo-xihei-core.woff2` 与 `wenkai-core.woff2`，`<link rel="preload" as="font" type="font/woff2" crossorigin>`；其余分片懒加载。
- 文楷沿用 `lxgw-wenkai-webfont`（已按 unicode-range 分片），在 `base.css` 保留 Regular + Bold 两个 import；`font-display: swap`。
- Fraunces：`import "@fontsource-variable/fraunces/index.css"`（latin 子集；文件名以 node_modules 实际为准）。
- CSP 已允许 `font-src 'self' data:`（`src-tauri/tauri.conf.json:25`），字体必须本地打包，**禁止** Google Fonts / CDN。
- **首屏字体体积上限**：见 §12.3（≤220 KB woff2 传输）。

### 4.6 圆角用法速查
`--r-xs` 胶带/kbd；`--r-sm` 输入框、芯片、日期格；`--r-md` 按钮、便签、记忆卡、名字牌；`--r-lg` 对话框、底部抽屉、VN 对话框；`--r-round` 开关、头像、徽点。**禁止出现其他圆角值**（`stylelint`/grep 校验见 §12）。

### 4.7 阴影规则（只有“纸张投影”）
- 只允许 `--shadow-1`（贴在桌面上的纸）和 `--shadow-2`（被拿起/弹层）。模糊半径 ≤12px、偏移向下、颜色为墨色的透明度；**没有扩散（spread）为正的发光**。
- 禁止：`filter: drop-shadow(0 0 …)`、彩色阴影、`backdrop-filter`。
- 贴纸角色的“白边”用 `filter: drop-shadow(0 0 0 #FBF7EE)` 无效，请用 4 个方向 1px 的 `drop-shadow` 叠出 2px 白边（见 §5.7）或在素材里直接带白边。

### 4.8 `lib/a11y.ts`（新增）与 `theme.ts`（改）

```ts
// lib/theme.ts：把 auto 解析成 light/dark，CSS 只需要一份暗色
export type ThemeChoice = "auto" | "light" | "dark";
const KEY = "wp.theme";
const mq = window.matchMedia("(prefers-color-scheme: dark)");
export const readTheme = (): ThemeChoice => { try { const v = localStorage.getItem(KEY); if (v === "light" || v === "dark") return v; } catch {} return "auto"; };
export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  const resolved = choice === "auto" ? (mq.matches ? "dark" : "light") : choice;
  root.setAttribute("data-theme", resolved);
  root.setAttribute("data-theme-pref", choice);
  try { choice === "auto" ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, choice); } catch {}
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "dark" ? "#0F1C2A" : "#F6EFE2");
}
mq.addEventListener("change", () => { if (readTheme() === "auto") applyTheme("auto"); });
```
```ts
// lib/a11y.ts：老人模式 / 字号 / 安静模式。存 localStorage：wp.elder("on"|"off")、wp.scale("1".."1.5")、wp.motion("calm"|"full")
export function applyA11y({ elder, scale, calm }: { elder: boolean; scale: number; calm: boolean }) {
  const root = document.documentElement;
  root.setAttribute("data-elder", elder ? "on" : "off");
  root.style.setProperty("--scale", String(elder ? Math.max(scale, 1.25) : scale)); // 老人模式字号下限 1.25
  root.setAttribute("data-motion", elder || calm ? "calm" : "full");
}
```
`public/theme-boot.js`（新增，**外部脚本**，因为 CSP `default-src 'self'` 禁止内联脚本），在 `index.html` `<head>` 里同步加载，避免首帧闪白：读取 `wp.theme / wp.elder / wp.scale`，写 `data-theme`、`data-elder`、`--scale`。`index.html` 的 `theme-color` 同时改为 `#F6EFE2`（并由 `applyTheme` 动态更新）。

### 4.9 `base.css` 需要的改动（要点）
- 删除 `body::after` 全屏噪点叠层（`base.css:17-22`）及其两条暗色覆盖；改用 §5.1 的背景图层。
- `body { font-size: var(--fs-body); line-height: var(--lh-body); background: var(--grain), var(--fiber), var(--paper); }`（见 §5.1）；`font-variant-numeric` 仅对数字组件开启，不再全局 `tabular-nums`。
- `:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: var(--r-xs); }`（交互元素自带圆角时使用其圆角）。
- 保留 `.sr-only`；`::selection { background: var(--accent-wash); color: var(--ink); }`（旧写法反色，对比度在 accent 浅色暗模式下不稳）。
- reduced-motion 的全局归零保留，但**不要**用 `animation-duration:.001ms !important` 去杀掉 Radix/motion 的退出动画（会导致元素不卸载）；改为各组件读 `useReducedMotion()` + `data-motion="calm"`（§8）。

---

## 5. 纹理与插画系统

### 5.1 纸纹（取代全屏噪点叠层）
原则：**纸纹是背景图层，不是盖在所有东西上的叠层**——不用 `position:fixed`、不用 `mix-blend-mode`、不盖住 Live2D 画布。浏览器只栅格化一次 200×200 的瓦片。

追加到 `tokens.css` 的 `:root` 与 `[data-theme="dark"]`：

```css
:root {
  /* 亮：墨色颗粒（rgb 47,58,74），alpha = 0.6·A − 0.22，只留稀疏的点 */
  --grain: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='g' x='0' y='0' width='100%25' height='100%25'><feTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' seed='7' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .184  0 0 0 0 .227  0 0 0 0 .29  0 0 0 .6 -.22'/></filter><rect width='200' height='200' filter='url(%23g)'/></svg>");
  /* 纸张纤维：极淡的短横线，瓦片 240×240，由 scripts/bake-fibers.mjs 用固定种子生成（见下） */
  --fiber: url("/textures/fiber-light.svg");
}
:root[data-theme="dark"] {
  /* 暗：暖纸色颗粒（rgb 237,230,214），更稀 */
  --grain: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='g' x='0' y='0' width='100%25' height='100%25'><feTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' seed='11' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .93  0 0 0 0 .9  0 0 0 0 .84  0 0 0 .5 -.2'/></filter><rect width='200' height='200' filter='url(%23g)'/></svg>");
  --fiber: url("/textures/fiber-dark.svg");
}
body            { background: var(--grain), var(--fiber), var(--paper); }
.sheet, .dialogbox, .slip-card { background: var(--grain), var(--sheet); }
```
- `.sheet` 是通用“抬起的纸”类（对话框、记忆卡、弹层、设置分组），统一使用。
- 纤维图 `public/textures/fiber-{light,dark}.svg`：240×240，14 条长 18–40px、描边 0.6px、不透明度 0.05 的随机弧线（种子固定 `seed=42`），由 `scripts/bake-fibers.mjs` 生成并**提交**（可复现）。若时间紧，P0 可不做纤维，只做颗粒。
- **验收（量化）**：在 `--paper` 区域截 200×200 像素，均值相对纯色 `#F6EFE2` 每通道偏移 ≤4/255，标准差 ≥1.5（有颗粒但不脏）；对比度表（§4.3）以纯色计，颗粒不得使任何文字对比度下降超过 0.15。
- Live2D 的 `<canvas>` 之上**不得**再有任何全屏层。

### 5.2 手绘线：`lib/ink.ts` + `<InkLine/>`

依赖 `perfect-freehand`。**固定种子、一次生成**：同一 `(variant, seed, size)` 的结果缓存在模块级 `Map`，运行时不再随机，截图稳定。

```ts
// src/lib/ink.ts
import { getStroke } from "perfect-freehand";

export function rng(seed: number) {            // mulberry32，确定性
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function outlineToPath(pts: number[][]) { // perfect-freehand README 里的标准转换
  if (pts.length < 4) return "";
  const f = (n: number) => n.toFixed(2);
  let d = `M${f(pts[0][0])},${f(pts[0][1])} Q`;
  for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length]; d += `${f(x0)},${f(y0)} ${f((x0 + x1) / 2)},${f((y0 + y1) / 2)} `; }
  return d + "Z";
}
const cache = new Map<string, string>();
export function cached(key: string, make: () => string) { let v = cache.get(key); if (!v) { v = make(); cache.set(key, v); } return v; }

/** 水平手绘线：viewBox 600×12，抖动 ±1.6，另叠一个低频起伏 1.2 */
export function inkLinePath(seed: number, size = 2.4) {
  return cached(`line:${seed}:${size}`, () => {
    const r = rng(seed), pts: number[][] = [];
    const n = 16, phase = r() * 6.28;
    for (let i = 0; i <= n; i++) pts.push([12 + (i / n) * 576, 6 + Math.sin(i / n * 6.28 + phase) * 1.2 + (r() - .5) * 3.2]);
    return outlineToPath(getStroke(pts, { size, thinning: .55, smoothing: .6, streamline: .45, simulatePressure: true, start: { taper: 40 }, end: { taper: 90 } }));
  });
}
```

```tsx
// src/components/ink/InkLine.tsx
type Props = {
  variant?: "divider" | "underline" | "squiggle"; // 600×12 / 600×12（更粗）/ 600×16（波浪）
  seed?: number;                 // 默认由 children/id 哈希；同一位置必须稳定
  size?: number;                 // 笔宽（viewBox 单位），divider 2.4 / underline 3.6
  draw?: "none" | "once" | "loop"; // once：进入时 520ms 自左向右画出；loop：思考指示 1800ms
  className?: string;
};
```
- 渲染：`<svg viewBox="0 0 600 12" preserveAspectRatio="none" width="100%" height="12" aria-hidden focusable="false"><path d fill="currentColor"/></svg>`，颜色继承 `color`（divider 用 `var(--line)` 的不透明版本 `color: color-mix(in srgb, var(--ink) 38%, transparent)`）。
- 动画：`clip-path: inset(0 100% 0 0)` → `inset(0 0 0 0)`，`once` 为 `520ms var(--ease-out)`，`loop` 为 `1800ms var(--ease-inout) infinite`（每轮结束停 600ms）。`prefers-reduced-motion`/calm：直接显示完成态。
- 用法：分隔线（替代 `border-top:1px solid var(--rule)`，如 `layout.css:86,91,113,149,228`）；当前导航项下划线；标题下划线；日记日期分隔；“她在想”指示线。
- 同页同一个 `seed` 不要重复出现超过 2 次（会显得复制粘贴）；用 `seed = hash(id)`。

### 5.3 手绘框：`<InkFrame/>`

```tsx
type FrameProps = {
  as?: "div" | "section" | "article" | "li";
  radius?: number;           // 默认 14（= --r-md）；对话框 20
  stroke?: number;           // 默认 2（老人模式 3）
  tone?: "ink" | "accent" | "alert";   // 线色：ink-mute / accent / alert
  seed?: number;
  fill?: "sheet" | "paper-2" | "none";  // 底色由 CSS 背景提供，SVG 只画线
  openCorner?: boolean;      // 左上角留 ~6px 缺口，像一笔画完没接上
  children: React.ReactNode;
};
```
实现要点：
1. `ResizeObserver` 取 `width/height`，**向上取整到 8 的倍数**作为缓存 key，避免拖动窗口时每帧重算。
2. 圆角矩形取点：每条边 ≥ `len/24` 个点，四角各 6 个点沿圆弧；每个点施加种子抖动 ±1.1px。
3. `getStroke(pts,{size: stroke*1.5, thinning:.4, smoothing:.55, streamline:.5, simulatePressure:true, start:{taper:20}, end:{taper:30}})`，`openCorner` 时首尾不闭合。
4. SVG `position:absolute; inset:0; pointer-events:none; overflow:visible`，`aria-hidden`；容器 `position:relative; border-radius: radius`，背景由 `.sheet` 提供。
5. 性能上限：同屏 `InkFrame` ≤12 个；列表（记忆卡）超过 12 个时用 CSS `border: var(--stroke-1) solid var(--line)` + 圆角降级，只给“被选中/悬停”的卡画手绘框。

### 5.4 邮戳 `<Stamp/>` 与 胶带 `<Tape/>`

**Stamp**
```tsx
type StampProps = {
  kind: "postmark" | "label" | "done" | "fail";
  lines: string[];            // postmark: ["鲸汐", "11.07"]；label: ["AI 角色"]；done: ["写好啦"]；fail: ["没送到"]
  size?: 72 | 96;             // postmark/done 的直径；label/fail 为矩形，高 22px
  tone?: "accent" | "alert";  // fail 强制 alert；其余 accent
  animate?: boolean;          // 首次出现：落下
};
```
- 圆形：外圈 `perfect-freehand` 画圆（半径 r，抖动 ±0.8，不完全闭合缺 12°），内圈细 1px；中间文字 `--font-num` 数字或 `--font-voice` 汉字；颜色 `--accent`（或 `--alert`）不透明度 0.9；**文字对比度按 §4.3 的 accent/alert 在 paper 上 ≥5.0**。
- 矩形（label/fail）：`InkFrame` 的小号版 + 13px `--font-ui` 字、`letter-spacing: .06em`。“AI 角色”就用这个，放在名字牌右侧，**永远可见**。
- 动画（`animate`）：`motion` 弹簧 `stiffness 400, damping 17`，从 `scale 1.3, rotate -14°, opacity 0` 到 `scale 1, rotate -6°, opacity .9`，一次，约 260ms；之后静止。老人/calm：直接显示。
- 邮戳**不可点击**，不是按钮。

**Tape**
```tsx
type TapeProps = { color?: "a" | "b" | "c" | "d"; angle?: number /* -6..6 */; w?: number /* 默认 72 */; h?: number /* 默认 22 */ };
```
```css
.tape { position: absolute; width: var(--w, 72px); height: var(--h, 22px); background: var(--tape, var(--tape-a)); opacity: .88;
  transform: rotate(var(--angle, -3deg)); border-radius: var(--r-xs); pointer-events: none;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'><path d='M-2 2 L2 -2 M0 8 L8 0 M6 10 L10 6' stroke='white' stroke-opacity='.28' stroke-width='1.6'/></svg>");
  clip-path: polygon(0 0,3% 18%,0 36%,3% 54%,0 72%,3% 100%,100% 100%,97% 82%,100% 64%,97% 46%,100% 28%,97% 0); }
```
- 斜纹用 SVG 描边（不是 CSS gradient）；4 色见 `--tape-a..d`；放在卡片顶边，`top:-10px; left: 16–28px`。
- 数量：同屏 ≤4 条；老人模式 `angle=0` 且仅装饰性保留 ≤2 条。胶带**不遮挡文字**。

### 5.5 水彩平涂的浪 `<Tide/>`

```ts
// src/lib/wave.ts：确定性的正弦叠加 + 轻微噪声。宽度 2880 = 两个 1440，循环位移 -50% 时无缝。
export function wavePath(seed: number, { w = 2880, h = 200, base = .5, amp = [14, 6], len = [720, 360], step = 24 } = {}) {
  const r = rng(seed), p1 = r() * 6.283, p2 = r() * 6.283; // len 必须整除 1440：720/480/360/240/180
  let d = `M0 ${h}`;
  for (let x = 0; x <= w; x += step) {
    const y = h * base + amp[0] * Math.sin(x / len[0] * 6.283 + p1) + amp[1] * Math.sin(x / len[1] * 6.283 + p2) + (r() - .5) * 1.2;
    d += ` L${x} ${y.toFixed(1)}`;
  }
  return d + ` L${w} ${h} Z`;
}
```
三层 + 一条“浪线”：

| 层 | 颜色 | base | amp | len | 漂移周期 | 方向 |
|---|---|---|---|---|---|---|
| far | `--sea-1` | .45 | 10 / 4 | 720 / 360 | 90s | ← |
| mid | `--sea-2` | .55 | 14 / 6 | 480 / 240 | 60s | → |
| near | `--sea-3` | .68 | 18 / 8 | 360 / 180 | 40s | ← |
| 浪线 | `--sheet` 80% | 沿 near 的顶缘用 `getStroke(size 3.2, thinning .5)` 画一笔 | | | 随 near | |

- 位移 `transform: translate3d(-50%,0,0)` 线性无限循环；仅 `transform`，`will-change: transform`。
- **水彩晕边**：仅给 `near` 层一个**静态**滤镜 `feTurbulence(baseFrequency=".02 .06" numOctaves=2 seed=3) + feDisplacementMap(scale=6)`。手机、老人模式、calm 下：**不加滤镜**，用平涂。
- 高度：聊天页舞台底部 `28%`（手机 `22%`）；其他页是固定在内容区底部的 **“潮线”** `72px` 高（只画 mid+near，不动），不得与正文重叠（页面 `padding-bottom: 96px`）。
- 进入页面：整组 `translateY(14px)→0`，弹簧 `stiffness 170, damping 18`，约 600ms（“潮水涨上来”）。
- 暗色（深海夜）：浪色同公式；再叠 5 颗**平涂**的四角星（`--lamp`，边长 6–10px，固定位置，种子 5，不闪烁）与一弯平涂月（直径 28px，`--lamp` 80%）。**无光晕**。
- 无障碍：整个 `<Tide/>` `aria-hidden`；对比度校验把 `--sea-3` 视为文字底色时 `--ink` ≥5.8（亮色，已算）。

### 5.6 手绘图标集 `Icon`（取代“纯文字导航”）

**目标**：19 个图标，24×24 网格，用于导航与关键操作；每个图标**必须配文字标签**（老人识别）。

| name | 画什么 | 用在 |
|---|---|---|
| `chat` | 对话气泡带小尾巴（像海螺口） | 导航“聊天” |
| `diary` | 一本带书脊和两行字的手帐 | 导航“日记” |
| `memory` | 玻璃瓶，里面卷着一张纸条 | 导航“记忆” |
| `settings` | 8 齿齿轮（老人最熟的符号） | 导航“设置” |
| `send` | 小纸飞机 | 发送 |
| `back-scroll` | 翻开的书 | “往回翻” |
| `new` | 铅笔 + 一页纸 | “换个新话题” |
| `video` | 一卷小胶片 | “发个视频给她” |
| `more` | 三道小浪（不是三点） | 更多菜单 |
| `forget` | 橡皮 | “忘掉” |
| `export` | 纸箱 + 向上箭头 | 导出 |
| `shell` | 扇贝 | 记忆分类“一起经历的”/空态 |
| `conch` | 海螺 | 记忆分类“关于你” |
| `starfish` | 海星 | 记忆分类“她学到的” |
| `bottle` | 玻璃小瓶（里面是一只小纸团） | 记忆分类“她拾到的” |
| `lighthouse` | 小灯塔 | 记忆分类“她的近况” |
| `postcard` | 一张带邮戳角的明信片 | 导航“见闻”、见闻页 |
| `newspaper` | 折起的小报纸 | 网页类见闻 |
| `phone` | 小手机，屏幕上三道横线 | “她在逛”便签、视频类见闻 |

**制作方式（可复现）**：`src/icons/icons.src.json` 存每个图标的**骨架点列**（24×24 坐标，折线/弧线采样点）→ `scripts/bake-icons.mjs` 用 `perfect-freehand`（`size: 2.2, thinning: .4, smoothing: .5, streamline: .4, simulatePressure: false`，抖动 ±0.3，种子 = 图标名哈希）→ 生成 `src/components/Icons.baked.ts`（只含 `d` 字符串，运行时无依赖，**提交**）。

五个导航图标的骨架点（agent 照抄起步，笔画间用 `|` 分隔）：
```
chat:     4,6 8,4 16,4 20,6 21,11 19,15 14,16 10,20 9,16 6,15 4,11 4,6
diary:    5,4 17,4 19,6 19,20 7,20 5,18 5,4 | 8,4 8,20 | 11,9 16,9 | 11,13 15,13
memory:   10,3 14,3 | 10,3 10,7 7,11 7,19 9,21 15,21 17,19 17,11 14,7 14,3 | 10,15 13,12 14,16
postcard: 3,6 21,6 21,18 3,18 3,6 | 15,8 19,8 19,12 15,12 15,8 | 6,12 12,12 | 6,15 12,15
settings: 由函数生成：8 齿，外半径 9、内半径 7、齿宽 22°；再加中心圆 r=3（35 点采样）
```
`Icon` 组件：`<Icon name size={28} />`，`fill="currentColor"`，`aria-hidden`；描边等效约 2px。19 个全部用同一条流水线烘焙，描边粗细与抖动参数统一。

### 5.7 角色贴纸 `WhaleSticker` 与 `CompanionCorner`

**WhaleSticker（取代 `WhaleFigure.tsx` 的渐变鲸）**
- 完全由代码绘制，**平涂**：身体 `color-mix(in oklab, var(--accent) 55%, var(--sheet))`，肚皮 `--sheet`，腮红 `--coral-soft`（装饰），描边 `--ink` 用 `perfect-freehand`（size 3.2，种子 17）；外圈 3px `--sheet` “贴纸白边”（用同一轮廓路径描边 6px 的 `--sheet` 放在最底层）。viewBox `0 0 240 200`。**不含任何 `linearGradient/radialGradient`**（§12.5 自检会 grep）。
- `mood` 状态表：

| mood | 眼 | 嘴/道具 | 用于 |
|---|---|---|---|
| `idle` | 两个墨点，每 3–6s 眨眼 120ms | 小弧嘴 | 默认 |
| `happy` | `^ ^` 弧线 | 张嘴 + 两颗小水花 | 日记写好、记忆收下 |
| `think` | 眼睛朝左上，一眉抬起 | 鳍托下巴；头上一笔自画墨线 | 等待回复 |
| `write` | 向下看 | 鳍握笔 + 小本子 | 日记生成中 |
| `sleep` | 闭眼弧线 | 头上两笔“Z”（墨线） | 连不上/夜深 |
| `sorry` | 眉八字 + 一滴汗 | 嘴下弯 | 出错 |
| `wave` | 眼弯 | 一只鳍举起 | 设置/引导 |
| `hold` | 看向瓶子 | 抱一个小玻璃瓶 | 记忆页 |
| `phone` | 向下看 | 双鳍捧一个小手机，屏幕三道横线依次点亮 | 她在逛视频（见闻页空态、便签、小角） |
| `paper` | 看着报纸 | 双鳍展开一张小报纸，笔尖在上面移动 | 她在翻网页 |

- 同一套状态给**所有角色**共用：`CompanionCorner` 对 4 个角色都用 `WhaleSticker`（描边与身体色随当前角色 accent 着色），不做角色人像小图，不需要截图脚本。各角色自己的 Live2D/VRM 形象只出现在聊天页主舞台；`WhaleSticker` 另外在主舞台形象加载失败时作为兜底。
- 动效：`idle` 呼吸 `scale 1 → 1.015`，`var(--breath)`，`ease-in-out`，`transform-origin: 50% 90%`。

**CompanionCorner（每页都有她）**
```tsx
<CompanionCorner mood={useCompanionMood()} />   // components/CompanionCorner.tsx，挂在 App.tsx 的 <main> 内（聊天页除外）
```
- 尺寸与位置：桌面 112×112，`right: 24px; bottom: 12px`，叠在“潮线”上；手机 64×64，`right: 12px; bottom: calc(var(--tabbar-h) + 8px)`；`z-index: var(--z-ui)`；页面滚动容器 `padding-bottom: 96px`（桌面）/ `88px`（手机），避免遮挡内容。
- 它是一个 `<button>`，`aria-label="和{name}打个招呼"`，命中区 ≥44px（手机贴纸 64px 满足）。点击：弹簧 `stiffness 400, damping 17`，`y: 0 → -10 → 0`，旁边冒一张便签小字（3 秒消失，`role="status"`），台词从下表随机，**10 秒内不重复触发**。
- 状态由 `lib/companion.ts`（`useSyncExternalStore`，同 `avatar-state.ts` 风格）提供：`setCompanionMood(mood, { ttl?: ms })`。

| 页面/事件 | mood | 点击台词（随机一句） |
|---|---|---|
| 日记，空闲 | `idle`（手里抱着小本子） | “今天的我写在这里了。”/“想看哪一天？” |
| 日记，生成中 | `write` | “我在写，你先歇会儿。” |
| 日记，刚写好 | `happy` 2.4s（邮戳落下同时） | “写好啦。” |
| 记忆，浏览 | `hold` | “这些都是我收好的。” |
| 记忆，刚忘掉一条 | `sorry` 2s → `idle` | “好，我不记这件事了。” |
| 设置 | `wave` | “有哪里不方便，告诉我。” |
| 连不上 | `sleep` | “我睡着了，网络回来我就醒。” |
| 夜里 22:00–06:00（本机时间） | `sleep` 概率 30% | “这么晚啦，早点睡。” |
| 见闻页，空闲 | `phone`（手里拿着手机） | “我逛到的都放在这儿。” |
| 她正在逛（非聊天页，视频） | `phone` | “我在外面逛呢，回来讲给你听。” |
| 她正在逛（非聊天页，网页） | `paper` | “我在看报纸呢，等我一下。” |

- 小角里不再初始化第二个 Live2D/VRM 渲染实例，永远用 `WhaleSticker`。聊天页自己有舞台，不显示 CompanionCorner。

---

## 6. 组件规范

通用约定：
- 所有组件放 `src/components/ui/`（原语皮肤）或 `src/components/`（业务）；样式写进新建的 `src/styles/components.css`，**class 用 BEM**，与旧 `layout.css` 并存直到 P4 清理旧规则。
- 状态一律用 `data-state`/`aria-*` 驱动样式，不用 `:hover` 单独承载信息（触屏没有悬停）。
- 每个可交互元素必须同时具备：默认 / 悬停 / 按下 / 禁用 / 聚焦；有异步行为的再加 加载 / 错误。
- 悬停只做 160ms 的底色变化（`--paper-2`）或 1px 上浮；**不用 `opacity` 变灰表示禁用**（会让文字掉到 <4.5:1），禁用 = 底 `--paper-2` + 字 `--ink-mute` + 虚线边框。

### 6.1 Button（`ui/Button.tsx`）

| 变体 | 默认 | 悬停 | 按下 | 禁用 | 聚焦 | 加载 |
|---|---|---|---|---|---|---|
| `primary` | 底 `--accent`，字 `--accent-ink`，`--shadow-1`，`--r-md` | `translateY(-1px)` + `--shadow-2`，160ms | `scale(.97)`，阴影去掉，弹簧 `stiffness 520, damping 32` | 底 `--paper-2`、字 `--ink-mute`、`1.5px dashed --line-strong` | `--focus-ring` | 文字不变，图标位换成 `InkLine loop`（宽 20px），`aria-busy="true"`，按钮宽度锁定 |
| `secondary` | 底 `--sheet`，`1.5px solid --line-strong`，字 `--ink` | 底 `--paper-2` | 同上 | 同上 | 同上 | 同上 |
| `quiet` | 无底，字 `--accent`，下方 `InkLine underline` 不显示 | 显示手绘下划线（`draw=once` 200ms） | 字色加深（`color-mix(accent 80%, ink)`） | 字 `--ink-mute` | 同上 | 同上 |
| `danger` | 底 `--alert`，字 `--alert-ink`（6.05:1） | 同 primary | 同 primary | 同 primary | 同上 | 同上 |

- 尺寸：`md` 高 `max(48px, var(--hit))`，左右内边距 20px，字 16px（`--font-ui`），图标 20px，间距 8px；`lg` 高 56px（对话框主按钮、引导、老人模式全部按钮）。**quiet 按钮视觉小，但可点击区域用 `::after { inset: -8px }` 扩到 ≥44px。**
- 图标按钮 `IconButton`：44×44（老人 56×56），图标 24px，必须有 `aria-label`，桌面有 Tooltip，老人模式下把文字标签写在图标旁（不依赖 Tooltip）。
- 同一视图里 `primary` 至多 1 个。另有 `danger-outline` 变体（透明底 + `1.5px solid --alert` + 字 `--alert`），用于详情页里的“忘掉这条”等需要保留、但不宜抢眼的危险入口；真正执行（确认框里）才用实心 `danger`。

### 6.2 输入（`ui/Field.tsx`、`ComposerBar.tsx`）
- `Field`（单行）：高 48，`--r-sm`，底 `--sheet`，`1.5px solid --line-strong`；聚焦 `border-color: --accent` + `--focus-ring`；`placeholder` 色 `--ink-mute`；错误：`border-color: --alert` + 下方 14px 的 `--alert` 文字 + 图标，`aria-invalid="true"`、`aria-describedby`；禁用：底 `--paper-2`。标签永远在输入框**上方**可见，不用浮动标签。
- `ComposerBar`（聊天回信条）：见 §7.1.4。`<textarea>` 自动增高 52→160px（沿用现有逻辑 `ChatPanel.tsx`，可换 `react-textarea-autosize` 8.5.9），`maxLength=2000`，输入法组合期（`isComposing`/`keyCode 229`）不触发发送；**Enter 换行、Cmd/Ctrl+Enter 发送**（Notion 明确，保持不变）。
- 字符计数：≥1800 字时右下显示 `1850 / 2000`（13px，≥1950 变 `--alert`）。

### 6.3 Switch / Slider / 单选卡（Radix）
- **Switch**（`@radix-ui/react-switch`）：轨道 56×32（老人 72×40），圆角 `--r-round`；关：底 `--paper-2` + `1.5px --line-strong`，滑块 `--ink-soft`；开：底 `--accent`，滑块 `--sheet` 且**滑块里画一个小对勾**（不靠颜色）；轨道旁固定显示文字“开 / 关”（16px）。滑块位移弹簧 `stiffness 500, damping 30`。整行（≥56px）可点，`role="switch"` 由 Radix 提供。
- **Slider**（`@radix-ui/react-slider`）：轨道高 8px、底 `--paper-2`、已填 `--accent`；滑块直径 28px（老人 36px），底 `--sheet`，`2px solid --accent`；左右端点分别放“小 Aa / 大 Aa”（16px / 24px）；步长 0.05；方向键 ±0.05，PageUp/Down ±0.25；上方有一段**实时预览句**用当前字号渲染。
- **单选卡 `ChoiceCard`**（外观三选一、角色选择）：`role="radio"` 组（Radix `RadioGroup`），卡片 160×112（手机一行 1 个、宽满），内含预览缩略图（本卡主题的纸色 + 墨色 + 小浪）、标题 18px、选中时右上角“已选”小邮戳 + `2.5px solid --accent`。

### 6.4 Dialog / AlertDialog / 底部抽屉（Radix）
- 遮罩：`rgb(15 28 42 / .45)`，**无模糊**；淡入 200ms。
- 内容：`.sheet` + `InkFrame(radius=20)`；桌面宽 `min(480px, 100vw - 32px)`（老人 `min(560px, …)`）；内边距 24px；标题 `h2` 24px 文楷；描述 16px `--ink-soft`；按钮区右对齐，间距 12px；手机上按钮纵向铺满，**安全选项在上**。
- 动效：`scale .96→1` + `y 8→0`，弹簧 `stiffness 300, damping 30`（≈220ms）；退出 160ms 淡出。使用 `AnimatePresence` + Radix 的 `forceMount`，并在 `useReducedMotion()` 时只淡入淡出。
- 焦点：打开时聚焦**最安全的选项**（AlertDialog 默认聚焦“先留着”），Esc 关闭，关闭后焦点回到触发元素；背景 `inert`（Radix 默认处理）。
- **底部抽屉 `Sheet`**（手机端“往回翻”、话题列表、筛选）：Radix Dialog 变体，自底部滑入，高 `min(86dvh, 720px)`，顶角 `--r-lg`，顶部 40×4 手绘把手（`InkLine`）；`motion` 的 `drag="y"`，下拉距离 >120px 或速度 >500px/s 关闭，**同时必须有可见的“关上”按钮**（手势不能是唯一方式）；`padding-bottom: env(safe-area-inset-bottom)`；弹簧 `stiffness 260, damping 32`。

### 6.5 Dropdown / Popover / Tooltip / Toast
- **DropdownMenu**（Radix）：`.sheet` + `--shadow-2`，项高 48（老人 56），图标 20 + 文字 16px；危险项文字 `--alert`；支持字母跳转；打开 `scale .98→1 + opacity` 160ms。取代 `<details>` “···”（`ChatSessionControls.tsx`）。
- **Popover**：话题列表、日历、筛选。外点/Esc 关闭，焦点陷入，打开 200ms。
- **Tooltip**（Radix）：延迟 400ms；底 `--ink`、字 `--sheet`（10.76:1）、`--r-sm`、14px；**只给“有可见文字的元素”补充**，不承载唯一信息。
- **Toast = 便签**（`sonner` 2.0.8，`unstyled`）：底 `--slip`、字 `--ink`（10.15:1）、`--r-xs` 的上缘 + 顶部一小条胶带；宽 `min(360px, 100vw-32px)`；位置桌面右下、手机顶部居中避开 tabbar；显示 4s（老人 8s 且带关闭按钮 ≥44px）；同时只显示 1 条（`visibleToasts={1}`）；`role="status"`，错误便签 `role="alert"`，底 `--alert-wash` + `1.5px --alert`。入场 `y 16→0, 280ms --ease-out`。带“撤回”的便签用 quiet 按钮。

### 6.6 思考指示 `<Thinking/>`（取代三点 typing）
- 组成：① 角色进入 `think` 姿态（Live2D：`ParamAngleZ` 以 3s 周期在 ±4° 摆动，`ParamEyeBallY +0.4`，不改表情；VRM：lookAt 抬高 + `relaxed` 0.2；贴纸：`mood="think"`）；② 对话框内一行 14px `--ink-mute` 小字，**每 2400ms 轮换**（淡入淡出 160ms，`aria-hidden`，对辅助技术只读一次“她在想”）；③ 小字下一条 `InkLine draw="loop"`（宽 96px）。
- 轮换文案（顺序循环）：“我想想哦…” → “翻翻小本子…” → “在找那句话…” → “马上就好。”
- 视频/网页进度（来自现有 SSE `video/web` 进度事件）：小字改为进度原文的口语版（见 §7.1.5），20s 后追加“这个视频有点长，我再看一会儿，你可以先去逛逛别的页面。”，45s 后出现 quiet 按钮“不等了”（调用现有 abort）。
- 禁止：任意三个圆点、旋转圈、骨架屏条纹。

### 6.7 NameTab 与 AI 标识
- 对话框左上“探出”一块名字牌：高 36，内边距 0 16，底 `--accent-wash`，上边与左右边用 `InkFrame` 画（下边与对话框相连），文字 18px 文楷 `--ink`，前缀 8px 实心 `--accent` 圆点。
- 名字牌右侧紧跟邮戳：`<Stamp kind="label" lines={["AI 角色"]}/>`，作为名字牌的一部分永远可见；窄屏放不下时换行到名字牌下方。
- 屏幕阅读器：整个名字牌区域 `aria-label="{name}，AI 角色"`。

### 6.8 对话相关组件

**DialogBox（视觉小说对话框）**
- 位置：舞台下部，水平居中，距舞台底 `88px`（给回信条留位）；宽 `min(640px, 100% - 48px)`，手机 `100% - 24px`。
- 尺寸：最小高 132px，最大高 `min(46% 舞台高, 320px)`，超出内部滚动（滚动条细 6px，`--line-strong`）；内边距 `20px 28px 24px`（手机 `16px 20px 20px`）；`.sheet` + `InkFrame(radius=20, stroke=2)` + `--shadow-1`。
- 文字：`--font-voice 17px / 1.9`，`--ink`，`max-width: 36em`，段间距 0.6em；`white-space: pre-wrap`；`overflow-wrap:anywhere`。
- 状态 `data-state`：`idle`（问候）/`thinking`（§6.6）/`streaming`（墨水渗入）/`done` / `failed` / `offline`。
- 无障碍：`aria-busy` 在 `thinking/streaming` 为 true；完成时把全文写入视觉隐藏的 `role="status"` 区一次（避免逐字朗读）。

**Streaming “墨水渗入”**（`components/InkText.tsx`）
- 把每次 SSE `delta` 作为一个 `<span class="ink-in">` 追加；CSS：`@keyframes ink-in { from { opacity: 0; transform: translateY(2px) } }`，`240ms var(--ease-out) both`。一次 `delta` 超过 24 个字符时按每 6 字切分并给 `animation-delay: i*28ms`（总上限 280ms），避免大块文字突然出现。
- 只动画**新增**的 span，已有 span 不重绘；完成后合并为单个文本节点（避免 DOM 过大）。
- 含 Markdown（出现 `**`、列表、代码围栏、链接）的回复用 `streamdown` 渲染，最后一个块套同一 `ink-in` 动画；其余走 `InkText`。
- reduced-motion/calm：无位移，`120ms` 淡入。

**Slip（你的话 = 手写便签）**
- 底 `--slip`，字 `--ink` 16px `--font-ui`/1.7，内边距 `10px 14px`，圆角 `14px 14px 2px 14px`，`--shadow-1`，`max-width: 85%`，右对齐；旋转取 `[-0.8°,-0.4°,0.4°,0.8°][hash(id)%4]`（老人 0°）；最新一张顶角有一条 `Tape`(28×12)。
- 状态：`sending`（底边 `InkLine loop` + 13px“寄出中”，**不要降低不透明度**）/`sent` / `failed`（底 `--alert-wash`，`1.5px --alert`，`Stamp fail`，下方两个按钮“再发一次”“删掉”）。
- 发送动画：从回信条位置飞到对话框上方右侧，弹簧 `stiffness 300, damping 30`，约 320ms；她的第一个字出现时缩小淡出 200ms（它已进入“往回翻”）。

**CaptionBlock（往回翻里她的话）**
- 无气泡；一段连续发言（间隔 <5 分钟）首行左侧 32px 贴纸头像，右侧名字 14px `--ink-soft`；正文 `--font-voice 17px/1.9`；块间距 20px，同一段内 8px；时间 13px `--ink-mute`，悬停/聚焦显示（老人模式常显）；右侧“复制”图标按钮在悬停/聚焦时出现（触屏：长按不是唯一方式，行末始终有“···”）。
- 日期分隔：`InkLine divider` + 居中 `Fraunces 14px` 的“11·07 周六”。

**往回翻 `Backlog`**：`react-virtuoso` `<Virtuoso followOutput="smooth" alignToBottom atBottomThreshold={80} initialTopMostItemIndex="LAST"/>`；不在底部时右下出现 quiet 按钮“回到最新”；`role="log"`，`aria-live="off"`（实时朗读由 DialogBox 负责，避免重复）。

### 6.9 确认对话框（统一）`<ConfirmDialog/>`（Radix AlertDialog）
```tsx
<ConfirmDialog
  title="要忘掉这条吗？"
  body="忘掉之后，她就想不起这件事了，也找不回来。聊天里的原话还在，想一起清掉请去「设置 › 我的数据」。"
  cancelLabel="先留着"          // 默认聚焦，primary 样式
  confirmLabel="忘掉它"         // danger 样式
  danger
  requireAck?: "我知道删除后找不回来"  // 仅「删除全部数据」使用：勾选后才启用确认
/>
```
替换 `MemoryPage.tsx:135`、`ChatSessionControls.tsx:35`、`SettingsPage.tsx:23`、`Accounts.tsx:85` 四处。**确认文案模板**：标题=问句；正文=一句后果（“会怎样”）+ 一句例外（“什么不会被删”）；按钮=具体动词，不写“确定/取消”。

### 6.10 日记与记忆专用组件
- **DateStamp**：左 `Fraunces 56px` 日（"07"，`lining-nums`），右上 13px 大写感的“NOV · 周六”（`--ink-mute`，`letter-spacing:.06em`），下方一条 `InkLine`；整体可作为 `<time dateTime>`。
- **IndexTabs**（周/月/年）：始终水平放在日记正文上方，切换时保留当前所选日期；`role="tablist"`，支持左右方向键、Home 和 End。
- **MiniCalendar**：紧凑日期选择器，供记忆筛选使用。日记主视图使用独立的 `DiaryCalendar`，在七列月历格中展示真实主题和记录状态（见 §7.2）。
- **MemoryCard**：见 §7.3.2。
- **QuotaMeter**：10 枚小贝壳排成一行，已用的变空壳（轮廓），剩余的实心；下方文字“本月还剩 7 / 10”；`role="meter"`，`aria-valuenow` 等。
- **StateBlock**（空/加载/错误/离线通用）：贴纸 120px + 标题 20px 文楷 + 正文 16px + 至多 1 个 primary 按钮 + 可选 quiet“详情”（展开技术细节）；居中，最大宽 360px。`loading` 用 `role="status"`，`error` 用 `role="alert"`。

---

## 7. 页面逐一设计

### 7.0 外壳（`App.tsx` / `Nav.tsx` / `Ocean.tsx`）

| 改动 | 说明 |
|---|---|
| `Ocean.tsx` → `Backdrop.tsx` | 纸底（§5.1）+ 非聊天页底部“潮线”（§5.5）。聊天页的浪画在舞台里（`ChatPage` 内的 `<Tide/>`），不再用 fixed 背景。 |
| `Nav.tsx` | 加图标（§5.6）、高亮“荧光笔块”、日记新条目与见闻新内容的小红点（用 `--alert` 实心 10px，不用珊瑚）。≥960px 左侧竖排 112px，<960px 底部 tab（5 项，每项 `flex:1; min-width:64px`）。老人模式只渲染 3 项（§9）。 |
| `App.tsx` | `<LazyMotion features={domAnimation}>` 包裹；`<Toaster/>`（sonner）；路由内容用 `AnimatePresence mode="popLayout"` 做页面切换；非聊天页挂 `<CompanionCorner/>`；`useEffect` 里首次运行检测 `wp.onboarded`，没有则渲染 `<Onboarding/>`（§7.5）。 |
| 页面切换 | 有 `document.startViewTransition` 时用它做 200ms 交叉淡入（封装在 `lib/vt.ts`：`withVT(fn)`，不支持直接 `fn()`）；**功能不得依赖它**（部分 WebView 没有此 API，此时直接切换）。无 VT 时用 `motion` 的 `opacity 0→1, y 6→0, 280ms`。 |

导航项（桌面 88×76 命中区；手机每项 `flex:1; min-width:72px; min-height:64px`）：

| 顺序 | 图标 | 标签（桌面 16px 文楷 / 手机 14px UI） | 老人模式 |
|---|---|---|---|
| 1 | `chat` | 聊天 | 聊天 |
| 2 | `diary` | 日记 | **她的日记**（页顶有“看她的见闻 ›”大按钮） |
| 3 | `postcard` | 见闻 | 并入日记页顶部大按钮，不在导航 |
| 4 | `memory` | 记忆 | 并入「设置 › 她记得的事」，不在导航 |
| 5 | `settings` | 设置 | 设置 |

选中态：图标与文字 `--accent`；背后一块 `--accent-wash` 的倾斜 −2° 圆角矩形（“荧光笔”），宽 80 高 56，进入时 `scaleX 0.6→1`，弹簧 `stiffness 300, damping 30`；文字下 `InkLine underline`（宽 40）。

---

### 7.1 聊天页（路由 `/`，`pages/ChatPage.tsx` + `components/ChatPanel.tsx` 重构）

#### 7.1.1 概念
一幅会说话的绘本插画：她站在海边，**说的话像绘本字幕一样落在她下面的对话框里**；你的话是一张递过去的小纸条；历史放在右边的“往回翻”里（视觉小说的 Backlog）。**不是**居中窄列 + 气泡。

#### 7.1.2 桌面 1180×780
```
┌────────┬──────────────────────────────────────────────────┬───────────────────────┐
│  112   │  舞台 Scene（flex，≈708）                [收起▸] 44│  往回翻（360，可收起）  │
│ [鲸尾] │                                                   │ ┌ 头 64 ─────────────┐│
│        │                                                   │ │往回翻  [话题 ▾][···]││
│ [聊天] │          ┌──────────────────────────┐             │ ├─────────────────────┤│
│  ◄荧光 │          │  角色全身（Live2D/VRM/    │             │ │ ──── 11·07 周六 ──── ││
│ [日记] │          │  贴纸），脚下是潮水        │             │ │ (头像)大肥鱼        ││
│  ●新   │          │  高 ≈ 舞台 78%            │             │ │ 哦鲸鲸～你来啦！     ││
│ [记忆] │          └──────────────────────────┘             │ │ 我是大肥鱼。…        ││
│        │   ╭[大肥鱼][AI 角色]────────────╮ ← 名字牌      │ │         ┌──────────┐││
│ [设置] │   │ 她当前这句话，文楷 17px/1.9   │ DialogBox     │ │         │今天好累  │││
│        │   │ 最多约 8 行，超出内部滚动      │ 宽 ≤640       │ │         └──────────┘││
│        │   ╰───────────────────────────────╯ 高 132–320   │ │ (头像)大肥鱼        ││
│        │  [聊聊今天][发个视频给她][看她的日记] ←仅空态      │ │ 抱抱你…             ││
│        │  ┌ 回信条 56–160 ───────────────────[发送 ▷]┐    │ │          [回到最新] ││
│        │  └──────────────────────────────────────────┘    │ └─────────────────────┘│
└────────┴──────────────────────────────────────────────────┴───────────────────────┘
```
- 栅格：`grid-template-columns: var(--nav-w) minmax(var(--scene-min),1fr) var(--backlog-w)`；收起往回翻后舞台占满，按钮变“往回翻”留在右上。
- 舞台：沿用 `Live2DStage`/`VrmStage`（画布不改），`Tide` 铺在舞台底部 28%，角色脚部落在 mid 与 near 浪之间（角色在 near 浪**之前**，z 层：far/mid → 角色 → near）。**取消**原 `stage__tag`（大名字 32px + 副标）和 `stage__hint`（`ChatPage.tsx:20-25,37`）：名字进名字牌；“点一点她，看看反应”改为鼠标悬停角色时光标 `pointer` + 第一次进入时一张便签提示（只出现一次，存 `wp.hint.poke`）；舞台上不出现“演示形象”类字样。她在外面逛时，舞台左上角出现“她在逛”便签（§7.7.3）。
- 舞台与对话框的层关系：对话框 `position:absolute; bottom: 88px`，在角色**前面**，最多遮挡角色下半身 20%；角色画布底部预留 `padding-bottom: 168px` 的“视线安全区”，让角色头脸永远在对话框之上。

#### 7.1.3 手机 390×844（含安全区）
```
┌──────────────────────────────┐ 0
│ [话题：周六闲聊 ▾]   [往回翻] │ 56（44px 按钮）
├──────────────────────────────┤
│                              │
│        角色（舞台）           │ ≈ 360（=42dvh，随键盘收缩）
│       ～～ 潮水 ～～          │
├─╮[大肥鱼][AI 角色]────────────┤
│ │ 她的话 17px/1.9            │ DialogBox 132–260
│ ╰────────────────────────────┤
│ [聊聊今天][发个视频][看日记]  │ 仅空态，横向可滚
│ ┌ 回信条 ─────────────[发送]┐│ 64
├──────────────────────────────┤
│ 聊天  日记  记忆  设置        │ tabbar 64 + safe
└──────────────────────────────┘ 844
```
- “往回翻”= 底部抽屉（§6.4），点按钮或在对话框上**上滑**打开；抽屉内同桌面的 Backlog。
- **键盘弹起**（`visualViewport.height < innerHeight − 120`）：`lib/useKeyboardInset.ts` 写 `--vvh`（根容器 `height: var(--vvh, 100dvh)`）；舞台高度收缩到 0，角色缩成 56px 头像贴纸贴在名字牌左侧；tabbar 隐藏；对话框最大高 `40dvh`；回信条贴在键盘上沿。键盘收起后 280ms 弹簧恢复。（取代 `layout.css:250` 的固定 `40dvh`。）
- 手机不显示「按 ⌘+Enter 发送」提示。

#### 7.1.4 回信条 `ComposerBar`
- 结构：`<textarea>`｜右侧操作组 `[+ 分享]`（44，打开“发个视频给她”弹层）、`[语音聊天]`、`[发送 ▷]` primary（宽 88，高 56；手机只图标+“发送”）。
- 语音聊天沿用同一回信条高度：状态留在左侧，右侧操作组显示“文字”与当前动作；录音时另有“取消”和“发送”。语音状态切换不增加回信条下方的说明行。
- “取消”只丢弃本次未提交录音并留在语音模式；“文字”退出语音模式并保留草稿。停顿不自动发送；错误状态提供简短提示和重试。
- 尺寸：容器 `.sheet` + `InkFrame(radius=14)`；textarea 字 16px，行高 1.6，最小高 52，最大 160；占位符：“想和{name}说点什么？”。
- 发送键禁用条件同现有逻辑（`!online || !sessionId || busy || !draft.trim()`）；禁用态按 §6.1。发送中按钮显示“寄出中”+ InkLine loop。
- 离线：**仍可输入**（草稿保留），发送键禁用，输入条上方一行 14px：“连上之后就能发出去。”
- mac 听写提示（`ChatPanel.tsx:221` 一整行 11px）：改成回信条右侧一个 `?` 图标按钮，点开 Popover：“按 macOS 的听写快捷键就能用说的，文字会先放在输入框里，你检查后再发送。没反应的话，到「系统设置 › 键盘 › 听写」打开。”
- 桌面输入条下方一行 13px `--ink-mute`：“Enter 换行 · ⌘/Ctrl + Enter 发送”（手机隐藏）。

“发个视频给她”弹层（Popover/手机 Sheet）：标题“给她看个视频”；说明“把 B 站视频的链接贴在这里，她看完会跟你讲。她只是看，不会替你评论或点赞。”；`Field`（占位 `https://www.bilibili.com/video/…`）；按钮“给她看”（primary）。提交=把链接作为一条消息发出（沿用现有“聊天里发链接才生效”的逻辑）。

#### 7.1.5 完整对话流程与反馈

| 步骤 | 视觉 | 时序 |
|---|---|---|
| 1 输入 | 回信条聚焦环；角色 `idle`，视线跟随指针（沿用） | — |
| 2 发送 | 纸条从回信条飞到对话框右上方（§6.8），按钮“寄出中” | 0–320ms 弹簧 300/30 |
| 3 等待 | 对话框 `thinking`：角色思考动作 + 轮换小字 + 墨线（§6.6）；视频/网页进度按下表 | 立即 |
| 4 开始输出 | 思考行 160ms 淡出；文字逐段“墨水渗入”；角色 `speaking=true`、按 `emotion` 事件换表情（沿用） | 首个 `delta` |
| 5 完成 | 纸条淡出；对话框内容写入 Backlog；回信条重新聚焦；若本轮有新记忆/日记事件，不弹窗（不打扰） | `done` |
| 6 失败 | 见 §7.1.6 | `error` |

视频/网页进度文案（映射 `lib/chat.ts:25-26` 的 `stage`）：

| 事件 | stage | 小字（替代原始 `message`，原始 `message` 仍放 `title` 属性） |
|---|---|---|
| video | `reading` | “先打开这个视频看看…” |
| video | `watching` | “在看里面的画面和字幕…” |
| video | `thinking` | “看完了，在想怎么跟你讲。” |
| video | `failed` | “这个视频我没看成。” + 按钮“换一个” |
| web | `reading` | “在读这个网页…” |
| web | `summarizing` | “读完了，在整理。” |
| web | `failed` | “这个网页打不开。” |

#### 7.1.6 空 / 加载 / 错误 / 离线

| 场景 | 角色 | 对话框文案 | 动作 |
|---|---|---|---|
| 首次进入（无历史） | `wave` 入场（`spring 170/18`，从下方 24px 浮上） | `character.greeting` 原文（`characters.ts` 已有）+ 邮戳 `Day 1` 落下 | 3 个建议芯片：“聊聊今天”（预填“今天……”）、“发个视频给她”、“看看她的日记” |
| 形象加载中 | `WhaleSticker idle` 在原位置，轻呼吸 | 名字牌+“{name}正在赶过来…”（`role=status`） | — |
| 形象加载失败 | 贴纸 `sorry` | “我的样子暂时没画出来，不影响聊天。” | quiet“再试一次” |
| 连接中（`health===undefined`，≤1.5s 不显示任何东西，避免闪） | idle | 不显示 | — |
| 连不上（`health.ok!==true`） | `sleep` | “网络好像断了，我在这儿等你。” | 按钮“再试一次”（56 高）；quiet“详情”展开原始错误（在这里才允许出现 `health.provider` 之类） |
| 发送失败 | `sorry` 2s | 失败纸条 + “这句话没送出去。” | “再发一次”“删掉” |
| 后端超时 | `think` 持续 | “她想得有点久，再等等，或者先去别的页面。” | quiet“不等了” |
| 新话题 | `idle` | 对话框清空，显示问候；Backlog 顶部插入分隔“新的一页” | — |

**顶部状态**：正常时**不显示任何状态点或模型名**（删除 `ChatPanel.tsx:177-180` 的 `chat__status`）。

#### 7.1.7 话题（会话）管理
- Backlog 头部：标题=当前话题名（18px 文楷，单行省略）、`话题 ▾`（Popover 列表，每行 56px：话题名 + 日期 13px + 当前对勾；底部 primary“开新话题”）、`···`（DropdownMenu：重命名、删除这个话题）。
- 重命名：在 Popover 内就地变成 `Field` + “保存/取消”；Enter 保存，Esc 取消。
- 删除：`ConfirmDialog`——标题“删除这个话题？”；正文“这个话题里的聊天，和只从它里面记住的事，都会删掉。别的话题不受影响。”；“先留着” / “删掉”。

---

### 7.2 日记页（`/diary`，`pages/DiaryPage.tsx` + `components/DailyJournalList.tsx`）

#### 7.2.1 概念
日记页按周、月和年浏览。月视图以手帐式月历展示真实的日期、主题与记录分布；选择某一天后阅读当天的综合日记及旧版视频日记。周视图保留按时间倒序的日记页，年视图汇总各月份并可直接定位。**视频待看**仍位于页面底部。

#### 7.2.2 桌面 1180×780
```
┌────────┬────────────────────────────────────────────────────────────────┐
│ [导航] │ 大肥鱼的日记                         [请她写今天的 ✎] primary   │
│        │ [周] [月] [年]   [‹ 上个月]   2026年11月   [下个月 ›] [回到今天] │
│        │ ┌────────────────────────────────────────────────────────────┐ │
│        │ │ 一       二       三       四       五       六       日    │ │
│        │ │ 26      27       28       29       30        31        1    │ │
│        │ │  2       3        4        5        6         7        8    │ │
│        │ │  9       10       11       12       13        14       15    │ │
│        │ │ …        有记录日期显示真实主题、记录数和轻量手绘标记        │ │
│        │ │ 有记录 · 今天                                                │ │
│        │ └────────────────────────────────────────────────────────────┘ │
│        │  ─ 给她看的视频 ─────────────────────────────────────────────  │
└────────┴────────────────────────────────────────────────────────────────┘
```
- 笔记本：宽 `min(var(--page-max), 100% - 160px)`，居中偏左；`.sheet` + `InkFrame(radius=20, openCorner)`；左缘 24px 为“装订区”：两个 14px 圆孔（`--paper-2` 底 + 描边）。
- 横线：正文区背景用 SVG 瓦片（高 36px，线在 35px 处，色 `color-mix(ink 9%, transparent)`），`background-attachment: local`；文字行高必须 **36px**（= 18px × 2.0），保证文字落在线上。
- 时间控件：周/月/年标签与范围导航并排放在内容上方；窄屏按“范围标签、前后导航、回到今天”的顺序纵向排列，箭头保留可访问名称。
- 月视图：七列月历按周一至周日排列，日期格显示实际主题和记录数；今天以手绘圈标出，选中日期使用 `--accent-wash`，有记录日期用轻量底色提示。选择日期后显示该日全部综合日记和旧版视频日记；空日期使用明确的无记录状态，返回月历保留月份和选中状态。
- 年视图：按月展示记录数量和空月状态，选择月份后进入对应的月历，不铺开展全年日记正文。

#### 7.2.3 手机 390×844
```
┌──────────────────────────────┐
│ 大肥鱼的日记                  │ 56
│ [请她写今天的 ✎]  primary       │
│ [周] [月] [年]                  │
│ [‹] 2026年11月 [›] [回到今天]   │
│ ┌──────────────────────────┐  │
│ │ 一  二  三  四  五  六  日 │  │
│ │ …   有记录日期显示真实主题 │  │
│ │ …   今天圈与选中状态清楚   │  │
│ └──────────────────────────┘  │
│ 给她看的视频 ▸ (折叠)         │
│                      [小角色] │
├──────────────────────────────┤
│ tabbar                       │
└──────────────────────────────┘
```

#### 7.2.4 内容规则
- **周模式**（默认）：列出所选日期所在周的日记，倒序。**月模式**：月历只展示日期、主题和记录分布；点选日期后显示当天的所有日记，返回保留当前月份和选中日期。**年模式**：显示月份记录数和空月，不铺开日记正文；选月后进入月历。翻周、翻月、翻年和视图切换都围绕当前所选日期。
- **日历主题**：优先使用记录标题，否则取正文首句；使用记录中的真实内容，不生成或猜测主题。过长主题在格内截短，完整正文在日记详情中查看。无记录日期可选，显示清楚的空日状态；空月显示无记录提示。
- 涂鸦：`public/doodles/doodle-{sun,cloud,rain,moon,wave,star}.svg`（`InkLine` 风格，56×56，单色 `--ink-mute`）。按日记接口的 `weather` 字段映射（B3）：`sunny→sun`、`cloudy→cloud`、`rain→rain`、`night→moon`、`wind→wave`、`snow→star`；标签文字「今天心里的天气」（`alt="今天心里的天气：晴"` 等）。`weather` 为 `null`（旧日记尚未回填）时不画涂鸦。日记小标题用 `title`，为 `null` 时用日期。页脚小字“她今天：{心情}”，心情中文：`happy` 开心 / `calm` 平静 / `tired` 有点累 / `excited` 兴奋 / `sad` 有点难过 / `cozy` 暖洋洋 / `curious` 好奇。
- 来源：折叠标题“她是从这些地方想起来的（3）”；展开后每条=类型小图标（聊天/视频/网页/学到的/想了想）+ 标题 + quiet“打开”（沿用现有跳转）；她自己逛到的条目标题前带“她自己逛到的：”。页面顶部固定一个按钮“看她的见闻 ›”（桌面 secondary，老人模式 56 高大按钮），跳 `/surf`。
- 历史版本：不再出现“第 N 版”。有旧版时显示 quiet“她改过 {n} 次，看看以前的写法”，展开后每个旧版以“{日期时间} 的写法”为标题。
- 生成中：按钮变“她在写…”；`CompanionCorner` 变 `write`；纸面末尾出现一条 `InkLine loop` 和小字“她在写，马上好。”；完成时邮戳落下 + toast“写好啦，翻到今天那一页看看。”
- 日期详情切换沿用现有页面动效；日期状态和按钮键盘焦点须可见，减少动态效果偏好继续生效。
- 视频区（`DiaryPage.tsx`）：标题“给她看的视频”；说明“把喜欢的 B 站视频链接放进来，她会挑时间看，再写进日记。”；输入标签“视频链接”；按钮“放进去”（**secondary**，不再是全页最重的深色实心）；队列行状态词：`pending`“排着队”、`processing`“她正在看…”、`done`“看完啦”、`failed`“没看成”+“再试一次”、`duplicate`“这个看过了”；运维动作“立即处理一条”改为 quiet“让她现在就看一个”；旧版视频日记折叠为“以前的视频小记”。**轮询**：仅 `document.visibilityState==="visible"` 且队列含 `pending|processing` 时每 5s 一次，否则停止（现有无条件 5s 轮询 `DiaryPage.tsx:87`）。

#### 7.2.5 文案全文

| 位置 | 文案 |
|---|---|
| 页标题 | “{name}的日记” |
| 主按钮 | “请她写今天的” / 忙时 “她在写…” |
| 今天没素材 | “今天我们还没一起经历什么。聊几句，再来找我写吧。” + 按钮“去聊天” |
| 加载 | “她在翻小本子…” |
| 空（该范围无日记） | 标题“这几天她还没写日记” · 正文“每天晚上 {time} 她会自己写。也可以现在请她写今天的。” · 按钮“请她写今天的”（`{time}` 来自后端配置，未知则写“晚上”） |
| 错误 | 标题“日记本打不开了” · 正文“可能是网络不好，也可能她还没醒。” · 按钮“再试一次” · quiet“详情” |
| 写好 toast | “写好啦，翻到今天那一页看看。” |
| 日历按钮无障碍名 | “选日期，当前是 11 月” |

---

### 7.3 记忆页（`/memory`，`pages/MemoryPage.tsx`）

#### 7.3.1 概念
海边拾到的东西：每条记忆是一枚贝壳，或一只瓶中纸条，带**图鉴编号**，可以收藏、翻看、放回海里（忘掉）。去掉“数据库浏览器”味：分类用五种海边的小物，筛选藏进“更多筛选”。

分类映射（`lib/memory.ts:40` 的类别 → 5 组；新增 `surf`）：

| 组名（界面） | 图标 | 对应 category |
|---|---|---|
| 关于你 | 海螺 `conch` | `fact` |
| 一起经历的 | 扇贝 `shell` | `conversation` `video` `web` `diary`（不含她自己逛到的） |
| 她学到的 | 海星 `starfish` | `learned` |
| 她拾到的 | 小瓶 `bottle` | `surf`（P5：她自己逛到的视频与网页，`sourceId` 以 `surf:` 开头） |
| 她的近况 | 灯塔 `lighthouse` | `reflection` |

#### 7.3.2 桌面 1180×780（内容区最大宽 `--memory-max` 960）
```
┌────────┬─────────────────────────────────────────────────────────────┐
│ [导航] │ 她记得的事                                  已收好 128 件     │
│        │ ┌ 便签（斜 −1°，胶带）────────────┐  ┌ 搜索 [找找她记得的事…][找]┐│
│        │ │ 她的近况：文楷 17px 短文 …      │  └──────────────────────────┘│
│        │ └─────────────────────────────────┘  [全部][关于你][一起经历的][她学到的][她拾到的][她的近况] │
│        │                                      [更多筛选 ▾]                 │
│        │ ┌──────────┐ ┌──────────┐ ┌──────────┐                           │
│        │ │胶带 No.0042│ │ No.0041  │ │ No.0040  │  卡片 ≈ 290×188        │
│        │ │[海螺]标题  │ │          │ │          │  纸条上缘锯齿             │
│        │ │正文 3 行…  │ │          │ │          │                           │
│        │ │11月5日·聊天│ │          │ │          │                           │
│        │ └──────────┘ └──────────┘ └──────────┘                           │
│        │            [‹ 上一页]  第 1 / 5 页  [下一页 ›]        [小角色·抱瓶]│
└────────┴─────────────────────────────────────────────────────────────┘
```
手机 390：搜索全宽 → 分类芯片横向滚动（每个 ≥44 高）→ 卡片单列（宽 `100% - 32px`）→ 底部分页；“更多筛选”为 Sheet。

#### 7.3.3 卡片 `MemoryCard`
- 结构：`<li><button class="memory-card">`（整张可点，打开详情 Dialog）。顶：胶带（颜色按分类固定 a/b/c/d）、`No.0042`（`--font-num` 13px `--ink-mute`）、分类图标 24px；中：标题 `--font-voice 18px/1.5`（2 行省略）；正文 `--font-ui 16px/1.7`（3 行省略，`--ink-soft`）；底：日期 13px + 来源类型小字（“聊天/视频/网页/日记”）。
- 外形：`.sheet`；上缘用 `clip-path` 做 8 个锯齿（深 4px）；旋转 `hash(id)%5 - 2` × 0.5°（老人 0°）；`--shadow-1`；圆角 `--r-md`。
- 状态：悬停=上浮 2px + `--shadow-2`（160ms）；按下=`scale .98`；聚焦=`--focus-ring`；历史记忆（`status==="superseded"`）=整体底色 `--paper-2` 且标题前加 13px“以前的记忆”标签（**不靠降低不透明度**）；来源缺失（`sourceMissing`）=底部“原话已不在了”。
- 图鉴编号：数值 = 后端提供的稳定序号 `seq`（B4：按该角色的创建顺序递增、删除后不回填），**始终显示**（含搜索与筛选结果里），格式 `No.` + 4 位补零；`seq` 为 `null`（仅聊天消息类）时不显示编号。

#### 7.3.4 详情 Dialog（纸条展开）
- `motion` 的 `layoutId` 共享元素从卡片放大到 Dialog（弹簧 `stiffness 300, damping 30`，≈280ms；`LazyMotion` 需 `domMax`，仅此页动态 import）；reduced-motion 时淡入。
- 内容：编号+分类图标、标题（20px 文楷）、全文（18px 文楷 / 1.9）、日期、“她是从这些话里记住的”引用块（每条：左侧 2px `--accent`，13→14px 原话，下附 quiet“回到当时的聊天”，沿用 `MemoryPage` 现有的 `open-message` 跳转逻辑）、若 `sourceId` 以 `journal:` 开头显示“看那天的日记”。
- 底部按钮：secondary“看那天的日记/回到当时的聊天”（有则显示），danger-outline“忘掉这条”（`--alert` 字 + `1.5px --alert` 边，不是实心；与其他按钮间距 ≥16px）。

#### 7.3.5 “忘掉”流程
1. 点“忘掉这条”→ `ConfirmDialog`（标题“要忘掉这条吗？”，正文见 §6.9，“先留着”默认聚焦）。
2. 确认→ 卡片 480ms 折成纸团落入底部小瓶（`scale 1→.2, y→+80, rotate→20°, opacity→0`，`--ease-inout`），列表其余卡片 `layout` 动画补位（弹簧 300/30）；`CompanionCorner` 变 `sorry` 2s。
3. 出便签 toast：“已经忘掉了。” + quiet“撤回”。**真正的删除请求延迟到 5s 后**（`setTimeout`，期间点“撤回”则取消；`pagehide`/路由切换时立即提交）。
4. 失败→ 卡片弹回原位（弹簧 400/17）+ 错误便签“没能忘掉，再试一次？”

#### 7.3.6 筛选与搜索
- 搜索框：`Field` + 放大镜图标，占位“找找她记得的事…”；按钮“找”；清除=右侧 ✕（44px）。
- “更多筛选”Popover（取代 `details` 浮层 `layout.css:136`）：四项，用口语：**谁说的**（都行/我说的/她说的）、**哪一段时间**（从…到…，用 MiniCalendar）、**还作数吗**（都看/现在的/以前的）、**哪位角色**（沿用）；底部“清掉筛选”“看结果”。手机=Sheet。
- 结果计数：搜索后在芯片行下一行 14px：“找到 12 件”。

#### 7.3.7 文案
| 位置 | 文案 |
|---|---|
| 标题 | “她记得的事” |
| 收藏计数 | “已收好 {n} 件” |
| 无记忆（新用户） | 标题“她还在认识你” · 正文“多聊几句，她记住的事就会放在这儿。” · 按钮“去和她聊聊” · 贴纸 `hold`（空瓶） |
| 搜索无结果 | 标题“没找到带「{q}」的纸条” · 正文“换个词试试，或者把筛选清掉。” · 按钮“清掉筛选” |
| 加载 | “她在翻小本子…”（贴纸 `hold` + `InkLine loop`） |
| 错误 | 标题“翻不开了” · 正文“网络好像不太好。” · 按钮“再试一次” · quiet“详情” |
| 删除成功 toast | “已经忘掉了。”（撤回） |

---

### 7.4 设置页（`/settings`，`pages/SettingsPage.tsx`、`components/Accounts.tsx`）

#### 7.4.1 概念
**大字、大行、大白话。** 每组 ≤5 项；每行 ≥72px（老人 ≥88px）；左图标+标题（20px 文楷）+一句说明（16px `--ink-soft`），右侧控件。不出现 select 下拉列表。

#### 7.4.2 桌面 1180×780（单栏，最大宽 `--page-max` 760）
```
┌────────┬────────────────────────────────────────────────────┐
│ [导航] │  设置                                                │
│        │  ── 她 ──────────────────────────────                │
│        │  ┌ [大头贴纸 96]  大肥鱼 · AI 角色    [换一位 ▸] ┐    │
│        │  └ 她怎么称呼你：[小周        ] [记下]          ┘    │
│        │  ── 让她自己逛 ──                                     │
│        │  她可以自己去逛                              [开/关]  │
│        │  逛的频率  [偶尔][常常][勤快]   看视频 [开] 翻网页 [开] │
│        │  逛到有意思的，告诉我                        [开/关]  │
│        │  ── 她逛什么 ──                                       │
│        │  喜欢的：#鲸歌 #纪录片 [+]    不想看的：#广告 [+]       │
│        │  ▸ 更多（安静时段 23:00–08:00）                        │
│        │  ── 看起来 ──                                         │
│        │  [跟随系统][晨光][深海夜]  ← 3 张 ChoiceCard 160×112   │
│        │  ── 方便我用 ──                                       │
│        │  老人模式（大字、大按钮、只留三个入口）      [开/关]    │
│        │  字号   小Aa ──●────── 大Aa    预览：今天天气很好      │
│        │  减少动画（安静模式）                         [开/关]  │
│        │  ── 额度 ──                                          │
│        │  本月还剩 2588 / 3000 个贝壳  ▓▓▓▓▓▓▓░░  下次 12月1日   │
│        │  聊天 180 · 看视频 100 · 读网页 12 · 写日记 20 · 她自己逛 100│
│        │  ── 我的数据 ──                                       │
│        │  [导出我的全部数据]  [清空聊天记录]  [退出登录]         │
│        │  [删除我的全部数据]（danger）                          │
│        │  ── 关于 ──   {name} 是 AI 角色，不是真人 ▸ 版本 ▸     │
│        │  ▸ 连接其他平台（B 站登录）  ← 折叠                    │
└────────┴────────────────────────────────────────────────────┘
```
手机：同序单列，ChoiceCard 一行一个，按钮全宽 56。

#### 7.4.3 各组规格
1. **她**：当前角色卡（贴纸/头像 96px + 名字 + 一句 `tagline`）+“换一位”→ Dialog：4 张角色卡（头像、名字、`tagline`、选中=2.5px accent 框+“已选”邮戳），选中立即换（`setCharacter`），关闭后 `CompanionCorner` `wave`。**形象选择**：默认只列该角色的**推荐形象**（`model.config` 里该角色 `modelId`；鲸汐是 `avatar-b`），其余 VRM 收进 quiet“更多形象”，展开后才是列表；列表里用角色名而非“栗发·软绵绵”这类（保留原 label 作副标）。**怎么称呼你**：一行 `Field`（≤12 字，占位“不想说也没关系”）+ quiet“记下”，`PUT /api/profile`（B5），成功 toast“记下啦。”，清空后保存即清除。
2. **让她自己逛**（P5，§7.7.6、§10.6）：总开关 Switch；频率 3 张 `ChoiceCard`（偶尔/常常/勤快）；看视频、翻网页两个 Switch；“逛到有意思的，告诉我”Switch。读写 `GET/PUT /api/surf/settings`，改动即生效，无保存按钮；失败 toast“没改成，再试一次？”并回滚控件。
3. **她逛什么**：兴趣 `TagInput`（≤8 个）、不想看的 `TagInput`（≤20 个）、折叠“更多”里的安静时段（两个时间步进器）。
4. **看起来**：`ChoiceCard` ×3：跟随系统 / 晨光 / 深海夜（含缩略预览）；选中即应用（`applyTheme`），无“保存”按钮。
5. **方便我用**：老人模式 Switch（说明“大字、大按钮、只保留聊天、她的日记、设置三个入口”）；字号 Slider（1.0–1.5，开老人模式时下限 1.25）；安静模式 Switch（说明“关掉会动的小细节”，默认=系统 `prefers-reduced-motion`）；高对比 Switch（`data-contrast=high`）。
6. **额度**（锚点 `#quota`）：`QuotaMeter` 读 `GET /api/quota`（B1）：主行“本月还剩 {remaining} / {total} 个贝壳”，条 = `used/total` 的手绘横条；“下次刷新 {月}月{日}日”；明细一行“聊天 {n} · 看视频 {n} · 读网页 {n} · 写日记 {n} · 她自己逛 {n}”；小字“用多少、什么时候扣，都会写在这里，不会悄悄扣。”；`billing==="off"` 时再加一行“现在还不收费，这里只是让你心里有数。”；`low` 时条变 `--alert` 并加“快用完了，她逛街会先歇着。”；读取失败显示 `StateBlock` 小版“额度暂时看不到”+“再试一次”。
7. **我的数据**：
   - “导出我的全部数据”→ `POST /api/export`（B2）；成功 toast“已导出到下载文件夹：{文件名}。”，失败 toast“没能导出，再试一次？”。
   - “清空聊天记录”→ `ConfirmDialog`：“清空所有聊天？”“聊天原文和只从聊天里记住的事都会删掉；看过的视频、网页、她自己逛到的东西和日记里的内容会留着。”（对应现有 `DELETE /api/chat/history` 语义，`docs/API.md:34`）→ “先留着”/“清空”。
   - “退出登录”→ `ConfirmDialog`（正文“退出后这台设备上的登录状态会清掉，聊天记录不受影响。”）。
   - “删除我的全部数据”→ `ConfirmDialog` + `requireAck`（“我知道删除后找不回来”）；正文“聊天、她记得的事、日记、她逛到的东西、额度记录和你的昵称都会删掉，B 站登录也会退出。建议先导出一份。”；danger 实心按钮“全部删掉”；调用 `DELETE /api/data`（`{confirm:"DELETE_ALL"}`），成功后清 `wp.*` 本地键并重载回到首次引导。
   - 所有按钮 secondary；仅“删除全部数据”是 danger。
8. **关于**：行1“{name}是一个 AI 角色，不是真人。她会陪你聊天、看视频、写日记，也会自己去逛逛。”（常驻可见，非折叠）；行2 版本号。
9. **连接其他平台**（折叠，默认收起）：把现有 B 站扫码登录 `Accounts` 放入；说明沿用 `Accounts.tsx:102` 原文；二维码白底保留（`.account__qr img` 白底是扫码必需）。

---

### 7.5 首次引导（3 步，`components/Onboarding.tsx`，`wp.onboarded` 未设时全屏覆盖）

通用：顶部**进度**：三颗贝壳 + 文字“第 1 步，共 3 步”（Finch 的教训：必须让人知道还有几步）；底部固定位置的 primary 按钮；左下 quiet“跳过，以后再说”（每步都有）；不出现 API Key、模型、插件字样；全程可键盘操作；背景=舞台（纸 + 潮水 + 她）。

```
桌面 1180×780                                手机 390×844
┌────────────────────────────────────┐      ┌──────────────────────┐
│ ○ ● ○   第 2 步，共 3 步            │      │ ○ ● ○ 第2步，共3步    │
│                                    │      │                      │
│  [她，居中偏左，Live2D/贴纸]        │      │   [她 220px]          │
│       ╭────────────────────╮       │      │ ╭──────────────────╮ │
│       │ 对话框：这一步的话   │       │      │ │ 这一步的话        │ │
│       ╰────────────────────╯       │      │ ╰──────────────────╯ │
│  [控件区：输入/角色卡/字号按钮]      │      │ [控件区]              │
│  [跳过，以后再说]        [下一步 ▸]  │      │ [下一步 ▸] 全宽 56   │
└────────────────────────────────────┘      └──────────────────────┘
```

| 步 | 名字牌下的话（原文） | 控件 | 按钮 |
|---|---|---|---|
| 1 遇见 | “你好呀，我是{name}。”（换行）“我是一个 AI 角色，不是真人。我会陪你聊天，也会替你看看视频、写写日记。” | 无（她 `wave` 入场，弹簧 170/18） | “你好呀” |
| 2 认识 | “你想让我怎么叫你？”（换行）“不想说也没关系。” | 昵称 `Field`（可空，≤12 字）；下方**选一位陪你**：4 张角色卡 | “就这样” / 昵称为空时同按钮 |
| 3 约定 | “最后说三件小事。”（换行）“① 我们的聊天只存在这台设备上。② 你随时可以导出，也可以删掉一切。③ 我不会向你要验证码、银行卡，也不会让你转账。” | “字看得清吗？”三个按钮 `Aa 标准`/`Aa 大`/`Aa 特别大`（选“特别大”=开启老人模式并说明“大字、大按钮、三个入口”） | “开始吧” |

- 完成：写 `wp.onboarded=1`、角色、字号；昵称 `PUT /api/profile`（B5，后端注入人格提示；空则不请求）；她说第一句 `greeting`；Backlog 里插入分隔“第一天”。
- 再次进入：设置页底部 quiet“重新看一遍引导”。

---

### 7.6 所有空 / 加载 / 错误状态总表

| 位置 | 状态 | 贴纸 mood | 标题 / 文案 | 主动作 | 来源（原文位置） |
|---|---|---|---|---|---|
| 聊天 | 空 | wave | greeting + 3 个建议芯片 | 建议芯片 | `ChatPanel.tsx:195` |
| 聊天 | 形象加载 | idle | “{name}正在赶过来…” | — | `ChatPage.tsx:28,33` |
| 聊天 | 离线 | sleep | “网络好像断了，我在这儿等你。” | 再试一次 | `ChatPanel.tsx:179,212` |
| 聊天 | 发送失败 | sorry | “这句话没送出去。” | 再发一次 / 删掉 | `ChatPanel.tsx:158-159` |
| 日记 | 空 | hold（空本子） | “这几天她还没写日记” | 请她写今天的 | `DailyJournalList.tsx:241` |
| 日记 | 加载 | write | “她在翻小本子…” | — | `DiaryPage.tsx:179`、`DailyJournalList.tsx:240` |
| 日记 | 错误 | sorry | “日记本打不开了” | 再试一次 | `DiaryPage.tsx`（`diary-error`） |
| 日记·视频 | 空 | idle | “还没有给她看的视频。把链接放进来吧。” | 聚焦输入 | `DiaryPage.tsx:196` |
| 记忆 | 空（新用户） | hold | “她还在认识你” | 去和她聊聊 | `MemoryPage.tsx:207` |
| 记忆 | 搜索无果 | think | “没找到带「{q}」的纸条” | 清掉筛选 | `MemoryPage.tsx:207` |
| 记忆 | 加载 / 错误 | hold / sorry | “她在翻小本子…” / “翻不开了” | 再试一次 | `MemoryPage.tsx:206` |
| 设置 | 读取账号失败 | sorry | “暂时看不到登录状态。” | 再试一次 | `Accounts.tsx:20` |
| 设置 | 额度读取失败 | sorry | “额度暂时看不到。” | 再试一次 | 新增 |
| 见闻 | 空（已开启） / 空（已关闭） | phone / sleep | “她还没出去逛过” / “她现在不去逛了” | 让她现在去逛逛 / 打开 | §7.7.4 |
| 见闻 | 搜索无果 / 加载 / 错误 | think / paper / sorry | “没找到带「{q}」的见闻” / “她在整理剪报…” / “见闻翻不开了” | 清掉搜索 / — / 再试一次 | §7.7.4 |
| 见闻 | 额度不足 | sleep | “这个月的贝壳快用完了” | 去看看额度 | §7.7.4 |
| 全局 | 后端离线 | sleep | “我睡着了，网络回来我就醒。”（CompanionCorner 台词） | — | — |

所有 `StateBlock` 的“详情”折叠里才允许出现技术原文（HTTP 状态、`error.message`）。

---

### 7.7 她自己去逛（P5 的界面；后端见 §10.6）

#### 7.7.1 概念
她不只在你说话时才存在：她会按自己的节奏去刷 B 站视频、上网冲浪，回来把看到的东西剪成**剪报 / 明信片**，写进日记，也会在聊天里主动讲一句“我今天看到…”。界面上要让人**看得见她在逛**，也**翻得到她逛过什么**，并且**管得住**（开关、频率、兴趣、屏蔽词）。

#### 7.7.2 三处界面
1. **舞台上的“她在逛”状态**（聊天页）。
2. **「她的见闻」页**，路由 `/surf`，导航第 3 项（图标 `postcard`）。
3. **设置里两组**：「让她自己逛」「她逛什么」（见 §7.4.3）。

#### 7.7.3 舞台状态 `<SurfStatus/>`（聊天页，`components/SurfStatus.tsx`）
- 触发：`useSurfEvents(character)`（§10.6.7）收到 `session` 事件且 `state="start"` 时显示，`state="end"` 后淡出（200ms）。
- 外观：舞台左上角一张小便签（`--slip` 底，高 40，内边距 `0 14px`，`--shadow-1`，微旋转 −1°，顶部一条 24×10 的 `Tape`），内容 = 小图标 + 一行 14px 字；整张便签是按钮（命中区 ≥44px），点击跳 `/surf`。
- 小图标（20px，手绘）：看视频 = 小手机，上面 3 道 `InkLine` 横线依次点亮（每道 400ms，循环 1200ms）；翻网页 = 小报纸，一支小笔尖在报纸上横向移动（`translateX 0→10px`，1600ms 往返）；整理 = 小本子。calm 模式下图标静止。
- 角色动作：`avatar-state.ts` 增加 `activity: "idle" | "thinking" | "browsing"`。`browsing` 时：Live2D `ParamEyeBallY = -0.5`、`ParamAngleY = -6`（低头看手机），保持 Idle 动作；VRM lookAt 目标下移 0.25 并叠加 `relaxed` 0.3；`speaking` 与情绪事件优先于它。她开口说话（用户发消息）时立即回到 `thinking`/`speaking`。
- 状态文案（按事件 `step.stage`）：

| stage | 便签上的字 |
|---|---|
| `searching` | “在找想看的东西…” |
| `watching` | “在看一个视频…” |
| `reading` | “在翻网页…” |
| `writing` | “在记下来…” |
| 结束且有新内容 | “逛完啦，带回 {n} 样东西”（停留 4s，点击去 `/surf`） |
| 结束但没带回东西 | “这次没逛到什么，下次再去。”（停留 3s） |

- `CompanionCorner`（非聊天页）：事件在跑时 mood = `phone`（视频）或 `paper`（网页），点击台词：“我在外面逛呢，回来讲给你听。”

#### 7.7.4 「她的见闻」页（桌面 1180×780）
```
┌────────┬────────────────────────────────────────────────────────────────┐
│ [导航] │ 大肥鱼的见闻            她今天逛了 3 个地方 · 下一次 16:30   │ 头 72
│        │ [全部][视频][网页]  [搜一搜…]              [让她现在去逛逛]      │ 56
│        │ ──────── 11月7日 周六 ────────                                  │
│        │ ┌───────────────────────┐ ┌───────────────────────┐            │
│        │ │胶带  [缩略图 16:9]     │ │胶带  [缩略图]          │ 卡 ≈ 340  │
│        │ │ ╭哔哩哔哩 11.07╮邮戳    │ │ ╭juejin.cn 11.07╮       │            │
│        │ │ 标题（文楷18，2行）     │ │ 标题                   │            │
│        │ │ 她说：「…一句话感想」   │ │ 她说：「…」            │            │
│        │ │ #海洋 #纪录片           │ │ #阅读                  │            │
│        │ │ 看视频·14:20 [打开][忘掉]│ │ 读网页·10:05 [打开][忘掉]│           │
│        │ └───────────────────────┘ └───────────────────────┘            │
│        │ ──────── 11月6日 周五 ────────                                  │
│        │ …                                  [再往前翻翻]      [小角色·phone]│
└────────┴────────────────────────────────────────────────────────────────┘
```
- 栅格：桌面两列（卡宽 ≈340，列间距 24），手机一列（宽 `100% - 32px`）；老人模式一列。按天分组，日期分隔 = `InkLine` + `Fraunces 14px`。
- 头部：标题“{name}的见闻”；副行 14px `--ink-mute`：“她今天逛了 {n} 个地方 · 下一次 {HH:mm}”（来自 `GET /api/surf/status`；已关闭则显示“她现在不去逛了”）。
- 按钮：secondary“让她现在去逛逛”，运行中变成禁用态“她正在逛…”（`aria-busy`）；30 分钟内已手动触发过 → 点击出便签“她刚回来不久，歇一会儿再去吧。”（服务端 429 的文案）。
- 筛选：`ToggleGroup` 芯片（全部 / 视频 / 网页）+ 搜索框（占位“找找她逛到的东西…”，走 `q` 参数）。
- 分页：每页 20 张；底部 quiet 按钮“再往前翻翻”加载下一页（`page+1`），没有更多时变成文字“翻到头了。”。

**`PostcardCard`（剪报 / 明信片卡片，`components/PostcardCard.tsx`）**
- 外形：`.sheet` + 上缘锯齿（同 `MemoryCard`）+ 左上 `Tape`；旋转 `hash(id)%5 - 2` × 0.5°（老人 0°）；`--shadow-1`；圆角 `--r-md`；内边距 16。
- 缩略图：16:9，宽 100% 内缩 12px，**照片白边** 6px `--sheet` + 轻微旋转 ±0.6°；图片来自 `GET /api/surf/thumb/:id`；无缩略图时显示纸色占位：网站首字大号 Fraunces/文楷（如“哔”“J”）+ 手绘小框；右下压一枚 `Stamp`（圆形 72，行1=站点简称“B站”或域名主体，行2=`MM.DD`）。
- 文字：标题 `--font-voice 18px/1.5`（2 行省略）；“她说：”前缀 14px `--ink-mute`，感想 `--font-voice 17px/1.8`，左侧 2px `--accent` 竖线；标签芯片（≤3，14px，`--paper-2` 底）。
- 底行：类型图标（`video`/`newspaper`）+ 时间 13px `--ink-mute`；按钮“打开原链接”（secondary，外部浏览器打开：Tauri 里用 `@tauri-apps/plugin-opener` 的 `openUrl`，浏览器开发用 `window.open(url, "_blank", "noopener")`）、“忘掉”（quiet，`--alert` 字，打开 `ConfirmDialog`）。
- 点击卡片主体（缩略图/标题）→ Dialog `PostcardDetail`：大图、完整摘要（`--font-voice 17px/1.9`）、她的感想、来源链接文本、按钮“跟她聊聊这个”（primary：写入 `localStorage["wp.pendingDraft"]=“我看到你逛到了《{title}》，”` 并 `navigate("/")`，聊天页挂载时读出填进回信条后删除）、“打开原链接”、“忘掉”。
- 状态：悬停上浮 2px；按下 `scale .98`；聚焦环；新内容（`createdAt` 在 24h 内且本机未看过）右上角 `Stamp label “新”`（`localStorage["wp.surf.seen"]` 记最大已看 id）。

**见闻页的空 / 加载 / 错误**

| 场景 | 贴纸 mood | 文案 | 动作 |
|---|---|---|---|
| 空，且已开启 | `phone` | 标题“她还没出去逛过”· 正文“她会挑时间去看视频、翻网页，回来讲给你听。” | primary“让她现在去逛逛” |
| 空，且已关闭 | `sleep` | 标题“她现在不去逛了”· 正文“打开之后，她会自己去看视频、翻网页。” | primary“打开”（调用设置接口 `enabled=true`） |
| 搜索无果 | `think` | 标题“没找到带「{q}」的见闻”· 正文“换个词试试。” | quiet“清掉搜索” |
| 加载 | `paper` + `InkLine loop` | “她在整理剪报…” | — |
| 错误 | `sorry` | 标题“见闻翻不开了”· 正文“网络好像不太好。” | primary“再试一次”，quiet“详情” |
| 额度不足（`status.pausedReason="quota"`） | `sleep` | 标题“这个月的贝壳快用完了”· 正文“她先歇着，下个月 1 号再去逛。” | quiet“去看看额度”→ `/settings#quota` |

#### 7.7.5 聊天里的主动分享
- 服务端把她的分享写成一条助手消息（带 `attachment`，§10.6.6）。客户端收到 SSE `share` 事件后：若聊天页在前台，`DialogBox` 以 ink-in 播放这条话，下方挂 `PostcardMini`；若在其它页，导航“聊天”图标右上角出现 10px `--alert` 红点（`aria-label` 追加“有新消息”），进入聊天页后消失。
- `PostcardMini`：宽 ≤ 对话框宽，高 72；左 96×54 缩略图（照片白边），右侧标题（`--font-ui 16px`，1 行省略）+ 站点·时间（13px）；右端两个按钮“打开”“看她的见闻 ›”（quiet）。在 `Backlog` 里同样显示；整张可聚焦。
- 分享话术由模型按人格生成（§10.6.6），不在前端写死；前端只在 `attachment.comment` 缺失时用兜底文案“我今天看到这个，觉得你会想看。”。

#### 7.7.6 设置组文案（接入 §7.4.3）

| 组 | 行 | 说明文字 |
|---|---|---|
| 让她自己逛 | 总开关 Switch | “开了之后，她会自己去看视频、翻网页，回来讲给你听。” |
| | 频率（3 张 `ChoiceCard`） | “偶尔 · 一天 2 次”“常常 · 一天 4 次”“勤快 · 一天 8 次”，副字“每次最多看 1–2 个视频、翻 3 个网页” |
| | 看什么（两个 Switch） | “看视频（B 站）”“翻网页” |
| | 讲给我听 Switch | “逛到有意思的，她会在聊天里告诉我。” |
| 她逛什么 | 兴趣 | 标签输入，占位“加一个她可能喜欢的，比如：鲸歌”，最多 8 个，每个 ≤12 字；下方小字“她自己也有喜欢的，这里是帮她多想几个。” |
| | 不想看的 | 标签输入，占位“加一个不想让她看的词”，最多 20 个；小字“带这些词的内容，她会直接跳过。” |
| | 安静时段（折叠“更多”） | 两个时间步进器（开始/结束，默认 23:00–08:00）；小字“这段时间她不出门，也不主动发消息。” |
| 额度行补充 | | “她自己去逛也会用贝壳：看一个视频 20 个，翻一个网页 3 个。贝壳少于一成时她会先歇着。” |

#### 7.7.7 老人模式与动效
- 老人模式：见闻页一列、卡片按钮 56px、`Tape` 与旋转关闭；“她在逛”便签字号 ×1.25 且不动画；入口：导航只有 3 项，所以“她的见闻”放在**日记页顶部的一个大按钮**（56 高，文字“看她的见闻 ›”）和聊天里分享卡的“看她的见闻”。
- calm：`SurfStatus` 图标静止，卡片无悬停位移。

---

## 8. 动效规范

### 8.1 总则
- 库：`motion`（motion.dev，`import { m, LazyMotion, domAnimation, AnimatePresence, MotionConfig, useReducedMotion } from "motion/react"`）。根部 `<MotionConfig reducedMotion={calm ? "always" : "user"}>`。
- 只动画 `transform` 与 `opacity`；唯一例外：墨线 `clip-path`（小元素）与折叠展开（用 `grid-template-rows: 0fr → 1fr` 过渡，不动画 `height`）。
- UI 动效 ≤300ms（页翻 520ms、潮水 600ms 例外）；缓动 `--ease-out`（入）/`--ease-inout`（循环）；**不用线性（除浪漂移）、不用 ease-in 入场**。
- 全部弹簧集中在 `src/motion/tokens.ts`，组件不得手写数值：

```ts
export const spring = {
  press:  { type: "spring", stiffness: 520, damping: 32 },          // 按下回弹，无过冲
  soft:   { type: "spring", stiffness: 300, damping: 30 },          // 默认 UI（几乎无回弹）
  sheet:  { type: "spring", stiffness: 260, damping: 32 },          // 抽屉
  page:   { type: "spring", stiffness: 260, damping: 28 },          // 翻页
  switch: { type: "spring", stiffness: 500, damping: 30 },
  cute:   { type: "spring", stiffness: 400, damping: 17 },          // 仅：邮戳、收藏、角色被点
  char:   { type: "spring", stiffness: 170, damping: 18, mass: 1 }, // 角色入场
} as const;
export const dur = { press: .12, hover: .16, fade: .2, panel: .28, ink: .24, page: .52 } as const;
```

### 8.2 动效表

| 交互 | 属性 | 参数 | reduced-motion / 老人 / calm |
|---|---|---|---|
| 按钮按下 | `scale 1→.97` | `spring.press`（≈120ms） | 仅底色变化 |
| 按钮悬停 | `y -1px` + 阴影 | 160ms `--ease-out` | 无位移 |
| 键盘聚焦 | `box-shadow` 环 | 瞬时 | 同 |
| 导航切换（荧光块） | `scaleX .6→1`、opacity | `spring.soft` | 120ms 淡入 |
| 页面切换 | VT 交叉淡入 200ms；无 VT 用 `opacity 0→1, y 6→0` | 280ms | 120ms 淡入 |
| 对话框/弹层出现 | `scale .96→1, y 8→0, opacity` | `spring.soft`（≈220ms）；退出 160ms | 120ms 淡入淡出 |
| 底部抽屉 | `y 100%→0` | `spring.sheet`；拖拽关闭阈值 120px / 500px/s | 淡入 |
| 你的纸条飞出 | `x,y` 到对话框右上、`rotate` | `spring.soft` ≈320ms；她开口时缩小淡出 200ms | 直接淡入到位 |
| 她的话墨水渗入 | `opacity 0→1, y 2→0` | 每 span 240ms，大块按 28ms 级联（总 ≤280ms） | 120ms 淡入、无位移 |
| 思考小字轮换 | opacity 交叉 | 160ms，每 2400ms | 不轮换，固定“我想想哦…” |
| 思考墨线 | `clip-path` 0→100% | 1800ms `--ease-inout`，每轮停 600ms | 静止显示满线 |
| 角色呼吸 | `scale 1→1.015` | `--breath` 4.5s `ease-in-out` 无限 | 关闭 |
| 角色眨眼 | 眼睑/眼点 | 随机 3–6s 一次，120ms | 关闭（Live2D 自带眨眼可保留，属内容） |
| 尾鳍/发丝漂浮 | `translateY ±3px` | 7s 正弦 | 关闭 |
| 角色入场 | `y 24→0, opacity` | `spring.char` ≈600ms | 淡入 |
| 角色被点 | `y 0→-10→0` | `spring.cute` | 仅表情变化 |
| 浪漂移 | `translateX 0→-50%` | far 90s / mid 60s / near 40s 线性 | 静止 |
| 潮水涨起（进页） | `translateY 14→0` | `spring.char` ≈600ms | 无 |
| 邮戳落下 | `scale 1.3→1, rotate -14→-6°, opacity` | `spring.cute` ≈260ms，一次 | 直接显示 |
| 记忆卡展开 | `layoutId` 共享元素 | `spring.soft` ≈280ms | 淡入 |
| 忘掉（折进瓶子） | `scale 1→.2, y +80, rotate 20°, opacity→0` | 480ms `--ease-inout`，列表补位 `spring.soft` | 淡出 160ms |
| 翻页 | 旧页 `x ∓24, rotate ∓1°, opacity`；新页 `x ±40→0`；纸影条平移 | 旧 200ms；新 `spring.page`；总 520ms | 120ms 淡入 |
| 展开折叠 | `grid-template-rows` | 280ms `--ease-out` | 即时 |
| Switch 滑块 | `x` | `spring.switch` | 即时 |
| Toast 入/出 | `y 16→0, opacity` | 280ms / 160ms | 淡入 |
| 键盘弹起布局 | `height` 经 CSS 变量 | 280ms `spring.soft`（用 `--vvh` 过渡，仅此处允许布局属性动画，且只在键盘事件时） | 即时 |
| “她在逛”便签入/出 | `opacity`、`y 8→0`、`rotate -1°` | 入 `spring.soft` / 出 200ms | 120ms 淡入 |
| 明信片卡片入场 | `opacity`、`y 12→0`（列表内错开 40ms，最多 6 张） | `spring.soft` | 120ms 淡入 |
| 手机屏三道线点亮 / 笔尖移动 | `opacity` / `translateX` | 循环 1200ms / 1600ms | 静止 |
| 角色对话时嘴型 | `ParamMouthOpenY` | 沿用现有正弦（`Live2DStage.tsx`） | 沿用（属内容） |

### 8.3 常驻动效的预算与降级
- 同屏常驻动画 ≤4 个：角色呼吸、浪漂（3 层算 1 个）、眨眼、尾鳍。用户**正在输入**时（`textarea` 有焦点且 2s 内有键入）浪漂暂停、呼吸降频到 6.5s。
- `document.visibilityState==="hidden"`、窗口失焦 >30s：暂停所有 CSS 动画（`animation-play-state: paused`，由根节点 `data-idle="true"` 控制）与 `requestAnimationFrame` 循环。
- 只动 `transform` / `opacity`（例外见 §8.1）；手机、老人模式、calm 下 Tide 不加滤镜、不画纤维纹理、`InkFrame` 不播放描边动画。
- View Transitions：只做页面级交叉淡入，必须 `if (document.startViewTransition)` 特性检测。

---

## 9. 适老化与无障碍

### 9.1 老人模式（设置 › 方便我用 › 老人模式；引导第 3 步也可开启）
`document.documentElement`：`data-elder="on"`，`--scale ≥ 1.25`，`data-motion="calm"`。

| 维度 | 规格 |
|---|---|
| 字号 | rem 整体 ×1.25：她的话 21.25px，正文 20px，最小字 16.25px（邮戳/编号）；可由字号滑块再调到 ×1.5 |
| 触控 | 所有可点元素 ≥56×56px，相邻间距 ≥8px；Switch 72×40；Slider 滑块 36px |
| 导航 | **三个入口**：聊天 / 她的日记 / 设置；“记忆”进入「设置 › 她记得的事」，“见闻”从日记页顶部大按钮进入；桌面左栏与手机底栏均只 3 项，标签字 20px |
| 动效 | `calm`：无呼吸、无漂浮、无浪漂、无墨水渗入位移、无翻页；只留 120ms 淡入。角色保留 Live2D 自带待机（内容） |
| 装饰 | 便签/卡片旋转 0°；胶带 ≤2 条且不旋转；不画纤维纹理；浪不加水彩滤镜 |
| 对比 | `--ink-mute`→`--ink-soft`（亮 ≥7.0、暗 ≥8.1）；控件边界 `--line-strong`→`--ink-mute`（≥5.2）；描边 2px/3px |
| 行宽 | 正文 ≤30em；设置行 ≥88px |
| 文字不靠悬停 | Tooltip 内容必须同时可见（图标按钮旁常显文字）；复制/时间等悬停才出现的操作改为常显 |
| 确认 | 所有删除/退出/清空/充值（将来）一律 `ConfirmDialog`，按钮 `lg`（56），正文先说后果；安全选项在上、默认聚焦 |
| 通知 | Toast 8 秒且有“关掉”按钮；重要错误不用 Toast 而用对话框 |
| 语音（后期） | 语音优先、字幕同步显示：回复朗读时对话框文字同步高亮当前句（预留 `data-speaking` 钩子，本期不做） |
| 防迷路 | 每页顶部固定页名（文楷 24→30px）；不使用手势作为唯一操作；任何页面一步回聊天（导航常驻） |

### 9.2 通用无障碍清单（所有模式）
1. **对比度**：见 §4.3；任何新组合先验算；文字 ≥4.5:1，正文与主要说明 ≥7:1；非文字控件边界 ≥3:1。**珊瑚色永不作文字**。
2. **尺寸**：触控 ≥44×44（老人 ≥56）；正文 ≥16px；聊天 17px；仅邮戳/编号/时间可到 13px。系统/应用字号放大到 200%（`--scale=2`）时 390px 宽无横向滚动、无文字重叠（Playwright 截图校验）。
3. **键盘**：Tab 顺序=视觉顺序；所有 Radix 组件的方向键/Esc/焦点回收保持默认；聊天页快捷键：`⌘/Ctrl+Enter` 发送、`Esc` 关闭往回翻、`/` 聚焦回信条（无输入框焦点时）。焦点环 `--focus-ring` 在亮/暗/老人模式下对背景对比 ≥3:1。
4. **读屏**：地标 `nav`/`main`/`complementary`（往回翻）；DialogBox 用一次性 `role="status"` 汇报完整回复（§6.8）；装饰（浪、手绘线、胶带、纹理、涂鸦）`aria-hidden`；图标按钮 `aria-label`；日历格子有完整日期名与“有日记”；`StateBlock` 的 `role` 按 §6.10。
5. **颜色之外**：状态必须有文字/图标（Switch 的“开/关”、错误的图标+文字、已选的对勾+“已选”邮戳）。
6. **动效**：`prefers-reduced-motion`、设置“安静模式”、老人模式三者任一生效即进入 calm；无闪烁（>3 次/秒）；无自动轮播。
7. **语言与文案**：`<html lang="zh-CN">`；短句、动词在前；不用英文缩写和“同步/重试”；一屏一个主动作。
8. **标准**：对照《互联网应用适老化通用设计规范》YD/T 3820-2021 与 GB/T 37668-2019，本文取更严的一档数值（正文 ≥16px、老人模式 20px、触控 56px、对比 ≥7:1）；国际对照 WCAG 2.2（1.4.3/1.4.6/1.4.4/2.5.8/2.5.5/2.3.1）。
9. **测试**：`@axe-core/playwright` 在 §12.1 的全部截图页面运行，0 个 critical/serious；人工用 VoiceOver（macOS）与 TalkBack（Android）各走一遍“发消息 → 看日记 → 忘掉一条记忆 → 开老人模式”。

---

## 10. 技术实施方案

### 10.1 流程（遵守 `AGENTS.md` / `CONTRIBUTING.md`）
1. 开工前确认当前目录是仓库根、看 `git status`、读 `docs/SESSION_HANDOFF.md`。有未提交改动先辨认归属，不要重置/清理。
2. Issue：1 个总 Issue「UI 重设计：潮汐手帐 2.0」+ 7 个子 Issue（P0、P-B、P1、P2、P3、P4、P5），每个写清范围与本文 §10.4 的“完成定义”。没有对应 Issue 的阶段，Agent 先按本文创建再开工。
3. 分支：`feat/<issue号>-ui-tide-journal-2-p0`（按阶段；后端阶段用 `...-pb`，冲浪用 `...-p5`）。**不直接推 `main`**；开发者自己审查并合并 PR。PR 正文写“解决什么/主要改动/验证命令与结果”，**界面变更附 §12.1 的截图**，用 `Closes #<issue>`。
4. 提交信息前缀：`feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:`；不混入无关格式化。
5. 不写入任何密钥；不部署；不向第三方平台发评论；不擅自扩范围。后端缺口已全部定为 P-B 的实施任务（§10.5），**按本文规格直接实现，不伪造数据，也不再等待决定**。
6. 每个阶段开新分支，从最新 `main` 切出；上一阶段的 PR 尚未合并时，新分支从上一阶段分支切出并在 PR 描述里写明依赖顺序。
7. 迭代到上限（§12.7）仍有差距：把差距报告写进该阶段 PR 描述，**直接进入下一阶段**。
8. 会话结束前按 `docs/SESSION_HANDOFF.md` 在 Issue/PR 留交接记录。

### 10.2 依赖清单（pnpm；在仓库根执行，版本即下表）

```bash
pnpm --dir apps/client add motion@^14.10.0 radix-ui@^1.8.1 sonner@^2.0.8 \
  react-virtuoso@^4.18.20 streamdown@^2.7.1 perfect-freehand@^1.2.3 \
  @tauri-apps/plugin-opener
pnpm --dir apps/client add -D playwright@^1.65.0 @axe-core/playwright@^4.14.0 \
  cn-font-split@7.4.3 culori@^4.0.2 @types/culori
# P5 才装（API 侧，无头浏览器）：
pnpm --dir apps/api add playwright-core@^1.65.0
pnpm --dir apps/api exec playwright-core install chromium
```

| 包 | 版本 | 用途 |
|---|---|---|
| motion | ^14.10.0 | 动效，按需 `motion/react`，`LazyMotion` |
| radix-ui（合集） | ^1.8.1 | Dialog/AlertDialog/Popover/DropdownMenu/Tooltip/Switch/Slider/Tabs/RadioGroup/ToggleGroup |
| sonner | ^2.0.8 | 便签式 toast |
| react-virtuoso | ^4.18.20 | 往回翻虚拟列表 |
| streamdown | ^2.7.1 | 流式 Markdown（仅含 Markdown 的回复） |
| perfect-freehand | ^1.2.3 | 手绘线/框/图标/浪线 |
| @tauri-apps/plugin-opener | 随 Tauri 2 | “打开原链接”（Tauri 里用外部浏览器打开；需在 `src-tauri` 注册插件与 `capabilities`，见 §10.6.9） |
| cn-font-split（dev） | 7.4.3 | 中文字体子集化 |
| culori（dev） | ^4.0.2 | 对比度脚本 |
| playwright（dev） | ^1.65.0 | 截图矩阵、a11y、e2e |
| @axe-core/playwright（dev） | ^4.14.0 | 无障碍检查 |
| playwright-core（apps/api） | ^1.65.0 | P5 网上冲浪的无头 Chromium |
| 已有 | lxgw-wenkai-webfont ^1.7.0、@fontsource-variable/fraunces ^5.3.0（**本轮启用**） | 文楷 / 日期数字 |
| 新字体文件（不入库） | LXGW Neo XiHei | `apps/client/fonts-src/`，由 `build-fonts.mjs` 生成 `public/fonts/` |

API 侧其余能力全部用 Node 内置（`node:zlib` 的 `deflateRawSync` 与 `crc32` 写 zip、`node:crypto`、`node:sqlite`、`node:fs`），**不新增 zip 库**。`cron` 已在依赖里。

`vite.config.ts`：`build.rollupOptions.output.manualChunks` 把 `pixi`/`three` 之外的 `motion`、`radix-ui`、`react-virtuoso`、`streamdown` 各自独立；`MemoryPage`、`SurfPage`、`Onboarding`、`streamdown` 用 `React.lazy`。

### 10.3 文件改动清单

#### 10.3.1 客户端（`apps/client/`，逐文件）

**新增**
| 路径 | 内容 |
|---|---|
| `public/theme-boot.js` | 首帧前写 `data-theme/data-elder/--scale`（外部脚本，CSP 友好） |
| `public/fonts/neo-xihei/*`、`public/textures/fiber-{light,dark}.svg`、`public/doodles/*.svg` | 字体分片、纹理、涂鸦 |
| `scripts/build-fonts.mjs`、`bake-icons.mjs`、`bake-fibers.mjs`、`check-contrast.mjs` | 构建/校验脚本 |
| `src/lib/ink.ts`、`wave.ts`、`vt.ts`、`a11y.ts`、`companion.ts`、`useKeyboardInset.ts` | 工具与状态 |
| `src/lib/quota.ts`、`data.ts`、`profile.ts`、`surf.ts`、`useSurfEvents.ts` | 新后端接口的客户端封装（P-B、P5） |
| `src/motion/tokens.ts` | 弹簧与时长（§8.1） |
| `src/styles/components.css`、`src/styles/paper.css`（纸纹/胶带/邮戳） | 新样式 |
| `src/components/ink/{InkLine,InkFrame,Stamp,Tape}.tsx`、`Tide.tsx`、`Backdrop.tsx` | §5 |
| `src/components/{Icon,Icons.baked,WhaleSticker,CompanionCorner,StateBlock,Onboarding,ConfirmDialog,Thinking,InkText,DialogBox,NameTab,ComposerBar,Backlog,Slip,CaptionBlock,MiniCalendar,QuotaMeter,MemoryCard,DateStamp,IndexTabs}.tsx` | §6 |
| `src/components/{SurfStatus,PostcardCard,PostcardMini,PostcardDetail,TagInput}.tsx`、`src/pages/SurfPage.tsx` | §7.7 |
| `src/components/ui/{Button,Field,Switch,Slider,ChoiceCard,Dialog,Sheet,Menu,Popover,Tooltip,Toaster}.tsx` | Radix 皮肤 |
| `tests/ui/{screens.spec.ts,a11y.spec.ts,grep-rules.spec.ts,surf.spec.ts}`、`playwright.config.ts` | §12 |

**修改**
| 路径 | 改什么 |
|---|---|
| `index.html` | `theme-color`→`#F6EFE2`；`<script src="/theme-boot.js">`；`preload` 核心字体 |
| `src/styles/tokens.css` | 全量替换为 §4.2（含 `--grain`） |
| `src/styles/characters.css` | 全量替换为 §4.4 |
| `src/styles/base.css` | §4.9：去噪点叠层、新焦点环、字体 import（保留 lxgw regular+bold，新增 neo-xihei、`@fontsource-variable/fraunces/index.css`）、`font-synthesis:none` |
| `src/styles/layout.css` | 逐页迁移到 `components.css`，P4 删除已无引用的规则；**不得**新增写在此文件里的东西 |
| `src/styles/ocean.css` | 改为 `tide.css`（`.tide__*`），保留 `drift` 关键帧思路 |
| `src/App.tsx` | §7.0；新增路由 `/surf`（懒加载） |
| `src/components/Nav.tsx` | 图标、荧光块、红点、5 项（老人 3 项）、`/surf` 入口 |
| `src/components/Ocean.tsx` | 重命名为 `Backdrop.tsx`（旧文件删除） |
| `src/components/Icons.tsx` | 保留 `TailMark`，其余并入 `Icon` |
| `src/components/WhaleFigure.tsx` | **删除**，由 `WhaleSticker` 取代（`ChatPage.tsx:8,28,33` 同步改） |
| `src/pages/ChatPage.tsx` | 舞台+`DialogBox`+`ComposerBar`+`Backlog` 组合；去掉 `stage__tag/stage__hint`；挂 `SurfStatus` |
| `src/components/ChatPanel.tsx` | 拆分：数据/流逻辑保留（`send`、SSE、`useChatSessions`），视图拆到新组件；删 `chat__status`；删三点；placeholder/离线文案按 §7.1；渲染消息 `attachment` |
| `src/components/ChatSessionControls.tsx` | `<select>`/`<details>`→ Popover + DropdownMenu；`window.confirm`→`ConfirmDialog` |
| `src/pages/DiaryPage.tsx`、`components/DailyJournalList.tsx` | §7.2；日期 input→`MiniCalendar`；真实 `mood/weather`；“第 N 版”文案；视频区降级；轮询按可见性；顶部“看她的见闻”入口 |
| `src/pages/MemoryPage.tsx` | §7.3；`window.confirm`→`ConfirmDialog`；延迟删除；真实 `seq`；第 5 类「她拾到的」 |
| `src/pages/SettingsPage.tsx`、`components/Accounts.tsx` | §7.4；二次点击确认→`ConfirmDialog`；额度/导出/删除全部/昵称/冲浪设置接线 |
| `src/avatar/Live2DStage.tsx`、`VrmStage.tsx`、`avatar-state.ts` | 增加 `thinking` 与 `browsing`（`activity`）姿态入口（props 或 store），**不改**模型加载逻辑 |
| `src/lib/theme.ts` | §4.8 |
| `src/lib/diary.ts`、`memory.ts` | 类型增加 `mood/weather/title`、`seq`、`surf` 类别（见 §10.5） |
| `src/lib/api.ts` | 仅新增 `getBlob/streamEvents` 辅助（SSE 用 fetch 流）；既有函数签名不变 |
| `src/main.tsx` | 挂 `MotionConfig`、`applyTheme/applyA11y` 初始化 |
| `src-tauri/tauri.conf.json` | CSP 的 `img-src` 改为 `'self' data: blob: http://127.0.0.1:8787 http://localhost:8787`（P5 缩略图由 API 提供）；注册 opener 插件及其权限 |
| `docs/DESIGN.md` | 改写为「潮汐手帐 2.0」（取舍、配色表、字体、布局、动效）——**每个 PR 同步更新对应部分** |
| `package.json` | 依赖 + 脚本 `"ui:fonts"`、`"ui:contrast"`、`"ui:test"`、`"ui:shots"` |

#### 10.3.2 API（`apps/api/`，P-B 与 P5）

**新增**
| 路径 | 内容 |
|---|---|
| `src/quota.ts`、`src/routes/quota.ts` | 额度服务与路由（B1） |
| `src/zip.ts`、`src/export.ts`、`src/store/export.ts`、`src/routes/data.ts` | 导出 zip、删除全部（B2） |
| `src/diary-mood.ts` | 日记心情/天气生成（B3） |
| `src/store/memory-seq.ts` | 稳定编号（B4） |
| `src/store/profile.ts`、`src/routes/profile.ts` | 昵称（B5） |
| `src/surf/{settings,picker,bilibili-search,web-search,browser,reader,thumbs,service,scheduler,blocklist}.ts`、`src/persona/interests.ts`、`src/store/surf.ts`、`src/routes/surf.ts` | 自主冲浪（P5） |
| `test/{quota,export,delete-all,diary-mood,memory-seq,profile}.test.ts`、`test/surf-{store,picker,bilibili-search,web,session,routes,scheduler}.test.ts` | 测试 |

**修改**
| 路径 | 改什么 |
|---|---|
| `src/server.ts` | `createApiServer` 增加路径分发：`/api/quota`、`/api/export`、`/api/data`、`/api/profile`、`/api/surf/*`；`/api/health` 增加 `schedule` |
| `src/config.ts` | 增加 `quotaMonthlyUnits`、`quotaEnforce`、`exportDir`、`surf*` 配置（见 §10.5/10.6） |
| `src/store/database.ts` | 新表与迁移（`usage_ledger`、`user_profile`、`memory_seq*`、`surf_*`、`messages.attachment_json`） |
| `src/journal-store.ts`、`src/daily-journal.ts` | `daily_journal_revisions` 增加 `mood/weather/title`；生成后调用 `diary-mood`；`journal-sources.ts` 的 surf 标题前缀 |
| `src/store/explorer.ts` | `seq` 字段与 `ensureSeq`；新增类别 `surf`；video/web 类别排除 `surf:%` |
| `src/store/maintenance.ts` | `clearAllData(db)` |
| `src/routes/chat-history.ts` | `DELETE /api/data` 复用其锁；`GET /api/chat/history` 返回 `attachment` |
| `src/persona/persona.ts` | `withUserName(core, nickname)` |
| `src/chat.ts`、`src/chat-materials.ts` | 注入昵称；写 `usage_ledger`；额度检查 |
| `vendor/dsh-bilibili/lib/extractor.js`、`UPSTREAM.md` | 新增 `searchVideos(session, {keyword, page})` 导出（WBI 签名的搜索），在 `UPSTREAM.md` 记录这一处本地补丁 |
| `package.json` | `playwright-core` 依赖与脚本 `"surf:install": "playwright-core install chromium"` |

### 10.4 分阶段计划与完成定义

阶段顺序：**P0 → P-B → P1 → P2 → P3 → P4 → P5**。P-B 放在 P1 之前，是因为 P2（真实 mood/weather/编号）、P3（额度/导出/删除/昵称）与 P5 都依赖它；P1 的昵称问候也用到 B5。

| 阶段 | 内容 | 完成定义（全部满足才算完成） |
|---|---|---|
| **P0 tokens / 字体 / 纹理**（≈2 天） | 依赖；`tokens.css`/`characters.css`/`base.css` 新版；`theme.ts`+`a11y.ts`+`theme-boot.js`；字体子集化与加载；纸纹；`ink.ts`+`InkLine`/`InkFrame`/`Tape`/`Stamp`；`Backdrop`+`Tide`；`WhaleSticker`；`check-contrast.mjs` | ① 现有 4 个页面在新 tokens 下无破版（旧 class 仍工作）；② `pnpm --dir apps/client typecheck` 与 `build` 通过；③ 对比度脚本全绿；④ 首屏字体 ≤220KB；⑤ `grep gradient` 为 0；⑥ 纸纹验收（§5.1）；⑦ 亮/暗 × 4 角色的“样品页”（隐藏路由 `/__kit`）截图入 PR |
| **P-B 后端补齐**（≈4 天） | §10.5 的 B1–B6：额度、导出/删除全部、日记 mood/weather、记忆编号、昵称注入、健康检查 `schedule` | ① `pnpm --dir apps/api typecheck` 与 `pnpm --dir apps/api test` 全绿，新增测试见 §12.8；② 每个接口按 §10.5 的请求/响应 schema 返回（测试逐字段断言）；③ 旧库打开后自动迁移，旧数据可读、旧测试不改动即通过；④ 客户端 `lib/quota.ts`、`data.ts`、`profile.ts` 与类型扩展就绪（`typecheck` 通过）；⑤ 手动 curl 记录（每个接口一条）贴进 PR |
| **P1 聊天**（≈4 天） | `Nav` 图标；`ChatPage` 重组；`DialogBox`/`NameTab`/`Thinking`/`InkText`/`Slip`/`Backlog`/`ComposerBar`；离线/失败/空态；`ConfirmDialog`（会话删除）；键盘 inset；`CompanionCorner` 框架；昵称问候 | §7.1 的 8 个状态截图齐全；无 `chat__status`、无三点、无模型名；流式有 ink-in；手机键盘弹起截图（模拟 `visualViewport`）；axe 0 严重 |
| **P2 日记 + 记忆**（≈4 天） | `DateStamp`/`IndexTabs`/`MiniCalendar`/翻页；真实心情天气涂鸦；视频区降级；`MemoryCard`（真实 `No.`）+详情+忘掉流程（延迟删除、撤回）；筛选 Popover；空/加载/错误 | §7.2、§7.3 状态截图齐全；无 `window.confirm`；编号来自 `seq`；“忘掉”动画与撤回可用（Playwright 断言 5s 内撤回不发 DELETE） |
| **P3 设置 / 引导 / 老人模式**（≈4 天） | 设置页重做；`ChoiceCard`/`Switch`/`Slider`；额度真实表；导出/删除全部/昵称接线；`Onboarding` 3 步；老人模式全站；`CompanionCorner` 全页接入 | 老人模式截图矩阵（§12.1）全齐；所有触控 ≥56；3 项导航；引导 3 步可完成/可跳过；导出得到有效 zip、删除全部后各页回到空态（e2e 对真实 API 的冒烟用例） |
| **P4 打磨**（≈3 天） | 清理 `layout.css`；动效调参；插画/贴纸终稿；`docs/DESIGN.md` 终稿；完整验收与迭代循环 | §12.1–12.7 全部通过，或把差距报告写进 PR 后结束本阶段 |
| **P5 自主冲浪**（≈7 天） | §10.6 的后端（设置、调度、B 站选片、网页冲浪、总结、分享、SSE）+ §7.7 的全部界面（舞台状态、`/surf` 见闻页、聊天里的明信片、设置两组、记忆第 5 类） | ① 后端：`surf-*` 测试全绿；② 一次手动触发（`POST /api/surf/run`）在本机真实跑完：至少产出 1 条 `surf_items`、对应 `experiences`（`sourceId` 以 `surf:` 开头）、`usage_ledger` 记账、SSE 事件顺序正确；③ 前端：§7.7 全部状态截图（含 `d`/`m`/亮/暗/老人）；④ `surf.spec.ts` 通过；⑤ 全量回归（P0–P4 的截图矩阵、a11y、grep 规则）仍然通过；⑥ 关闭开关后调度器不再触发（测试断言） |

每个阶段结束都要跑 §12.7 的迭代循环（该阶段范围内的页面）。

### 10.5 P-B 后端补齐（实施任务 B1–B6）

通用约定（全部任务适用）：
- 框架：`apps/api` 是 Node ≥26 的原生 `node:http` 服务，`src/server.ts` 的 `createApiServer(deps)` 按路径前缀分发到 `src/routes/*.ts`；存储是 `node:sqlite` 的 `DatabaseSync`，表在 `src/store/database.ts` 的 `openChatDatabase` 里 `CREATE TABLE IF NOT EXISTS`，加列用 `PRAGMA table_info` 判断后 `ALTER TABLE ADD COLUMN`（与现有迁移同写法）。日记表在 `src/journal-store.ts`（`JournalStore`）里同样迁移。
- 路由模块导出 `handleXxx(req, res, deps): Promise<boolean>`（匹配返回 `true`），沿用 `routes/journals.ts` 的 JSON 读写与错误体 `{ "error": "<code>", "message": "<中文一句话>" }`。
- 测试：`apps/api/test/*.test.ts`，`node:test` + 临时目录 + `ChatStore`/`JournalStore` + 假 `ChatProvider` + `createApiServer`（照抄既有测试的 setup），不连真实网络。运行：`pnpm --dir apps/api test`、`pnpm --dir apps/api typecheck`。
- 所有新表带 `character` 的以 `characterId`（`CHARACTERS` 中的 id）为值；没有角色维度的（额度、昵称）是全局的。

#### B1 额度 / 贝壳（quota）

**产品语义**：当前没有计费，额度是“用量透明表”：每次会产生模型调用的动作都记一笔“贝壳”，用户可在设置里看到本月用了多少、还剩多少。默认**只记账不拦截**（`QUOTA_ENFORCE=0`）；开启拦截后，额度用完时聊天/看视频/冲浪返回 402 并由前端显示“这个月的贝壳用完了”。

**配置**（`config.ts`，环境变量）：`QUOTA_MONTHLY_UNITS`（默认 `3000`）、`QUOTA_ENFORCE`（默认 `"0"`，`"1"` 开启拦截）。

**单位成本**（常量，`quota.ts` 导出 `UNIT_COSTS`）：

| 动作 `kind` | 贝壳 | 记账位置 |
|---|---|---|
| `chat`（一次助手回复） | 1 | `chat.ts` 的 `runChat` 在 `done` 前 |
| `video`（用户分享视频被她看完） | 20 | `chat-materials.ts` 的 `watchVideo` 成功后 |
| `web`（用户分享网页被她读完） | 3 | `readWeb` 成功后 |
| `journal`（一次日记生成/重写） | 5 | `daily-journal.ts` 的 `#generate` 成功后 |
| `surf`（自主冲浪：每个视频 20、每个网页 3，按 `meta.kind` 区分） | 20 / 3 | `surf/service.ts` 每个条目写入后 |

**存储**：
```sql
CREATE TABLE IF NOT EXISTS usage_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,              -- chat|video|web|journal|surf
  units INTEGER NOT NULL,
  character TEXT,
  meta_json TEXT,                  -- 如 {"surf":"video","itemId":12}
  created_at TEXT NOT NULL         -- ISO UTC
);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_created ON usage_ledger(created_at);
```

**服务**（`src/quota.ts`）：`class QuotaService { constructor(db, config, now = () => new Date()) }`
- `record(kind, units, {character, meta})`：写一行。
- `summary()`：按**本地时区自然月**（`Intl` 取服务器本地时间；周期起点为当月 1 日 00:00 本地）汇总。
- `assertAvailable(units)`：仅在 `quotaEnforce` 为真且 `remaining < units` 时抛 `QuotaExceededError`；路由层转成 `402 {"error":"quota_exceeded","message":"这个月的贝壳用完了，下个月 1 号会重新给你。"}`。
- `isLow()`：`remaining / total < 0.2`（自主冲浪暂停条件，§10.6.5）。

**路由**：`GET /api/quota`
```jsonc
// 200
{
  "billing": "off",                       // 目前恒为 "off"：还没开始收费
  "enforced": false,
  "period": { "start": "2026-11-01", "end": "2026-11-30", "resetsAt": "2026-12-01T00:00:00+08:00" },
  "total": 3000,
  "used": 412,
  "remaining": 2588,
  "low": false,                           // remaining/total < 0.2
  "breakdown": { "chat": 180, "video": 100, "web": 12, "journal": 20, "surf": 100 },
  "costs": { "chat": 1, "video": 20, "web": 3, "journal": 5, "surfVideo": 20, "surfWeb": 3 },
  "today": { "used": 37 }
}
```
**客户端消费**：`lib/quota.ts` 导出 `getQuota()`；`QuotaMeter`（设置 › 额度，§7.4.3）显示“本月还剩 {remaining} / {total} 个贝壳”“下次刷新 {月}月{日}日”，并把 `breakdown` 画成 5 条横向手绘条（聊天 / 看视频 / 读网页 / 写日记 / 她自己逛）；`low=true` 时条变 `--alert` 并加一行“快用完了，她逛街会先歇着。”；`billing==="off"` 时显示一行小字“现在还不收费，这里只是让你心里有数。”。`402` 在聊天里的文案：“这个月的贝壳用完了，下个月 1 号再来找我。”
**测试**（`test/quota.test.ts`）：① 空库 `summary()` 的 `used=0`、`remaining=total`；② `record` 后 `breakdown` 与 `used` 正确；③ 跨月（注入 `now`）旧月记录不计入；④ `QUOTA_ENFORCE=1` 且额度不足时 `assertAvailable` 抛错，聊天路由返回 402；⑤ `QUOTA_ENFORCE=0` 时仍放行；⑥ `runChat` 一次回复后恰好多一条 `chat` 行（用假 provider）；⑦ `GET /api/quota` 响应字段与类型逐项断言。

#### B2 数据导出（JSON zip）与“删除全部数据”

**导出路由**
- `POST /api/export` → 在 `EXPORT_DIR`（环境变量，默认 `~/Downloads`）生成 `whalepartner-export-YYYYMMDD-HHmmss.zip`，返回
```json
{ "ok": true, "path": "/Users/x/Downloads/whalepartner-export-20261107-203015.zip", "bytes": 48213, "files": 12, "createdAt": "2026-11-07T12:30:15.000Z" }
```
- `GET /api/export` → 直接以 `application/zip` 流式返回同样内容（`Content-Disposition: attachment`），供浏览器开发环境下载。
- 导出期间持有与聊天历史清除相同的读锁语义：先 `pauseBackgroundJobs()`，导出完成后恢复，避免导出到一半被写入（沿用 `routes/chat-history.ts` 里的调用方式）。

**实现**
- `src/zip.ts`：纯 Node 的 zip 写入器。`createZip(entries: {name:string; data:Buffer}[]): Buffer`，每个文件用 `zlib.deflateRawSync` 压缩，CRC32 用 `zlib.crc32`，写本地文件头 + 中央目录 + 结束记录；文件名按 UTF-8 并置通用标志位 bit 11。
- `src/store/export.ts`：`dumpAll(db): Record<string, unknown[]>`，**白名单**表：`sessions`、`messages`、`facts`、`experiences`、`observations`、`daily_journals`、`daily_journal_revisions`、`daily_journal_sources`、`diary_items`、`surf_items`、`surf_sessions`、`surf_settings`、`usage_ledger`、`user_profile`、`memory_seq`；不存在的表跳过。永不导出：Bilibili 登录凭据、任何 API Key、向量库二进制。
- `src/export.ts`：把上面组装成 zip 内文件：

| zip 内文件 | 内容 |
|---|---|
| `manifest.json` | `{ app:"WhalePartner", version, exportedAt, counts:{…每表行数} }` |
| `README.txt` | 一段中文：每个文件是什么（供用户自己看） |
| `profile.json` | 昵称等 |
| `sessions.json`、`messages.json` | 聊天（含 `attachment_json` 解析后的对象） |
| `memories/facts.json`、`experiences.json`、`observations.json` | 记忆 |
| `journals.json` | 日记，含**全部版本**（`revisions[]`，每版 `text/mood/weather/title/createdAt`） |
| `diary_items.json` | 旧版日记条目 |
| `surf.json` | 见闻条目（不含缩略图二进制） |
| `surf-thumbs/<id>.jpg` | 见闻缩略图（存在才放） |
| `usage.json` | 用量流水 |

**删除全部**：`DELETE /api/data`，请求体 `{ "confirm": "DELETE_ALL" }`，缺失或不符 → `400 {"error":"confirm_required"}`。成功 `200 {"ok":true,"deleted":{"messages":123,"facts":12,…}}`。
- 复用 `routes/chat-history.ts` 的顺序：`sessionRequests.lockForHistoryClear()` → `pauseBackgroundJobs()` → `journal.lockForSessionDeletion()` → `waitForMemoryJobs()` → 执行 → 解锁。
- `store/maintenance.ts` 新增 `clearAllData(db)`：在一个事务里清空 §上表全部数据表**和** `memory_seq`、`memory_seq_counter`、`user_profile`、`usage_ledger`；然后删除向量库条目（沿用现有 `clearChatData` 的做法）、删除 `.local/surf/` 目录、调用 Bilibili 登出（`accounts.ts` 现有登出函数）。不删除配置、不删除 `.env`。
- 前端清掉 `localStorage` 里所有 `wp.*` 键后 `location.reload()`，回到首次引导。

**客户端消费**：`lib/data.ts` 导出 `exportAll()`（Tauri 内 POST 并 toast“已导出到下载文件夹：{文件名}。”；浏览器环境走 GET 触发下载）与 `deleteAll()`；设置 › 我的数据的两行按钮（§7.4.3）。
**测试**：`export.test.ts`：① 造数据后 `POST /api/export`，用 `unzip -l` 等价的手写读取（或 `node:zlib` 解 `inflateRawSync`）验证 zip 可读、`manifest.counts` 与表行数一致、日记含多版本；② `GET /api/export` 的 `Content-Type`；③ 导出不含 `token|cookie|sessdata`（对全部 JSON 做字符串扫描）。`delete-all.test.ts`：① 错误 `confirm` → 400 且数据不变；② 正确 `confirm` → 所有白名单表行数为 0、`memory_seq_counter` 为空、`.local/surf` 被删；③ 删除后 `GET /api/memories`、`/api/journals` 返回空而不是报错；④ 删除过程中并发的聊天请求被锁挡住（返回 409，沿用 `chat-history` 现有错误）。

#### B3 日记心情 / 天气（写日记时由模型一并生成）

**语义**：`mood` 是她这一天的心情，`weather` 是她的“心里的天气”（不是真实天气，界面标签就叫「今天心里的天气」）。

**枚举**：`mood ∈ happy|calm|tired|excited|sad|cozy|curious`；`weather ∈ sunny|cloudy|rain|night|wind|snow`。界面涂鸦映射：`sunny→sun`、`cloudy→cloud`、`rain→rain`、`night→moon`、`wind→wave`、`snow→star`。

**存储**：`daily_journal_revisions` 增加三列（`JournalStore` 迁移，`PRAGMA table_info` 判断）：`mood TEXT`、`weather TEXT`、`title TEXT`。旧行为 `NULL`。

**生成**（`src/diary-mood.ts`）：日记正文生成成功后，在 `DailyJournalService.#generate` 里紧接着发起**第二次短调用**：`provider.stream`，`temperature 0.2`，`maxTokens 120`，系统提示 = `buildPersonaCore(character)` 的一行版 + 下面的任务：
```text
下面是你今天写的日记。请只输出一个 JSON：{"mood":"<happy|calm|tired|excited|sad|cozy|curious 之一>","weather":"<sunny|cloudy|rain|night|wind|snow 之一>","title":"<不超过 12 个字的日记小标题，用你自己的口吻，不要加标点结尾>"}。
mood 选最贴近今天整体情绪的；weather 是你“心里的天气”，不是真实天气。不要输出任何别的文字。
```
解析失败或枚举越界 → 默认 `{mood:"calm", weather:"cloudy", title:null}`（`title` 为空时前端用日期）。**失败不影响日记本身**，只写默认值并记一行日志。额度记账：这次调用不额外记贝壳（含在 `journal` 的 5 个里）。
**启动回填**：服务启动后异步对最近 30 条 `mood IS NULL` 的版本各补一次（串行、间隔 2 秒、遇到 provider 错误立即停止，下次启动再补）。

**接口变化**：`GET /api/journals` 与 `GET /api/journals/:date` 的每个版本对象增加 `mood`、`weather`、`title`（可能为 `null`）。其余字段不变。
**客户端消费**：`lib/diary.ts` 类型扩展；`DiaryPage` 的涂鸦按 `weather` 映射（§7.2.4）、小标题用 `title`、页脚小字“她今天：{心情中文}”（心情中文表：开心/平静/有点累/兴奋/有点难过/暖洋洋/好奇）；`null` 时涂鸦不画、标题回退日期，不再用 `hash(date)` 伪造。
**测试**（`diary-mood.test.ts`）：① 假 provider 返回合法 JSON → 入库字段正确；② 返回夹杂文字的 JSON（含代码围栏）→ 能解析；③ 返回非法枚举/非 JSON → 默认值；④ 第二次调用抛错 → 日记仍成功、mood 为默认值；⑤ 旧库迁移后旧行三列为 `NULL`，接口返回 `null`；⑥ 回填只处理 `NULL` 行且最多 30 条。

#### B4 记忆稳定编号（图鉴编号 `seq`）

**语义**：每个角色的“被她记住的东西”（facts、experiences、reflection）按创建顺序有一个**永不改变、永不复用**的编号，卡片上显示 `No.0042`。删除后空出的编号不补。聊天消息本身不编号。

**存储**：
```sql
CREATE TABLE IF NOT EXISTS memory_seq (
  ref_type  TEXT NOT NULL,         -- fact|experience|reflection
  ref_id    INTEGER NOT NULL,
  character TEXT NOT NULL,
  seq       INTEGER NOT NULL,
  PRIMARY KEY (ref_type, ref_id),
  UNIQUE (character, seq)
);
CREATE TABLE IF NOT EXISTS memory_seq_counter (
  character TEXT PRIMARY KEY,
  last INTEGER NOT NULL
);
```
**迁移与分配**（`src/store/memory-seq.ts`）：`ensureSeq(db, character)` 在 `listMemoryExplorer`（`store/explorer.ts`）开头调用：找出该角色下尚无 `memory_seq` 行的 fact/experience/reflection，按 `created_at, id` 升序依次分配 `last+1…`，同一事务内更新 `memory_seq_counter`。这就是迁移——旧库第一次打开记忆页时**惰性回填**，编号按历史创建顺序。同时删除指向已不存在记录的 `memory_seq` 行（**计数器不回退**）。新记录在下一次列表请求时拿到编号（写入路径不改，避免触碰记忆写入的并发）。
**接口变化**：`GET /api/memories` 的每个 item 增加 `seq: number | null`（消息类为 `null`）；`GET /api/memories/:id` 同。
**客户端消费**：`MemoryCard` 与详情标题右侧 `No.{seq 补零到 4 位}`（Fraunces）；`seq===null`（仅消息）不显示编号；§7.3.3 的编号规则按此执行，**始终显示**。
**测试**（`memory-seq.test.ts`）：① 旧库（无 `memory_seq`）插入 5 条后首次列表 → 编号 1…5 按创建顺序；② 再新增 2 条 → 6、7；③ 删除第 3 条 → 其余不变，再新增得到 8（不复用）；④ 不同角色各自从 1 开始；⑤ 同一次并发列表请求不产生重复（`UNIQUE` 保证 + 事务）；⑥ 清空全部数据后计数器重置。

#### B5 昵称注入人格提示

**存储**：`user_profile(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`，目前只用 `key="nickname"`。
**路由**：
- `GET /api/profile` → `200 {"nickname": "小周" | null}`
- `PUT /api/profile`，请求体 `{"nickname": "小周"}` 或 `{"nickname": null}`（清除）→ `200 {"nickname": …}`。校验：去首尾空白后 1–12 个字符；不得含控制字符、换行、`<`、`>`、反引号；违反 → `400 {"error":"invalid_nickname","message":"昵称请用 1 到 12 个字，不要带换行或特殊符号。"}`。
**注入**：`persona.ts` 新增 `withUserName(core: string, nickname: string | null): string`：昵称为空原样返回；否则在 `core` 末尾追加一段 `\n\n【对方】\n对方希望你称呼 TA 为「{nickname}」。自然地偶尔使用即可，不要每句都叫，也不要解释这个称呼的来源。`。在 `chat.ts` 的 `runChat`（构建上下文处）、`daily-journal.ts`（`writeJournal`）、`surf/service.ts` 的分享话术里，凡调用 `buildPersonaCore(character)` 之后都包一层 `withUserName(…, profile.nickname)`。
**客户端消费**：引导第 2 步的昵称 `Field` 在“就这样”时 `PUT /api/profile`（空则不请求）；设置 › 她 之上增加一行“她怎么称呼你”（`Field` + “记下”按钮，toast“记下啦。”）；不再使用 `localStorage["wp.nickname"]`（读到旧值时迁移一次：`PUT` 后删除）。问候语里的 `{nickname}` 来自 `GET /api/profile`。
**测试**（`profile.test.ts`）：① PUT/GET 往返；② 非法昵称 400（各类各一条）；③ `null` 清除；④ `withUserName` 的输出含昵称且为空时不变；⑤ 假 provider 捕获到的 `runChat` system prompt 含“称呼 TA 为「小周」”；⑥ 删除全部后昵称为空。

#### B6 其余已定的小项
1. **日记任务时间可读**：`GET /api/health` 响应增加 `"schedule": { "journalTime": "20:30" | null }`，由 `config.journalCron`（默认 `30 20 * * *`）解析：仅当形如 `M H * * *` 时返回 `"HH:MM"`，否则为 `null`。客户端空态文案“她每天晚上 {journalTime} 写日记”，`null` 时写“她每天晚上写日记”。
2. **记忆删除的撤回**：只在前端实现（延迟 5 秒再发 `DELETE`，`pagehide` 立即提交），后端不变。
3. **聊天历史返回附件**：`messages` 表增加 `attachment_json TEXT`（迁移）；`GET /api/chat/history` 的每条消息增加 `attachment: object | null`（P5 使用，B 阶段只做迁移与透传，测试里直接 `INSERT` 一条带附件的助手消息断言返回）。
4. **Tauri CSP**：见 §10.3.1（`img-src` 增加本地 API 源）。

### 10.6 P5 自主冲浪「她自己去逛」

#### 10.6.1 概览与数据流
```
调度器(每 5 分钟检查) ──到点──> SurfService.run(character, slot)
   │                               │
   │   前置检查：开关 / 静默时段 / 额度 / 近 14 天有聊天 / 视频锁 / 用户正在聊天
   │                               ▼
   │      选题（兴趣 + 近期话题）→ ① B 站：搜索→筛选→模型挑 1 个→看（collect/summarize）
   │                               ② 网页：Bing 搜索→模型挑 ≤3→无头浏览器读→正文
   │                               ▼
   │      每个条目：模型总结 {summary, comment, tags, worth_sharing, safe}
   │                               ▼
   │      写入 surf_items + experiences(surf:…) + 缩略图 + usage_ledger
   │                               ▼
   └─> SSE: session/step/item/share ──> 客户端“她在逛”便签 / 见闻页 / 聊天明信片
        收尾：值得分享且符合频控 → 助手消息(attachment)；20:30 后 → 重写今天的日记
```
- **复用**：B 站能力完全复用 `apps/api/vendor/dsh-bilibili` + `src/video-service.ts`（`createVideoService().collect/summarize`、`acquireVideoLock`）+ `src/bilibili.ts`（`assertBilibiliRequestAllowed`、限流冷却）+ `src/chat-background.ts`（`queueLearning`/`queueReflection`/`pauseBackgroundJobs`）；归档复用 `src/memory/archive.ts` 的 `archiveExperience`。
- **网页**：新增 `playwright-core` 无头 Chromium；不复用用户聊天里的 `web-service.ts` 抓取（它只做静态 HTML），但复用其 `isPrivateAddress` 与 SSRF 查询函数。
- **默认值**：新装即 `enabled=true`、`frequency="normal"`、`video=true`、`web=true`、`shareToChat=true`。首次启动没装 Chromium 时，网页部分自动跳过并在状态里写 `webAvailable:false`，视频照常；`pnpm --dir apps/api surf:install` 安装后无需重启。

#### 10.6.2 设置与存储

**表**（`store/database.ts` 创建；`store/surf.ts` 提供 `SurfRepository`，挂在 `ChatStore` 上）：
```sql
CREATE TABLE IF NOT EXISTS surf_settings (
  character TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  frequency TEXT NOT NULL DEFAULT 'normal',      -- rare|normal|often
  interests_json TEXT NOT NULL DEFAULT '[]',     -- 用户补充的兴趣，≤8 个，每个 ≤12 字
  blocked_json TEXT NOT NULL DEFAULT '[]',       -- 屏蔽词，≤20 个，每个 ≤12 字
  quiet_start TEXT NOT NULL DEFAULT '23:00',
  quiet_end TEXT NOT NULL DEFAULT '08:00',
  video INTEGER NOT NULL DEFAULT 1,
  web INTEGER NOT NULL DEFAULT 1,
  share_to_chat INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS surf_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character TEXT NOT NULL,
  slot TEXT NOT NULL,                  -- 'YYYY-MM-DD HH:MM'（调度槽）或 'manual-<ISO>'
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,                -- running|done|skipped|failed
  items_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  queries_json TEXT,
  UNIQUE (character, slot)
);
CREATE TABLE IF NOT EXISTS surf_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character TEXT NOT NULL,
  session_id INTEGER NOT NULL REFERENCES surf_sessions(id),
  kind TEXT NOT NULL,                  -- video|web
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  source_site TEXT NOT NULL,           -- 'bilibili' 或域名主体，如 'juejin.cn'
  thumb_path TEXT,                     -- 相对 .local/surf/thumbs/
  summary TEXT NOT NULL,
  comment TEXT NOT NULL,               -- 她的一句话感想 ≤30 字
  tags_json TEXT NOT NULL DEFAULT '[]',
  score INTEGER NOT NULL DEFAULT 3,    -- worth_sharing 1–5
  dedupe_key TEXT NOT NULL,            -- 'bv:BVxxxx' 或 'web:<sha1(规范化url)前16位>'
  experience_id INTEGER,
  created_at TEXT NOT NULL,
  shared_at TEXT,
  shared_message_id INTEGER,
  hidden INTEGER NOT NULL DEFAULT 0,   -- “忘掉”后软删除标记（同时删 experience 与缩略图）
  UNIQUE (character, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_surf_items_feed ON surf_items(character, hidden, created_at DESC);
```
`messages` 增加 `attachment_json`（B6 已迁移）。设置读写：`SurfRepository.getSettings(character)`（无行则返回默认值）、`putSettings`。

**配置**（`config.ts`）：`SURF_ENABLED`（全局总闸，默认 `"1"`）、`SURF_CHROMIUM_PATH`（可选，默认用 playwright 自带）、`SURF_DIR`（默认 `.local/surf`）。

#### 10.6.3 兴趣来源与选题
1. **人格兴趣**：`src/persona/interests.ts` 导出 `CHARACTER_INTERESTS: Record<CharacterId, string[]>`，每个角色 6–8 个中文关键词，写死在代码里（与 `src/persona/characters/*.md` 的设定一致）。例：鲸汐 = 海洋、鲸歌、纪录片、深海生物、手帐、治愈系音乐、星空、温柔的故事；其余角色按其设定各写一组。
2. **用户补充**：设置里的 `interests`（最多 8 个）。
3. **近期话题**：取该角色最近 7 天的用户消息（`messages`，role=user，最近 40 条）与最近 10 条 `facts`，用一次**短模型调用**（temperature 0.4，maxTokens 150）提取 ≤4 个“用户近期关心的话题关键词”，缓存 6 小时（内存 `Map`）；失败则为空。
4. **组合**：`pickTopics()` = 随机取 2 个人格兴趣 + 1–2 个用户补充 + 1–2 个近期话题（不足则少取），去掉命中屏蔽词的，**保证 `topics.length ≥ 1`**；为空时回退到人格兴趣的随机 2 个。每次会话的 `topics` 写入 `surf_sessions.queries_json`。
5. 视频搜索关键词 = topic 直接用；网页搜索 = `topic + " " + 后缀`，后缀从 `["是什么", "最新", "有趣的事", "入门"]` 随机取，使结果更像读物。

#### 10.6.4 调度
- **槽位**（本地时间，`frequency` 决定）：

| 频率 | 每日槽位 | 每次最多 | 每日上限 |
|---|---|---|---|
| `rare`（偶尔） | 11:40、19:20 | 视频 1、网页 3 | 视频 2、网页 6 |
| `normal`（常常） | 09:30、13:30、16:30、19:20 | 视频 1、网页 3 | 视频 4、网页 8 |
| `often`（勤快） | 08:30、10:00、11:30、13:30、15:00、16:30、18:00、19:20 | 视频 2、网页 3 | 视频 6、网页 12 |

- **调度器**（`surf/scheduler.ts`）：`CronJob.from({ cronTime: "*/5 * * * *", onTick })`。每次 tick 对每个角色：到达/越过某个槽位、且 `now - slot ≤ 60 分钟`（宽限窗口，覆盖电脑睡眠后醒来）、且 `surf_sessions` 中 `(character, slot)` 不存在 → 插入 `running` 行（`UNIQUE` 保证不重复）→ 异步执行 `run`。同一时刻同一角色只跑一个会话；多个角色顺序跑（先到先跑，间隔 ≥30 秒）。
- **只为“活跃角色”跑**：该角色最近 14 天有聊天（`messages` 有记录）；全新安装的第一次聊天之后才开始逛。
- **手动触发**：`POST /api/surf/run`，slot = `manual-<ISO>`；同一角色 30 分钟内最多 1 次，超过 → `429 {"error":"too_soon","message":"她刚回来不久，歇一会儿再去吧。"}`；手动触发**无视静默时段与槽位**，但仍遵守额度、视频锁、每日上限。
- 服务启动时调度器自动启动；`SURF_ENABLED=0` 或角色 `enabled=false` 时 tick 直接返回（测试断言关闭后不再产生会话）。

#### 10.6.5 一次会话的流程、上限与暂停条件
**前置检查**（任一不满足 → 会话写 `skipped` 并带 `error` 原因码，不发 `session` SSE）：

| 原因码 | 条件 |
|---|---|
| `disabled` | 总闸或角色开关关闭 |
| `quiet` | 当前在 `quiet_start`–`quiet_end` 内（跨午夜处理；仅自动触发） |
| `quota` | `QuotaService.isLow()`（剩余 <20%）或 `enforce` 下额度不足 |
| `chatting` | 用户在最近 3 分钟内有聊天请求（`SessionRequests` 的最近活动时间） |
| `video_busy` | `acquireVideoLock` 拿不到（用户正在让她看视频）——只跳过视频部分，网页部分照常；二者都不能做才 `skipped` |
| `backoff` | 连续 3 次 provider 失败后 1 小时内 |
| `daily_cap` | 当日视频/网页已达上限（见 §10.6.4 表） |

**步骤**（每步发 SSE `step`，`stage` 见 §7.7.3）：
1. `searching`：`pickTopics()`。
2. 视频（`video` 开启、有名额）：§10.6.8 → `watching`。
3. 网页（`web` 开启、有名额、Chromium 可用）：§10.6.8 → `reading`。
4. `writing`：对每个条目做总结（§10.6.11），入库、记账、发 `item` 事件。
5. 收尾：`SurfService.afterSession()`：分享（§10.6.6）；当前时间已过 20:30 且本次产出 ≥1 条 → 调 `journal.generate(today)` 让日记把今天逛到的写进去（`journal-sources.ts` 会带上 surf 经验）。
6. 会话 `done`，发 `session{state:"end", count}`。

**上限**：单会话总时长 4 分钟（超时则中止浏览器与未完成条目，已完成的保留）；每会话视频/网页数见 §10.6.4；每个域名每天最多访问 2 次；全局每日上限按表；任何一步抛出 provider 错误计入连续失败计数。
**额度**：每个视频记 `surf` 20 贝壳、每个网页 3 个（B1）；会话开始前预估 `视频数×20 + 网页数×3`，不足则缩减到够用。

#### 10.6.6 主动分享（聊天里的“我今天看到…”）
- **触发条件**（全部满足）：`shareToChat=true`；本次有 `score ≥ 4` 的条目（取最高分一个）；今天已分享 <2 次；距上次分享 ≥3 小时；不在静默时段；用户空闲 ≥10 分钟；该角色至少有一个会话。否则条目只进见闻页，不打扰。
- **生成**：一次短调用（temperature 0.8，maxTokens 160），系统提示 = `withUserName(buildPersonaCore(character), nickname)`，用户消息：
```text
你刚才自己去逛，看到了一样东西，想顺口讲给对方听。
标题：{title}
来源：{source_site}
你的笔记：{summary}
请用你平常说话的口吻，说 1 到 3 句话，像随口分享，不要催对方点开，不要说“链接在下面”，不要加表情符号。以“我今天看到…”或类似自然的开头皆可。
```
- **写入**：向该角色**最新会话**插入一条 `role=assistant` 的消息（`attachment_json = {"type":"surf","itemId":12,"kind":"video","title":"…","url":"…","thumb":"/api/surf/thumb/12","comment":"…"}`），**不触发记忆任务**（不进入事实抽取，避免自我强化）；更新 `surf_items.shared_at/shared_message_id`；发 SSE `share{itemId, messageId}`。
- **前端**：§7.7.5。`GET /api/chat/history` 返回 `attachment`。

#### 10.6.7 客户端事件：SSE（已定）
- 路由 `GET /api/surf/events?character=<id>`，`text/event-stream`，服务端每 20 秒发一次注释心跳 `: ping`。进程内 `SurfEventBus`（`EventEmitter`）把事件广播给该角色的所有连接。
- 事件（`event:` 名 + JSON `data`）：

| event | data |
|---|---|
| `session` | `{ "state": "start" \| "end", "sessionId": 7, "kinds": ["video","web"], "count": 2 }`（`count` 仅 `end`） |
| `step` | `{ "sessionId": 7, "stage": "searching" \| "watching" \| "reading" \| "writing", "kind": "video" \| "web" \| null }` |
| `item` | `{ "id": 12, "kind": "video", "title": "…", "sourceSite": "bilibili", "thumb": "/api/surf/thumb/12", "comment": "…", "createdAt": "…" }` |
| `share` | `{ "itemId": 12, "messageId": 345 }` |

- 客户端 `useSurfEvents(character)`：用 `fetch` 流读取（不用 `EventSource`，因为 Tauri 下要拼 `API_BASE` 且要能带头）；断线重连退避 2→4→8→16→30 秒；页面不可见时断开，可见时重连并先 `GET /api/surf/status` 对齐状态。事件到达后：`session`/`step` 驱动 `SurfStatus` 与 avatar `activity`；`item` 让见闻页顶部插入新卡并点亮导航红点；`share` 让聊天页重拉历史（或直接追加）。
- 无 JS 事件时的兜底：见闻页每 60 秒、可见时 `GET /api/surf/feed?page=1` 刷新一次。

#### 10.6.8 内容获取

**A. B 站视频**（`surf/bilibili-search.ts` + `surf/picker.ts`）
1. **搜索**：在 `vendor/dsh-bilibili/lib/extractor.js` 新增并导出 `searchVideos(session, { keyword, page = 1 })`：调用已有的 `getWbiSignedParams(session, params)` 与 `apiGet(session, endpoint, params)`（走同一个 2 秒间隔的请求队列），端点 `/x/web-interface/wbi/search/type`，参数 `search_type=video, keyword, page, order=totalrank`；返回 `[{bvid, title, author, duration, play, pubdate, pic, description}]`（`title` 去掉 `<em>` 标签；`duration` 转秒；`pic` 补 `https:`）。`UPSTREAM.md` 记录这处本地补丁。`src/bilibili.ts` 外包一层 `searchBilibili(keyword)`，先调 `assertBilibiliRequestAllowed()`（尊重限流冷却，冷却中则跳过视频部分）。
2. **候选筛选**（`picker.ts` 的 `filterCandidates`，纯函数，可单测）：时长 60 秒–20 分钟；播放量 ≥5000；标题/作者/简介不含屏蔽词（用户的 + 内置的 `blocklist.ts`）；`dedupe_key` 不在 `surf_items` 与 `experiences.sourceId`（`bili:` 前缀的用户分享记录也算）里；保留前 8 个。
3. **挑选**：一次模型调用，输入 8 个候选的“标题 / UP 主 / 时长 / 播放量 / 简介前 60 字”及她的兴趣与近期话题，要求输出 JSON `{"index": <0-7>, "reason": "<她为什么想看，一句话，口吻同她>"}`；解析失败取第 1 个。
4. **观看**：`acquireVideoLock` → `createVideoService().collect(url)` → `summarize(...)`（与用户分享视频完全同一管线，字幕/弹幕/简介合成摘要）→ 释放锁 → `queueLearning`（以 `surf:bv:<BV>` 为 `sourceId` 的经验归档，沿用现有后台学习）。
5. **缩略图**：下载 `pic`（通过 `assertBilibiliRequestAllowed` 之后用 Node `fetch`，`Referer: https://www.bilibili.com`），保存到 `.local/surf/thumbs/<itemId>.jpg`。

**B. 网上冲浪**（`surf/web-search.ts`、`browser.ts`、`reader.ts`）
1. **搜索源**：`https://cn.bing.com/search?q=<关键词>&setlang=zh-hans`。用同一个 Playwright 页面打开，解析 `li.b_algo`：标题 `h2 a` 文本、链接 `h2 a[href]`、摘要 `.b_caption p`。Bing 的跳转链接形如 `https://www.bing.com/ck/a?...&u=a1<base64url>&...`，`decodeBingRedirect(href)`：取 `u` 参数，去掉前缀 `a1`，base64url 解码得到真实 URL（解码失败丢弃该条）。Bing 无结果或被验证拦截时回退 `https://html.duckduckgo.com/html/?q=<关键词>`（解析 `a.result__a`，其 `uddg` 参数是真实 URL）。每个关键词取前 8 条。
2. **挑选**：过滤掉：屏蔽词/内置屏蔽域名；登录墙站点（`weibo.com`、`xiaohongshu.com`、`douyin.com`、`zhihu.com`）；`dedupe_key`（规范化 URL = 去掉 `utm_*`、`#fragment`、末尾 `/` 后的 sha1 前 16 位）已存在；同域名当天已访问 2 次；非 `http(s)`、IP 直连、私网地址（`resolvesPublic(host)` 复用 `web-service.ts` 的 `isPrivateAddress` 与 DNS 查询）。剩下的交给模型挑 ≤3 个（输出 JSON `{"picks":[{"index":0,"reason":"…"}]}`）。
3. **浏览器**（`browser.ts`）：单例 Chromium（`chromium.launch({headless:true, args:["--no-sandbox"]})` 仅在容器环境下加；平时不加），空闲 5 分钟自动关闭；每个会话新建一个 `BrowserContext`（`locale:"zh-CN"`，桌面 UA，视口 1280×800，`javaScriptEnabled:true`）。`context.route("**/*")` 拦截：资源类型 `image/media/font/websocket` 直接 `abort`；对每个导航请求再次做 `resolvesPublic`（防重定向到内网），失败则 `abort`。
4. **读取**（`reader.ts`）：`page.goto(url, {waitUntil:"domcontentloaded", timeout:20000})` → 等 1.5 秒 → `page.evaluate` 提取：依次尝试 `article`、`main`、`[role=main]`，否则取页面中**文本最密的 `div/section`**（按 `innerText.length` 与链接文本占比评分）；去掉 `nav/header/footer/aside/script/style/form`；折叠空白；截取前 8000 字；少于 200 字视为失败丢弃。同时读取 `og:image`（回退第一张宽 ≥300 的 `img`）与 `document.title`、`og:site_name`。
5. **缩略图**：缩略图地址由 Node 侧 `fetch` 下载（同样过 `resolvesPublic`，限 2 MB，`Content-Type` 必须是 `image/*`），**不引入图像库**：原样保存为 `.jpg`/`.png` 扩展名按 `Content-Type`，客户端用 `object-fit:cover` 裁成 16:9；`GET /api/surf/thumb/:id` 按实际扩展名返回对应 `Content-Type`。没有缩略图则 `thumb_path` 为空。
6. **节奏**：两次导航之间随机等待 3–8 秒；会话内串行；单页导航超时 20 秒；整个会话超时 4 分钟。
7. **总结**：见 §10.6.11；`sourceId = "surf:web:" + sha1 前 16 位`；`archiveExperience(store, memory, { kind:"web", title, text: summary, url, sourceId }, "她自己逛到的")`。

**C. 内置屏蔽**（`blocklist.ts`）：内置词表（成人、赌博、暴力血腥、自残、极端政治动员、广告营销类关键词，各 ~20 个）与域名表；与用户 `blocked_json` 合并后用于：搜索词、候选标题/摘要/正文前 500 字、最终总结；模型总结返回 `safe:false` 的条目直接丢弃，不入库。

#### 10.6.9 客户端接入与 Tauri
- `lib/surf.ts`：`getSurfSettings/putSurfSettings`、`getSurfFeed({character,kind,page,pageSize,q})`、`getSurfStatus()`、`runSurf()`、`deleteSurfItem(id)`、`thumbUrl(id)`（= `${API_BASE}/api/surf/thumb/${id}`）。
- `<img src>` 直接用 `thumbUrl`；因此 `tauri.conf.json` 的 CSP `img-src` 必须含 `http://127.0.0.1:8787 http://localhost:8787`（§10.3.1）。浏览器开发环境走 Vite 代理 `/api`，无需改动。
- “打开原链接”：Tauri 内 `import { openUrl } from "@tauri-apps/plugin-opener"`；在 `src-tauri/Cargo.toml` 加 `tauri-plugin-opener`，`lib.rs` 里 `.plugin(tauri_plugin_opener::init())`，`capabilities/default.json` 加 `"opener:allow-open-url"`（允许 `http://*`、`https://*`）；浏览器环境回退 `window.open(url, "_blank", "noopener")`。
- 导航红点与“新”邮戳依赖 `localStorage["wp.surf.seen"]`（最大已看 `id`）。

#### 10.6.10 路由

| 方法 路径 | 说明 |
|---|---|
| `GET /api/surf/settings?character=` | `200 {character, enabled, frequency, interests, blocked, quiet:{start,end}, video, web, shareToChat, webAvailable}` |
| `PUT /api/surf/settings?character=` | 请求体为上述字段的子集。校验：`frequency ∈ rare\|normal\|often`；`interests` ≤8 个、每个 1–12 字；`blocked` ≤20 个、每个 1–12 字；`quiet.start/end` 形如 `HH:MM`。失败 `400 {"error":"invalid_settings","message":"…"}`；成功返回完整设置 |
| `GET /api/surf/status?character=` | `200 {running, sessionId\|null, stage\|null, todayCount, lastRunAt\|null, nextRunAt\|null, pausedReason: "quota"\|"quiet"\|"disabled"\|null, webAvailable}` |
| `POST /api/surf/run?character=` | `202 {sessionId}`；30 分钟内重复 `429 too_soon`；正在跑 `409 {"error":"already_running"}`；额度不足 `402` |
| `GET /api/surf/feed?character=&kind=video\|web&page=1&pageSize=20&q=` | `200 {items:[{id,kind,title,url,sourceSite,thumb,summary,comment,tags,createdAt,sharedAt}], page, pageSize, total}`，`hidden=0`，按 `created_at DESC`；`q` 对 `title/summary/comment/tags` 做 `LIKE`；`pageSize` ≤50 |
| `GET /api/surf/items/:id` | 单条（同上字段 + `summary` 全文）；不存在 `404` |
| `DELETE /api/surf/items/:id` | “忘掉”：软删除 `hidden=1` 并**同时**删除对应 `experiences`（含向量）、缩略图文件；`204`。（去重键保留，避免日后又逛回来） |
| `GET /api/surf/thumb/:id` | 图片字节；缓存头 `Cache-Control: private, max-age=86400`；无图 `404` |
| `GET /api/surf/events?character=` | SSE，见 §10.6.7 |

所有 `character` 参数缺省取当前默认角色（与 `routes/memories.ts` 相同的解析函数），非法 id → `400`。

#### 10.6.11 总结提示词、记忆与日记接入
**每个条目的总结调用**（temperature 0.5，maxTokens 400；系统提示 = `withUserName(buildPersonaCore(character))` 的短版）：
```text
你刚刚自己看了下面这个{视频|网页}。请只输出一个 JSON：
{"summary":"<客观摘要，80 到 160 字，写清它讲了什么>","comment":"<你自己的一句话感想，不超过 30 个字，用你平常的口吻，不要加表情符号>","tags":["<至多 3 个短标签，每个不超过 6 字>"],"worth_sharing":<1 到 5 的整数，5 表示非常想讲给对方听>,"safe":<true 或 false，内容是否适合一个温和的陪伴应用展示>}
标题：{title}
来源：{source_site}
内容：
{正文或字幕摘要，≤6000 字}
```
解析失败 → 重试 1 次，仍失败则丢弃该条目（不入库）。
**接入记忆**：入库时同步 `archiveExperience`：`kind` = `video`/`web`，`sourceId` = `surf:bv:<BV>` / `surf:web:<hash>`；标签“她自己逛到的”。因此：
- **聊天**：她之后能在对话中自然提起（与用户分享的视频同样走记忆检索）。
- **记忆页**：`store/explorer.ts` 新增类别 `surf`（“她拾到的”，包含 `sourceId LIKE 'surf:%'` 的 experiences），原 `video`/`web` 类别排除 `surf:%`；`GET /api/memories?category=surf` 可用，并计入分类计数。
- **日记**：`store/journal-sources.ts` 把 `sourceId` 以 `surf:` 开头的经验标题加前缀“她自己逛到的：”，使日记模型知道这是她自己的见闻，而不是用户给她看的。

#### 10.6.12 测试（`apps/api/test/`）
- `surf-store.test.ts`：设置默认值与往返；`UNIQUE(character,dedupe_key)`；`feed` 分页/`kind`/`q`；`DELETE` 软删除并级联删 `experiences` 与缩略图文件。
- `surf-picker.test.ts`：`pickTopics`（空输入回退、屏蔽词过滤、数量范围）、`filterCandidates`（时长/播放量边界、屏蔽词、去重）、`dedupe` 的 URL 规范化（`utm_*`/`#`/尾斜杠）。
- `surf-bilibili-search.test.ts`：对录制好的搜索 JSON 夹具断言解析（去 `<em>`、时长换算、`pic` 补协议）；冷却期内不发请求。
- `surf-web.test.ts`：Bing 结果 HTML 夹具 → 解析条目；`decodeBingRedirect` 正反例；DuckDuckGo 回退夹具；SSRF：`http://127.0.0.1`、`http://10.0.0.1`、`http://[::1]`、重定向到内网均被拒；登录墙域名被滤掉。再起一个本地 HTTP 服务（`node:http`）提供一篇带 `<article>` 的页面：如果本机已安装 Chromium 则用 Playwright 真实读取并断言正文与 `og:image`，否则用 `t.skip()`。
- `surf-session.test.ts`（假 provider、假 B 站服务、假浏览器 reader）：一次会话产出 1 个视频 + 2 个网页 → 3 条 `surf_items`、3 条 `experiences`（`sourceId` 全以 `surf:` 开头）、`usage_ledger` 合计 26 贝壳、SSE 事件顺序为 `session(start) → step(searching) → step(watching) → item → step(reading) → item → item → step(writing)… → session(end)`；分享：`score≥4` 时产生一条带 `attachment` 的助手消息且**不产生记忆任务**；频控（当日第 3 次不分享、间隔不足 3 小时不分享）；静默时段 `skipped(quiet)`；额度不足 `skipped(quota)`；每日上限；连续 3 次 provider 失败后 `backoff`；用户正在聊天 `skipped(chatting)`。
- `surf-routes.test.ts`：设置校验（每类非法输入一条）；feed 分页；`DELETE` 级联；缩略图 404；`POST /run` 的 202/429/409；SSE 帧格式与心跳。
- `surf-scheduler.test.ts`（注入 `now`）：槽位到点触发；睡眠后在 60 分钟宽限内补跑一次；超出宽限不补；同一槽位不重复（`UNIQUE`）；`enabled=false` 不触发；无近 14 天聊天的角色不触发。
- 客户端 e2e：`tests/ui/surf.spec.ts`（Playwright，`page.route` 打桩；SSE 用一次性 fulfilled 的有限响应体）：见闻页空/有数据/搜索无果/错误态；“忘掉”确认后卡片消失并发出 `DELETE`；设置里开关与频率变更发出 `PUT`；`session` 事件让舞台出现“在看一个视频…”便签；聊天里带 `attachment` 的消息渲染 `PostcardMini`。

---

## 11. 可复用的开源项目与代码

所有下列项目都可以自由阅读、借鉴，代码也可以直接复用（含 SillyTavern、ChatterUI、lobe-chat 等）；复用时在 PR 描述写“来源仓库 + 文件 + commit”即可。

| 项目 | 可借鉴/复用部分 | 复用方式 |
|---|---|---|
| **motion** | 弹簧、布局动画、手势拖拽、`AnimatePresence` | 依赖；`LazyMotion` 控体积，`layoutId` 需 `domMax` |
| **Radix Primitives**（radix-ui） | 可访问行为：Dialog/AlertDialog/Popover/Menu/Switch/Slider/Tabs | 依赖；无样式，自己写皮肤（§6） |
| **sonner** | toast 队列与手势 | 依赖；`unstyled` + 自定义 class |
| **react-virtuoso** | 反向滚动、`followOutput`、动态高度 | 依赖 |
| **streamdown**（Vercel） | 流式 Markdown 容错（未闭合语法） | 依赖；仅含 Markdown 的回复用，纯文本走 `InkText` |
| **perfect-freehand** | 压感笔触 → 手绘线/框/图标 | 依赖；自己生成点，固定种子 |
| **cn-font-split** | 中文字体切片 | 依赖（dev）：`fontSplit({ input, outDir, css:{ fontFamily }, targetType:"woff2" })` |
| 霞鹜文楷 / 霞鹜新晰黑 / Fraunces | 字体本体 | 文楷沿用 `lxgw-wenkai-webfont`；新晰黑子集化后放 `public/fonts/neo-xihei/`；Fraunces 引 `@fontsource-variable/fraunces/index.css` |
| **playwright-core** | 无头 Chromium 页面读取 | 依赖（apps/api），§10.6.8 |
| **AIRI（moeru-ai/airi）** | 角色陪伴 UI 的整体结构、情绪→表情映射、口型驱动、舞台与对话叠放 | 直接参考结构；代码可搬 |
| **Open-LLM-VTuber** | Live2D 表情标签解析、口型与待机动作触发、对话与形象同步 | 参考交互；后端是 Python，借思路 |
| **amica（semperai）** | VRM 表情/视线/待机动作、3D 角色叠加聊天条 | 代码可搬，用于 §7.7 的“低头看手机”视线与姿态 |
| NextChat | 设置面板的信息组织、键盘处理 | 参考交互 |
| **SillyTavern** | 角色卡、世界书、重新生成/多版本回复（swipe）的交互；UI 里 swipe/regenerate 的实现 | 可读源码、可直接复用代码与样式 |
| **ChatterUI** | 移动端聊天列表、键盘处理、会话切换的细节 | 可读源码、可直接复用 |
| **lobe-chat** | 设置页分组、插件/角色管理的界面组织、主题切换 | 可读源码、可直接复用 |
| Excalidraw / rough.js | 手绘风格实现参考 | 参考 |
| dotLottie / Rive | 角色微动效 | 本轮不用 |
| Playwright / axe-core / Ladle | 测试与审计 | 开发依赖 |

借用代码的流程：① 找到对应文件；② 搬入后按本项目 tokens 重写样式（不保留外来的颜色/圆角）；③ PR 描述记录来源。

---

## 12. 验收标准（交付必须达到，否则持续迭代）

### 12.1 Playwright 截图矩阵
- 配置：`apps/client/playwright.config.ts`，`webServer: pnpm --dir apps/client dev`（端口 1420）；用 `page.route("**/api/**", …)` 做**固定数据桩**（正常/空/离线/出错/流式），不依赖真后端；`reducedMotion` 在需要的用例里设为 `reduce`；截图前 `await page.evaluate(() => document.fonts.ready)` 并等 400ms 让进场动画结束；Live2D 在桩模式下用 `WhaleSticker` 代替（不下载模型）；SSE 桩用一次性 fulfilled 的有限响应体。
- 输出：`artifacts/ui/round-<N>/<页>-<状态>-<视口>-<主题>-<老人>.png`，例 `chat-thinking-m-dark-elder.png`。视口：`d`=1180×780，`m`=390×844，`t`=380×560（窗口 minWidth/minHeight，`tauri.conf.json`）。
- 必须覆盖：

| 页 | 状态（每个状态至少 d + m，亮色） |
|---|---|
| 聊天 | normal（6 轮历史）、empty、thinking、streaming、video-progress（`watching`）、offline、send-failed、video-popover、surf-status（便签“在看一个视频…”）、share-card（带 `PostcardMini` 的分享消息）；仅 m：backlog-open、keyboard-open |
| 日记 | normal、writing、empty、error、calendar-open、month-collapsed |
| 记忆 | normal（有编号）、detail-open、forget-confirm、empty-new、search-empty、filter-open |
| 设置 | normal、character-dialog、delete-confirm、delete-all-confirm、quota（正常 / low）、surf-settings |
| 见闻 | normal（≥6 张，视频+网页混合）、detail-open、forget-confirm、empty-on、empty-off、search-empty、loading、error、quota-paused |
| 引导 | step1、step2、step3 |

- 变体叠加：上述各页 **normal**（含引导 step1）再各自拍 `{亮,暗} × {老人关,老人开} × {d,m}`；聊天 normal 额外拍 4 个角色 × {亮,暗} × d；`t` 视口只拍聊天 normal/offline 与设置 normal（亮）。
- 总量不少于 **130 张**；每轮迭代全部重拍；PR 中至少贴 12 张代表图（每页亮/暗/老人各 1）。
- 每张图同时输出 `*.metrics.json`：页面上所有可见交互元素的 `boundingBox`、计算字号、前景/背景色（用于 §12.3 与视觉审查）。

### 12.2 对比度与 a11y 自动检查
`scripts/check-contrast.mjs`（`pnpm --dir apps/client ui:contrast`）：解析 `tokens.css` 与 `characters.css`，对下表每一对（亮、暗、4 角色各一遍）计算比值，低于阈值则退出码 1：

```js
import { wcagContrast } from "culori";
// [前景变量, 背景变量, 最小比值]
const PAIRS = [
  ["--ink", "--paper", 7], ["--ink", "--paper-2", 7], ["--ink", "--sheet", 7], ["--ink", "--slip", 7],
  ["--ink-soft", "--paper", 7], ["--ink-soft", "--paper-2", 7], ["--ink-soft", "--sheet", 7],
  ["--ink-mute", "--paper", 4.5], ["--ink-mute", "--paper-2", 4.5], ["--ink-mute", "--sheet", 4.5],
  ["--accent", "--paper", 4.5], ["--accent", "--paper-2", 4.5], ["--accent", "--sheet", 4.5], ["--accent", "--accent-wash", 4.5],
  ["--accent-ink", "--accent", 4.5], ["--alert", "--paper", 4.5], ["--alert", "--alert-wash", 4.5], ["--alert-ink", "--alert", 4.5],
  ["--ink", "--sea-3", 4.5], ["--line-strong", "--paper", 3], ["--line-strong", "--sheet", 3],
];
// 同时断言：coral 不出现在任何 color: 声明里（grep），--ink-mute 在老人模式 = --ink-soft
```
- `a11y.spec.ts`：对 §12.1 的每个页面状态运行 `new AxeBuilder({ page }).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"])`，**critical + serious = 0**；`color-contrast` 规则开启。
- 手工补充：VoiceOver / TalkBack 走查（§9.2-9）。

### 12.3 量化阈值总表
（表内为避免破坏 Markdown 表格，正则里的 `|` 写成了 `\|`；复制到终端时去掉反斜杠。）

| 项 | 阈值 | 如何测 |
|---|---|---|
| 触控目标 | 所有可见 `button, a, [role=button\|tab\|switch\|radio], input, textarea`：高、宽 ≥44px；老人模式 ≥56px（正文行内链接除外） | `metrics.json` |
| 正文字号 | 计算字号：正文 ≥16px，聊天 ≥17px；<14px 的文字只能是邮戳/编号/时间且颜色为 `--ink-mute` 或更深 | `metrics.json` |
| 老人模式 | 根字号 = 20px（×1.25）；导航 3 项；`--hit`=56 | 断言 |
| 对比度 | §12.2 全绿；axe 无 `color-contrast` 违规 | 脚本 |
| 首屏字体体积 | `/` 首次加载 3 秒内所有 `font/woff2` 传输体积 **≤220 KB**（含文楷核心集 + 新晰黑核心集 + Fraunces latin） | `performance.getEntriesByType("resource")` |
| JS 体积 | 非 pixi/three 的入口 chunk gzip 相对改造前基线增加 **≤60 KB** | `vite build` 输出 |
| 动效属性 | 源码中 `@keyframes` 与 motion 动画只改 `transform`/`opacity`（§8.1 例外除外） | grep + 人工 |
| 无 `window.confirm/alert` | 源码 grep 为 0，且 e2e 中 `page.on("dialog")` 一旦触发即失败 | grep + 用例 |
| 无禁用样式 | `rg -n "gradient\|backdrop-filter" apps/client/src apps/client/public` 为 0 | grep |
| 圆角收敛 | `border-radius` 只出现 `var(--r-*)`、`50%`（仅圆形头像/点）、`0` | grep |
| 淘汰 token | `rg "ink-faint\|--rule\b\|--ground\|--radius" apps/client/src` 为 0（P4 后） | grep |
| 技术词 | `rg -n "模型\|后端\|API\|token\|在线 ·" apps/client/src/{pages,components}` 仅允许出现在“详情”折叠与开发者注释 | grep + 人工 |
| 横向滚动 | 380px 与 `--scale=2` 下 `document.documentElement.scrollWidth <= innerWidth` | 断言 |
| reduced-motion | 模拟 `reduce` 后 `document.getAnimations().filter(a=>a.effect.getTiming().iterations===Infinity)` 为空（Live2D 画布除外） | 断言 |
| 线框一致性 | 见 §12.4 | 断言 |

### 12.4 与线框一致性（±8px 容差）
`screens.spec.ts` 对关键锚点断言 `boundingBox`：桌面聊天页 `nav` 宽 112；`Backlog` 宽 360；`DialogBox` 底边距舞台底 88；`DialogBox` 宽 ≤640 且水平居中于舞台（±16）；`ComposerBar` 高 56–160；名字牌高 36；日记笔记本宽 ≤760；记忆卡片列数（1180 宽=3，390 宽=1）；设置行最小高 72（老人 88）；`CompanionCorner` 桌面 112、手机 64。**不一致就是缺陷。**

### 12.5 “AI 味”自检表（16 问，答案必须全为“否”；任何“是”=不通过）
1. 页面里有任何渐变、毛玻璃、发光、彩色/大模糊阴影吗？
2. 有紫蓝渐变、霓虹描边、深色背景上的发光线框吗？
3. 有三点 typing、旋转圈、骨架屏条纹吗？
4. 界面出现模型名、后端、API、token、“AI 助手”“智能”“为您生成”吗？
5. 有“闪光星（sparkle）”图标或 emoji 当图标吗？
6. 聊天是左右灰/蓝气泡 + 小圆头像吗？（ChatGPT / Character.ai / Replika 套路）
7. 有居中 hero + 一个大 CTA 的落地页式屏幕吗？
8. 有三个等宽图标卡片并排吗？
9. 所有卡片是同圆角、同阴影、同尺寸的矩阵（没有层次与手作不规则）吗？
10. 空/错误态是线框插画 + 灰字，或“暂无数据 / 操作成功 / 请稍后重试 / 加载中”吗？
11. 用 Inter / Roboto / Arial / 纯系统无衬线承担了品牌表达吗？
12. 有 `window.confirm` / `alert` 吗？
13. 任何文字 <4.5:1，或出现珊瑚色小字吗？
14. 任何一个页面没有她吗？
15. 有倒计时、红点轰炸、“她会难过”式催促、抽卡式奖励吗？
16. 她说的话里出现“作为一个 AI 助手”“我无法”这类系统腔，或扮演亲属、声称真实情感吗？

### 12.6 评分量表（1–5，由**独立的视觉审查 Agent**依据截图评分，§13.3）

| 维度 | 1 分 | 3 分 | 5 分（可量化特征） |
|---|---|---|---|
| **温度** | 像后台：纯文字 + 细线 + 灰字；页面无角色 | 有纹理或插画，但缺角色在场或文案生硬 | 每页都有她且姿态随状态变化；首屏同时可见 纸纹 + 手绘线 + 邮戳/胶带至少两种；空/错误态全是角色+口语文案；0 处系统腔 |
| **品牌一致** | 页面各自为政（按钮/圆角/字体不一） | 大体统一，个别页偏离 | tokens 之外 0 个硬编码颜色/圆角；4 角色换肤全部正确；与线框断言 100% 通过；亮暗两套气质一致 |
| **清晰** | 层级混乱，主操作找不到 | 主操作可见但同屏竞争 | 每屏 primary ≤1 且位置固定；信息层级 ≤3 级字号；文案无术语；状态必有文字 |
| **适老** | 小字灰字、触控 <44、靠悬停 | 基本达标，老人模式有缺口 | §12.3 适老项全达；老人模式 3 项导航、56px、calm 全生效；确认框都先说后果；200% 字号不破版 |
| **精致度** | 对不齐、间距随意、素材粗糙 | 整体整齐，细节有瑕疵 | 4px 栅格 0 偏差；手绘线种子稳定无抖动；图标描边/大小一致；无溢出/截断/重叠；截图放大 200% 无毛边 |
| **动效** | 生硬/卡顿/过度 | 有动效但参数不统一 | 全部参数取自 `motion/tokens.ts`；reduced-motion 全降级；每个动效有意义（反馈/连续性/情感），无纯炫技 |

### 12.7 迭代循环（每个阶段都执行）
```
实现 → 重拍 §12.1 全矩阵 → 机器检查（§12.2/12.3/12.4/grep）
     → 视觉审查 Agent 看图（§13.3 提示词）给出：问题清单 + 6 维评分（每分必须引用截图文件名）
     → 任一维度 <4 或 机器检查有失败 或 自检表有“是”
            → 把问题按“blocker/major/minor”列成清单写进 Issue 评论 → 修复 → 回到“重拍”
     → 全部 ≥4 且机器检查全绿且自检表全“否” → 结束，PR 贴最终截图与评分表
```
- **最多 5 轮**（每个阶段）。第 5 轮仍未达标：停止改动，把**差距报告**（下方模板）写进该阶段 PR 描述（并贴到 Issue），然后**直接进入下一阶段**，不再“凑分”；开发者合并 PR 时自行取舍。
- 打分的 Agent **不得是刚写代码的同一会话**（避免自评偏高）；若只有一个 Agent，则必须“先清空对实现过程的叙述，只凭截图与 `metrics.json` 评分”，并对每个 ≥4 的评分写出证据。
- 评分只认截图与指标，不认代码意图。

差距报告模板：
```
## 差距报告（阶段 P?，第 N 轮）
- 通过项：…
- 未达标项（维度 / 当前分 / 目标 / 证据截图 / 原因 / 已尝试的修复）：…
- 机器检查失败：…
- 遗留项（留给后续阶段或开发者合并时参考）：…
- 建议下一步与预计工作量：…
```

### 12.8 后端与「她自己去逛」的验收（P-B、P5）

| 项 | 要求 | 如何测 |
|---|---|---|
| API 类型检查 | `pnpm --dir apps/api typecheck` 通过 | 命令 |
| API 全量测试 | `pnpm --dir apps/api test` 全绿；旧测试不改动即通过 | 命令 |
| B1 额度 | `test/quota.test.ts`：汇总、跨月、402 拦截、`runChat` 记账、字段断言 | node:test |
| B2 导出/删除 | `test/export.test.ts`、`test/delete-all.test.ts`：zip 可读、`manifest.counts`、无凭据字符串、`confirm` 校验、清空后各接口返回空 | node:test |
| B3 心情天气 | `test/diary-mood.test.ts`：合法 JSON、带围栏 JSON、非法值回退、二次调用失败不影响日记、迁移、回填 ≤30 | node:test |
| B4 编号 | `test/memory-seq.test.ts`：惰性回填顺序、不复用、角色独立、并发不重复、清空重置 | node:test |
| B5 昵称 | `test/profile.test.ts`：往返、非法值 400、清除、注入 system prompt、删除全部后为空 | node:test |
| 冲浪后端 | `surf-store / surf-picker / surf-bilibili-search / surf-web / surf-session / surf-routes / surf-scheduler` 七个测试文件全绿（§10.6.12） | node:test |
| 冲浪上限 | 测试断言：每会话视频/网页数、每日上限、同域名每日 2 次、静默时段、额度 <20% 暂停、用户正在聊天不打断、关闭开关后不再触发 | node:test |
| 冲浪手动冒烟 | `POST /api/surf/run` 在本机跑完一次：≥1 条 `surf_items`、对应 `experiences`（`sourceId` 以 `surf:` 开头）、`usage_ledger` 记账、SSE 顺序正确；把命令与输出贴进 PR | 手动 + 记录 |
| 冲浪前端 | `tests/ui/surf.spec.ts`：见闻页各状态、忘掉确认与 `DELETE`、设置 `PUT`、`session` 事件驱动便签、聊天附件渲染 | Playwright |
| 回归 | P5 结束时重跑 §12.1–12.5 全部检查，仍须通过 | 全部 |

---

## 13. 提示词库

> 约定：`{SPEC}` = 本规范文档路径（建议提交为 `docs/ui/WhalePartner_UI重设计规范.md`）；`{ISSUE}` = GitHub Issue 号；`{PHASE}` = P0 / P-B / P1…P5。提示词可直接整段复制。

### 13.1 主实现 Agent 系统提示词
```text
你是 WhalePartner（鲸汐）的资深全栈工程师兼界面设计师。你的任务是把 apps/client 按《{SPEC}》端到端重设计为「潮汐手帐 2.0 · 海边绘本日记」，补齐 apps/api 的后端缺口，并实现「她自己去逛」，达到该文档第 12 章的验收标准。你没有其他背景，一切以仓库与该文档为准。

【目标】
让产品从“冷淡的后台工具”变成“温暖的海边绘本日记里的陪伴”：每页都有她、纸与手绘质感、她的话像绘本字幕、你的话像小纸条、记忆像拾到的贝壳与瓶中纸条、日记像手帐；她还会自己去刷视频、上网，把见闻剪成明信片带回来。同时更好用、更适老（老人模式）。

【开工前必做】
1. 确认当前目录是仓库根；运行 git status、git branch，若有未提交改动先辨认归属并保留，不得重置/清理。
2. 按顺序阅读：AGENTS.md → CONTRIBUTING.md → docs/PRODUCT_SCOPE.md → docs/DESIGN.md → docs/SESSION_HANDOFF.md → {SPEC} 全文（先 §0、§1、§2、§4，再按当前阶段读相关章节）→ 当前 Issue #{ISSUE}。
3. 浏览 apps/client/src 的 styles/*、pages/*、components/*，以及 apps/api/src 的 server.ts、routes/*、store/*，使每条改动都落在真实存在的文件和 class 上。

【流程】
- 只做 Issue #{ISSUE} 范围内的事；在任务分支 feat/{ISSUE}-ui-tide-journal-2-<阶段> 上工作；不向 main 推送；开发者自己合并 PR。PR 里写：解决什么、主要改动、验证命令与结果，并附截图；用 Closes #{ISSUE}。
- 提交信息用 feat:/fix:/docs:/refactor:/test:/chore: 前缀；不把无关格式化混入。
- 不写入任何密钥/令牌；不部署；不向第三方发消息；不改仓库设置。
- 后端接口按 {SPEC} §10.5 / §10.6 的规格实现（路由、请求/响应、存储、测试都已写明），不要伪造数据，也不要等待额外决定。
- 迭代到上限仍有差距：把差距报告写进 PR 描述，直接进入下一阶段。
- 结束前按 docs/SESSION_HANDOFF.md 在 Issue/PR 评论留交接记录。

【产品约束】
- 聊天页保留名字牌里的“AI 角色”小标签（设计元素）。鲸汐使用 characters.ts 里现有的 VRoid 示例模型（modelId "avatar-b"），WhaleSticker 只在形象加载失败时兜底和作为小角贴纸。
- 界面不得出现 API Key/模型/后端/token 等词（“详情”折叠内除外）；不扮演亲属；不索要验证码/银行卡；不挽留要走的用户；不做抽卡；不用“她会难过”催促。
- 参考项目（SillyTavern、ChatterUI、lobe-chat、AIRI 等）可以自由阅读并复用代码，按 {SPEC} §11 记录来源。

【设计硬约束】
- 颜色、字号、间距、圆角、阴影、动效参数只能取自 tokens.css 与 motion/tokens.ts；不得硬编码新颜色/圆角/毫秒数。新增颜色组合必须先用 scripts/check-contrast.mjs 验算（正文 ≥7:1，任何文字 ≥4.5:1，控件边界 ≥3:1）。珊瑚色 #E8765E 永不作文字。
- 禁止：任何 gradient、backdrop-filter、发光/彩色/模糊半径>12px 的阴影、emoji 当图标、window.confirm/alert、三点 typing、闪光星（sparkle）图标、“AI 助手/为您/暂无数据/请稍后重试”等系统腔文案。
- 动效只动 transform/opacity（墨线 clip-path 和折叠 grid-template-rows 除外），弹簧取 motion/tokens.ts；prefers-reduced-motion、安静模式、老人模式必须全部降级；View Transitions 必须特性检测+降级。
- 手绘线/框/图标使用 perfect-freehand 且固定种子；纸纹是背景图层，不是全屏叠层；Live2D canvas 上不得有全屏覆盖层。
- 触控目标 ≥44px（老人模式 ≥56px）；正文 ≥16px，聊天 17px；老人模式整体 ×1.25，导航 3 项。

【后端约束】
- 沿用 apps/api 的框架：原生 node:http、routes/*.ts 分发、node:sqlite 的 DatabaseSync、openChatDatabase 里的 CREATE TABLE IF NOT EXISTS 与 PRAGMA table_info + ALTER TABLE 迁移、node:test 测试。不引入 Web 框架或 ORM。
- 每个后端任务都要有测试；pnpm --dir apps/api typecheck 与 pnpm --dir apps/api test 必须全绿；旧库打开必须自动迁移且旧测试不改动即通过。
- 自主冲浪必须遵守 {SPEC} §10.6 的上限与暂停条件（频率槽位、每会话/每日上限、静默时段、额度 <20% 暂停、用户正在聊天不打断）。

【工作流（每个阶段重复）】
1. 复述本阶段目标与“完成定义”（{SPEC} §10.4），列出要改/新增的文件清单，用任务清单跟踪。
2. 小步实现，每完成一个组件/接口就在本地跑 typecheck 与相关用例；前端组件先在样品页（/__kit）里把所有状态摆出来：默认/悬停/按下/禁用/聚焦/加载/错误。
3. 实现后运行：pnpm --dir apps/api typecheck；pnpm --dir apps/api test；pnpm --dir apps/client typecheck；pnpm --dir apps/client build；pnpm --dir apps/client ui:contrast；pnpm --dir apps/client ui:test（Playwright 截图矩阵 + axe + grep 规则）。
4. 迭代循环（{SPEC} §12.7）：重拍全矩阵 → 机器检查 → 用独立视觉审查（提示词见 §13.3）评分与挑刺 → 任一维度<4 / 机器检查失败 / 自检表有“是” → 列问题清单写进 Issue → 修复 → 再拍。每阶段最多 5 轮；仍不达标就把差距报告写进 PR，进入下一阶段。
5. 同步更新 docs/DESIGN.md 对应部分。

【自检（提交 PR 前逐条回答并贴在 PR）】
- §12.5 的 16 问，每问答“否”，并给出证据（grep 结果或截图文件名）。
- §12.6 六个维度的分数 + 每个分数的证据截图。
- §12.3 量化表的实测值（触控最小值、字体体积、grep 计数）。
- 与线框的锚点断言通过情况；后端测试清单与结果。

【禁止事项汇总】
不扩大范围；不重写别人的分支；不把原型占位冒充已完成。

【输出要求】
最终回复包含：做了什么（按文件）；验证命令与实测结果；截图清单（路径）；评分表与自检表；遗留差距；PR/Issue 链接。语气平实，不夸大。
```

### 13.2 各阶段任务提示词（在 13.1 之后追加）

**P0 · tokens / 字体 / 纹理**
```text
阶段 P0。阅读 {SPEC} §4、§5、§10.2–10.4。
目标：建立新的设计地基，旧页面不破版。
要做：
1. 按 §10.2 安装依赖。
2. 用 §4.2 全量替换 src/styles/tokens.css，§4.4 替换 characters.css，按 §4.9 修改 base.css（删除 body::after 噪点叠层）；为不支持 color-mix(in oklab) 的 WebView 增加 @supports 降级：在 characters.css 为 4 角色×亮/暗预先算好 --sea-1/2/3 的十六进制备用值（用 culori 计算）。
3. 实现 lib/theme.ts（解析 auto→data-theme）、lib/a11y.ts、public/theme-boot.js，并在 index.html 引入；theme-color 改 #F6EFE2。
4. 字体：scripts/build-fonts.mjs 用 cn-font-split 生成新晰黑分片 + 核心集；启用 Fraunces latin（@fontsource-variable/fraunces/index.css）；文楷沿用 lxgw-wenkai-webfont；全部本地打包，满足 CSP。
5. 纹理：--grain 背景图层（§5.1），可选纤维 SVG。
6. 组件：src/lib/ink.ts、InkLine、InkFrame、Tape、Stamp、Tide、Backdrop（替换 Ocean）、WhaleSticker（替换 WhaleFigure，无渐变）。
7. scripts/check-contrast.mjs 与 Playwright 基础配置；隐藏路由 /__kit 展示全部原语的全部状态（仅开发环境）。
不要做：任何页面的布局重构；不改数据层。
完成定义：{SPEC} §10.4 的 P0 七条全部满足；贴出 /__kit 在 亮/暗 × 4 角色的截图。
```

**P-B · 后端补齐**
```text
阶段 P-B。阅读 {SPEC} §10.5（B1–B6）、§12.8，以及 apps/api/src 的 server.ts、config.ts、store/database.ts、store/explorer.ts、store/maintenance.ts、journal-store.ts、daily-journal.ts、persona/persona.ts、routes/*.ts、test/*.test.ts。
目标：把额度、导出/删除全部、日记心情天气、记忆编号、昵称注入、健康检查 schedule、消息附件迁移全部做成可用接口，并配好客户端封装。
要做（逐项按规格，规格已含路由、schema、存储、测试）：
1. B1：usage_ledger + QuotaService + GET /api/quota；在 runChat / watchVideo / readWeb / 日记生成处记账；QUOTA_ENFORCE=1 时 402。
2. B2：src/zip.ts（zlib.deflateRawSync + crc32）、POST/GET /api/export、DELETE /api/data（复用 chat-history 的锁顺序）、clearAllData。
3. B3：daily_journal_revisions 增 mood/weather/title；diary-mood.ts 二次短调用；失败默认值；启动回填最近 30 条。
4. B4：memory_seq / memory_seq_counter、ensureSeq 惰性回填，explorer 返回 seq。
5. B5：user_profile、GET/PUT /api/profile、withUserName 并注入 chat / journal。
6. B6：/api/health 加 schedule.journalTime；messages.attachment_json 迁移与 history 透传；tauri.conf.json 的 CSP img-src 增加本地 API 源。
7. 客户端：lib/quota.ts、data.ts、profile.ts，扩展 lib/diary.ts、lib/memory.ts 的类型（只加字段，不改既有函数签名）。
8. 每项写测试（见规格），跑 pnpm --dir apps/api typecheck 与 test，全绿；对每个接口做一次 curl 并把输出贴进 PR。
不要做：任何界面改动（界面在 P1–P3 接线）。
完成定义：{SPEC} §10.4 的 P-B 五条全部满足。
```

**P1 · 聊天**
```text
阶段 P1。阅读 {SPEC} §6.1–6.8、§7.0、§7.1、§8、§9.2。
目标：聊天页变成“她在海边，话落在绘本字幕里，你递小纸条”。
要做：
1. Nav 加手绘图标与荧光块（§7.0，5 项；老人模式 3 项）；先烘焙 chat/diary/surf/memory/settings 图标（scripts/bake-icons.mjs），其余按需。
2. 重组 ChatPage：舞台（保留 Live2DStage/VrmStage）+ Tide + NameTab（含“AI 角色”标签）+ DialogBox + ComposerBar + Backlog（react-virtuoso）；手机用底部抽屉打开往回翻；useKeyboardInset 处理键盘。
3. 删除 chat__status（ChatPanel.tsx:177-180）与三点 typing（layout.css:62-66）；实现 Thinking、InkText（含 streamdown 分支）、Slip（含 sending/failed）。
4. 离线/失败/空/形象加载状态按 §7.1.6 逐条实现；视频/网页进度按 §7.1.5 映射 stage；视频分享弹层；问候用 GET /api/profile 的昵称。
5. ChatSessionControls：select/details → Popover + DropdownMenu；window.confirm → ConfirmDialog。
6. CompanionCorner 的组件与 store 先搭好（聊天页不显示）。
7. 保持：Enter 换行、⌘/Ctrl+Enter 发送、输入法组合期不发送、数据层与 SSE 逻辑不变。
完成定义：§10.4 的 P1；§12.1 聊天全部状态截图；无模型名/后端字样；流式输出可见 ink-in；axe 0 严重；PR 附前后对比图。
```

**P2 · 日记 + 记忆**
```text
阶段 P2。阅读 {SPEC} §6.9–6.10、§7.2、§7.3、§8。
目标：日记像手帐，记忆像海边拾到的贝壳与瓶中纸条。
要做：
1. 日记：DateStamp、IndexTabs、横线本（36px 行距）、真实 mood/weather 涂鸦与小标题（B3 字段，为 null 时不画）、邮戳“写好啦”、翻页动效、MiniCalendar 取代原生 date input、来源/历史版本文案按 §7.2.4；视频区降级为页面底部“给她看的视频”，轮询仅在可见且有排队时进行；页顶“看她的见闻”大按钮（P5 前链接到占位路由）。
2. 记忆：分类（含第 5 类“她拾到的”，P5 前为空）、MemoryCard（胶带、锯齿、真实 No.{seq}）、详情 Dialog（layoutId）、忘掉流程（ConfirmDialog → 折进瓶子 → 便签撤回，5s 后真正 DELETE，pagehide 立即提交）、更多筛选 Popover、搜索与分页。
3. 所有空/加载/错误用 StateBlock + 贴纸 + §7.2.5/§7.3.7 文案；日记空态里的写日记时间来自 /api/health 的 schedule。
4. CompanionCorner 在日记/记忆页接入 mood 映射（§5.7 表）。
完成定义：§10.4 的 P2；无 window.confirm；§12.1 日记与记忆全部状态截图；撤回用例通过（5s 内撤回不发 DELETE）。
```

**P3 · 设置 / 引导 / 老人模式**
```text
阶段 P3。阅读 {SPEC} §6.3、§6.9、§7.4、§7.5、§9。
目标：大字大行大白话的设置、3 步引导、完整老人模式。
要做：
1. 设置按 §7.4.3 重做：她（角色卡+换一位 Dialog+怎么称呼你）、看起来（ChoiceCard）、方便我用（老人模式/字号/安静/高对比）、额度（QuotaMeter 接 GET /api/quota）、我的数据（导出 POST /api/export、清空聊天、退出、删除全部 DELETE /api/data）、关于（AI 角色声明常驻、版本号）；B 站登录折叠到“连接其他平台”。
2. Onboarding 3 步（§7.5），昵称 PUT /api/profile；完成后写 localStorage 并触发问候。
3. 老人模式全站生效（§9.1）：3 项导航、rem×1.25、--hit 56、calm 动效、去旋转/胶带≤2、对比升级、Toast 8s、悬停才有的内容常显。
4. CompanionCorner 在设置页 wave，全站联调。
完成定义：§10.4 的 P3；老人模式截图矩阵齐全；所有可见交互元素 ≥56px；200% 字号 390px 无横向滚动；导出得到有效 zip、删除全部后各页回到空态。
```

**P4 · 打磨与验收**
```text
阶段 P4。阅读 {SPEC} §8、§12、§14。
目标：清理、调参、终稿、验收。
要做：删除 layout.css 中无引用规则与淘汰 token（grep 为 0）；统一动效参数；确认只动 transform/opacity 并在隐藏标签页时暂停常驻动效；替换最终插画/贴纸（记录 PROVENANCE，§13.5）；docs/DESIGN.md 终稿；跑完整 §12 并执行迭代循环（最多 5 轮）。
完成定义：§12 全部通过，或把差距报告写进 PR。
```

**P5 · 自主冲浪「她自己去逛」**
```text
阶段 P5。阅读 {SPEC} §7.7、§10.6、§12.8、§11（amica 的视线/姿态参考）。
目标：她会自己去刷 B 站视频、上网冲浪，把见闻带回来：舞台上看得见她在逛，见闻页翻得到，聊天里偶尔主动讲，设置里管得住。
后端要做（apps/api，按 §10.6 逐项）：
1. 表与迁移：surf_settings / surf_sessions / surf_items；SurfRepository；设置默认值。
2. vendor/dsh-bilibili 新增 searchVideos 导出（WBI 签名）并写入 UPSTREAM.md；bilibili-search.ts + picker.ts（筛选、模型挑选）。
3. 浏览器：playwright-core 单例 Chromium，请求拦截 + SSRF 校验；web-search.ts（Bing 解析 + 重定向解码 + DuckDuckGo 回退）；reader.ts 正文提取、og:image 缩略图。
4. service.ts：一次会话完整流程、上限与暂停条件、总结 JSON、入库（surf_items + experiences(surf:…) + 缩略图 + usage_ledger）；blocklist.ts。
5. scheduler.ts：CronJob 每 5 分钟、槽位 + 60 分钟宽限、UNIQUE 去重、手动触发 30 分钟限 1 次；分享（评分≥4，≤2 次/日，间隔≥3 小时，用户空闲≥10 分钟）与 20:30 后重写日记。
6. 路由与 SSE：§10.6.10、§10.6.7；explorer 的 surf 类别；journal-sources 的“她自己逛到的：”前缀。
7. 测试：§10.6.12 的七个测试文件，全绿。
前端要做（apps/client，按 §7.7）：
1. lib/surf.ts、useSurfEvents（fetch 流 + 退避重连）。
2. SurfStatus 便签 + avatar activity=browsing（Live2D/VRM 低头看手机）+ WhaleSticker 的 phone / paper 心情。
3. /surf 见闻页：PostcardCard、PostcardDetail、筛选、搜索、分页、手动触发、所有空/加载/错误态；导航第 3 项与红点；老人模式入口在日记页顶部。
4. 聊天里的 PostcardMini 与 Backlog 渲染；“跟她聊聊这个”预填草稿。
5. 设置「让她自己逛」「她逛什么」两组；记忆页第 5 类「她拾到的」。
6. tauri.conf.json CSP img-src 与 opener 插件；tests/ui/surf.spec.ts；§12.1 的新增截图。
完成定义：§10.4 的 P5 六条全部满足；全量回归通过。
```

### 13.3 视觉审查 Agent 提示词（看截图逐条挑刺）

```text
你是严苛的视觉审查员，不是实现者。你只依据我提供的截图与对应 *.metrics.json 评判，不看也不相信代码意图。对照《{SPEC}》判断截图是否达到「潮汐手帐 2.0」的要求。

输入：本轮截图目录 artifacts/ui/round-{N}/，每张图有 metrics.json（元素 boundingBox、字号、前景/背景色）。
规则：
1. 不夸奖，不总结优点。每张图先找问题；一张图找不到问题时，必须写出你检查过的 3 个具体点作为证据。
2. 所有数值判断只能引用 metrics.json 或 {SPEC} 的数值，禁止凭肉眼编造像素值。
3. 逐类检查：对比度/字号（§4.3、§12.3）；触控尺寸；对齐与 4px 栅格；信息层级与主操作唯一性；AI 味（§12.5 的 16 问逐条回答）；温度（角色在场、纸纹/手绘线/邮戳/胶带是否可见、文案口吻）；与线框一致性（§7 与 §12.4）；文案（系统腔、技术词、错别字）；亮暗/老人模式差异是否正确；文字溢出/截断/重叠；装饰是否遮挡内容；动效相关（若有 GIF/帧序列）；见闻页与“她在逛”便签（§7.7）的卡片层次、缩略图比例与邮戳。
4. 同一问题在多张图重复出现时合并，列出所有受影响截图。

输出（严格 JSON，随后一段不超过 5 行的中文总评）：
{
 "round": N,
 "issues": [
  {"id":"I-001","screenshots":["chat-normal-d-light-off.png"],"region":"左下对话框，约 x:12%-60% y:70%-88%","severity":"blocker|major|minor","dimension":"温度|品牌一致|清晰|适老|精致度|动效","evidence":"metrics: .dialogbox 宽 702px > 640","spec_ref":"§6.8","fix":"把 max-width 改为 min(640px, 100% - 48px)"}
 ],
 "ai_taste_checklist": {"1":"否","2":"否", "...":"…", "16":"否"},
 "scores": {"温度":{"score":3,"evidence":["…"]},"品牌一致":{},"清晰":{},"适老":{},"精致度":{},"动效":{}},
 "pass": false
}
评分按 §12.6 锚点；任一维度 <4 或有 blocker 则 pass=false。最后给“下一轮最该先修的 3 件事”。
```

### 13.4 文案润色提示词

```text
你是中文界面文案编辑。为「鲸汐」陪伴应用润色界面文案。

声音：她在对一个熟人说话——口语、温和、短句、动词在前；偶尔一点俏皮，但不卖萌过头。她是“角色设定”，不声称有真实意识或真实情感，不扮演亲属，不催促，不挽留，不说“她会难过”。界面里的系统提示（按钮、错误、确认）用“我/你”的朋友口吻，但必须准确。
绝对禁止：AI助手、智能、为您、赋能、暂无数据、操作成功、请稍后重试、加载中、同步、重试、刷新、API、token、模型、后端、服务器、缓存、设置失败（错误码仅在“详情”中出现）。
必须保留：涉及删除/退出/清空的后果说明（先说会怎样，再说什么不会受影响）。
约束：按钮 ≤6 字且以具体动词开头（“再试一次”“忘掉它”“先留着”，不用“确定/取消”）；标题 ≤12 字；正文 ≤2 句、每句 ≤22 字；适老模式下字数更紧；变量保持 {name} {n} {date} 原样。
输入：一张表（位置 / 原文 / 上下文）。
输出：Markdown 表：位置 | 原文 | 改写 | 为什么这样改（≤15字）。每条给 1 个主推 + 1 个备选。
```

### 13.5 生图提示词（插画 / 角色表情 / 贴纸）

**做法（先读）**
1. 生成记录写进 `docs/assets/PROVENANCE.md`（每个素材一行：提示词、种子、参考图、后处理）。终稿由人工重描/矢量化或至少实质性修改后入库。
2. 提示词里不写在世艺术家姓名，也不写具体影视作品或角色名；不生成真实人物。
3. 一致性：先做一张**角色设定表**（正面/侧面/表情）并锁定；之后所有表情都以这张图作参考图（Midjourney 用 `--cref <设定表> --cw 100` 与固定 `--sref` 风格参考；Stable Diffusion 系用 IP-Adapter 或训练 LoRA；其他服务用“同一参考图 + 固定种子”）。每次只改一个变量（表情/道具）。
4. 后处理流水线（脚本化，`scripts/post-sticker.mjs`）：去背景 → 轮廓统一描 2px `#2F3A4A` → 颜色量化到 §4 色板（亮色 8 色：`#F6EFE2 #FBF7EE #2F3A4A` + 当前角色 accent + `#F4B9A8 #F2D58A #BFE0DC`）→ 加 3px `#FBF7EE` 贴纸白边 → 导出 512×512 webp（透明底）。
5. 这里生成的是 `WhaleSticker` 的最终稿（鲸鱼吉祥物，与代码绘制的版本一致），用于鲸汐的兜底形象和所有角色共用的小角贴纸；鲸汐主舞台仍是现有 VRoid 模型。

**通用风格词**
- 中文：水彩平涂，纸质颗粒，蜡笔质感深靛蓝灰色描边（#2F3A4A），暖米色纸底（#F6EFE2），低饱和，柔和克制，海边绘本插画，扁平无渐变，无高光，无光晕，贴纸风格，粗白色模切边，居中，纯色背景。
- English: flat watercolor and gouache texture, soft crayon outline in deep blue‑grey ink (#2F3A4A), warm cream paper (#F6EFE2), muted limited palette, seaside picture‑book illustration for adults, flat colors, no gradients, no gloss, no glow, die‑cut sticker with thick white border, centered, plain solid background.
- 负面词（中）：渐变，光泽，3D 渲染，霓虹，发光，镜头光晕，紫蓝渐变，文字，水印，签名，多余手指，写实照片，闪光星星，sparkle 图标，硬阴影，杂乱背景，商标。
- Negative (EN): gradient, glossy, 3D render, neon, glow, lens flare, purple‑blue gradient, text, watermark, signature, extra fingers, photorealistic, sparkles, harsh shadow, cluttered background, logo.

**A1 · 鲸汐吉祥物设定表**
- 中：`一只圆润可爱的小鲸鱼吉祥物，浅青蓝色身体，奶白色肚皮，脸颊有两团淡珊瑚色腮红，眼睛是两个简单的深色圆点，头顶一小股喷水，设定表：正面、侧面、四分之三、背面四个视图加六个表情小图，白底，{通用风格词}。--ar 3:2`
- EN: `A round, friendly little whale mascot, pale teal body, cream belly, two soft coral cheek blushes, simple dark dot eyes, a small water spout on top, character sheet with front, side, three‑quarter and back views plus six small expression thumbnails, {general style words}. --ar 3:2`
- 颜色提示：身体色用目标角色 accent（鲸汐 `#1A6670`）与纸色混合 55% 的结果 `#6D9FA0` 作为色值约束。

**A2 · 表情/状态贴纸（对应 §5.7 的 10 个 mood，逐个生成）**
- 中：`参考图中的同一只小鲸鱼吉祥物，{状态描述}，贴纸风格，粗白色模切边，纯色背景，{通用风格词}`
- 状态描述：`idle 平静微笑看向前方` / `happy 闭眼开心大笑，身旁两颗小水花` / `think 眼睛看向左上方，一只鳍托着下巴，头顶一笔弯曲的细线` / `write 低头，鳍握着一支小铅笔，面前一本小本子` / `sleep 闭眼，头顶两个手写的 Z` / `sorry 眉毛八字，额头一滴汗，嘴角下弯` / `wave 一只鳍高高举起打招呼` / `hold 双鳍抱着一个透明玻璃小瓶，瓶里有一张卷起的纸条` / `phone 低头，双鳍捧着一个小手机，屏幕有三道横线` / `paper 双鳍展开一张小报纸，眼睛看着报纸`。
- EN: `The same little whale mascot as the reference image, {state}, sticker style, thick white die‑cut border, plain background, {general style words}`，其中 state 对应上面十条的英文直译。

**A3 · 空状态插画**（日记空）：`摊开的空白手帐本，旁边一支铅笔和一枚小贝壳，铺在暖米色纸上，俯视，蜡笔描边，水彩平涂，留白很多，无文字，{通用风格词}`
**A4 · 空状态插画**（记忆空）：`一只空的玻璃漂流瓶斜靠在沙滩上，旁边有一小片浪花，水彩平涂，暖米色纸底，无文字，{通用风格词}`
**A5 · 日记涂鸦 ×6**（单色墨线，透明底，56px 可读）：`极简手绘线稿涂鸦：太阳 / 云 / 雨滴 / 月亮 / 一道小浪 / 一颗星，单一深靛蓝灰色细笔触，略带不规则，无填充，无阴影，白底，居中`
**A6 · 记忆图标 ×5**：`五枚手绘图标：海螺、扇贝、海星、玻璃小瓶、小灯塔，蜡笔描边，淡水彩平涂，单个居中，白底，统一笔触粗细，{通用风格词}`
**A7 · 见闻页空状态**（§7.7.4）：`一只小鲸鱼吉祥物低头看着手里的小手机，身旁摊着几张小剪报，铺在暖米色纸上，蜡笔描边，水彩平涂，留白很多，无文字，{通用风格词}`

---

## 14. 已定决策汇总

下表把此前所有开放事项逐条列出，并给出**已定**的做法；Agent 直接按此执行。

| # | 原开放事项 | 已定决策 |
|---|---|---|
| 1 | 新晰黑字体 | 直接使用霞鹜新晰黑，`build-fonts.mjs` 子集化放 `public/fonts/neo-xihei/`，首屏字体总量上限 220 KB；系统字体栈只作 CSS 回退 |
| 2 | 大肥鱼/小克/小智的形象与贴纸 | 照现有角色配置使用；小角 `CompanionCorner` 对**所有**角色统一用 `WhaleSticker`，不做人像小图、没有 `capture-portraits.mjs` |
| 3 | “鲸汐”的形象 | 沿用 `characters.ts` 中 `modelId: "avatar-b"` 的 VRoid 紫发示例模型；`WhaleSticker` 仅作模型加载失败的兜底，以及小角贴纸风格 |
| 4 | 小角里再起第二个 Live2D/VRM 实例 | 不做；小角永远是 `WhaleSticker` |
| 5 | 后端缺口 | 全部转为实施任务：额度（B1）、导出与删除全部（B2）、日记心情天气（B3）、记忆编号（B4）、昵称注入（B5）、日记时间与消息附件（B6） |
| 6 | 昵称存哪 | 后端 `user_profile`，接口 `GET/PUT /api/profile`；本地旧键 `wp.nickname` 迁移一次后删除 |
| 7 | 额度单位与是否拦截 | 单位“贝壳”，每月 3000，默认只记账不拦截（`QUOTA_ENFORCE=0`）；成本见 §10.5 B1 |
| 8 | 导出格式与位置 | JSON zip，默认写 `~/Downloads`（`EXPORT_DIR` 可改）；浏览器环境走 `GET /api/export` 下载 |
| 9 | 删除全部数据 | `DELETE /api/data` + `{confirm:"DELETE_ALL"}`，清空全部白名单表、向量、见闻缩略图并登出 B 站；前端再清 `wp.*` 并重载 |
| 10 | 日记 mood/weather | 写日记后第二次短调用生成，枚举固定；失败用默认值；旧版本启动时回填最近 30 条 |
| 11 | 记忆编号 | `memory_seq` 表 + 惰性回填，卡片始终显示 `No.0042`；消息不编号 |
| 12 | 日记任务时间 | `/api/health` 的 `schedule.journalTime`，解析不了就写“每天晚上” |
| 13 | 老人模式是否本期实现 | 实现界面层老人模式（字号/触控/三项导航/calm/确认框）；不做家庭账号、代付、语音优先 |
| 14 | 与未合并 PR 的冲突 | 每个阶段都从最新 `main` 切出；上一阶段 PR 未合并就从其分支切并在描述里写明顺序 |
| 15 | 往回翻默认展开 | 窗口宽 <1100px 默认收起；用户操作后记入 `wp.backlog` |
| 16 | Live2D 切页重挂载 | 本期不做单例提升，接受切回聊天页时舞台重新挂载 |
| 17 | 音效 | 本期不做 |
| 18 | 纸纹与水彩滤镜的开销 | 纸纹用背景瓦片；滤镜仅给静态近浪；手机、老人模式、calm 下不加滤镜；动效一律只动 `transform`/`opacity` |
| 19 | 输入键位 | Enter 换行、⌘/Ctrl+Enter 发送；手机靠显眼的“发送”键 |
| 20 | 适老标准 | 数值取比 YD/T 3820-2021 与 GB/T 37668-2019 更严的一档（正文 ≥16px、老人模式 20px、触控 56px、对比 ≥7:1），国际对照 WCAG 2.2 |
| 21 | 生图素材 | 生图结果经 `post-sticker.mjs` 后处理并记录在 `docs/assets/PROVENANCE.md`（提示词、种子、参考图、后处理），终稿由人工重描后入库 |
| 22 | 记忆删除撤回 | 前端延迟 5 秒提交，`pagehide` 立即提交，后端不变 |
| 23 | 自主冲浪：视频来源 | B 站（`vendor/dsh-bilibili` 新增 WBI 搜索导出），时长 60 秒–20 分钟、播放 ≥5000，由模型从 8 个候选里挑 1 个 |
| 24 | 自主冲浪：网页来源 | `playwright-core` 无头 Chromium；搜索用 `cn.bing.com`，Bing 失败回退 DuckDuckGo html；每会话 ≤3 页，同域名每天 ≤2 次 |
| 25 | 自主冲浪：频率 | 偶尔 2 次/常常 4 次/勤快 8 次每天（默认“常常”），槽位见 §10.6.4；手动触发 30 分钟 1 次 |
| 26 | 自主冲浪：事件通道 | SSE（`GET /api/surf/events`），客户端 fetch 流 + 2→30 秒退避重连 |
| 27 | 自主冲浪：缩略图 | 保存到 `.local/surf/thumbs/`，由 `GET /api/surf/thumb/:id` 提供；Tauri CSP `img-src` 增加本地 API 源 |
| 28 | 自主冲浪：存入记忆的方式 | `experiences` 的 `sourceId` 以 `surf:` 开头，记忆页第 5 类“她拾到的”，日记来源标题加“她自己逛到的：” |
| 29 | 自主冲浪：主动分享 | 评分 ≥4 才分享；每天 ≤2 次，间隔 ≥3 小时；不在静默时段；用户空闲 ≥10 分钟；分享消息不触发记忆任务 |
| 30 | 自主冲浪：暂停条件 | 开关关闭、静默时段（默认 23:00–08:00）、额度低于 20%、用户正在聊天、视频锁占用、连续 3 次失败后 1 小时 |
| 31 | 自主冲浪：内容安全 | 内置屏蔽词/域名 + 用户屏蔽词；模型总结 `safe:false` 则丢弃 |
| 32 | 评审与合并 | 开发者自己合并 PR；Agent 达到迭代上限后把差距写进 PR 并进入下一阶段 |
| 33 | 导航项数 | 常规 5 项（聊天/日记/见闻/记忆/设置）；老人模式 3 项（聊天/日记/设置），见闻从日记页顶部大按钮进入 |


---

**本文档的使用方式一句话**：先把 §4 的 tokens 和 §5 的纹理/手绘地基立起来（P0），再补后端（P-B），按“聊天 → 日记/记忆 → 设置/引导/老人模式 → 打磨”逐阶段实现，最后做「她自己去逛」（P5）；每阶段都用 §12 的截图矩阵、指标与独立视觉审查，最多迭代 5 轮，达标即收，没达标就把差距写进 PR 继续下一阶段。
