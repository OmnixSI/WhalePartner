/** 见闻页用到的纯函数（不碰网络，node 测试可以直接 import）。 */

export function timeOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

// ---- 日期筛选 ----

export type DateRange = "all" | "today" | "week" | "month" | "day";

/** 本地日历日 YYYY-MM-DD（「选一天」的默认值和上限）。不用 toISOString：那是 UTC，东八区早上 8 点前会变成昨天。 */
export function localDay(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** 把「今天 / 近 7 天 / 近 30 天 / 某一天」换成接口要的 [from, to)（本地时区的零点）。 */
export function dateRangeBounds(range: DateRange, day: string, now = new Date()): { from?: string; to?: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayMs = 24 * 60 * 60_000;
  if (range === "today") return { from: start.toISOString() };
  if (range === "week") return { from: new Date(start.getTime() - 6 * dayMs).toISOString() };
  if (range === "month") return { from: new Date(start.getTime() - 29 * dayMs).toISOString() };
  if (range === "day" && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const [y, m, d] = day.split("-").map(Number);
    const from = new Date(y, m - 1, d);
    if (Number.isNaN(from.getTime())) return {};
    return { from: from.toISOString(), to: new Date(y, m - 1, d + 1).toISOString() };
  }
  return {};
}

// ---- 「和她聊聊这个」----

/** 预填进聊天输入框的那句话：标题和链接。聊天页读 `?quote=`。 */
export function quoteText(item: { title: string; url: string }): string {
  return `我看到你逛到了《${item.title}》\n${item.url}`;
}

/** 跳到聊天页，并把见闻标题和链接通过 `?quote=` 带过去。 */
export function chatQuoteHref(item: { title: string; url: string }): string {
  return `/?quote=${encodeURIComponent(quoteText(item))}`;
}

/** 「今天 14:20」「昨天 09:30」「11月5日 18:02」。 */
export function whenText(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const startOf = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(date)) / (24 * 60 * 60_000));
  const time = timeOf(iso);
  if (diff === 0) return `今天 ${time}`;
  if (diff === 1) return `昨天 ${time}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}
