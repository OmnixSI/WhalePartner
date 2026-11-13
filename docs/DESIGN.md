# 界面与美术规范（潮汐手帐 2.0）

客户端（`apps/client`）的视觉方向叫“潮汐手帐”：一本放在海边的手帐，纸、墨、一条海平线，角色是页面上唯一鲜艳的东西。

- **唯一来源**：[`UI_SPEC.md`](UI_SPEC.md)（下称“规范”）。本文件是**实现镜像**：只写代码里现在是这样，不写打算这样。
- **唯一真相**：颜色/圆角/字号/间距/时长在 `apps/client/src/styles/tokens.css`；弹簧参数在 `apps/client/src/motion/tokens.ts`。
- **两层 token**：`--paper/--ink/--accent…` 是调色板；`--color-* / --text-* / --r-inner…--r-full / --elev-* / --dur-fast…` 是语义层（#151）。`components/ui/*` 只用语义层，页面迁移时也改用语义层。
- 任何“页面级”硬编码（色值、px 圆角、ms 时长、stiffness）都算缺陷，`pnpm --dir apps/client run ui:check` 会拦。

## 取舍

做减法比做加法重要。早期版本用了毛玻璃卡片、渐变按钮、发光徽标和上浮的气泡，每个单独看都还行，放在一起就是随处可见的“AI 应用”模板。现在：

- 没有渐变、毛玻璃、发光和彩色大阴影；层次靠一像素的线和留白（`--shadow-1` / `--shadow-2` 只做“纸平放 / 纸被拿起”）。
- 没有胶囊徽标和圆形图标按钮；标签是 `InkFrame` 的细边小方框，主按钮是强调色实底 + 反色字。
- 一个页面只有一种强调色，且随角色变；珊瑚色（`--coral`）只做胶带、邮戳、插画这类**图形**，禁止做文字。
- 圆角只有 4 档 + 1 个圆：`--r-inner 6` / `--r-element 12`（老人模式 14）/ `--r-container 18`（老人模式 20）/ `--r-page 26` / `--r-full 999`。旧页面还在用调色板层的 `--r-xs 4 / --r-sm 8 / --r-md 14 / --r-lg 20 / --r-round 999`，迁移时换成语义层。
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
- 字号有两套，都在 `styles/tokens.css`：
  - 旧页面（调色板层）：`--fs-*` 10 档，固定值。
  - 设计系统（语义层，`components/ui/*` 和迁移后的页面）：`--text-*` 8 档，`--text-base 1rem × --text-ratio 1.125` 的阶梯；触屏或窄屏下 `--text-sm`、`--text-control` 不低于 16px。
  - 页面迁移时按下表换；没有对应档的保留原 token。

  | 旧 `--fs-*` | 值 | 新 `--text-*` | 值 |
  |---|---|---|---|
  | `--fs-micro` | 13 | `--text-xs` | 13 |
  | `--fs-small` | 14 | `--text-sm` | ≈14.2 |
  | `--fs-body` | 16 | `--text-md`（控件字用 `--text-control`） | 16 |
  | `--fs-chat` | 17 | 无，聊天页保留 `--fs-chat` | — |
  | `--fs-diary` | 18 | `--text-lg` | 18 |
  | `--fs-h3` | 20 | `--text-xl` | ≈20.3 |
  | `--fs-h2` | 24 | `--text-2xl` | ≈25.6 |
  | `--fs-h1` | 32 | `--text-3xl` | ≈32.4 |
  | `--fs-display` | 44 | `--text-display` | ≈41 |
  | `--fs-date` | 56 | 无，日记日期保留 `--fs-date` | — |

- 两套都是 **<14px 只允许**邮戳、编号、时间（`--fs-micro` / `--text-xs`），且颜色必须是 `--ink-mute` 或更深。

## 纸与手（`components/ink/*`，样式在 `styles/ink.css`）

- `InkLine`：手绘分隔线 / 下划线 / 波浪线，路径按 `(variant, seed, size)` 缓存，截图可复现、滚动不重算。
- `InkFrame`：手绘框（`InkFrame` 的圆角走 `radiusToken()`，只会返回 `var(--r-*)`）。
- `Tape`：4 色胶带（`--tape-a..d`），斜纹是 SVG 描边不是 CSS 渐变。
- `Stamp`：邮戳/标签；圆直径由量出来的文字块反推，永不压字。
- `Tide`：水彩平涂的浪，三层（far 90s / mid 60s / near 40s 线性漂移），只用 `transform`。
- 纸纹是**背景图层**（`--grain` 的 SVG 噪声，亮色墨颗粒 / 暗色暖纸颗粒），不是盖在所有东西上的叠层。

## 设计系统（`components/ui/*`，#151）

基础组件放在 `apps/client/src/components/ui/`，从 `components/ui/index.ts` 导出。每个组件带自己的 CSS，页面只为用到的组件付体积。交互底层用已有依赖 `radix-ui`（Dialog、Select、Tabs、Tooltip、Switch、Toast），没有新增运行时依赖。部分结构改写自 meta/astryx（MIT），没有作为依赖安装，见仓库根目录 [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)。

### 语义 token（`styles/tokens.css`）

| 类 | token | 晨光（亮） | 深海夜（暗） |
|---|---|---|---|
| 表面（低→高） | `--color-bg-body` / `--color-bg-muted` / `--color-surface` / `--color-card` / `--color-popover` | 纸 / 次级纸 / `--sheet` / `#FFFCF5` / `#FFFDF9` | 纸 / 次级纸 / `#1B2E41` / `#1F3448` / `#243B51`（越高越亮） |
| 遮罩 | `--color-scrim` | 墨 36% | 近黑 58% |
| 文字 | `--color-text-primary/secondary/tertiary/disabled` | `--ink` / `--ink-soft` / `--ink-mute` / `#80878F` | 同名调色板 / `#7D8995` |
| 边 | `--color-border` / `--color-border-strong` | `--line` / `--line-strong`（≥3:1） | 同左 |
| 强调 | `--color-accent` / `-muted` / `--color-on-accent` | 随角色（`characters.css`） | 随角色 |
| 状态 | `--color-success/warning/error/info`，各带 `-muted` 浅底与 `--color-on-*` | `#2F6B3F` / `#7A5200` / `#A8372B` / `#2F5C8C` | `#8FD3A0` / `#F2C14E` / `#FF9C86` / `#8FB6E0` |
| 交互叠层 | `--overlay-hover` / `--overlay-press` | .07 / .13 | .09 / .16 |
| 字号 | `--text-xs…--text-display` | `--text-base 1rem × --text-ratio 1.125` 的阶梯，13px 地板；rem 跟根字号和 `--scale` 缩放 | 同左 |
| 圆角 | `--r-inner 6` / `--r-element 12` / `--r-container 18` / `--r-page 26` / `--r-full` | 控件内小块 / 按钮输入框 / 卡片弹层 / 对话框 | 同左 |
| 层级 | `--elev-flat` / `-raised` / `-floating` / `-overlay` | 1px 边 + 递增的墨色阴影 | 1px 边 + 黑色阴影，靠表面提亮分层 |
| 尺寸 | `--control-h`（=`--hit`）/ `--control-h-lg`（=`--field-h`）/ `--control-px` | 44 / 52 / 1.125rem；老人模式 56 | 同左 |
| 动效 | `--dur-fast 120` / `--dur-medium 200` / `--dur-slow 320`（ms）；`--ease-standard/enter/exit`；`--press-scale .97`、`--enter-scale .96`、`--enter-shift 6px` | 降级动效下时长缩短、位移和缩放归零 | 同左 |

间距沿用 `--sp-1…--sp-20`（4px 网格）。

### 组件

| 组件 | 要点 |
|---|---|
| `Button` | 变体 `primary` / `secondary` / `ghost` / `danger`，尺寸 `md` / `lg`，`loading`、`icon`、`block` |
| `IconButton` | 第 5 个变体 `icon`：方形，必须给 `label`（读屏和 Tooltip 用） |
| `Field` / `Input` / `Textarea` | 标签、说明、错误三件套自动连 `aria-describedby` |
| `Select` | radix Select；弹层用 `--color-popover` + `--elev-floating` |
| `Switch` | 轨道 `--r-full`，滑块只动 `transform` |
| `Tabs` / `TabPanel` | 分段式；选中块用 `--r-inner` |
| `Card` / `CardButton` | 静态卡与可点卡（可点卡才有 hover 叠层） |
| `Dialog` / `ConfirmDialog` | 遮罩 `--color-scrim`，面板 `--r-page` + `--elev-overlay`；破坏性确认先讲后果 |
| `Toaster` / `toast` | Radix Toast；默认 8 秒消失，常显「关掉」，带撤销时不短于 8 秒 |
| `Tooltip` | 只补充说明，不承载唯一信息 |

每个可交互组件都有 hover、按下（active）、焦点（`:focus-visible` 双环）和禁用四种状态：

- hover 和按下不换底色，垫一层 `currentColor` 只改 `opacity`（`ui-press`，`shared.css`）。
- 精确指针下按下微缩 `--press-scale`；触屏和降级动效下不缩。
- 禁用：`--color-text-disabled`，去掉叠层和指针。

### 预览页

`/__kit` 是组件预览页（`pages/UiKitPage.tsx`，懒加载、不进导航）：所有变体 × 状态、亮暗对照、4 个角色色、手机宽度和老人模式。手绘基元的样品页挪到了 `/__kit/ink`。截图见 [`images/design-system/`](images/design-system/)，`ui:check --shots` 每次重拍到 `apps/client/test-results/ui-check/`。

## 布局

- **桌面（≥960px）**：左侧导航展开 `--shell-nav-w` = 200px × 字号倍数（老人模式 250），1180 以下自动收成 72px 图标栏（聊天、日记、记忆、见闻、设置）。≥1180 时收起按钮在品牌行左端（标记和「鲸汐」在它右边），钉在 72px 窄栏正中，展开、收起两态同一位置；收起后品牌标记挪到按钮下面。回信条：左边「发个视频给她」，右边「语音、发送」挨着；三个按钮和单行输入框上下居中，多行时贴底对齐最后一行；手机上仍是一行，发送只留图标。聊天页是 `.room` 网格 `minmax(--scene-min 480px, 1fr) + --backlog-w`：左边舞台（她 + 对话框 + 回信条），右边「往回翻」默认收起，用户点击后展开。`--backlog-w` 是 `clamp(300px, 22vw, 360px)`（1180 宽 300、1440 宽 317、封顶 360），右栏打开时人物仍占可画区 ≥72%。
- **对话框**：`.dlg` 宽 `min(640px, 100%)` 居中于舞台，`min-height 132px`、`max-height min(320px, 38dvh)`。
- **内容页（日记 / 记忆 / 见闻 / 设置）**：靠左单栏，`--page-max 760px`；记忆页 `--memory-max 960px`，卡片网格 `repeat(auto-fill, minmax(240px, 1fr))`（1180 宽 = 3 列，390 宽 = 1 列）。用细线分段，不装进卡片矩阵。
- **手机（<960px）**：导航变底部文字栏（`--tabbar-h 64px`，处理安全区）；聊天页舞台 34–42dvh，回信条永远在 tabbar 之上；聊天页的「往回翻」收进顶部 `.mbar`。点开后：720–959 宽（左侧还有图标栏）从右侧滑出，宽 `--backlog-w`、满高；719 及以下是横向铺满的底部抽屉。
- **设置行**：`min-height 72px`，老人模式 `88px`。
- **触控**：`--hit 44px`（老人 56）；输入框 `--field-h 52px`，且 `min-height: max(--field-h, --hit)`。所有可见 `button/a/[role]/input/textarea` 都在闸门里量。
- **同伴小角** `CompanionCorner`：桌面 112、手机 64；日记/记忆页自己挂，其余由 `App` 补。

## 动效（规范 §8）

- 库：`motion`（`motion/react`）。只动 `transform` / `opacity`；例外只有墨线 `clip-path` 与折叠 `grid-template-rows`。
- **弹簧只在 `src/motion/tokens.ts`**：`spring.press/soft/sheet/page/switch/cute/char`。组件里不写 stiffness/damping。
- **时长与曲线只在 `styles/tokens.css`**：`--dur-press 120 / --dur-hover 160 / --dur-fade 200 / --dur-panel 280 / --dur-ink 240 / --dur-page 520`（ms）；常驻动效另有 `--breath 4.5s`、`--drift-far/mid/near 90/60/40s`、`--blink 4.6s`、`--lit 1.2s`、`--pen 1.6s`、`--dur-inkline 1800ms`、`--dur-fold 480ms`。
- 缓动只有三条：`--ease-out`（入）、`--ease-inout`（循环）、`--ease-linear`（只给浪漂移）。设计系统组件另用语义档：`--dur-fast/medium/slow` 与 `--ease-standard/enter/exit`。UI 动效不超过 `--dur-slow` 320ms（对话框、抽屉），翻页 520ms、墨线 1800ms、“忘掉”480ms 是白名单。
- 环境动效（标了 `data-ambient` 的海平线和浪）静置 8 秒后暂停，有输入再继续；页面隐藏时所有 CSS 动画暂停（`lib/activity.ts`）；Live2D 的 pixi 交互管理器不挂系统 ticker。
- 降级：`prefers-reduced-motion: reduce` 与 `data-motion="calm"`（老人模式自动进 calm）下，`--dur-*` 变 1ms/120ms、角色贴纸与浪停住、不位移只淡入。`calmFade`（`motion/tokens.ts`）就是那一档。

## 适老与无障碍

- 老人模式：根字号 `16px × --scale`，且 `--scale ≥ 1.25`（=20px）；`--hit 56`；`--ink-mute = --ink-soft`（取消最浅灰）；`--line-strong = --ink-mute`；记忆从「设置 › 她记得的事」进，聊天、日记、见闻和设置保留在导航；`--r-md 16`；动效进 calm。
- 对比度：正文 ≥7:1，任何文字 ≥4.5:1，控件边界 ≥3:1。`apps/client/scripts/contrast-check.mjs` 对 172 组（亮/暗 × 4 角色，含语义层）逐对验算。
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
| `styles/surf.css` | 见闻页（懒加载） |
| `styles/surf-slip.css` | 「她在逛」小便签，聊天页和见闻页共用，由 `SurfStatus` 引入 |
| `styles/toast-note.css` | 日记、记忆、见闻三页共用的便签小提示，由 `components/diary/Toast` 引入 |
| `styles/ink.css` | 手绘基元：线、框、胶带、邮戳、浪、图标 |
| `styles/sticker.css` | 贴纸角色与小角（呼吸/眨眼/手机三道线/笔尖） |
| `styles/layout.css` | 外框、导航、内容页通用排版、账号接入 |
| `styles/kit.css` | 手绘基元样品页 `/__kit/ink`（只看，不进导航） |
| `components/ui/*` | 设计系统基础组件，见上文「设计系统」 |
| `pages/UiKitPage.tsx` | 组件预览页 `/__kit`；`/__kit/cards` 由它懒加载 `pages/CardKitPage.tsx` |
| `card-preview/tier/*` | 好感度卡五档与升级动画（#159），见 `docs/CHARACTER_CARDS.md` |
| `scripts/perf-budget.json` | 性能预算：首屏基线、运行时依赖清单、动效/filter 存量 |
| `scripts/perf-idle.mjs` | 空闲 CPU、渲染进程内存、定时器与动画计数 |
| `scripts/ui-fixtures.mjs` | ui:check 和性能脚本共用的假 API |
| `motion/tokens.ts` | 弹簧与 motion 侧的时长常量 |
| `components/diary/useDiaryPageData.ts` | 周/月/年范围内读取共享日记与旧视频队列 |
| `components/diary/DailyJournalLeaf.tsx` | 综合日记正文、日期与可展开来源 |
| `avatar/live2d/actions.ts` | 过滤当前模型短动作并随机选择一次播放 |
| `lib/external-url.ts` | Tauri 桌面与 Web 共用的外链打开入口 |

## 机器检查（交付闸门）

```bash
pnpm --dir apps/client run ui:check            # 全跑：源码 + 构建 + 浏览器（会自己起 vite，跑完关掉）
pnpm --dir apps/client run ui:check --static   # 只跑源码检查
pnpm --dir apps/client run ui:check --shots    # 另外拍 6 页 × 亮/暗 和预览页，存到 apps/client/test-results/ui-check/
pnpm --dir apps/client run ui:check --debt     # 打印各文件的动效 / filter 存量，用来调低 perf-budget.json
pnpm --dir apps/client run contrast:check      # 只跑对比度，逐对打印比值
```

默认跑 49 项，带 `--shots` 再加一项截图（共 50 项）；任何一项失败退出码为 1。完整编号以 `scripts/ui-check.mjs` 文件头为准，下面列的是常用的几类。浏览器检查覆盖聊天、日记、记忆、设置、见闻、预览页和好感度卡预览页 7 页：

1. 对比度 172 组
2. 淘汰 token
3. gradient / backdrop-filter
4. 珊瑚色作文字
5. `window.confirm/alert`
6. 圆角只允许 `--r-*`
7. 动效参数只在 tokens
8. 运行时依赖在清单内
9. 动画/过渡只动 transform·opacity（`components/ui` 0 处，旧页面只减不增）
10. filter 只减不增
11. 首屏 gzip（只打印，不设上限）
12. 触控 ≥44（老人 ≥56）
13. 横向滚动（380px 与 `--scale=2`）
14. axe（wcag2a/2aa/21aa/22aa，critical+serious = 0）
15. 静置 / 隐藏后动画停下（每页都等满 9.5 秒再查；加载转圈只在 `/__kit` 豁免，生产页静置后不许还在转）
16. 懒加载页借用的组件样式还在（`/surf` 的便签是 fixed 小条），标签的 `aria-controls` 不悬空，渲染出的面板都有标签指向；`loading` / `aria-disabled` 的按钮点击和回车都不提交、不回调；字段标签都连到控件（控件自带 id 时连到它）
17. 好感度卡升级（`/__kit/cards`，dev 构建即 StrictMode）：1→5 按 2、3、4、5 逐档快进且 ≤3 秒，4→5 按时播完，跳过即停，每轮结束回调正好 1 次
18. 好感度卡升级竞态：先跳过、再执行已到点的定时器回调，卡不复活、回调不多一次
19. 好感度卡升级：安静模式开关和系统减少动态都只淡入，并按时播完；关掉开关后恢复完整动效
20. 好感度卡缩略卡（`size="sm"`）：给了 `upgradeFrom` 也不播、不出跳过和提示、不回调
21. 好感度卡升级被打断：播放中清空 `upgradeFrom`、卸载卡片，这一轮立即作废，到点也不回调
22. 好感度卡读屏：名字牌和档位点对读屏隐藏，主卡、缩略卡的 ariaSnapshot 只有卡根的 `aria-label`
23. 好感度卡触屏：390 宽、真实触摸序列横向拖动能倾斜（`touch-action: pan-y`），松手复位
24. 截图（只在 `--shots` 时）

界面打磨专项（`--only=polish` 单跑）：

- 设置页点目录「关于」：只滚页面，html 不滚、侧栏 y=0 满高（1440 / 900）
- 见闻工具条：1440 / 1180 筛选、搜索、「让她现在去逛逛」同一行；900 / 390 换行不溢出
- 聊天页没有对话时不留空右栏，舞台和画布铺满内容宽（1440 / 1180）；有对话时右栏照常
- 收起 / 展开导航按钮在品牌行、两态同一位置，原地再点即展开
- 页头：聊天页没有页头；日记、记忆、见闻、设置的标题行位置、宽度、字号、到正文间距一致（1440 / 1180 / 900 / 390）；五页都没有面包屑和日记、记忆那两句说明
- 聊天舞台人物撑满：只留画布量看得见的像素，构图方向占可画区 ≥72%，待机摆动不碰两侧（1440 / 1180 / 900 / 390）
- 聊天主区平铺：没有圆角卡（边框、圆角、底色、描边阴影），舞台贴满内容区（1440 / 1180 / 900）
- 见闻页「她今天逛了…」在标题右侧同一行，次要文字色（1440 / 1180 / 900）
- 设置页滚动时吸顶目录条盖住卡片列和描边，不重叠、不横向溢出（1440 / 1180 / 900 / 390）
- 侧栏与往回翻宽度：展开侧栏 200（老人模式 250），品牌字、导航项、分组名、她的卡片不截断不换行；往回翻右栏 ≤360 且 ≤ 内容区 31%（1920 / 1440 / 1180），900 抽屉贴右侧满高 ≤360，390 仍是底部抽屉；右栏打开时人物占可画区 ≥72%（1440 / 1180）
- 回信条：视频 / 语音 / 发送和单行输入框中心竖直差 ≤1px，多行时对齐最后一行；语音紧挨发送在右边（1440 / 1180 / 1180 老人 / 900 / 390）；收起按钮和品牌标记同一行，她的卡片下面不再空一行
- 弹层关上后焦点回到打开它的按钮：往回翻抽屉（900 / 390 × Escape / 「关上」）、设置页「换一位」（Escape / ✕）

角色闪卡（`apps/client/src/card-preview/`）的镭射、光泽和光照是单独确认的卡面效果，不受渐变、圆角和动效时长这三条限制。

## 性能预算

基线是 0.3.4（main@47518a3）。机器能判的写进 `scripts/perf-budget.json` 并由 ui:check 拦。2026-11-12 产品决定取消首屏体积上限，ui:check 只报数字：首屏 JS / CSS 体积不设上限，ui:check 第 11 项只打印 gzip 大小（`vite build` 后按 `index.html` 的入口与 modulepreload 计）：

| 预算 | 上限 | 在哪拦 |
|---|---|---|
| 运行时依赖 | 只能是清单里的 17 个；加依赖要改清单并在 #151 说明 | 第 8 项 |
| 非合成层动效 / filter | `components/ui` 为 0；旧文件按 `motionDebt` / `filterDebt` 存量只减不增 | 第 9、10 项 |
| 常驻动画 | 静置 10 秒内、页面隐藏后，循环动画数为 0 | 第 15 项 |

需要人看的项用 `scripts/perf-idle.mjs` 测，结果记在 [`perf/`](perf/)：

- 空闲 CPU：鲸汐聊天页静置 ≤ 1%。Live2D 角色页不高于 0.3.4。
- 渲染进程内存：不高于 0.3.4。
- 页面隐藏后，30 秒内定时器和 rAF 触发次数接近 0。

新页面默认懒加载。只给某一页用的 CSS 跟着那一页加载，被别的页面复用的组件自己 import 样式，不要靠懒加载页的 CSS 顺带加载：设置页的标签框、聊天页的「她在逛」便签、记忆页借用的日记状态块和小日历，都因此丢过样式。

## 角色形象

大肥鱼（DeepSeek）的聊天舞台使用唯一现有的 Live2D 模型；其余人格保留 AI 人格与聊天能力，默认形象是各自固定的矢量徽记 `CharacterMark`（平涂、无渐变），不会共用大肥鱼的 Live2D 模型。形象加载中只显示一条海平线和角色名（`Horizon`），失败时舞台底部给一张「再试一次」纸条；任何情况下都不画手绘形象。已不再有 VRM：示例清单、下载脚本和渲染器已移除。模型许可、来源和 Cubism Core 获取方式见 [`LIVE2D.md`](LIVE2D.md)。
