import type { CharacterId } from "../persona/persona.ts";

/**
 * 每个角色自己的兴趣（§10.6.3-1）。写死在代码里，与 persona/characters/*.md 的设定对齐：
 * 鲸汐住深海里、慢热；大肥鱼好奇爱较真；小克爱书与红茶；小智爱清单和整理。
 * 这里只放 6–8 个中文关键词，作为选题的底子；用户可以在设置里再补。
 */
export const CHARACTER_INTERESTS: Record<CharacterId, string[]> = {
  whale: ["海洋", "鲸歌", "纪录片", "深海生物", "手帐", "治愈系音乐", "星空", "温柔的故事"],
  deepseek: ["冷知识", "编程入门", "猫咪", "效率工具", "科普", "数学趣题", "职场吐槽"],
  claude: ["旧书", "散文", "红茶", "博物馆", "古典音乐", "植物", "写作技巧"],
  chatgpt: ["清单整理", "学习方法", "数码测评", "AI 新闻", "时间管理", "手帐排版", "小实验"],
};

export function interestsOf(character: CharacterId): string[] {
  return CHARACTER_INTERESTS[character] ?? CHARACTER_INTERESTS.whale;
}
