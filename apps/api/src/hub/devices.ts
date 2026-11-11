/**
 * 设备配对：hub 上存「已配对设备」。只存 token 的 sha256，不存明文。
 * 配对码 6 位、10 分钟有效、一次性；错误尝试限速，防止暴力枚举。
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface DeviceRecord {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface PublicDevice {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
}

export const PAIR_CODE_TTL_MS = 10 * 60_000;
const MAX_FAILED = 8;
const FAIL_WINDOW_MS = 60_000;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export class DeviceRegistry {
  readonly #file: string | undefined;
  #devices: DeviceRecord[] = [];
  readonly #codes = new Map<string, number>();
  #failures: number[] = [];
  readonly #now: () => number;

  /** file 省略时只存内存（测试 / 临时库）。 */
  constructor(file?: string, now: () => number = Date.now) {
    this.#file = file;
    this.#now = now;
    if (file && existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, "utf8")) as { devices?: DeviceRecord[] };
        this.#devices = Array.isArray(parsed.devices) ? parsed.devices : [];
      } catch { this.#devices = []; }
    }
  }

  #save() {
    if (!this.#file) return;
    mkdirSync(dirname(this.#file), { recursive: true });
    const tmp = `${this.#file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ devices: this.#devices }, null, 2), { mode: 0o600 });
    renameSync(tmp, this.#file);
  }

  createPairingCode(): { code: string; expiresAt: string } {
    this.#sweep();
    let code = "";
    do { code = String(randomInt(0, 1_000_000)).padStart(6, "0"); } while (this.#codes.has(code));
    const expires = this.#now() + PAIR_CODE_TTL_MS;
    this.#codes.set(code, expires);
    return { code, expiresAt: new Date(expires).toISOString() };
  }

  #sweep() {
    const now = this.#now();
    for (const [code, expires] of this.#codes) if (expires <= now) this.#codes.delete(code);
    this.#failures = this.#failures.filter((at) => now - at < FAIL_WINDOW_MS);
  }

  /** 兑换：成功返回明文 token（只此一次）。 */
  redeem(code: string, name: string): { ok: true; token: string; device: PublicDevice } | { ok: false; reason: "rate_limited" | "invalid" } {
    this.#sweep();
    if (this.#failures.length >= MAX_FAILED) return { ok: false, reason: "rate_limited" };
    const expires = this.#codes.get(code.trim());
    if (expires === undefined || expires <= this.#now()) {
      this.#failures.push(this.#now());
      return { ok: false, reason: "invalid" };
    }
    this.#codes.delete(code.trim());
    const token = `wpd_${randomBytes(32).toString("base64url")}`;
    const now = new Date(this.#now()).toISOString();
    const record: DeviceRecord = {
      id: randomBytes(6).toString("hex"),
      name: name.trim().slice(0, 40) || "未命名设备",
      tokenHash: sha256(token),
      createdAt: now,
      lastSeenAt: null,
    };
    this.#devices.push(record);
    this.#save();
    return { ok: true, token, device: publicDevice(record) };
  }

  /** 校验设备 token；顺手记录最近使用时间（不频繁落盘）。 */
  verify(token: string): DeviceRecord | undefined {
    if (!token.startsWith("wpd_")) return undefined;
    const hash = Buffer.from(sha256(token));
    const found = this.#devices.find((device) => {
      const other = Buffer.from(device.tokenHash);
      return other.length === hash.length && timingSafeEqual(other, hash);
    });
    if (found) {
      const now = this.#now();
      const last = found.lastSeenAt ? Date.parse(found.lastSeenAt) : 0;
      if (now - last > 5 * 60_000) {
        found.lastSeenAt = new Date(now).toISOString();
        this.#save();
      }
    }
    return found;
  }

  list(): PublicDevice[] { return this.#devices.map(publicDevice); }

  revoke(id: string): boolean {
    const before = this.#devices.length;
    this.#devices = this.#devices.filter((device) => device.id !== id);
    if (this.#devices.length === before) return false;
    this.#save();
    return true;
  }
}

function publicDevice(device: DeviceRecord): PublicDevice {
  return { id: device.id, name: device.name, createdAt: device.createdAt, lastSeenAt: device.lastSeenAt };
}
