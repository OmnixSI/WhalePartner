import { join, resolve } from "node:path";

/**
 * 用户数据目录：`WP_DATA_DIR`（打包后由外壳注入）优先，否则沿用原来的 apps/api/.local。
 * 每次调用都重新读环境变量，测试和外壳都可以在运行中改。
 * 冲浪的缩略图、浏览器、B 站冷却文件都放在这里面，不再散落到仓库根目录。
 */
export function dataDir(env: Record<string, string | undefined> = process.env): string {
  const configured = env.WP_DATA_DIR?.trim();
  return configured ? resolve(configured) : resolve(import.meta.dirname, "../.local");
}

/** 冲浪留下的东西（缩略图等）。 */
export const surfDataDir = (env: Record<string, string | undefined> = process.env) => join(dataDir(env), "surf");

/** playwright 浏览器的安装位置。 */
export const browsersDir = (env: Record<string, string | undefined> = process.env) => join(dataDir(env), "browsers");

/** B 站限流冷却文件（视频摘要与冲浪共用）。 */
export const bilibiliCooldownPath = (env: Record<string, string | undefined> = process.env) =>
  join(dataDir(env), "bilibili-rate-limit.json");

/** 冲浪自己的 B 站指数退避状态。 */
export const bilibiliBackoffPath = (env: Record<string, string | undefined> = process.env) =>
  join(dataDir(env), "bilibili-surf-backoff.json");
