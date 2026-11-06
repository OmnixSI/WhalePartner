/**
 * 「换一位」对话框（规范 §7.4.3-1）：4 张角色卡，选中立即换（`setCharacter`），
 * 关闭后小角的她挥个手。形象默认只列这个角色的**推荐形象**，其余收进「更多形象」；
 * 列表里用角色名，原来的模型 label 只作副标。
 */
import { Dialog } from "radix-ui";
import { useEffect, useId, useRef, useState } from "react";
import { AVATAR_MODELS } from "../../avatar/model.config";

/** 有没有真正可渲染的形象文件（main 的 Live2D/VRM 清单里任何一条有 url 就不算占位）。 */
const AVATAR_IS_PLACEHOLDER = AVATAR_MODELS.every((model) => !model.url);
import { CHARACTERS, setCharacter, setModelOverride, useCharacter, useModel } from "../../characters";
import { setCompanionMood } from "../CompanionCorner";
import { WhaleSticker } from "../WhaleSticker";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CharacterDialog({ open, onOpenChange }: Props) {
  const character = useCharacter();
  const model = useModel();
  const titleId = useId();
  const descId = useId();
  const changed = useRef(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (open) {
      changed.current = false;
      setMoreOpen(false);
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
            每个角色有自己的口吻和聊天记录，你记得的事是共用的。选好就换，不用保存。
          </Dialog.Description>

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
                      <WhaleSticker mood={selected ? "happy" : "idle"} />
                    </span>
                    <span className="set-char__name">{item.name}</span>
                    <span className="set-char__tagline">{item.tagline}</span>
                    {selected && <span className="set-char__stamp">已选</span>}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="set-models">
            <p className="set-models__title">{character.name}现在用的形象</p>
            <p className="set-models__current">{model.label}</p>
            {AVATAR_IS_PLACEHOLDER && (
              <p className="set-models__note">现成的演示形象，授权还没核对，只作内部展示。</p>
            )}
            <button
              type="button"
              className="btn btn--quiet set-models__morebtn"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((value) => !value)}
            >
              更多形象 {moreOpen ? "▴" : "▾"}
            </button>
            {moreOpen && (
              <ul className="set-models__list">
                {AVATAR_MODELS.filter((item) => item.id !== character.modelId && item.id !== model.id).map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="set-model"
                      aria-pressed={model.id === item.id}
                      onClick={() => {
                        setModelOverride(item.id);
                        changed.current = true;
                      }}
                    >
                      <span className="set-model__name">{character.name}</span>
                      <span className="set-model__label">{item.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="set-dialog__actions">
            <Dialog.Close className="btn btn--secondary">好</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
