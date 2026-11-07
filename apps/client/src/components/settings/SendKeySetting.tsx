/** 聊天偏好：发送键位（Enter 发送 / Cmd·Ctrl+Enter 发送）与「分条出现」。存 localStorage，即时生效。 */
import { useState } from "react";
import { readPace, readSendKey, writePace, writeSendKey, type SendKey } from "../../lib/chat-prefs";
import { SettingRow } from "./Row";
import { Switch } from "./Switch";

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
        icon="settings"
        title="发送键"
        desc={sendKey === "enter" ? "现在：Enter 发送，Shift + Enter 换行。（触屏设备 Enter 一直是换行。）" : "现在：⌘/Ctrl + Enter 发送，Enter 换行。"}
        stacked
      >
        <div className="set-choices" role="radiogroup" aria-label="发送键">
          <button type="button" role="radio" aria-checked={sendKey === "enter"} className={`btn ${sendKey === "enter" ? "btn--primary" : "btn--secondary"}`} onClick={() => chooseKey("enter")}>
            Enter 发送
          </button>
          <button type="button" role="radio" aria-checked={sendKey === "mod-enter"} className={`btn ${sendKey === "mod-enter" ? "btn--primary" : "btn--secondary"}`} onClick={() => chooseKey("mod-enter")}>
            ⌘/Ctrl + Enter 发送
          </button>
        </div>
      </SettingRow>
      <SettingRow title="一句一句地说" desc="她的回复按句分成一到三条，像在打字一样一条条出现。关掉就一次摆全。" onActivate={() => choosePace(!pace)}>
        <Switch label="一句一句地说" checked={pace} onChange={choosePace} />
      </SettingRow>
    </>
  );
}
