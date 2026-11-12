/**
 * 设置页顶部的「她」概览：角色、好感度等级、当前模型、本月额度，一眼看全。
 *
 * 三个数字各自只从后端读（/api/relationship、/api/setup、/api/quota），读不到就写「暂时看不到」，
 * 不自己编；每一项失败互不影响。
 */
import { useEffect, useState } from "react";
import { API_BASE } from "../../lib/api";
import { getQuota } from "../../lib/quota";
import type { RelationshipProgress } from "../../card-preview/data";
import type { Character } from "../../characters";
import { CharacterMark } from "../CharacterMark";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import type { RelationshipState } from "./useRelationship";

type Load<T> = { phase: "loading" } | { phase: "ok"; value: T } | { phase: "down" };

async function getJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

type SetupLite = { chain: string[]; codex: { model: string } };
const PROVIDER_LABEL: Record<string, string> = { deepseek: "DeepSeek", codex: "Codex" };

function modelText(setup: SetupLite): string {
  const first = setup.chain[0];
  if (!first) return "没有可用的模型";
  const name = PROVIDER_LABEL[first] ?? first;
  return first === "codex" && setup.codex.model ? `${name} · ${setup.codex.model}` : name;
}

function Chip({ label, state, children }: { label: string; state: "loading" | "ok" | "down"; children: string }) {
  return (
    <div className="set-chip" data-state={state}>
      <dt className="set-chip__label">{label}</dt>
      <dd className="set-chip__value">{children}</dd>
    </div>
  );
}

export function HerOverview({ character, relationship: rel, onSwap }: { character: Character; relationship: RelationshipState; onSwap: () => void }) {
  const relationship: Load<RelationshipProgress> = rel.snapshot ? { phase: "ok", value: rel.snapshot } : rel.status === "error" ? { phase: "down" } : { phase: "loading" };
  const [setup, setSetup] = useState<Load<SetupLite>>({ phase: "loading" });
  const [quota, setQuota] = useState<Load<{ remaining: number; total: number }>>({ phase: "loading" });

  useEffect(() => {
    const ctrl = new AbortController();
    getJson<SetupLite>("/api/setup", ctrl.signal)
      .then((value) => {
        if (!Array.isArray(value.chain)) throw new Error("bad setup");
        setSetup({ phase: "ok", value });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setSetup({ phase: "down" });
      });
    getQuota(ctrl.signal).then((value) => {
      if (ctrl.signal.aborted) return;
      setQuota(value && typeof value.remaining === "number" && typeof value.total === "number" ? { phase: "ok", value } : { phase: "down" });
    });
    return () => ctrl.abort();
  }, []);

  const wait = "读取中…";
  const gone = "暂时看不到";

  return (
    <Card variant="raised" padding="lg" className="set-her" aria-label="她的概览">
      <span className="set-her__sticker" aria-hidden="true">
        <CharacterMark />
      </span>
      <div className="set-her__text">
        <p className="set-her__name">{character.name}</p>
        <p className="set-her__tagline">{character.intro}</p>
      </div>
      <Button variant="secondary" className="set-her__swap" onClick={onSwap}>
        换一位
      </Button>
      <dl className="set-chips">
        <Chip label="好感度" state={relationship.phase}>
          {relationship.phase === "ok" ? `Lv.${relationship.value.level} · ${relationship.value.label}` : relationship.phase === "loading" ? wait : gone}
        </Chip>
        <Chip label="当前模型" state={setup.phase}>
          {setup.phase === "ok" ? modelText(setup.value) : setup.phase === "loading" ? wait : gone}
        </Chip>
        <Chip label="本月贝壳" state={quota.phase}>
          {quota.phase === "ok" ? `还剩 ${quota.value.remaining} / ${quota.value.total}` : quota.phase === "loading" ? wait : gone}
        </Chip>
      </dl>
    </Card>
  );
}
