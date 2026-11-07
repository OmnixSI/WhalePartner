# 角色默认形象与 Live2D 归属（Issue #84）

## 目标

四个人格各使用一个固定默认形象。当前只有大肥鱼（DeepSeek）绑定实际可用的 Live2D 模型；小克、小智和鲸汐使用 WhaleSticker 默认形象。角色切换只切换人格，聊天、记忆、日记和见闻仍然共享。

## 实现

- 模型注册表只保留本机已有的大肥鱼 Live2D 模型，并记录其所属人格。
- 每个人格在角色配置中指定固定默认形象；模型解析同时校验所属人格，旧存储中的跨角色模型 ID 不会加载。
- 移除未提供模型文件的 VRM 示例、模型清单、下载脚本、渲染器和客户端 three-vrm 依赖。
- 角色设置显示各自的默认形象，不再提供跨角色模型选择。
- 未更改应用 bundle identifier、真实业务数据库、用户配置或忽略的本机 Live2D/Cubism Core 资源。

## 验证

- `pnpm --dir apps/client run typecheck`：通过。
- `pnpm --dir apps/client run test`：通过，10 个用例；包含模型归属、默认值和跨角色旧 ID 校验。
- `pnpm --dir apps/client run build`：通过，Vite 生产构建成功。
- 活跃代码与开发文档扫描：没有已删除 VRM 注册表、渲染器或下载脚本的有效引用。

## 交接

- 状态：待 GitHub PR 自查与合并。
- 分支：`fix/84-character-default-avatars`
- Issue：[ #84](https://github.com/OmnixSI/WhalePartner/issues/84)
- 人工验收：分别切换四个人格，确认大肥鱼加载 Live2D，其余三者显示固定贴纸形象，且没有可选或串用其他模型的入口。
- Notion 任务：角色默认形象与 Live2D 绑定（#84）。
