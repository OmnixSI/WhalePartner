const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function searchTerms(value: string, maxTerms = Number.MAX_SAFE_INTEGER): string[] {
  const terms = new Set<string>();
  const segments = value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const segment of segments) {
    if (CJK.test(segment)) {
      const chars = Array.from(segment);
      if (chars.length === 1) terms.add(chars[0]);
      for (let i = 0; i < chars.length - 1; i++) terms.add(chars.slice(i, i + 2).join(""));
    } else {
      terms.add(segment);
    }
  }
  return [...terms].slice(0, maxTerms);
}

export function indexedMessageText(value: string): string {
  return searchTerms(value).join(" ");
}

export function matchExpression(value: string): string | undefined {
  const searchable = value
    .replace(/(?:过去|最近|近)一年|前年|去年|今年|上个月|上月|本月|这个月|上周|本周|这周|前天|昨天|今天|今日/gu, " ")
    .replace(/(?:19|20)\d{2}\s*年(?:\s*(?:0?[1-9]|1[0-2])月)?/gu, " ");
  const terms = searchTerms(searchable, 24);
  return terms.length ? terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ") : undefined;
}

export interface TimeWindow {
  from: string;
  to: string;
}

export function timeWindow(query: string, now = new Date()): TimeWindow | undefined {
  const month = query.match(/((?:19|20)\d{2})年\s*(0?[1-9]|1[0-2])月/u);
  if (month) {
    const start = new Date(Number(month[1]), Number(month[2]) - 1, 1);
    return { from: start.toISOString(), to: new Date(start.getFullYear(), start.getMonth() + 1, 1).toISOString() };
  }
  // 必须带「年」字：「花了2000块」里的 2000 不是年份。
  const year = query.match(/(?:^|[^\d])((?:19|20)\d{2})\s*年/u);
  if (year) {
    const start = new Date(Number(year[1]), 0, 1);
    return { from: start.toISOString(), to: new Date(start.getFullYear() + 1, 0, 1).toISOString() };
  }

  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const addDays = (date: Date, offset: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
  if (/前年/u.test(query)) return { from: new Date(now.getFullYear() - 2, 0, 1).toISOString(), to: new Date(now.getFullYear() - 1, 0, 1).toISOString() };
  if (/去年/u.test(query)) return { from: new Date(now.getFullYear() - 1, 0, 1).toISOString(), to: new Date(now.getFullYear(), 0, 1).toISOString() };
  if (/今年/u.test(query)) return { from: new Date(now.getFullYear(), 0, 1).toISOString(), to: new Date(now.getFullYear() + 1, 0, 1).toISOString() };
  if (/上个月|上月/u.test(query)) return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(), to: new Date(now.getFullYear(), now.getMonth(), 1).toISOString() };
  if (/本月|这个月/u.test(query)) return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString() };
  if (/上周/u.test(query)) {
    const thisMonday = addDays(startOfDay, -((startOfDay.getDay() + 6) % 7));
    return { from: addDays(thisMonday, -7).toISOString(), to: thisMonday.toISOString() };
  }
  if (/本周|这周/u.test(query)) {
    const thisMonday = addDays(startOfDay, -((startOfDay.getDay() + 6) % 7));
    return { from: thisMonday.toISOString(), to: addDays(thisMonday, 7).toISOString() };
  }
  if (/前天/u.test(query)) return { from: addDays(startOfDay, -2).toISOString(), to: addDays(startOfDay, -1).toISOString() };
  if (/昨天/u.test(query)) return { from: addDays(startOfDay, -1).toISOString(), to: startOfDay.toISOString() };
  if (/今天|今日/u.test(query)) return { from: startOfDay.toISOString(), to: addDays(startOfDay, 1).toISOString() };
  if (/过去一年|最近一年|近一年/u.test(query)) {
    const from = new Date(now);
    from.setFullYear(from.getFullYear() - 1);
    return { from: from.toISOString(), to: now.toISOString() };
  }
  return undefined;
}

export function matchesTimeWindow(createdAt: string | undefined, query: string): boolean {
  const window = timeWindow(query);
  return !window || Boolean(createdAt && createdAt >= window.from && createdAt < window.to);
}

export function overlapsFactTimeWindow(validFrom: string, validTo: string | null, query: string): boolean {
  const window = timeWindow(query);
  return !window || (validFrom < window.to && (validTo === null || validTo > window.from));
}

export function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s，。！？、,.!?：:；;「」“”"'（）()]/gu, "");
}
