/**
 * 「换一位」对话框（规范 §7.4.3-1）：4 张角色卡，选中立即换（`setCharacter`），
 * 关闭后小角的她挥个手。每个人格使用一个固定默认形象，不提供跨角色的模型选择。
 */
import { Dialog } from "radix-ui";
import { useEffect, useId, useRef, useState } from "react";
import { CHARACTERS, setCharacter, useCharacter } from "../../characters";
import { API_BASE } from "../../lib/api";
import { CARD_CHARACTERS, RELATIONSHIP_SAMPLES, type RelationshipProgress } from "../../card-preview/data";
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
  const titleId = useId();
  const descId = useId();
  const changed = useRef(false);
  const [relationship, setRelationship] = useState<{ characterId: string; snapshot: RelationshipProgress } | null>(null);
  const [relationshipStatus, setRelationshipStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (open) {
      changed.current = false;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setRelationship(null);
    setRelationshipStatus("loading");
    void fetch(`${API_BASE}/api/relationship?character=${encodeURIComponent(character.id)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json() as RelationshipProgress;
      })
      .then((snapshot) => {
        if (!Number.isFinite(snapshot.points) || !Number.isInteger(snapshot.level)) throw new Error("Invalid relationship snapshot");
        setRelationship({ characterId: character.id, snapshot });
        setRelationshipStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setRelationshipStatus("error");
      });
    return () => controller.abort();
  }, [character.id, open, retryCount]);

  const close = (next: boolean) => {
    if (!next && changed.current) setCompanionMood("wave", { ttl: 2400 });
    onOpenChange(next);
  };
  const activeRelationship = relationship?.characterId === character.id ? relationship.snapshot : null;
  const sample = RELATIONSHIP_SAMPLES.find((item) => item.level === activeRelationship?.level) ?? RELATIONSHIP_SAMPLES[0];
  const cardRelationshipStatus = activeRelationship ? undefined : relationshipStatus === "error" ? "error" : "loading";

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
            sample={sample}
            showProgress={activeRelationship !== null}
            relationship={activeRelationship}
            relationshipStatus={cardRelationshipStatus}
          />
          {relationshipStatus === "error" && (
            <div className="set-dialog__relationship-retry">
              <p>好感度服务暂时没有响应，角色切换仍可正常使用。</p>
              <button type="button" className="btn btn--secondary" onClick={() => setRetryCount((count) => count + 1)}>
                重试读取好感度
              </button>
            </div>
          )}

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
