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

export type Store = Pick<Storage, "getItem" | "setItem"> & Partial<Pick<Storage, "removeItem">>;

export function browserStore(): Store | null {
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
export function createRecord(keyOf: (characterId: string) => string) {
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
    /** 删掉这条记录（没有 removeItem 的 storage 视为删除失败，退回内存里记「没有」）。 */
    clear(characterId: string, store: Store | null): void {
      memory.delete(characterId);
      try {
        if (!store?.removeItem) throw new Error("no storage");
        store.removeItem(keyOf(characterId));
        unsaved.delete(characterId);
      } catch {
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

/**
 * 聊天页一轮结束、读到当前等级后调用：该提示就返回要提示的等级（并记下「这一档已提示」），否则返回 null。
 * 不改「上次看到的等级」——卡面动画仍在设置页播；唯一的例外是第一次（没有记录），和 planUpgrade 一样只对齐不提示。
 */
export function announceUpgrade(characterId: string, current: number, store: Store | null = browserStore()): number | null {
  const level = clampLevel(current);
  const seenLevel = seen.read(characterId, store);
  if (seenLevel === null) {
    seen.write(characterId, level, store);
    return null;
  }
  if (!shouldAnnounceUpgrade(seenLevel, notified.read(characterId, store), level)) return null;
  notified.write(characterId, level, store);
  return level;
}

// ---------------------------------------------------------------------------

/**
 * 「显示档位」：解锁了高档以后，可以切回低档看看低档卡面。每个角色一条，存在客户端 localStorage，
 * 键名 `wp.cardViewLevel.<角色 id>`，值是 1–5 的整数；没有这条记录就跟着真实等级显示最高档。
 *
 * - 只改显示：真实等级、好感度和「上次看到的等级」（seen-level）都不读不写。
 * - 只能选 1…真实等级；选真实等级本身等于「跟着真实等级」，删掉记录。
 * - 记录比真实等级高（后端数据重置、等级变低）时按真实等级显示，记录不动。
 * - 真的升档、要播升级动画时，接入方调 clearViewLevel 回到最高档，让新卡面播出来。
 * - 存本地而不是后端：这是单台设备上的看卡偏好，和「上次看到的等级」放在一起，不用加接口和迁移。
 */
export const VIEW_KEY_PREFIX = "wp.cardViewLevel.";
export const viewKey = (characterId: string) => `${VIEW_KEY_PREFIX}${characterId}`;

/** 已解锁、可以切过去看的档位：1…真实等级。 */
export function unlockedLevels(real: number): number[] {
  return Array.from({ length: clampLevel(real) }, (_, i) => i + 1);
}

/** 这一档能不能看：1…真实等级之间的整数。 */
export function canView(real: number, want: number): boolean {
  return Number.isInteger(want) && want >= 1 && want <= clampLevel(real);
}

/** 实际显示哪一档：有记录且已解锁就用记录，否则真实等级。 */
export function resolveViewLevel(real: number, chosen: number | null): number {
  return chosen !== null && canView(real, chosen) ? chosen : clampLevel(real);
}

const view = createRecord(viewKey);

export const readViewLevel = (characterId: string, store: Store | null = browserStore()): number | null => view.read(characterId, store);

/** 选一档来看。没解锁返回 false、什么都不写；选真实等级就删掉记录（之后跟着真实等级）。 */
export function chooseViewLevel(characterId: string, real: number, want: number, store: Store | null = browserStore()): boolean {
  if (!canView(real, want)) return false;
  if (want === clampLevel(real)) view.clear(characterId, store);
  else view.write(characterId, want, store);
  return true;
}

export const clearViewLevel = (characterId: string, store: Store | null = browserStore()): void => view.clear(characterId, store);

/** 测试用：清掉内存里的兜底记录（模拟重启）。 */
export const resetViewMemory = (): void => view.reset();

/** 测试用：清掉内存里的兜底记录。 */
export function resetSeenMemory(): void {
  seen.reset();
  notified.reset();
}
