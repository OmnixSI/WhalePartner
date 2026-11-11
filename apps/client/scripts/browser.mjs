/**
 * 检查脚本统一用本机 Google Chrome 启动浏览器，不需要另外下载 Playwright 自带的 Chromium。
 * 想换浏览器时设 CHROME_PATH（兼容旧的 WP_CHROME），指向可执行文件。
 */
export function launchChrome(chromium, options = {}) {
  const executablePath = process.env.CHROME_PATH || process.env.WP_CHROME;
  return chromium.launch({ ...options, ...(executablePath ? { executablePath } : { channel: "chrome" }) });
}
