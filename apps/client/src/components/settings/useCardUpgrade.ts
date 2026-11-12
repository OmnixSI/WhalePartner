/**
 * 把真实等级接到卡面的升级动画上（#160）。
 *
 * 给它角色和当前等级（读到之前传 null），返回传给 LazyAffinityCard 的 upgradeFrom / onUpgradeEnd：
 * 「上次看到的等级」低于当前就播 上次→当前，播完或跳过后记成当前；没记录就直接记当前、不播。
 * 记录规则和键名见 card-preview/tier/seen-level.ts。upgradeFrom 在渲染时就算出来，
 * 所以等级变高的那一帧卡面直接从旧档开始播，不会先闪一下新卡面。
 */
import { useCallback, useEffect, useState } from "react";
import { planUpgrade, readSeenLevel, writeSeenLevel } from "../../card-preview/tier/seen-level";

export function useCardUpgrade(characterId: string, level: number | null) {
  const [, bump] = useState(0);
  const plan = level === null ? null : planUpgrade(readSeenLevel(characterId), level);

  // 首次看到 / 记录比当前高：对齐到当前等级（幂等，StrictMode 重复执行没有影响）
  const record = plan?.record ?? null;
  useEffect(() => {
    if (record !== null) writeSeenLevel(characterId, record);
  }, [characterId, record]);

  const onUpgradeEnd = useCallback(({ to }: { to: number }) => {
    writeSeenLevel(characterId, to);
    bump((n) => n + 1);
  }, [characterId]);

  return { upgradeFrom: plan?.from, onUpgradeEnd };
}
