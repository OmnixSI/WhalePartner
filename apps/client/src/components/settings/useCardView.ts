/**
 * 「显示档位」：解锁高档后切回低档看卡面。只改卡面显示的档位，真实等级、好感度、「上次看到的等级」都不动。
 * 选择按角色存在本地（`wp.cardViewLevel.<角色 id>`，规则见 card-preview/tier/seen-level.ts），重启后仍有效。
 *
 * 要播升级动画（upgrading）时按真实等级显示，并删掉选择：升档后先让她看到新卡面，再自己决定要不要切回去。
 */
import { useCallback, useEffect, useState } from "react";
import { chooseViewLevel, clearViewLevel, readViewLevel, resolveViewLevel, unlockedLevels } from "../../card-preview/tier/seen-level";

export function useCardView(characterId: string, level: number | null, upgrading: boolean) {
  const [, bump] = useState(0);

  useEffect(() => {
    if (upgrading) clearViewLevel(characterId);
  }, [characterId, upgrading]);

  const shown = level === null ? null : upgrading ? level : resolveViewLevel(level, readViewLevel(characterId));

  const choose = useCallback((want: number) => {
    if (level !== null && chooseViewLevel(characterId, level, want)) bump((n) => n + 1);
  }, [characterId, level]);

  return { shown, choose, unlocked: level === null ? [] : unlockedLevels(level) };
}
