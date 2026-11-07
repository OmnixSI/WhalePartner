/**
 * 「关掉窗口后让她在后台继续逛」：只在桌面 App 里出现。
 * 状态存在 Tauri 外壳的 app config 目录（get_keep_running / set_keep_running），默认关。
 */
import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { SettingGroup, SettingRow } from "./Row";
import { Switch } from "./Switch";

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
    <SettingGroup title="后台">
      <SettingRow
        icon="settings"
        title="关掉窗口后让她在后台继续逛"
        desc={
          failed
            ? "没改成，再试一次。"
            : "打开后，关窗口只是收起来，菜单栏留个图标，她继续上网、用模型额度，要停就点图标选“退出鲸汐”。关着时，关窗口就是退出。"
        }
        onActivate={on === null ? undefined : () => void change(!on)}
      >
        <Switch label="关掉窗口后让她在后台继续逛" checked={on === true} disabled={on === null} onChange={(next) => void change(next)} />
      </SettingRow>
    </SettingGroup>
  );
}
