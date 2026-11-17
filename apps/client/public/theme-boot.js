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
  // 界面语言：规则与 src/i18n/index.ts 的 resolveLang 相同（存了 zh/en 就用它，否则系统是中文用中文、其余英文）。
  // 在首帧前写好 html lang、标题和首屏角色名，英文启动时不会先闪一下中文。
  var langPref = null;
  try { langPref = localStorage.getItem("wp.lang"); } catch (e) { /* 隐私模式 */ }
  var sysLang = (navigator.languages && navigator.languages[0]) || navigator.language || "";
  var en = langPref === "en" || (langPref !== "zh" && !/^zh\b/i.test(sysLang));
  root.lang = en ? "en" : "zh-CN";
  document.title = en ? "WhalePartner" : "鲸汐 · WhalePartner";
  var desc = document.querySelector('meta[name="description"]');
  if (desc) desc.setAttribute("content", en ? "WhalePartner: a companion who lives on your device" : "鲸汐：住在你手机里的陪伴角色");
  // 首屏的角色名：DOM 还没解析到 #splash-name，等 DOMContentLoaded 再写（仍在首帧之前）
  var NAMES = en
    ? { deepseek: "Big Fat Fish", claude: "Claudie", chatgpt: "Gippy", whale: "Jingxi" }
    : { deepseek: "大肥鱼", claude: "小克", chatgpt: "小智", whale: "鲸汐" };
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
