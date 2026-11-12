/**
 * 「上次看到的等级」（#160）：每个角色一条，存在客户端 localStorage，键名 `wp.cardSeenLevel.<角色 id>`，值是 1–5 的整数。
 * 好感度卡组件自己不读写存储；接入方用 planUpgrade 判断这一次要不要播升级动画。
 *
 * - 没有记录（首次安装、清过存储、值不合法）：当作刚看到当前等级，只记下，不播。
 * - 记录 < 当前：播 记录→当前；播完（或跳过）后把记录改成当前。
 * - 记录 ≥ 当前（含后端数据被重置、等级变低）：只把记录对齐到当前，不播。
 * - localStorage 不可用（隐私模式等）：退到内存里记，同一次打开页面内也不会重播。
 *   只写失败（setItem 抛错、getItem 正常）时同样：读这个角色就用内存值，不读 storage 里更旧的值。
 */
// 不 import ./tiers：这个文件要能被 node --test 直接加载（项目里没开 .ts 扩展名导入）
const clampLevel = (level: number) => (Number.isFinite(level) ? Math.min(5, Math.max(1, Math.floor(level))) : 1);

export const SEEN_KEY_PREFIX = "wp.cardSeenLevel.";
export const seenKey = (characterId: string) => `${SEEN_KEY_PREFIX}${characterId}`;
/** 聊天页「升档提示」已经提示过的等级：同一档只提示一次。提示不改「上次看到的等级」。 */
export const NOTIFIED_KEY_PREFIX = "wp.cardToastLevel.";
export const notifiedKey = (characterId: string) => `${NOTIFIED_KEY_PREFIX}${characterId}`;

type Store = Pick<Storage, "getItem" | "setItem">;

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

/**
 * 一组「每个角色一个等级」的本地记录。写 storage 失败时把值留在内存，并记下是哪个键失败了：
 * 读这个键就用内存里的值（storage 里可能还躺着更旧的值，不能读它）；之后写成功了再清掉标记。
 */
function createRecord(keyOf: (characterId: string) => string) {
  const memory = new Map<string, number>();
  const unsaved = new Set<string>();
  return {
    read(characterId: string, store: Store | null): number | null {
      if (unsaved.has(characterId)) return memory.get(characterId) ?? null;
      try {
        return store ? parse(store.getItem(keyOf(characterId))) : null;
      } catch {
        return null;
      }
    },
    write(characterId: string, level: number, store: Store | null): void {
      const value = clampLevel(level);
      try {
        if (!store) throw new Error("no storage");
        store.setItem(keyOf(characterId), String(value));
        memory.delete(characterId);
        unsaved.delete(characterId);
      } catch {
        memory.set(characterId, value);
        unsaved.add(characterId);
      }
    },
    reset(): void {
      memory.clear();
      unsaved.clear();
    },
  };
}

const seen = createRecord(seenKey);
const notified = createRecord(notifiedKey);

export const readSeenLevel = (characterId: string, store: Store | null = browserStore()): number | null => seen.read(characterId, store);
export const writeSeenLevel = (characterId: string, level: number, store: Store | null = browserStore()): void => seen.write(characterId, level, store);
export const readNotifiedLevel = (characterId: string, store: Store | null = browserStore()): number | null => notified.read(characterId, store);
export const writeNotifiedLevel = (characterId: string, level: number, store: Store | null = browserStore()): void => notified.write(characterId, level, store);

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

/**
 * 聊天页一轮结束后要不要提示「升档了」：有「上次看到的等级」且低于当前（卡面还没带她看过），
 * 并且这一档还没提示过。没有记录的不提示（第一次只对齐，见 planUpgrade）。
 */
export function shouldAnnounceUpgrade(seenLevel: number | null, notifiedLevel: number | null, current: number): boolean {
  const level = clampLevel(current);
  return seenLevel !== null && seenLevel < level && (notifiedLevel === null || notifiedLevel < level);
}

/** 测试用：清掉内存里的兜底记录。 */
export function resetSeenMemory(): void {
  seen.reset();
  notified.reset();
}
