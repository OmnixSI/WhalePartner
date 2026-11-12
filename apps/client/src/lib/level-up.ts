/**
 * 聊天页一轮结束后看一眼好感度有没有跨档（#160）。只在聊天页懒加载，不进首屏；
 * 不碰卡面代码（只用 seen-level，它不 import 任何卡面模块）。
 * 规则见 card-preview/tier/seen-level.ts 的 announceUpgrade。
 */
import { announceUpgrade } from "../card-preview/tier/seen-level";
import { fetchRelationship } from "./relationship";

/** 该提示就返回新等级，否则 null；读不到好感度当作没升（不编数字，也不报错打扰聊天）。 */
export async function checkLevelUp(characterId: string): Promise<number | null> {
  try {
    const snapshot = await fetchRelationship(characterId);
    return announceUpgrade(characterId, snapshot.level);
  } catch {
    return null;
  }
}
