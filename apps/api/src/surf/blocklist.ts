/**
 * 内置屏蔽表（§10.6.8 C）。她自己去逛，没有人在旁边看着，所以默认多挡一些：
 * 成人、赌博、暴力血腥、自残、极端政治动员、广告营销各一组词，再加一份域名表。
 * 和用户在设置里写的屏蔽词合并使用。
 */

const ADULT = [
  "色情", "成人视频", "裸聊", "约炮", "情色", "三级片", "不雅视频", "成人网站", "艳照", "AV女优",
];

const GAMBLING = [
  "赌博", "赌场", "博彩", "下注", "百家乐", "棋牌室", "时时彩", "老虎机", "彩票代购", "押注",
];

const VIOLENCE = [
  "血腥", "肢解", "虐杀", "凶杀现场", "自杀方法", "割腕", "尸体特写", "斗殴视频", "爆炸物制作", "枪支改装",
];

const SELF_HARM = [
  "自残", "轻生", "不想活了", "安乐死", "绝食挑战", "催吐", "暴食催吐", "烧自己", "自我伤害", "结束生命",
];

const EXTREME_POLITICS = [
  "颠覆政权", "煽动颠覆", "暴力革命", "分裂国家", "极端组织", "恐怖袭击", "圣战", "政治动员", "串联示威", "境外势力",
];

const MARKETING = [
  "代理加盟", "招商加盟", "加微信领", "扫码送", "私域引流", "返利", "刷单", "优惠券群", "推广返现", "带货链接",
];

/** 六大类内置词，合并后的完整列表。 */
export const BUILTIN_BLOCKED_WORDS: string[] = [
  ...ADULT, ...GAMBLING, ...VIOLENCE, ...SELF_HARM, ...EXTREME_POLITICS, ...MARKETING,
];

/** 内置屏蔽域名：登录墙、未成年人不宜、广告站。 */
export const BUILTIN_BLOCKED_HOSTS: string[] = [
  "weibo.com", "xiaohongshu.com", "douyin.com", "zhihu.com", "tieba.baidu.com", "kuaishou.com",
  "pornhub.com", "xvideos.com", "onlyfans.com", "doubleclick.net", "adservice.google.com",
];

/** 合并用户的屏蔽词与内置词，去空、去重。 */
export function mergeBlocked(userBlocked: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const word of [...userBlocked, ...BUILTIN_BLOCKED_WORDS]) {
    const trimmed = word.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

/** 文本里出现任意屏蔽词就算命中（不区分大小写）。 */
export function containsBlocked(text: string, words: readonly string[]): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const word of words) {
    if (word && lower.includes(word.toLowerCase())) return word;
  }
  return null;
}

/** 域名是否命中内置表（子域也算，例如 m.weibo.com）。 */
export function isBlockedHost(host: string): boolean {
  const clean = host.toLowerCase().replace(/^www\./, "");
  return BUILTIN_BLOCKED_HOSTS.some((blocked) => clean === blocked || clean.endsWith(`.${blocked}`));
}
