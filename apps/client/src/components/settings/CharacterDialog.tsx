/**
 * 「换一位」对话框（规范 §7.4.3-1）：4 张角色卡，选中立即换（`setCharacter`），
 * 关闭后小角的她挥个手。每个人格使用一个固定默认形象，不提供跨角色的模型选择。
 */
import { useEffect, useRef } from "react";
import { CHARACTERS, setCharacter, useCharacter } from "../../characters";
import { CARD_CHARACTERS, RELATIONSHIP_SAMPLES } from "../../card-preview/data";
import { CardShowcase } from "../../card-preview/CardShowcase";
import { setCompanionMood } from "../CompanionCorner";
import { CharacterMark } from "../CharacterMark";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import type { RelationshipState } from "./useRelationship";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  relationship: RelationshipState;
};

export function CharacterDialog({ open, onOpenChange, relationship }: Props) {
  const character = useCharacter();
  const cardCharacter = CARD_CHARACTERS.find((item) => item.id === character.id) ?? CARD_CHARACTERS[0];
  const changed = useRef(false);
  useEffect(() => {
    if (open) {
      changed.current = false;
    }
  }, [open]);

  const close = (next: boolean) => {
    if (!next && changed.current) setCompanionMood("wave", { ttl: 2400 });
    onOpenChange(next);
  };
  const activeRelationship = relationship.snapshot;
  const relationshipStatus = relationship.status;
  const sample = RELATIONSHIP_SAMPLES.find((item) => item.level === activeRelationship?.level) ?? RELATIONSHIP_SAMPLES[0];
  const cardRelationshipStatus = activeRelationship ? undefined : relationshipStatus === "error" ? "error" : "loading";

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
      {/* 角色卡展示区：主程的卡面组件挂在这里，外壳只管尺寸和留白 */}
      <CardShowcase
        character={cardCharacter}
        sample={sample}
        showProgress={activeRelationship !== null}
        relationship={activeRelationship}
        relationshipStatus={cardRelationshipStatus}
      />
      {relationshipStatus === "error" && (
        <div className="set-dialog__relationship-retry">
          <p>好感度服务暂时没有响应，角色切换仍可正常使用。</p>
          <Button variant="secondary" onClick={relationship.retry}>
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
                <span className="set-char__sticker" aria-hidden="true">
                  <CharacterMark character={item.id} />
                </span>
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
