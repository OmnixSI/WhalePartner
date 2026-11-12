/**
 * 「上次看到的等级」（#160）：每个角色一条，存在客户端 localStorage，键名 `wp.cardSeenLevel.<角色 id>`，值是 1–5 的整数。
 * 好感度卡组件自己不读写存储；接入方用 planUpgrade 判断这一次要不要播升级动画。
 *
 * - 没有记录（首次安装、清过存储、值不合法）：当作刚看到当前等级，只记下，不播。
 * - 记录 < 当前：播 记录→当前；播完（或跳过）后把记录改成当前。
 * - 记录 ≥ 当前（含后端数据被重置、等级变低）：只把记录对齐到当前，不播。
 * - localStorage 不可用（隐私模式等）：退到内存里记，同一次打开页面内也不会重播。
 */
// 不 import ./tiers：这个文件要能被 node --test 直接加载（项目里没开 .ts 扩展名导入）
const clampLevel = (level: number) => (Number.isFinite(level) ? Math.min(5, Math.max(1, Math.floor(level))) : 1);

export const SEEN_KEY_PREFIX = "wp.cardSeenLevel.";
export const seenKey = (characterId: string) => `${SEEN_KEY_PREFIX}${characterId}`;

type Store = Pick<Storage, "getItem" | "setItem">;
const memory = new Map<string, number>();

function browserStore(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function parse(raw: string | null): number | null {
  if (raw === null || !/^[1-5]$/.test(raw)) return null;
  return Number(raw);
}

export function readSeenLevel(characterId: string, store: Store | null = browserStore()): number | null {
  try {
    const stored = store ? parse(store.getItem(seenKey(characterId))) : null;
    if (stored !== null) return stored;
  } catch { /* 读不了就看内存 */ }
  return memory.get(characterId) ?? null;
}

export function writeSeenLevel(characterId: string, level: number, store: Store | null = browserStore()): void {
  const value = clampLevel(level);
  try {
    if (!store) throw new Error("no storage");
    store.setItem(seenKey(characterId), String(value));
    memory.delete(characterId);
  } catch {
    memory.set(characterId, value);
  }
}

export type UpgradePlan = {
  /** 要播 from→当前 时给 upgradeFrom；不播为 undefined */
  from: number | undefined;
  /** 需要立刻把记录改成当前等级（首次、或记录比当前高）；不需要为 null */
  record: number | null;
};

export function planUpgrade(seen: number | null, current: number): UpgradePlan {
  const level = clampLevel(current);
  if (seen === null || seen > level) return { from: undefined, record: level };
  if (seen === level) return { from: undefined, record: null };
  return { from: seen, record: null };
}

/** 测试用：清掉内存里的兜底记录。 */
export function resetSeenMemory(): void {
  memory.clear();
}
