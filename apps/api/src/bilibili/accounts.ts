import { checkBilibiliLoginQr, isBilibiliSessionValid, loadBilibiliSession, logoutFromBilibili, requestBilibiliLoginQr } from "./session.ts";

export type LoginState = "waiting" | "scanned" | "expired" | "success" | "error";

export interface AccountStatus {
  platform: "bilibili";
  name: string;
  connected: boolean;
  /** 已保存的登录态是否还有效；离线或查询失败时是 null。 */
  valid: boolean | null;
  savedAt: string | null;
}

export interface LoginStart {
  key: string;
  /** 二维码的内容（一条链接），界面自己画成二维码。 */
  url: string;
  expiresInSeconds: number;
}

/** 各平台账号的接入。目前只有 B 站；登录态只存在本机，任何接口都不返回它。 */
export interface AccountService {
  list(): Promise<AccountStatus[]>;
  startLogin(platform: string): Promise<LoginStart>;
  checkLogin(platform: string, key: string): Promise<LoginState>;
  logout(platform: string): Promise<void>;
}

export class AccountError extends Error {}

function assertBilibili(platform: string) {
  if (platform !== "bilibili") throw new AccountError("这个平台还没有接入。");
}

export function createAccountService(): AccountService {
  return {
    async list() {
      const session = await loadBilibiliSession().catch(() => undefined);
      let valid: boolean | null = null;
      if (session) {
        try {
          valid = await isBilibiliSessionValid(session.sessdata);
        } catch {
          valid = null;
        }
      }
      return [{ platform: "bilibili", name: "哔哩哔哩", connected: Boolean(session), valid, savedAt: session?.savedAt || null }];
    },
    async startLogin(platform) {
      assertBilibili(platform);
      const qr = await requestBilibiliLoginQr();
      return { key: qr.qrcodeKey, url: qr.url, expiresInSeconds: qr.expiresInSeconds };
    },
    async checkLogin(platform, key) {
      assertBilibili(platform);
      return checkBilibiliLoginQr(key);
    },
    async logout(platform) {
      assertBilibili(platform);
      await logoutFromBilibili();
    },
  };
}
