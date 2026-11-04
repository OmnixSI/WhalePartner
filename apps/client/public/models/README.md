# 角色模型

`avatar-a.vrm`、`avatar-b.vrm` 是演示用的现成二次元模型，不提交到仓库，用 `pnpm --dir apps/client run fetch-model` 下载（校验 sha256）。

- 来源：VRoid 官方示例 AvatarSample_A / AvatarSample_B，经 AIRI 项目引用的镜像 `dist.ayaka.moe` 下载。
- 版权：pixiv Inc. / VRoid Project。使用条件见 [VRoid 帮助页](https://vroid.pixiv.help/hc/en-us/articles/4402394424089)。
- 用途：只作内部展示。这不是鲸汐的原创形象，也没有核对过对外发布和商用的授权；对外发布前要换成有授权的角色。

新增或替换模型：改 `src/avatar/model.config.ts` 的清单和 `scripts/fetch-model.mjs` 的下载地址与校验值。
