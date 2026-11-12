/**
 * 「换一位」对话框（规范 §7.4.3-1）：4 张角色卡，选中立即换（`setCharacter`），
 * 关闭后小角的她挥个手。每个人格使用一个固定默认形象，不提供跨角色的模型选择。
 *
 * 上面是当前角色的好感度卡（真实等级，升档时播升级动画，#160）；下面四位角色用静态缩略卡，各显示自己的等级。
 */
import { Suspense, useEffect, useRef } from "react";
import { CHARACTERS, setCharacter, useCharacter, type CharacterId } from "../../characters";
import { CARD_CHARACTERS } from "../../card-preview/data";
import { LazyAffinityCard, clampLevel, tierOf } from "../../card-preview/tier";
import { setCompanionMood } from "../CompanionCorner";
import { CharacterMark } from "../CharacterMark";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { AffinityShowcase } from "./AffinityShowcase";
import { useRelationship, type RelationshipState } from "./useRelationship";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  relationship: RelationshipState;
};

/** 角色列表里的缩略卡（sm，静态）：显示这位角色自己的真实等级；读到之前、读不到时仍是徽记。 */
function CharThumb({ id }: { id: CharacterId }) {
  const { snapshot } = useRelationship(id);
  const level = snapshot ? clampLevel(snapshot.level) : null;
  const mark = <CharacterMark character={id} />;
  return (
    <>
      <span className="set-char__thumb" aria-hidden="true">
        {level ? <Suspense fallback={mark}><LazyAffinityCard character={id} level={level} size="sm" /></Suspense> : mark}
      </span>
      {level && <span className="set-char__level">Lv.{level} {tierOf(level).label}</span>}
    </>
  );
}

export function CharacterDialog({ open, onOpenChange, relationship }: Props) {
  const character = useCharacter();
  const cardCharacter = CARD_CHARACTERS.find((item) => item.id === character.id) ?? CARD_CHARACTERS[0];
  const changed = useRef(false);
  const { snapshot, status, retry, refresh } = relationship;

  useEffect(() => {
    if (open) {
      changed.current = false;
      // 每次打开都静默重读一次真实等级：上回之后升档了，卡面从上次看到的那一档接着播上来
      refresh();
    }
  }, [open, refresh]);

  const close = (next: boolean) => {
    if (!next && changed.current) setCompanionMood("wave", { ttl: 2400 });
    onOpenChange(next);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size="lg"
      className="set-dialog--chars"
      title="换一位"
      description="每个人格有自己的口吻；聊天、记忆、日记和见闻共用。选好角色卡就会切换人格，不用保存。"
      footer={<Button variant="secondary" onClick={() => close(false)}>好</Button>}
    >
      <AffinityShowcase character={cardCharacter} snapshot={snapshot} status={status} />
      {status === "error" && (
        <div className="set-dialog__relationship-retry">
          <p>好感度服务暂时没有响应，角色切换仍可正常使用。</p>
          <Button variant="secondary" onClick={retry}>
            重试读取好感度
          </Button>
        </div>
      )}

      <ul className="set-chars">
        {CHARACTERS.map((item) => {
          const selected = item.id === character.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                className="set-char ui-press ui-focus"
                aria-pressed={selected}
                data-selected={selected ? "on" : "off"}
                onClick={() => {
                  if (selected) return;
                  setCharacter(item.id);
                  changed.current = true;
                }}
              >
                <CharThumb id={item.id} />
                <span className="set-char__name">{item.name}</span>
                <span className="set-char__tagline">{item.tagline}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
