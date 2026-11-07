# 界面与美术规范（潮汐手帐 2.0）

客户端（`apps/client`）的视觉方向叫“潮汐手帐”：一本放在海边的手帐，纸、墨、一条海平线，角色是页面上唯一鲜艳的东西。

- **唯一来源**：`docs/redesign/spec/WhalePartner_UI重设计规范.md`（下称“规范”）。本文件是**实现镜像**：只写代码里现在是这样，不写打算这样。
- **唯一真相**：颜色/圆角/字号/间距/时长在 `apps/client/src/styles/tokens.css`；弹簧参数在 `apps/client/src/motion/tokens.ts`。
- 任何“页面级”硬编码（色值、px 圆角、ms 时长、stiffness）都算缺陷，`scripts/redesign/check.mjs` 会拦。

## 取舍

做减法比做加法重要。早期版本用了毛玻璃卡片、渐变按钮、发光徽标和上浮的气泡，每个单独看都还行，放在一起就是随处可见的“AI 应用”模板。现在：

- 没有渐变、毛玻璃、发光和彩色大阴影；层次靠一像素的线和留白（`--shadow-1` / `--shadow-2` 只做“纸平放 / 纸被拿起”）。
- 没有胶囊徽标和圆形图标按钮；标签是 `InkFrame` 的细边小方框，主按钮是强调色实底 + 反色字。
- 一个页面只有一种强调色，且随角色变；珊瑚色（`--coral`）只做胶带、邮戳、插画这类**图形**，禁止做文字。
- 圆角只有 4 档 + 1 个圆：`--r-xs 4` / `--r-sm 8` / `--r-md 14`（老人模式 16）/ `--r-lg 20` / `--r-round 999`。
- 界面上不出现模型名、后端、API、token、“AI 助手”“为您生成”。她是角色，不是工具。

## 配色（`styles/tokens.css`）

亮色“晨光”是纸，暗色“深海夜”是夜里的海；设置页可选“跟随系统 / 晨光 / 深海夜”，暗色只有一份。

| token | 晨光（亮） | 深海夜（暗） | 用途 |
|---|---|---|---|
| `--paper` | `#F6EFE2` | `#0F1C2A` | 底 |
| `--paper-2` | `#EDE3D0` | `#17283A` | 次级纸：输入底、凹陷、选中底 |
| `--sheet` | `#FBF7EE` | `#13222F` | 抬起的纸：对话框、卡片、弹层 |
| `--ink` | `#2F3A4A` | `#EDE6D6` | 正文（≥7:1） |
| `--ink-soft` | `#3F4A5C` | `#CBD2D7` | 次要正文（仍 ≥7:1） |
| `--ink-mute` | `#525D70` | `#A0ACB6` | 时间/编号/说明（≥4.5:1，只给 ≥13px） |
| `--line` | 墨 20% | 纸 18% | 装饰性细线（不承载信息） |
| `--line-strong` | `#7D8795` | `#6B7A88` | 输入框/开关边界（≥3:1） |
| `--coral` | `#E8765E` | `#F08A72` | **只做图形**：胶带、邮戳环、插画 |
| `--alert` | `#A8372B` | `#FF9C86` | 危险/错误：文字、实心按钮、点 |
| `--slip` | `#FFF1B8` | `#3A3420` | 你说的话（手写便签底） |
| `--ok` / `--lamp` | `#2F6B3F` / `#F2C14E` | `#8FD3A0` / `#F2C14E` | 成功字样 / 灯塔黄（仅装饰） |

强调色随角色，见 `styles/characters.css`（亮色取深、暗色取浅，四套都在对比度闸门里）：

| 角色 | 晨光 | 深海夜 |
|---|---|---|
| 鲸汐 | `#1A6670` | `#7CCBD2` |
| 大肥鱼 | `#2E4BB8` | `#9DB2FF` |
| 小克 | `#9F4326` | `#F2A582` |
| 小智 | `#0A6B53` | `#79D9BC` |

海平线的三层浪用 `--sea-1/2/3`（`color-mix` 把强调色混进纸色）算出来，所以换角色背景跟着变。

## 字体

- 她的声音、页面标题、日记正文：霞鹜文楷（`--font-voice`，OFL）。按 `unicode-range` 分片（`styles/fonts-core.css` + `public/fonts/core/*.woff2`），首屏只下载用到的字。
- 界面 chrome：霞鹜新晰黑（`--font-ui`，本地有则用，否则退到系统黑体）。
- 日期与编号：Fraunces（`--font-num`，latin 子集 + 等宽数字）。
- 她说的话是文楷并带一条强调色细线，你说的话放进浅色便签（`--slip`）：一眼分得出谁在说话，不靠气泡颜色。
- 字号档位只有 tokens 里那 10 个（13/14/16/17/18/20/24/32/44/56）。**<14px 只允许**邮戳、编号、时间，且颜色必须是 `--ink-mute` 或更深。

## 纸与手（`components/ink/*`，样式在 `styles/ink.css`）

- `InkLine`：手绘分隔线 / 下划线 / 波浪线，路径按 `(variant, seed, size)` 缓存，截图可复现、滚动不重算。
- `InkFrame`：手绘框（`InkFrame` 的圆角走 `radiusToken()`，只会返回 `var(--r-*)`）。
- `Tape`：4 色胶带（`--tape-a..d`），斜纹是 SVG 描边不是 CSS 渐变。
- `Stamp`：邮戳/标签；圆直径由量出来的文字块反推，永不压字。
- `Tide`：水彩平涂的浪，三层（far 90s / mid 60s / near 40s 线性漂移），只用 `transform`。
- 纸纹是**背景图层**（`--grain` 的 SVG 噪声，亮色墨颗粒 / 暗色暖纸颗粒），不是盖在所有东西上的叠层。

## 布局

- **桌面（≥960px）**：左侧导航 `--nav-w 112px`（聊天、日记、记忆、见闻、设置），聊天页是 `.room` 网格 `minmax(--scene-min 480px, 1fr) + --backlog-w 360px`：左边舞台（她 + 对话框 + 回信条），右边「往回翻」默认收起，用户点击后展开。
- **对话框**：`.dlg` 宽 `min(640px, 100%)` 居中于舞台，`min-height 132px`、`max-height min(320px, 38dvh)`。
- **内容页（日记 / 记忆 / 见闻 / 设置）**：靠左单栏，`--page-max 760px`；记忆页 `--memory-max 960px`，卡片网格 `repeat(auto-fill, minmax(240px, 1fr))`（1180 宽 = 3 列，390 宽 = 1 列）。用细线分段，不装进卡片矩阵。
- **手机（<960px）**：导航变底部文字栏（`--tabbar-h 64px`，处理安全区）；聊天页舞台 34–42dvh，回信条永远在 tabbar 之上；聊天页的「往回翻」收进顶部 `.mbar`。
- **设置行**：`min-height 72px`，老人模式 `88px`。
- **触控**：`--hit 44px`（老人 56）；输入框 `--field-h 52px`，且 `min-height: max(--field-h, --hit)`。所有可见 `button/a/[role]/input/textarea` 都在闸门里量。
- **同伴小角** `CompanionCorner`：桌面 112、手机 64；日记/记忆页自己挂，其余由 `App` 补。

## 动效（规范 §8）

- 库：`motion`（`motion/react`）。只动 `transform` / `opacity`；例外只有墨线 `clip-path` 与折叠 `grid-template-rows`。
- **弹簧只在 `src/motion/tokens.ts`**：`spring.press/soft/sheet/page/switch/cute/char`。组件里不写 stiffness/damping。
- **时长与曲线只在 `styles/tokens.css`**：`--dur-press 120 / --dur-hover 160 / --dur-fade 200 / --dur-panel 280 / --dur-ink 240 / --dur-page 520`（ms）；常驻动效另有 `--breath 4.5s`、`--drift-far/mid/near 90/60/40s`、`--blink 4.6s`、`--lit 1.2s`、`--pen 1.6s`、`--dur-inkline 1800ms`、`--dur-fold 480ms`。
- 缓动只有三条：`--ease-out`（入）、`--ease-inout`（循环）、`--ease-linear`（只给浪漂移）。UI 动效 ≤300ms，翻页 520ms、墨线 1800ms、“忘掉”480ms 是白名单。
- 降级：`prefers-reduced-motion: reduce` 与 `data-motion="calm"`（老人模式自动进 calm）下，`--dur-*` 变 1ms/120ms、角色贴纸与浪停住、不位移只淡入。`calmFade`（`motion/tokens.ts`）就是那一档。

## 适老与无障碍

- 老人模式：根字号 `16px × --scale`，且 `--scale ≥ 1.25`（=20px）；`--hit 56`；`--ink-mute = --ink-soft`（取消最浅灰）；`--line-strong = --ink-mute`；记忆从「设置 › 她记得的事」进，聊天、日记、见闻和设置保留在导航；`--r-md 16`；动效进 calm。
- 对比度：正文 ≥7:1，任何文字 ≥4.5:1，控件边界 ≥3:1。`scripts/redesign/check-contrast.mjs` 对 90 组（亮/暗 × 4 角色）逐对验算。
- 焦点：`:focus-visible` 双环 `--focus-ring`（纸 + 强调色），任何底色上都可见。
- 语义：图标一律 `aria-hidden`，认路靠文字；装饰（浪、纸纹）`aria-hidden` + `pointer-events:none`；`<time>` 不用 `aria-label`（ARIA 禁止），改用 `sr-only` 文本。
- 确认：所有破坏性操作走 `ConfirmDialog`（先讲后果，再给动作），**全站零 `window.confirm/alert`**。

## 文案与标识

- 用角色自己的口吻：“我想想哦…”“网络好像断了，我在这儿等你。”错误码放进“详情”折叠里。
- 首次引导三步讲清楚：聊天只存在这台设备、随时可导出可删除、不会要验证码/银行卡/转账。
- 她不扮演亲属，不声称真实情感，也不催人留下。

## 文件地图

| 文件 | 管什么 |
|---|---|
| `styles/tokens.css` | 颜色、字号、间距、圆角、触控、层级、动效时长与曲线 |
| `styles/characters.css` | 4 角色 × 亮/暗的强调色 |
| `styles/base.css` | reset、纸纹背景、焦点环、`.sr-only` |
| `styles/ocean.css` | 全局背景海平线（两层浪，慢漂） |
| `styles/chat.css` | 聊天页：舞台、对话框、便签、回望、回信条 |
| `styles/diary.css` | 日记：日期戳、横线本、翻页、索引页签 |
| `styles/memory.css` | 记忆：图鉴编号、卡片网格、详情、筛选 |
| `styles/settings.css` | 设置与引导：分组行、开关、滑块、选择卡 |
| `styles/ink.css` | 手绘基元：线、框、胶带、邮戳、浪、图标 |
| `styles/sticker.css` | 贴纸角色与小角（呼吸/眨眼/手机三道线/笔尖） |
| `styles/layout.css` | 外框、导航、内容页通用排版、账号接入 |
| `styles/kit.css` | 隐藏样品页 `/__kit`（只看，不进导航） |
| `motion/tokens.ts` | 弹簧与 motion 侧的时长常量 |
| `components/diary/useDiaryPageData.ts` | 周/月/年范围内读取共享日记与旧视频队列 |
| `components/diary/DailyJournalLeaf.tsx` | 综合日记正文、日期与可展开来源 |
| `avatar/live2d/actions.ts` | 过滤当前模型短动作并随机选择一次播放 |
| `lib/external-url.ts` | Tauri 桌面与 Web 共用的外链打开入口 |

## 机器检查（交付闸门）

```bash
node scripts/redesign/check.mjs            # 全跑：源码 + 浏览器（会自己起 vite，跑完关掉）
node scripts/redesign/check.mjs --static   # 只跑源码检查
node scripts/redesign/check.mjs --shots    # 另外拍 docs/redesign/shots/P4/ 的 4 页 × 亮/暗（1440×900）
node scripts/redesign/check-contrast.mjs   # 只跑 90 组对比度，逐对打印比值
```

十项：对比度 90 组、淘汰 token、gradient/backdrop-filter、`window.confirm/alert`、珊瑚色作文字、圆角只允许 `--r-*`、动效参数只在 tokens、触控 ≥44（老人 ≥56）、横向滚动（380px 与 `--scale=2`）、axe（wcag2a/2aa/21aa/22aa，critical+serious = 0）。任何一项失败退出码为 1。

## 角色形象

形象是 three-vrm 渲染的 VRM 模型（`avatar/*`），模型清单在 `apps/client/models.manifest.json`，文件不进仓库，用 `pnpm fetch-model` 下载并校验。拿不到模型、或手机/老人/calm 下，只显示一条海平线和角色名（`Horizon`），不画任何手绘形象；角色徽记用矢量的 `CharacterMark`（平涂、无渐变）。目前都是别人做好的现成模型，授权没有核对，只作内部展示；对外发布前要换成原创或授权明确的形象。
