/**
 * 记忆列表的一行（参照 astryx 的 Table / List 行）：图标块 + 标题与摘要 + 分类 + 来源 + 时间。
 * 整行是一个按钮，点开详情；宽屏五列对齐，窄屏折成两行。
 */
import { Icon } from "../ink-icons";
import { ChevronDown } from "../ui";
import {
  bodyOf,
  dayShort,
  groupInfo,
  groupOf,
  isSuperseded,
  seqLabel,
  sourceLabel,
  titleOf,
  type MemoryEntryP2,
} from "./types";

type Props = {
  entry: MemoryEntryP2;
  onOpen: (entry: MemoryEntryP2) => void;
  /** 「忘掉」确认后：淡出（透明度过渡），撤回时回来。 */
  forgetting?: boolean;
};

export function MemoryRow({ entry, onOpen, forgetting = false }: Props) {
  const group = groupInfo(groupOf(entry));
  const seq = seqLabel(entry.seq);
  const superseded = isSuperseded(entry);
  const title = titleOf(entry);
  const body = bodyOf(entry);
  const date = dayShort(entry.createdAt);

  return (
    <li className="mrow" data-forgetting={forgetting || undefined}>
      <button
        type="button"
        className="mrow__btn ui-press ui-focus"
        data-memory-card
        data-superseded={superseded || undefined}
        onClick={() => onOpen(entry)}
        aria-label={`${seq ? `No.${seq}，` : ""}${group.label}：${title}`}
      >
        <span className="mrow__icon" aria-hidden>
          <Icon name={group.icon} size={22} />
        </span>
        <span className="mrow__main">
          <span className="mrow__title">
            {title}
            {superseded && <span className="pbadge" data-tone="warning">以前的</span>}
            {entry.sourceMissing && <span className="pbadge">原话已不在</span>}
          </span>
          {body && body !== title && <span className="mrow__text">{body}</span>}
        </span>
        <span className="mrow__meta">
          <span className="mrow__cat">
            <span className="pbadge" data-tone="accent">{group.label}</span>
          </span>
          <span className="mrow__src">{sourceLabel(entry)}</span>
          <span className="mrow__date">{seq ? <span className="mrow__seq">No.{seq}</span> : null}{date}</span>
        </span>
        <span className="mrow__chev" aria-hidden>
          <ChevronDown />
        </span>
      </button>
    </li>
  );
}
