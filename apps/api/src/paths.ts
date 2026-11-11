import { resolve } from "node:path";

/**
 * 后端根目录：源码运行时是 `apps/api`，打包进桌面 App 后是 `Resources/api`。
 *
 * 打包时 esbuild 把整个 src 合成一个 `dist/server.mjs`，`dist` 和 `src` 一样只比根目录深一层，
 * 所以本文件必须留在 src 顶层。子目录里的模块要找 vendor、scripts、`.local` 时都从这里取，
 * 不要自己用 `import.meta.dirname` 往上数层级。
 */
export const API_ROOT = resolve(import.meta.dirname, "..");
