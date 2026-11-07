/* 首帧前写 data-theme / data-elder / --scale，避免闪白（规范 §4.8）。
   CSP default-src 'self' 禁止内联脚本，所以单独成文件。 */
(function () {
  var root = document.documentElement;
  var mq = window.matchMedia("(prefers-color-scheme: dark)");
  var theme = null, elder = null, scale = null, motion = null;
  try {
    theme = localStorage.getItem("wp.theme");
    elder = localStorage.getItem("wp.elder");
    scale = localStorage.getItem("wp.scale");
    motion = localStorage.getItem("wp.motion");
  } catch (e) { /* 隐私模式 */ }
  var resolved = theme === "light" || theme === "dark" ? theme : (mq.matches ? "dark" : "light");
  root.setAttribute("data-theme", resolved);
  root.setAttribute("data-theme-pref", theme === "light" || theme === "dark" ? theme : "auto");
  var elderOn = elder === "on";
  root.setAttribute("data-elder", elderOn ? "on" : "off");
  var s = Number(scale || 1);
  if (!isFinite(s) || s <= 0) s = 1;
  root.style.setProperty("--scale", String(elderOn ? Math.max(s, 1.25) : s));
  root.setAttribute("data-motion", elderOn || motion === "calm" ? "calm" : "full");
  // 首屏的角色名：DOM 还没解析到 #splash-name，等 DOMContentLoaded 再写（仍在首帧之前）
  var NAMES = { deepseek: "大肥鱼", claude: "小克", chatgpt: "小智", whale: "鲸汐" };
  var cid = null;
  try { cid = localStorage.getItem("wp.character"); } catch (e) { /* 隐私模式 */ }
  var name = NAMES[cid] || NAMES.deepseek;
  document.addEventListener("DOMContentLoaded", function () {
    var el = document.getElementById("splash-name");
    if (el) el.textContent = name;
  });
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta && resolved === "dark") meta.setAttribute("content", "#0F1C2A");
})();
