/**
 * 好感度卡对外入口（#159 → #160）。接入方用 LazyAffinityCard，卡面 JS/CSS 只在第一次渲染时下载，不进首屏；
 * tiers 是纯数据，可以直接 import。
 */
import { lazy } from "react";

export const LazyAffinityCard = lazy(() => import("./AffinityCard"));
export type { AffinityCardProps, UpgradeEnd } from "./AffinityCard";
export { CARD_TIERS, clampLevel, tierFeatures, tierOf, upgradeSteps, type CardLevel, type CardTier } from "./tiers";
