/**
 * 「换一位」对话框（规范 §7.4.3-1）：4 张角色卡，选中立即换（`setCharacter`），
 * 关闭后小角的她挥个手。每个人格使用一个固定默认形象，不提供跨角色的模型选择。
 */
import { Dialog } from "radix-ui";
import { useEffect, useId, useRef } from "react";
import { CHARACTERS, setCharacter, useCharacter } from "../../characters";
import { CARD_CHARACTERS, RELATIONSHIP_SAMPLES } from "../../card-preview/data";
import { CardShowcase } from "../../card-preview/CardShowcase";
import { setCompanionMood } from "../CompanionCorner";
import { CharacterMark } from "../CharacterMark";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CharacterDialog({ open, onOpenChange }: Props) {
  const character = useCharacter();
  const cardCharacter = CARD_CHARACTERS.find((item) => item.id === character.id) ?? CARD_CHARACTERS[0];
  const characterIndex = CHARACTERS.findIndex((item) => item.id === character.id);
  const titleId = useId();
  const descId = useId();
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

  return (
    <Dialog.Root open={open} onOpenChange={close}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="set-dialog set-dialog--wide" aria-labelledby={titleId} aria-describedby={descId}>
          <Dialog.Title className="set-dialog__title" id={titleId}>
            换一位
          </Dialog.Title>
          <Dialog.Description className="set-dialog__body" id={descId}>
            每个人格有自己的口吻；聊天、记忆、日记和见闻共用。选好角色卡就会切换人格，不用保存。
          </Dialog.Description>

          <CardShowcase
            character={cardCharacter}
            index={characterIndex}
            sample={RELATIONSHIP_SAMPLES[0]}
            showProgress={false}
          />

          <ul className="set-chars">
            {CHARACTERS.map((item) => {
              const selected = item.id === character.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className="set-char"
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
                    {selected && <span className="set-char__stamp">已选</span>}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="set-dialog__actions">
            <Dialog.Close className="btn btn--secondary">好</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
