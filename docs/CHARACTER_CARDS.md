# 角色闪卡网页预览

独立预览使用当前客户端的字体、色彩、角色徽记与卡牌材质，不挂载聊天页，不调用 API，也不连接 SQLite。页面内的角色选择和关系阶段仅保存在当前页内存；切换卡片不会改动应用角色。

当前只有大肥鱼绑定可用的 Live2D 模型。预览在唯一的主卡舞台中真实加载该模型，支持触摸互动和已配置的表情；牌库缩略卡不会初始化额外渲染器。小克、小智和鲸汐继续展示各自固定的矢量默认形象，不借用大肥鱼模型。模型署名与许可可在主卡详情展开查看。

## 启动

在仓库根目录运行：

```sh
pnpm --dir apps/client dev -- --host 127.0.0.1 --port 1420
```

打开 <http://127.0.0.1:1420/character-cards.html>。不需要启动 API。

## 演示内容

- 四位角色的牌库、选择反馈及各自模型归属。
- 主卡中的真实 Live2D 舞台、预配置表情、点击动作和可见载入/失败状态；目前只有大肥鱼模型可以这样显示。
- 四级卡面效果与关系样本联动：Lv.1 基础图像、Lv.2 倾斜与分层视差、Lv.3 动态灯光和立体光环、Lv.4 专属星芒粒子。
- 卡面内部只呈现角色形象和等级对应的视觉效果，不绘制编号、角色名、模型名或等级说明；角色名称、好感度、模型状态与署名位于卡面外，卡牌选择按钮仍带有完整辅助技术标签。
- 深海蓝立绘底、金属层叠卡框、能量光环与动态光照；Live2D 目标高度为卡面舞台的 116%、宽度为 130%，超出部分由卡面边缘裁切，模型占据卡面主要区域。
- 卡面倾斜时，金属背板、场景光、Live2D 人物和光环按不同幅度视差移动；最高档以专属光环、动态光照和星芒粒子呈现。
- 四档固定关系样本。阶段名称、点数和阈值仅供网页演示，不代表真实关系规则或用户数据。
- 基础角色始终可选；牌库卡片与主卡支持键盘、鼠标和触摸；减少动态效果偏好会停用视差与 CSS 动画。
- Live2D 使用共享 Pixi ticker；舞台离开视口或窗口隐藏时暂停 ticker。画布分辨率上限为设备像素比 1.5，以减少高像素屏幕上的 GPU 像素填充，保留完整模型纹理和动画。

运行前需在当前工作区准备 `apps/client/public/live2d/whale-maid/` 的模型资源及 `apps/client/public/live2d/libs/live2dcubismcore.min.js`。它们由 `.gitignore` 排除；模型采用 CC BY-NC-SA 4.0，Cubism Core 为 Live2D 专有组件，因此不提交模型或 Core。仅本机预览和本地构建使用这些资源。

卡面截图中的模型署名：角色原作上善无形，DeepSeek 女仆设计 ZipZipPipe，Live2D 建模氵六青，发布仓库 [A8Chann/dsh-pet-live2d](https://github.com/A8Chann/dsh-pet-live2d)；模型适用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)。

## 卡面效果依据

公开资料将《王者万象棋》效果描述为五级：基础卡面、立体、动态画面、专属特效和镀闪（[效果说明](https://www.sohu.com/a/1057939968_122743460)）；版本更新记录了 17 个英雄的卡面升级特效迭代（[体验服更新公告转载](https://a.4399.cn/gg/53760390_250086.html)），另有公告记录过 3 级以上卡面特定角度显示异常的修复（[卡面问题修复](https://wzwxq.com/updates/official/18731495)）。本项目按用户验收采用四档，省略镀闪档；公开检索未找到游戏卡面渲染源码或直接复刻项目，预览只复刻视觉层级，不复制游戏资源或宣称还原官方 Shader。

实现参考了开源 [3D TCG Card Renderer](https://github.com/BrannySG/card-renderer) 的倾角色散与动态光照，以及 [cards-css](https://github.com/kongyo2/cards-css) 的指针响应卡面效果；预览使用现有 Live2D 角色，不引入这些项目作为运行依赖。

应用设置页“换一位”会读取当前人格的真实好感度，并在卡外显示关系阶段、进度和下一档解锁点；闪卡只呈现角色形象与对应档位特效。独立预览页使用固定关系样本，不连接账号或业务数据。

## 浏览器检查与截图

保持 Vite 页面运行，在仓库根目录执行：

```sh
pnpm --dir apps/client run card-preview:check
```

检查会真实加载本机模型并验证渲染器仅有一个实例、人物占比、四级效果、粒子数量、视差反馈、角色归属、切换等级不重载模型、角色选择不写入 `wp.character`、无 API 请求、键盘/触摸操作、待解锁提示、减少动态效果、字号缩放和窄屏横向溢出；另会打开设置页角色选择，验证基础卡面已接入、Live2D 人物随当前角色切换，并确认选择仍写入现有 `wp.character`。加载错误由舞台提供重试；预览牌库与关系样本固定，不连接业务数据。

截图保存在 `apps/client/test-results/card-preview/`（已被 git 忽略，不入库）：Lv.1 基础卡面、Lv.2 视差、Lv.3 动态灯光、Lv.4 专属特效、角色选择弹窗、独立主卡特写、390 × 844 窄屏概览与触摸选中状态；桌面图包含大肥鱼的 Live2D 主卡。

2026-11-09 复测通过：四档卡面均由真实 Live2D 主舞台渲染，等级切换不重复创建模型，角色切换符合模型归属，卡面内部无编号、姓名、模型或等级文字。共享 Pixi ticker 在三秒观察窗内运行 180 帧（60 FPS）；桌面和移动布局、Reduced Motion、键盘/触摸交互及无 API 请求检查通过。截图可用上面的命令重新生成。

## 五档好感度卡与升级动画（#159）

新卡面组件在 `apps/client/src/card-preview/tier/`，和上面的四档闪卡预览互不影响；预览页是 `/__kit/cards`（`pages/CardKitPage.tsx`，由 `/__kit` 页按路径懒加载，首屏不加载卡面代码）。档位名和门槛跟后端 `RELATIONSHIP_STAGES` 一致，Lv5 来自 #158。

| 档位 | 门槛 | 卡面 | 静置时 | 悬停 / 指针 |
| --- | --- | --- | --- | --- |
| Lv1 相识 | 0 | 素纸：纸面、细线框、一条海平线 | 平放 | 无 |
| Lv2 相熟 | 25 | 银衬：拉丝银框 + 内框，卡片微微立起，画面与名牌分层 | 固定斜角 | 跟指针倾斜，扫一道光 |
| Lv3 默契 | 100 | 潮光：角色色深海底、焦散水纹、光环、气泡，Live2D 可开待机 | 同上 | 同上 |
| Lv4 亲近 | 250 | 金缘：金框、顶光、星芒，每位角色一套专属纹样 | 同上 | 同上，星芒上浮 |
| Lv5 相依 | 500 | 鎏金箔：碎箔拼成的金底与折痕、拉丝框、暗色画框 | 同上 | 同上，镭射层随指针移动 |

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
    size="md"                     // "md" 主卡 | "sm" 缩略卡（静态）
  />
</Suspense>
```

- 触发：拿到新等级比上次看过的高时，把 `level` 设成新等级、`upgradeFrom` 设成旧等级；`onUpgradeEnd` 里把 `upgradeFrom` 清回 `undefined`。同一对 from/to 要重播，先清再设。
- 动画进行中根元素带 `data-upgrading="<目标档>"`，读屏会念「升到 Lv.N 相依」。
- `tierFeatures(level)` 给出 `{ tilt, live2dIdle, signature, foil }`，用来决定要不要开 Live2D 待机（Lv3 起）。
- 「上次看过的等级」存在哪里由 #160 决定，组件不读写存储、不请求接口。

`ui:check` 会打开 `/__kit/cards` 跑触控、横向滚动、axe、静置检查，并检查升级能播完、能跳过、减少动态时按时落到新卡面；`--shots` 另拍 `cards-tiers-{light,dark}.png`、`cards-signatures.png`、`cards-up-{12,23,34,45}.png`（每段取 45% 处一帧）和 `cards-390.png` 到 `apps/client/test-results/ui-check/`。
