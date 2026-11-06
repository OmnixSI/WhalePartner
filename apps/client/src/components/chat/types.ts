/** 聊天页的数据形状（P1）。只描述界面需要的字段，不碰后端契约。 */
export type TurnRole = "me" | "her";

export type TurnStatus = "sending" | "sent" | "thinking" | "streaming" | "done" | "failed";

export interface Turn {
  key: string;
  role: TurnRole;
  text: string;
  /** ISO 时间，用于「往回翻」的日期分隔与时间戳。 */
  at: string;
  status: TurnStatus;
  /** recall 事件带来的「想起来的事」，只在往回翻里做脚注。 */
  recalled?: string[];
}

/** 视频 / 网页进度的口语版（§7.1.5）。原始 message 只放 title。 */
export interface Progress {
  kind: "video" | "web";
  stage: "reading" | "watching" | "thinking" | "summarizing" | "failed";
  message: string;
  title?: string;
}

export type DialogState = "blank" | "idle" | "loading" | "thinking" | "streaming" | "done" | "failed" | "offline";
