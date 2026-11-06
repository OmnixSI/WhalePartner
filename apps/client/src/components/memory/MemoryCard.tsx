/**
 * MemoryCard（规范 §7.3.3）：一枚贝壳 / 一张纸条，整张可点，打开详情。
 *
 * - `<li><button>`：整卡是按钮，键盘 Enter/Space 与鼠标一致；焦点环走全站 `--focus-ring`。
 * - 顶：胶带（按分类固定色）+ `No.0042`（`--font-num` 13px `--ink-mute`）+ 分类图标。
 * - 中：标题（文楷 18/1.5，2 行）+ 正文（16/1.7，3 行，`--ink-soft`）。
 * - 底：日期 + 来源类型。
 * - 外形：`.sheet`；上缘 8 个锯齿用 `clip-path`；角度 = `hash(id)%5 - 2` × 0.5°（老人 / calm 归零）。
 * - 历史记忆不靠降低不透明度，而是换 `--paper-2` 底 + 13px「以前的记忆」标签。
 * - 编号缺失（后端还没给 seq）时整块不显示，卡片其余照常。
 */
import { Tape } from "../ink";
import { Icon } from "../ink-icons";
import { hashSeed } from "../../lib/ink";
import { useInkEnv } from "../ink/useCalm";
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
  /** 「忘掉」确认后：480ms 折成纸团落下去（CSS 负责动作，行内旋转要先让开）。 */
  forgetting?: boolean;
};

export function MemoryCard({ entry, onOpen, forgetting = false }: Props) {
  const env = useInkEnv();
  const group = groupInfo(groupOf(entry));
  const seq = seqLabel(entry.seq);
  const angle = env.calm || env.elder ? 0 : ((hashSeed(entry.id) % 5) - 2) * 0.5;
  const superseded = isSuperseded(entry);
  const title = titleOf(entry);
  const body = bodyOf(entry);
  const date = dayShort(entry.createdAt);

  return (
    <li className="mcard">
      <button
        type="button"
        className="mcard__btn"
        onClick={() => onOpen(entry)}
        data-superseded={superseded || undefined}
        data-forgetting={forgetting || undefined}
        style={forgetting ? undefined : { transform: `rotate(${angle}deg)` }}
        aria-label={`${seq ? `No.${seq}，` : ""}${group.label}：${title}`}
      >
        <Tape color={group.tape} w={64} h={18} angle={env.calm ? 0 : -3} className="mcard__tape" />
        <span className="mcard__top">
          {seq && <span className="mcard__seq">No.{seq}</span>}
          <span className="mcard__icon" aria-hidden>
            <Icon name={group.icon} size={24} />
          </span>
        </span>

        {superseded && <span className="mcard__old">以前的记忆</span>}

        <span className="mcard__title">{title}</span>
        {body && body !== title && <span className="mcard__text">{body}</span>}

        <span className="mcard__foot">
          {date && <span className="mcard__date">{date}</span>}
          <span className="mcard__source">{sourceLabel(entry)}</span>
        </span>

        {entry.sourceMissing && <span className="mcard__missing">原话已不在了</span>}
      </button>
    </li>
  );
}
