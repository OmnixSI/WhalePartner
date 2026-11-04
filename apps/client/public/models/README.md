# 角色模型

`demo.vrm` 是演示用的开源模型，不提交到仓库，用 `pnpm --dir apps/client run fetch-model` 下载。

- 来源：pixiv three-vrm 官方示例 `VRM1_Constraint_Twist_Sample.vrm`
- 版权：© 2022 pixiv Inc.
- 授权：[VRM Public License 1.0](https://vrm.dev/licenses/1.0/)
- 用途：仅作内部展示。这不是鲸汐的原创形象；对外发布前要换成原创或已取得商用授权的模型。

换模型：修改 `src/avatar/model.config.ts` 的 `url` 与授权信息，以及 `scripts/fetch-model.mjs` 的下载地址和校验值。
