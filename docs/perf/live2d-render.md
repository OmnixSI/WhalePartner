# Live2D 每帧开销（feat/live2d-perf）

去掉了「静置降到约 10fps」（#153），静置、交互、说话都按刷新率画；窗口隐藏或舞台离开视口时仍然整段停掉。
同时把 Cubism 4 的绘制路径改成每部件 VAO + GL 状态缓存（`src/avatar/live2d/gl-renderer.ts`）。

测试条件：Apple M4（10 核），有界面 Chrome 157，视口 1280×800、DPR 2，画布 1710×678（分辨率上限 1.5），
大肥鱼（whale-maid，269 个部件、每帧可见 93 个、8 个蒙版、10 405 个顶点）。

## 一帧花在哪

同一页面、同一时刻把 Live2D 的 ticker 开 / 停对照（`stopped` 时页面其余部分几乎不耗）：

| | 渲染进程 CPU | GPU 进程 CPU | 整机 GPU 占用 |
|---|---|---|---|
| Live2D 在跑 | 12–13% | 7–9% | 21–24% |
| Live2D 停掉 | 0.1–0.4% | 0% | 6–8% |

Live2D 自己的 JS（每帧约 1.0–1.4 ms，机器负载高时到 2 ms）里：

- Cubism Core（闭源 wasm，`coreModel.update`）约 75–80%。离线连续调用一次 0.5 ms，与参数改了多少无关；
- 动作 + 物理约 0.28 ms，眨眼 / 呼吸 / 视线 / 表情合计 < 0.02 ms；
- 绘制（`doDrawModel`）约 0.2 ms。

GPU 那一侧，大头是把一张每帧都变的画布合成进窗口：保留 GL 绘制但隐藏画布，GPU 占用回到 11–12%；
不画模型、只清空画布，仍有约 20%；画布面积减半、减到四分之一，数字基本不变（是每帧固定成本，不随面积走）。

## 绘制路径改动

原版所有部件共用一组缓冲，每画一个部件就把顶点、uv、索引各 `bufferData` 一次，并重设程序、属性指针、
采样器、矩阵、纹理、混合，画完 `useProgram(null)`。改成：

- 每部件一个 VAO；uv、索引只上传一次（STATIC_DRAW），顶点每帧最多 `bufferSubData` 一次（91% 的可见部件每帧都在变形，所以不做内容比对）；
- 程序、纹理、剔除、混合、uniform 只在值变化时设置；MVP、裁剪矩阵每程序每帧一次。

| | 原版 | 改后 |
|---|---|---|
| 每帧 GL 调用（交互） | 2361 | 527 |
| 每帧 `bufferData` | 311 | 0（只有 `bufferSubData` ≈ 100） |
| 绘制段 JS，机器空闲时 | 0.21–0.23 ms | 0.14–0.17 ms |
| 绘制段 JS，同页交替开关（机器有负载） | 0.30 / 0.26 / 0.41 ms | 0.28 / 0.25 / 0.36 ms（静置 / 交互 / 说话） |
| GPU 进程 CPU，同页交替开关 | 11.5 / 10.4 / 18.7% | 11.3 / 10.5 / 17.4% |

三种状态都是 60.0 fps。画面：`scripts/live2d-pixel-diff.mjs` 录 12 个姿态（静置、点击动作、张嘴），
两份构建画出来逐字节相同（1710×678，差异 0 字节）。

## 没有做的

- 缓存视线用的 `getBoundingClientRect`：每帧约 0.025 ms，缓存在页面切换动画时会过期。
- 只在顶点变化时上传、只在蒙版变化时重画蒙版：实测 91% 的可见部件和 8 个蒙版每帧都在变。
- 裁小画布：合成成本不随面积变化。
- 降低模拟频率再插值：等于变相降帧，不做。

## 发布前必跑：逐像素对照

`gl-renderer.ts` 替换了 `pixi-live2d-display` 内部类的方法，没有接进 CI。改动 `gl-renderer.ts`、升级 `pixi-live2d-display` / `pixi.js` / Cubism Core、或换模型之后，发布前在三种 GL 环境下各跑一遍，三次都要输出「一致」、退出码 0：

- WebGL2：走新路径（输出里 `fastPath: true`）；
- WebGL1 带 `OES_vertex_array_object`：走原版；
- WebGL1 无 VAO 扩展：走原版。这一项防的是 pixi 把 `gl.createVertexArray` 补成返回 null 的桩、立绘整块空白的问题。

```sh
cd apps/client
# 0. 模型素材软链到 public/live2d（做完删掉，不提交）
# 1. 两份构建：基线（改动前的提交）和待发布版本
vite build --outDir /tmp/dist-base   # 在基线提交上
vite build --outDir /tmp/dist-new    # 在待发布提交上
# 2. 在基线上录一组姿态（只需录一次）
node scripts/live2d-pixel-diff.mjs /tmp/dist-base /tmp/snaps.json record
# 3. 三种 GL 环境各比一次
for g in webgl2 webgl1 webgl1-novao; do
  node scripts/live2d-pixel-diff.mjs /tmp/dist-base /tmp/snaps.json a --gl=$g
  A=/tmp/snaps.a.px.json; [ $g = webgl2 ] || A=/tmp/snaps.a.$g.px.json
  node scripts/live2d-pixel-diff.mjs /tmp/dist-new /tmp/snaps.json b $A --gl=$g || echo "失败：$g"
done
```

任一帧有像素差异、帧数不一致、或画面全透明时脚本退出码为 1。端口固定 14251，需要有界面的 Chrome。

2026-11-12 的结果：三种环境 12 帧都与基线逐字节相同；修复前的 4d499bf 在无 VAO 扩展时 12 帧全透明（基线每帧约 14 万个非透明像素），脚本退出码 1。
