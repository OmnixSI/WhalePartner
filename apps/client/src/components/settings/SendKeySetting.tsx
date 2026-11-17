/** 聊天偏好：发送键位（Enter 发送 / Cmd·Ctrl+Enter 发送）与「分条出现」。存 localStorage，即时生效。 */
import { useState } from "react";
import { readPace, readSendKey, writePace, writeSendKey, type SendKey } from "../../lib/chat-prefs";
import { SettingRow } from "./Row";
import { Button } from "../ui/Button";
import { Switch } from "./Switch";
import { m } from "../../i18n";

export function SendKeySetting() {
  const [sendKey, setSendKey] = useState<SendKey>(readSendKey);
  const [pace, setPace] = useState(readPace);

  const chooseKey = (value: SendKey) => {
    setSendKey(value);
    writeSendKey(value);
  };
  const choosePace = (on: boolean) => {
    setPace(on);
    writePace(on);
  };

  return (
    <>
      <SettingRow
        title={m.settings.sendKey.title}
        desc={sendKey === "enter" ? m.settings.sendKey.descEnter : m.settings.sendKey.descMod}
        stacked
      >
        <div className="set-actions set-actions--start" role="radiogroup" aria-label={m.settings.sendKey.title}>
          <Button role="radio" aria-checked={sendKey === "enter"} variant={sendKey === "enter" ? "primary" : "secondary"} onClick={() => chooseKey("enter")}>
            {m.settings.sendKey.enter}
          </Button>
          <Button role="radio" aria-checked={sendKey === "mod-enter"} variant={sendKey === "mod-enter" ? "primary" : "secondary"} onClick={() => chooseKey("mod-enter")}>
            {m.settings.sendKey.modEnter}
          </Button>
        </div>
      </SettingRow>
      <SettingRow title={m.settings.sendKey.paceTitle} desc={m.settings.sendKey.paceDesc} onActivate={() => choosePace(!pace)}>
        <Switch label={m.settings.sendKey.paceTitle} checked={pace} onChange={choosePace} />
      </SettingRow>
    </>
  );
}
