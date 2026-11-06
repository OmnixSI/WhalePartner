# 大肥鱼 Live2D

## 模型来源与许可

应用使用 [A8Chann/dsh-pet-live2d](https://github.com/A8Chann/dsh-pet-live2d/tree/9b7cd8ed0d16bd23fb098bc0c4fdbac63d89de75/dsh-live2d-pet/pets/ds-whale-girl) 发布的 DS 鲸鱼娘 Cubism 4 模型（commit `9b7cd8ed0d16bd23fb098bc0c4fdbac63d89de75`，模型 `c_0120.model3.json`）。该模型由上善无形的原创角色「溟月」、ZipZipPipe 的 DeepSeek 女仆设计与氵六青的 Live2D 绑定组成。应用显示模型原始素材，不叠加水印。

模型素材许可为 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh)：须署名、仅限非商业用途；改编素材须以相同许可共享。各权利人和作品链详见上游的 [`LICENSE`](https://github.com/A8Chann/dsh-pet-live2d/blob/9b7cd8ed0d16bd23fb098bc0c4fdbac63d89de75/dsh-live2d-pet/pets/ds-whale-girl/LICENSE) 与 [`NOTICE.md`](https://github.com/A8Chann/dsh-pet-live2d/blob/9b7cd8ed0d16bd23fb098bc0c4fdbac63d89de75/NOTICE.md)。WhalePartner 将许可原文和完整署名随模型下载到本机；素材不提交到 WhalePartner 仓库。商业使用需先取得各权利人授权。

## 运行时与许可

- `pixi-live2d-display` 0.4.0 与 PixiJS 6.5.10 用于加载和渲染，源码采用 MIT 许可。
- Cubism Core 是模型运行所需组件，但它不是开源软件，也未由 Live2D 发布到 GitHub。Live2D 官方文档说明 Core 随 SDK 包提供；下载 SDK 要求接受 Live2D Proprietary Software License Agreement 与 Live2D Open Software License Agreement。AI/聊天机器人应用的发布还需按官方流程判断对应发布许可。
- WhalePartner 不提交或从第三方仓库镜像下载 Cubism Core。下载脚本仅获取模型文件、署名及模型许可证。开发者若自行从 [Live2D 官方 SDK 页面](https://www.live2d.com/en/sdk/download/web/)获取并放入 `apps/client/public/live2d/libs/live2dcubismcore.min.js`，须自行阅读并遵循适用条款；缺少 Core 时应用回退到默认鲸鱼形象。

官方依据：[Web SDK 下载与协议](https://www.live2d.com/en/sdk/download/web/)、[Cubism Web SDK 手册](https://docs.live2d.com/en/cubism-sdk-manual/cubism-sdk-for-web/)、[SDK 发布许可（含 AI/聊天机器人）](https://www.live2d.com/en/sdk/license/)。

## 集成方式

- React 聊天页通过 `pixi-live2d-display` 0.4.0 与 PixiJS 6.5.10 加载 Cubism 4；运行时与模型均通过现有主应用入口加载。
- `pnpm --dir apps/client run fetch-live2d` 从固定的 Git commit 下载模型 JSON、MOC、贴图、物理、动作、表情、署名许可至 Git 忽略的 `apps/client/public/live2d/whale-maid/`。模型资源不随 Git 提交；Cubism Core 需单独按官方条款获取。
- 表情依据聊天情绪切换；点击角色依次触发 `Hammer`（锤击）、`BubbleGum`（吹泡泡）、`SprayWater`（喷水）、`OpenCase`（打开盒子）、`Selfie`（自拍）、`SelfieQuick`（快速自拍）和 `Ketchup`（番茄酱彩蛋）七组模型动作与对应表情，动作结束后回到待机。模型持续播放原生待机动作，视线跟随指针，回复生成时驱动嘴部开合。
- 视线追踪使用舞台坐标；嘴型在 Live2D 动作参数更新后写入，避免被同一帧的动作计算覆盖。聊天回复之外，点击动作仍可使用模型自身的嘴部动画。
- 缺少模型资源或 WebGL 初始化失败时，聊天页沿用现有鲸鱼形象回退，并报告形象加载状态。

## 验证

在同一台 Mac 上从 Tauri 主应用构建验证客户端类型检查、生产构建、模型加载和聊天页显示；运行截图确认角色无可见水印，并逐一触发七组点击动作，动作结束后回到待机。指针移动事件已在运行中的舞台触发。项目应用标识 `com.omnixsi.whalepartner` 未改动。嘴型更新已修正到动作参数计算之后；本轮未发送新聊天消息，因此未做回复期间的嘴型运行截图。截图在本次任务对话中完成视觉检查，但没有保存为仓库 PNG 附件。

本次运行受限网络环境无法通过脚本连接 GitHub 下载资源；模型素材来自隔离研究目录中固定 commit 的副本，Cubism Core 使用本机现有文件。新环境的模型下载及 Core 安装路径按上文说明分别处理。

```sh
pnpm --dir apps/client run fetch-live2d
pnpm --dir apps/client run build
```
