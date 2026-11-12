# 角色闪卡

**现行规范是下文「五档好感度卡与升级动画（#159）」**：五档、名字牌规则、升级动画和接口都以那一节为准。独立预览页 `character-cards.html` 已换成同一套五档卡面；设置页「换一位」里的 `CardShowcase` 仍是旧的 legacy 四档卡，等 #160 接入新卡面后替换。

## 独立预览（character-cards.html）

独立预览使用当前客户端的字体、色彩、角色徽记与五档卡面，不挂载聊天页，不调用 API，也不连接 SQLite。页面内的角色和主题切换只影响当前页；不读取真实好感度，也不写入 `wp.character`。

- 五档并排：同一角色的 Lv.1–Lv.5，档位名和门槛跟 `CARD_TIERS` / 后端 `RELATIONSHIP_STAGES` 一致，卡面材质取 `CARD_TIERS` 的 `finish`。
- 四位角色：鲸汐、大肥鱼、小克、小智，都以 Lv.5 相依展示；强调色和专属纹样各不相同。
- 四段升级：1→2、2→3、3→4、4→5 可以点击试播；点卡面或「跳过」立即落到目标档，播完停在目标档，可反复重播。
- 亮色 / 暗色切换只改当前页的 `data-theme` / `data-theme-pref`，不写 `localStorage`；卸载时恢复原值。
- 独立预览不加载 Live2D，卡面默认画角色徽记；应用里的 Live2D 接入和署名见 [`LIVE2D.md`](LIVE2D.md)。

### 启动

在仓库根目录运行：

```sh
pnpm --dir apps/client dev --host 127.0.0.1 --port 1420
```

打开 <http://127.0.0.1:1420/character-cards.html>。不需要启动 API。

### 浏览器检查与截图

保持 Vite 页面运行，在仓库根目录执行：

```sh
pnpm --dir apps/client run card-preview:check
```

检查五档卡面、四位角色的切换、四段升级（含跳过与 4→5 播完）、亮/暗主题、390 × 844 窄屏横向溢出、系统减少动态，以及静置时没有循环动画；同时确认页面不请求 API、不改 `wp.character`。

截图保存在 `apps/client/test-results/card-preview/`（已被 git 忽略，不入库）：桌面亮/暗、五档并排亮/暗、四段升级后的卡面、四位角色 Lv.5、390 × 844 亮/暗；可用上面的命令重新生成。

2026-11-12 复测通过：五档卡面、四位角色、四段升级与亮暗主题均正常；桌面和 390 宽无横向溢出，静置 1.5 秒观察不到循环动画，页面无 API 请求。具体命令与结果见本次交付说明。

### 卡面效果依据

公开资料将《王者万象棋》效果描述为五级：基础卡面、立体、动态画面、专属特效和镀闪（[效果说明](https://www.sohu.com/a/1057939968_122743460)）；版本更新记录了 17 个英雄的卡面升级特效迭代（[体验服更新公告转载](https://a.4399.cn/gg/53760390_250086.html)），另有公告记录过 3 级以上卡面特定角度显示异常的修复（[卡面问题修复](https://wzwxq.com/updates/official/18731495)）。好感度五档、卡面视觉五档（Lv5 相依，500 点，镀闪，见 [`RELATIONSHIP.md`](RELATIONSHIP.md)）；公开检索未找到游戏卡面渲染源码或直接复刻项目，预览只复刻视觉层级，不复制游戏资源或宣称还原官方 Shader。

实现参考了开源 [3D TCG Card Renderer](https://github.com/BrannySG/card-renderer) 的倾角色散与动态光照，以及 [cards-css](https://github.com/kongyo2/cards-css) 的指针响应卡面效果；独立预览使用内联 SVG 角色徽记，应用设置页仍用现有 Live2D 角色，不引入这些项目作为运行依赖。

应用设置页“换一位”仍使用 legacy 的 `CardShowcase`，会读取当前人格的真实好感度，并在卡外显示关系阶段、进度和下一档解锁点；它将在 #160 接入新五档卡面。独立预览使用固定演示数据，不连接账号或业务数据。

## 五档好感度卡与升级动画（#159）

这是好感度卡的现行规范。新卡面组件在 `apps/client/src/card-preview/tier/`；独立预览页 `character-cards.html` 和 `/__kit/cards`（`pages/CardKitPage.tsx`）共用这套组件，前者直接打包进独立入口，后者由 `/__kit` 页按路径懒加载，首屏不加载卡面代码。档位名和门槛跟后端 `RELATIONSHIP_STAGES` 一致，Lv5 来自 #158。

| 档位 | 门槛 | 卡面 | 静置时 | 悬停 / 指针 |
| --- | --- | --- | --- | --- |
| Lv1 相识 | 0 | 素纸：纸面、细线框、一条海平线 | 平放 | 无 |
| Lv2 相熟 | 25 | 银衬：拉丝银框 + 内框，卡片微微立起，画面与名牌分层 | 固定斜角 | 跟指针倾斜，扫一道光 |
| Lv3 默契 | 100 | 潮光：角色色深海底、焦散水纹、光环、气泡，Live2D 可开待机 | 同上 | 同上 |
| Lv4 亲近 | 250 | 金缘：金框、顶光、星芒，每位角色一套专属纹样 | 同上 | 同上，星芒上浮 |
| Lv5 相依 | 500 | 镀闪：碎箔拼成的金底与折痕、拉丝框、暗色画框 | 同上 | 同上，镭射层随指针移动 |

名字牌：每张卡底部有一块名字牌，写角色名（默认取角色名，`name` 可改）和「Lv.N 档位名」，名字牌上方是五颗档位点，亮几颗就是几档。卡内只有这两行字，不写分数、门槛、模型名或编号；分数和下一档进度留在卡外由页面显示。整张卡的 `aria-label` 是「<角色名>的好感度卡，Lv.N 档位名，<卡面材质>卡面」，名字牌和档位点对读屏隐藏，不重复念。

取舍：#159 原文写了 Lv2 自动摆动、Lv3 焦散流动、Lv5 静置高光，它们和性能要求「静置时没有循环动画」冲突，以性能为准：这三处都做成静态（Lv2 是固定斜角，Lv3 焦散是静态水纹，Lv5 高光只在悬停和升级时出现）。GitHub issue 的文字暂未改。

专属纹样：鲸汐是鲸尾掀起的水纹和气泡，大肥鱼是水柱和水珠，小克是翻飞的书页和茶气，小智是抽枝的藤叶。所有纹样都是内联 SVG 和 CSS，没有位图。

升级动画逐档播放，每一步只播一次：

- 1→2（650ms）：旧卡面淡出，银框从外向内收拢，卡片抬起到斜角。
- 2→3（950ms）：卡心荡开两圈涟漪，边缘一道光转一圈，卡底由纸面转成深海，光环亮起。
- 3→4（1250ms）：四段金线从底边沿两侧合拢到顶边，十颗金点上浮，顶光落下。
- 4→5（1800ms）：一次闪白，一道光从左上扫到右下，镭射层渐亮，碎箔上的闪点逐颗弹出。
- 跨多档（如 1→5）逐档快进，整段等比压到 3 秒以内。点卡面或「跳过」立即落到新卡面。

规则：动画只动 `transform` / `opacity`，不用 CSS `filter`；静置时没有循环动画，光泽只在升级瞬间和精确指针悬停时各播一次；`prefers-reduced-motion` 或安静模式下升级只淡入新卡面（每步 450ms）并显示「升到 Lv.N」，不倾斜、不闪。

### 接口（给 #160）

```tsx
import { LazyAffinityCard, tierFeatures, type UpgradeEnd } from "../card-preview/tier";

<Suspense fallback={null}>
  <LazyAffinityCard
    character="deepseek"          // CharacterId
    level={level}                 // 1–5，越界会夹住
    upgradeFrom={prevLevel}       // 可选：小于 level 时播 prevLevel→level；不升级时传 undefined
    onUpgradeEnd={(e: UpgradeEnd) => setPrevLevel(undefined)}  // { from, to, skipped }
    art={<Live2DStage />}         // 可选：立绘槽，默认画角色徽记；整张卡只渲染一次，升级时不会重建
    size="md"                     // "md" 主卡 | "sm" 缩略卡（静态，忽略 upgradeFrom）
  />
</Suspense>
```

- 触发：拿到新等级比上次看过的高时，把 `level` 设成新等级、`upgradeFrom` 设成旧等级；`onUpgradeEnd` 里把 `upgradeFrom` 清回 `undefined`。同一对 from/to 要重播，先清再设。
- `onUpgradeEnd` 每轮升级正好调一次（播完或跳过；StrictMode 下也是一次）。播放中换了 `upgradeFrom` / `level`，旧一轮直接作废、不回调，从新的一轮开始；卸载时也不回调。
- `size="sm"` 是静态缩略卡：忽略 `upgradeFrom`，不播动画、不出「升到 Lv.N」和「跳过」、不调 `onUpgradeEnd`。升级动画只在 `md` 主卡上播。
- 触屏：主卡设了 `touch-action: pan-y`，横向拖动用来倾斜，竖向仍交给页面滚动；松手或手势被取消时倾斜复位。
- 动画进行中根元素带 `data-upgrading="<目标档>"`，读屏会念「升到 Lv.N 相依」。
- `tierFeatures(level)` 给出 `{ tilt, live2dIdle, signature, foil }`，用来决定要不要开 Live2D 待机（Lv3 起）。
- 「上次看过的等级」存在哪里由 #160 决定，组件不读写存储、不请求接口。

`ui:check` 会打开 `/__kit/cards` 跑触控、横向滚动、axe、静置检查，另有五项卡面专项：1→5 按 2、3、4、5 逐档快进且 ≤3 秒，4→5 播完，跳过即停，StrictMode 下每轮结束回调正好 1 次；跳过和已到点的定时器在同一拍时卡不复活、回调不多一次；安静模式开关和系统减少动态都走淡入；缩略卡给了 `upgradeFrom` 也不播、不回调；390 宽触屏横向拖动能倾斜、松手复位。`--shots` 另拍 `cards-tiers-{light,dark}.png`、`cards-signatures.png`、`cards-up-{12,23,34,45}.png`（每段取 45% 处一帧）和 `cards-390.png` 到 `apps/client/test-results/ui-check/`。

## 接入真实好感度（#160）

设置页「换一位」弹窗里的卡面接上了真实等级（`useRelationship` / `/api/relationship`）：主卡显示当前等级，等级升高时自动播一次升级动画；备选角色用 `sm` 缩略卡，各显示自己的等级。

### 位置（旧 → 新）

| 位置 | 旧 | 新 |
| --- | --- | --- |
| 设置页「换一位」弹窗主卡 | `CardShowcase`（四档、只读） | `settings/AffinityShowcase`（`LazyAffinityCard` md + 右侧细节 + 大肥鱼 Lv3 起的 Live2D 立绘） |
| 弹窗里的角色列表 | 贴纸缩略图 | `CharThumb`（`LazyAffinityCard` sm，右下角标当前等级） |
| 等级数据 | `useRelationship` 只在打开时取一次 | 同一个 hook 一次管四个角色（`entries`），主卡、缩略卡、概览读同一份；进页面读当前角色；打开弹窗、切回标签页（`visibilitychange`）读四个（每个角色一个请求）；弹窗开着时换角色只读新的当前角色和还没读好的；当前角色或任一缩略卡读失败都出现「重试」，点后只重读失败的。同一角色只认最新一次请求，旧请求被中止、晚到的响应也不写回（`lib/relationship-loader.ts`，有单测） |

`CardShowcase`、`character-cards.html`、`card-preview-check` 没动（旧预览页仍用 `CardShowcase`）。`HerOverview` 没动。

### 「上次看到的等级」

- 存储：localStorage，每个角色一条，键 `wp.cardSeenLevel.<角色 id>`，值是 1–5 的整数。读写和判断都在 `card-preview/tier/seen-level.ts`（纯函数，有单测）；组件本身仍不读写存储。
- 没有记录（首次、清过存储、值不合法）：记下当前等级，不播。
- 记录 < 当前：播 记录→当前，播完或点「跳过」后记成当前。动画播到一半关掉弹窗，下次打开会重播。
- 记录 ≥ 当前（后端数据重置、等级变低）：只把记录对齐到当前，不播。
- localStorage 不可用（隐私模式等）：退到内存里记，同一次打开页面内不会重播。只有写失败（`setItem` 抛错、`getItem` 正常）时同样：记下写失败的角色，读它时用内存值，写成功后清掉标记。
- `upgradeFrom` 在渲染时就算出来，升级那一帧卡面直接从旧档开始，不会先闪一下新卡面。

### 聊天页升档提示

一轮聊天正常结束后（失败不算），聊天页读一次 `/api/relationship`（`lib/level-up.ts`，懒加载）。有「上次看到的等级」且低于当前、并且这一档还没提示过，就用 `components/ui/Toast` 弹「好感度升到 Lv.N，去看看她的新卡面」，点「去看看」跳 `/settings?card=1`，设置页打开「换一位」并清掉参数，升级动画在那里播。

- 「已提示的等级」单独存 `wp.cardToastLevel.<角色 id>`，同一档只提示一次，再升一档可以再提示。提示不改「上次看到的等级」；没有记录时只对齐、不提示（和卡面一致）。判断在 `seen-level.ts` 的 `announceUpgrade`。
- 吐司组件和 `Toaster` 在 `components/chat/LevelUpToast.tsx`，只在真的升档时才下载，卡面代码不进聊天页首屏。

### 检查

`ui:check` 第 25 项确认卡面不进首屏（首屏文件里没有 `acard`，gzip 在 #160 上限内：JS ≤ 284,826 B，CSS ≤ 45,363 B）；第 26 项用假接口跑：鲸汐 Lv3 首次打开不播 → 接口改成 Lv4 并触发刷新，播一次 3→4 → 再开、刷新页面都不重播 → 换到大肥鱼（2→3）只播它自己、鲸汐记录不动 → 清存储或读取失败后重试都不播。另有两项：「换一位」主卡与缩略卡共用等级（接口全 500 后点重试四张缩略卡和四个等级字样一起恢复；只有小克一个缩略卡 500 时仍有重试入口，点后只重读小克；弹窗里大肥鱼 Lv2→3 后切角色，主卡、缩略卡、字样都是 Lv3；打开弹窗请求不超过 4 次；弹窗开着连续换 3 个角色各只请求 1 次），以及聊天页升档提示（Lv3 不提示，升到 Lv4 提示一次且 seen 仍是 3，再聊、刷新后都不再提示，点「去看看」到设置页卡面并播 3→4）。只跑这些：`node scripts/ui-check.mjs --only=card-live`。`--shots` 另拍 `settings-card-{light,dark}.png`、`settings-card-up.png`（升级中一帧）、`settings-card-thumbs.png`。
