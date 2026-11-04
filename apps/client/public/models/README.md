# 角色模型

这里的 `.vrm` 都是别人做好的现成模型，不提交到仓库，用 `pnpm --dir apps/client run fetch-model` 按清单下载（校验 sha256，共约 390 MB）。清单是 `apps/client/models.manifest.json`：每个模型的来源、授权声明和下载地址都记在里面，新增模型只加一条。

- 用途：只作内部展示。授权没有逐个核对；其中有些明确限制个人非商业、禁止改作或再分发（尤其是 DeepSeek 鲸鱼娘、Claude 娘、白紫龙娘：作者木子惡魔，原档写着 `allowRedistribution=false`、`commercialUsage=personalNonProfit`，使用时需署名）。这些文件不进仓库，每台机器从作者的发布页自己下载。
- 对外发布或商用前，要么取得作者授权，要么换成原创或授权明确的模型。
- 单个模型下载失败不会中断其它模型，脚本退出码为 1，重跑即可。

模型授权的来源：VRoid 官方示例（A、B、F、G 等）、OpenGameArt 的 VRoid CC0 合集、GitHub 上各开源项目自带的模型；清单里的 `licenseNote` 是对来源声明的转述，以原始页面为准。
