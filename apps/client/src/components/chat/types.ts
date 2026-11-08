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
  /** 她这句话什么情绪：给脸和名字牌用，正文里不出现标签。 */
  emotion?: import("../../avatar/model.config").AvatarEmotion;
  /** 后端消息 id：多端事件据此去重。 */
  serverId?: number;
  /** 客户端幂等 id（我发的话才有）。 */
  clientId?: string;
  /** 说到一半被打断（保留已生成的部分）。 */
  interrupted?: boolean;
  /** 后端根据用户明确计划延后的主动跟进。 */
  proactive?: boolean;
  /** 别的设备上正在进行的这一轮（流 id）。 */
  streamId?: string;
}

/** 视频 / 网页进度的口语版（§7.1.5）。原始 message 只放 title。 */
export interface Progress {
  kind: "video" | "web";
  stage: "reading" | "watching" | "thinking" | "summarizing" | "failed";
  message: string;
  title?: string;
}

export type DialogState = "blank" | "idle" | "loading" | "thinking" | "streaming" | "done" | "failed" | "offline";
