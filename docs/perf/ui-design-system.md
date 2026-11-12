# #151 设计系统：与 0.3.4 的性能对比

[#151](https://github.com/OmnixSI/WhalePartner/issues/151) 引入设计系统（语义 token + `components/ui`），同时清理了首屏和空闲时的浪费。本文记录和 0.3.4 对比的数据与测试条件。预算本身见 [`DESIGN.md` §性能预算](../DESIGN.md#性能预算)。

## 总览

| 指标 | 0.3.4 | #151 | 变化 |
|---|---|---|---|
| 首屏 JS（gzip） | 433.6 KB | 277.9 KB | −35.9% |
| 首屏 CSS（gzip） | 48.9 KB | 44.3 KB | −9.4% |
| 鲸汐聊天页 · 空闲 CPU | 9.12% | 0.45% | −95% |
| 鲸汐聊天页 · 渲染进程 RSS | 160.9 MB | 153.3 MB | −4.7% |
| 鲸汐聊天页 · JS 堆（GC 后） | 4.46 MB | 3.70 MB | −17% |
| 鲸汐聊天页 · 静置时的循环动画 | 5 | 0 | |
| 大肥鱼聊天页（Live2D）· 空闲 CPU | 50.9%（32–56） | 52.8%（46–53） | 在噪声内，无变化 |
| 大肥鱼聊天页 · 渲染进程 RSS | 245.0 MB | 232.9 MB | −4.9% |
| 大肥鱼聊天页 · JS 堆（GC 后） | 8.07 MB | 8.11 MB | 持平 |
| 大肥鱼聊天页 · 30 秒内定时器与 rAF 触发 | 3619 | 1819 | −50% |
| 大肥鱼聊天页 · 页面隐藏后 5 秒内触发 | 301 | 1 | |
| 大肥鱼聊天页 · 静置时的循环动画 | 5 | 0 | |

## 测试条件

- 机器：Apple M4，macOS 26.5.2，Google Chrome 157.0.8103.51（Playwright 无头）。
- 构建：
  - 0.3.4：main@47518a3 的 `vite build`。
  - #151：`feat/ui-design-system`@746afd3 的 `vite build`。之后的提交只调整样式归属（设置页、「她在逛」便签、日记状态块）和文档，不改聊天页的运行逻辑；首屏体积按最终提交重测。
  - Live2D 模型不进仓库，构建时临时链接本地模型目录，构建完就删掉链接。
- 隔离：`env -i`，HOME 和 TMPDIR 都在 `.worktrees/ui-ds-iso/` 下。后端用 `scripts/ui-fixtures.mjs` 的假 API，不连 8787，不碰日常数据。
- 首屏体积：`scripts/perf-budget.mjs`。计 `index.html` 一打开就会下载的入口脚本、modulepreload、样式表和它们的静态 import，不含懒加载 chunk、字体和图片。
- 空闲 CPU 和内存：`scripts/perf-idle.mjs --runs=N --seconds=30 --settle=8`，打开聊天页，先静置 8 秒，再量 30 秒。
  - CPU 是 renderer 和 GPU 进程 cpuTime 的增量除以墙钟时间。
  - RSS 取 renderer 进程，JS 堆是 GC 后的值。
  - 鲸汐页跑 3 次，大肥鱼页跑 5 次，取中位数。
- 原始 JSON 在 `.worktrees/ui-ds-iso/`（不进仓库）：`perf-034-final.json`、`perf-new-whale.json`、`perf-034-deepseek.json`、`perf-new-deepseek.json`。

## 降下来的原因

- **首屏体积**：日记、记忆、见闻三页和两个样品页改成懒加载，`kit.css` 只在 `/__kit/ink` 加载。
- **鲸汐页空闲 CPU**：
  - 0.3.4 的海平线和浪（5 条无限 SVG 漂移动画）一直在跑，静置时 CPU 9%。
  - 现在它们标成 `data-ambient`，静置 8 秒后暂停，页面隐藏时所有 CSS 动画都暂停（`lib/activity.ts`）。
- **大肥鱼页的定时器**：pixi 的 InteractionManager 默认在系统 ticker 上每帧做一次指针命中检测。Live2D 舞台不需要它，改成 `useSystemTicker = false`，触发次数减半。

## 没降下来的：Live2D 持续 60fps 渲染

大肥鱼页空闲 CPU 仍在 50% 左右：Live2D 模型静置时也按 60fps 重绘。

- 无头 Chrome 多半走软件 GL，这个数字会比真机 WKWebView 高。
- 但"静置时不需要每帧重绘"在真机上同样成立，可以在空闲时降帧，或者在没有动作、口型和视线变化时停掉 ticker。

这一项会改动角色表现，不在 #151 的范围里，记到聊天页的 issue。

## 没测的项

- **Tauri / WKWebView 真机数据**：这一轮只在隔离的 Chrome 里测，没有起 Tauri 应用（起应用会用到用户的数据目录）。Chrome 和 WKWebView 的绝对值不同，前后对比的方向可以参考。
- **GPU 进程内存**：没有单独统计，表里只有 renderer RSS。
- **0.3.4 的独立复测**：另由代码助手按自己的脚本测，见 `.worktrees/perf-034/BASELINE.md`；本文的 0.3.4 数字是本分支脚本测的。
