import type { cards as Zh } from "../zh/cards.ts";

export const cards: typeof Zh = {
  tiers: {
    acquainted: "Acquainted",
    familiar: "Familiar",
    inSync: "In sync",
    close: "Close",
    inseparable: "Inseparable",
    finishPaper: "Plain paper",
    finishSilver: "Silver lining",
    finishTide: "Tide glow",
    finishGold: "Gold edge",
    finishFoil: "Foil shimmer",
  },
  samples: {
    basicEffect: "Basic card",
    basicDetail: "Static art and a basic frame",
    depthEffect: "Depth effect",
    depthDetail: "Tilt with layered parallax between character and background",
    liveEffect: "Live visuals",
    liveDetail: "Live2D idle animation and flowing energy light",
    specialEffect: "Signature effects",
    specialDetail: "Floating particles and dynamic lighting",
  },
  relationship: {
    sampleIntro: (level, effect, detail) => `Lv.${level} ${effect}: ${detail}`,
    matchedIntro: (level, effect, detail) => `Lv.${level} ${effect}: ${detail}`,
    notLiveIntro: (level, effect, sampleLevel) => `Lv.${level} ${effect} (not available yet; the card shows Lv.${sampleLevel} for now)`,
    maxUnlocked: (effect) => `Highest level unlocked: ${effect}`,
    nextStage: (n) => `${n} more affinity ${n === 1 ? "point" : "points"} to the next stage`,
  },
  affinityCard: {
    ariaLabel: (name, level, label, finish) => `${name}'s affinity card, Lv.${level} ${label}, ${finish} finish`,
    upgradeNotice: (level, label) => `Reached Lv.${level} · ${label}`,
    skip: "Skip",
    upgradeStatus: (level, label) => `Reached Lv.${level} ${label}`,
  },
};
