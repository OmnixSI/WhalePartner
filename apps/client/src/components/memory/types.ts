import type { IconName } from "../ink-icons";
import type { MemoryEntry } from "../../lib/memory";

/**
 * 记忆页的形状（规范 §7.3 / §10.5）。
 *
 * 后端 B4 会给 `seq`（图鉴编号，随角色创建顺序递增、删除不回填）；这条分支的 `/api/memories`
 * 还没有它，所以 `seq` 是可选：`null` / 缺省时不画 `No.`，编号位整块让出去，不塞假数字。
 * `status`（superseded）、`sourceMissing`、`quote`、`sourceId` 同理，取不到就不显示对应的小标签。
 */
export type MemoryEntryP2 = MemoryEntry & {
  seq?: number | null;
  status?: "active" | "superseded" | string | null;
  sourceMissing?: boolean | null;
  sourceId?: string | null;
  quote?: string | null;
};

export type GroupKey = "all" | "about" | "together" | "learned" | "surf" | "now";

export type Group = {
  key: GroupKey;
  label: string;
  icon: IconName;
  /** 胶带色（规范 §7.3.3：按分类固定 a/b/c/d）。 */
  tape: "a" | "b" | "c" | "d";
};

export const GROUPS: readonly Group[] = [
  { key: "all", label: "全部", icon: "shell", tape: "b" },
  { key: "about", label: "关于你", icon: "conch", tape: "a" },
  { key: "together", label: "一起经历的", icon: "shell", tape: "b" },
  { key: "learned", label: "她学到的", icon: "starfish", tape: "c" },
  { key: "surf", label: "她拾到的", icon: "bottle", tape: "d" },
  { key: "now", label: "她的近况", icon: "lighthouse", tape: "c" },
];

const SYMBOL = new Map<GroupKey, Group>(GROUPS.map((group) => [group.key, group]));

export function groupOf(entry: MemoryEntryP2): GroupKey {
  const source = (entry.source ?? "").toLowerCase();
  const sourceId = (entry.sourceId ?? "").toLowerCase();
  if (sourceId.startsWith("surf:") || source === "surf") return "surf";
  if (source === "reflection") return "now";
  if (source === "learned") return "learned";
  if (entry.kind === "fact") return "about";
  if (source === "conversation" || source === "video" || source === "web" || source === "diary") return "together";
  // 老数据没有 source：她记下的经历归「一起经历的」（事实在上一步已经归到「关于你」）。
  return "together";
}

export function groupInfo(key: GroupKey): Group {
  return SYMBOL.get(key) ?? GROUPS[1];
}

/** `No.` + 4 位补零（规范 §7.3.3）；没有 seq 就返回 null，界面整块不画。 */
export function seqLabel(seq: number | null | undefined): string | null {
  if (typeof seq !== "number" || !Number.isFinite(seq) || seq <= 0) return null;
  return String(Math.trunc(seq)).padStart(4, "0");
}

const SOURCE_LABEL: Record<string, string> = {
  conversation: "聊天",
  video: "视频",
  web: "网页",
  diary: "日记",
  learned: "学到的",
  surf: "她自己逛到的",
  reflection: "近况",
};

export function sourceLabel(entry: MemoryEntryP2): string {
  const source = (entry.source ?? "").toLowerCase();
  if (SOURCE_LABEL[source]) return SOURCE_LABEL[source];
  return entry.kind === "fact" ? "聊天" : "一起经历的";
}

const WEEKDAY = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

export function dayLabel(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}月${date.getDate()}日 · ${WEEKDAY[date.getDay()]}`;
}

export function dayShort(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 卡片要显示的字：事实用原话；经历用标题 + 正文（标题可能为空）。 */
export function titleOf(entry: MemoryEntryP2): string {
  const title = entry.title?.trim();
  if (title) return title;
  const first = entry.text.split("\n")[0]?.trim() ?? "";
  return first || "一条记忆";
}

export function bodyOf(entry: MemoryEntryP2): string {
  const title = entry.title?.trim();
  const text = entry.text.trim();
  if (!text) return "";
  if (!title) return text;
  // 后端把标题写在正文第一行时，别重复显示。
  const rest = text.startsWith(title) ? text.slice(title.length).trim() : text;
  return rest || text;
}

/** 「她的近况」是她自己写的小记和会话观察，后端不支持单条删除，所以不给「忘掉这条」。 */
export function canForget(entry: MemoryEntryP2): boolean {
  return groupOf(entry) !== "now";
}

export function isSuperseded(entry: MemoryEntryP2): boolean {
  return entry.status === "superseded";
}

export type OwnFilters = {
  from: Date | null;
  to: Date | null;
  /** all = 都看，current = 现在的，past = 以前的 */
  era: "all" | "current" | "past";
};

export const EMPTY_FILTERS: OwnFilters = { from: null, to: null, era: "all" };

export function filterActive(filters: OwnFilters): boolean {
  return Boolean(filters.from || filters.to || filters.era !== "all");
}
