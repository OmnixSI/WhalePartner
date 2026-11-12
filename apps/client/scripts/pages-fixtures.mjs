/**
 * 记忆页 / 见闻页截图用的示例数据（#156 #157）：形状跟真实接口一致，内容是编的。
 * 只给 pages-shots.mjs 与 ui-check 用，不进应用代码。
 */
export const D = (day, time = "10:00") => `2026-11-${String(day).padStart(2, "0")}T${time}:00+11:00`;

export const MEMORY_ENTRIES = [
  { id: "m01", seq: 42, text: "你下班回家的时候，通常先说一句「我回来了」，再把包放在椅子上。", kind: "fact", source: "conversation", createdAt: D(5), quote: "我回来了——今天地铁人好多。" },
  { id: "m02", seq: 41, text: "你说累的时候，更想有人陪着，而不是被建议。", kind: "fact", source: "conversation", createdAt: D(3), quote: "别跟我讲道理，陪我坐一会儿就行。" },
  { id: "m03", seq: 40, title: "海边捡到的第一块玻璃", text: "海边捡到的第一块玻璃\n你把一个磨圆碎玻璃的短片看了很久，说想起小时候在海边捡过一块绿色的。", kind: "experience", source: "video", createdAt: D(2), url: "https://www.bilibili.com/video/BV1xx411c7mD" },
  { id: "m04", seq: 39, text: "你不太喜欢在晚上做决定，总说「明天早上再看」。", kind: "fact", source: "conversation", createdAt: D(1, "22:30"), quote: "这个明天早上再看吧。" },
  { id: "m05", seq: 38, title: "一起把周末的计划排满了", text: "一起把周末的计划排满了\n周六去菜市场，周日在家煮汤。你说煮汤的时候想放点玉米。", kind: "experience", source: "conversation", createdAt: D(1, "09:12"), url: "/" },
  { id: "m06", seq: 37, title: "她学会了织补", text: "她学会了织补\n看完一篇文章后，她知道怎么用同色毛线补旧毛衣上的小洞，下次你的袖口破了可以帮忙。", kind: "experience", source: "learned", createdAt: D(5, "20:10") },
  { id: "m07", seq: 36, title: "潮间带的一小时", text: "潮间带的一小时\n退潮后的礁石上，小螃蟹和海葵各忙各的。她记下了海葵合起来是在吃东西。", kind: "experience", source: "surf", sourceId: "surf:11", createdAt: D(6, "09:30"), url: "https://www.bilibili.com/video/BV1aa411c7mA" },
  { id: "m08", seq: 35, title: "她从一篇网页里读到的", text: "她从一篇网页里读到的\n深色咖啡豆更苦不是因为咖啡因多，而是烘得更久。", kind: "experience", source: "surf", sourceId: "surf:12", createdAt: D(4, "15:40"), url: "https://example.com/coffee" },
  { id: "m09", seq: 34, text: "今天在窗台上发现一只小螃蟹，她给它起了名字叫「横着走」。", kind: "experience", source: "reflection", createdAt: D(6, "08:00") },
  { id: "m10", seq: 33, title: "你写日记的那天", text: "你写日记的那天\n你说今天过得很普通，但还是想记下来：晚饭后在楼下走了二十分钟。", kind: "experience", source: "diary", createdAt: D(2, "21:45") },
  { id: "m11", seq: 32, text: "你喜欢喝不加糖的热燕麦奶。", kind: "fact", source: "conversation", createdAt: D(10 - 9, "08:20"), quote: "不加糖，谢谢。", sourceMissing: true },
  { id: "m12", seq: 31, text: "你以前说周五晚上要加班，后来换了组，现在周五可以早点走。", kind: "fact", source: "conversation", createdAt: D(1, "18:00"), status: "superseded" },
  { id: "m13", seq: 30, title: "一部讲灯塔的短片", text: "一部讲灯塔的短片\n守夜人一天只做三件事：擦灯、看海、记天气。", kind: "experience", source: "video", createdAt: D(4, "10:02"), url: "https://www.bilibili.com/video/BV1yy411c7mE" },
  { id: "m14", seq: 29, text: "你对芒果过敏，吃了会起红点。", kind: "fact", source: "conversation", createdAt: "2026-10-28T12:00:00+11:00", quote: "我吃芒果会过敏。" },
];

export const NOTE = { text: "今天在窗台上发现一只小螃蟹。", updatedAt: D(6, "08:00") };

const T = (id, kind, title, site, url, summary, comment, tags, createdAt, extra = {}) => ({
  id, kind, title, url, sourceSite: site, thumb: kind === "video" || id % 3 === 0 ? `t${id}` : null, thumbError: null,
  summary, comment, tags, createdAt, sharedAt: null, ...extra,
});

export const SURF_ITEMS = [
  T(21, "video", "潮间带的一小时：退潮后礁石上的小世界", "bilibili", "https://www.bilibili.com/video/BV1aa411c7mA", "退潮后的礁石上，小螃蟹和海葵各忙各的，拍摄者蹲了一个小时没有动。", "原来海葵合起来是在吃东西，我以前以为它是睡着了。", ["海洋", "纪录片"], D(6, "09:30")),
  T(20, "web", "怎么给旧毛衣补一个小洞", "example.com", "https://example.com/darning", "用织补蘑菇和同色毛线，一针一针把洞织回去，关键是先固定好四周。", "下次你的袖口破了，我知道怎么办了。", ["手作"], D(6, "08:10"), { sharedAt: D(6, "08:15") }),
  T(19, "video", "灯塔守夜人的一天", "bilibili", "https://www.bilibili.com/video/BV1yy411c7mE", "守夜人一天只做三件事：擦灯、看海、记天气。", "「安静不是没有声音，是知道声音从哪来」——这句我想了很久。", ["灯塔", "生活"], D(5, "21:00")),
  T(18, "web", "为什么深烘咖啡豆更苦", "example.com", "https://example.com/coffee", "苦味主要来自烘焙时间而不是咖啡因含量，深烘豆里的咖啡因反而略少。", "你早上总喝的那杯，可能比你想的更温柔。", ["咖啡", "科普"], D(5, "14:20")),
  T(17, "video", "把碎玻璃磨成小石头", "bilibili", "https://www.bilibili.com/video/BV1xx411c7mD", "一个把碎玻璃磨成小石头的短片，慢慢滚圆，最后像海边的海玻璃。", "我想起你上次说的那句「有些事只是需要时间」。", ["手作"], D(4, "19:45")),
  T(16, "web", "挑一把适合新手的小刀：雕刻入门指南", "zhihu.com", "https://zhuanlan.zhihu.com/p/1", "从刃口角度、握法到木料选择，新手先用椴木练习。", null, ["手作", "木工"], D(4, "11:05")),
  T(15, "video", "夜晚的港口，货轮慢慢靠岸", "bilibili", "https://www.bilibili.com/video/BV1bb411c7mG", "一小时的延时摄影：货轮、拖船和起重机的灯光在水面上拉出长线。", "看着看着，我也想去港口坐一会儿。", ["海洋"], D(3, "22:10")),
  T(14, "web", "云的十种形状和它们预报的天气", "wikipedia.org", "https://zh.wikipedia.org/wiki/云", "卷云、积云、层云……不同云型对应的降雨概率与高度。", "明天你出门前看一眼天，说不定能自己判断要不要带伞。", ["天气", "科普"], D(3, "09:30")),
  T(13, "video", "老式胶片相机是怎么上卷的", "bilibili", "https://www.bilibili.com/video/BV1cc411c7mH", "手把手演示 135 胶卷的装卷、过片与退卷。", "这个声音好治愈，咔嗒、咔嗒。", ["摄影"], D(2, "16:00")),
];
export const SURF_SOURCES = [{ site: "bilibili", count: 5 }, { site: "example.com", count: 2 }, { site: "zhihu.com", count: 1 }, { site: "wikipedia.org", count: 1 }];

/** 假封面：每个 id 一张渐变以外的纯色海景小插画（SVG）。 */
export function thumbSvg(id) {
  const hues = [[212, 55], [188, 50], [24, 60], [160, 40], [270, 38], [340, 45]];
  const [h, s] = hues[id % hues.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="hsl(${h} ${s}% 30%)"/><rect y="104" width="320" height="76" fill="hsl(${h} ${s}% 22%)"/><circle cx="${70 + (id * 37) % 180}" cy="62" r="24" fill="hsl(${(h + 30) % 360} 70% 72%)"/><path d="M0 116 Q40 104 80 116 T160 116 T240 116 T320 116" stroke="hsl(${h} ${s}% 60%)" stroke-width="3" fill="none"/></svg>`;
}

export function surfFeed(items = SURF_ITEMS) {
  return { items, total: items.length, page: 1, pageSize: 20, sources: items.length ? SURF_SOURCES : [] };
}
