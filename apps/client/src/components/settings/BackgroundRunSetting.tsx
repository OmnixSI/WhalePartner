/**
 * 「关掉窗口后让她在后台继续逛」：只在桌面 App 里出现。
 * 状态存在 Tauri 外壳的 app config 目录（get_keep_running / set_keep_running），默认关。
 */
import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { SettingGroup, SettingRow } from "./Row";
import { Switch } from "./Switch";
import { m } from "../../i18n";

export function BackgroundRunSetting() {
  const desktop = isTauri();
  const [on, setOn] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    invoke<boolean>("get_keep_running")
      .then((value) => alive && setOn(value))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [desktop]);

  if (!desktop) return null;

  const change = async (next: boolean) => {
    const before = on;
    setOn(next);
    setFailed(false);
    try {
      await invoke("set_keep_running", { enabled: next });
    } catch {
      setOn(before);
      setFailed(true);
    }
  };

  return (
    <SettingGroup title={m.settings.background.group}>
      <SettingRow
        title={m.settings.background.title}
        desc={
          failed
            ? m.settings.background.failed
            : m.settings.background.desc
        }
        onActivate={on === null ? undefined : () => void change(!on)}
      >
        <Switch label={m.settings.background.title} checked={on === true} disabled={on === null} onChange={(next) => void change(next)} />
      </SettingRow>
    </SettingGroup>
  );
}
