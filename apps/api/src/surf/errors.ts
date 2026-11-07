/**
 * 失败按类型处理：网络抖动可以再试，限流要冷却，内容不合适就直接换一个，
 * 浏览器没装好就降级成只看视频。分类只看错误对象本身，不依赖具体库。
 */

export type SurfErrorKind =
  | "network" // 超时、连接被重置、DNS：值得再试一次
  | "rate_limit" // 对方明确让我们慢一点：不再试，进入冷却
  | "content" // 打不开的页面、正文太短、登录墙：换下一个，不重试
  | "browser" // 浏览器没装好或起不来：降级
  | "provider" // 模型调用失败
  | "aborted" // 被会话超时或关闭中止
  | "unknown";

export class SurfError extends Error {
  readonly kind: SurfErrorKind;
  readonly status?: number;
  constructor(kind: SurfErrorKind, message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.kind = kind;
    this.status = options.status;
  }
}

const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "EPIPE", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"]);

/** B 站的限流/风控返回码。 */
const RATE_LIMIT_CODES = new Set([-352, -412, -799, -509, -412]);

export function classifyError(error: unknown, signal?: AbortSignal): SurfErrorKind {
  if (error instanceof SurfError) return error.kind;
  if (signal?.aborted) return "aborted";
  const name = error instanceof Error ? error.name : "";
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status: unknown }).status) : Number.NaN;
  if (name === "AbortError" && !message.includes("timeout")) return "aborted";
  if (status === 429 || status === 412 || RATE_LIMIT_CODES.has(status)) return "rate_limit";
  if (/(\b429\b|\b412\b|限流|风控|too many requests|rate.?limit)/i.test(message)) return "rate_limit";
  if (/executable doesn't exist|browsertype\.launch|没有能读网页的浏览器|浏览器.*(没装|不可用|起不来)|chromium/i.test(message)) return "browser";
  if (name === "TimeoutError" || NETWORK_CODES.has(code) || /timeout|timed out|超时|fetch failed|network|socket|econn|net::err|dns/i.test(message)) return "network";
  const httpStatus = Number.isFinite(status) ? status : Number(/(?:返回了|http)\s*([45]\d\d)/i.exec(message)?.[1] ?? Number.NaN);
  if (httpStatus >= 400 && httpStatus < 600) return httpStatus >= 500 ? "network" : "content";
  if (/正文|网页里没有|不会去读|内部网络|有效的网页|只能读|登录|验证码|没有读到/.test(message)) return "content";
  return "unknown";
}

/** 这类错误值得原地再试一次。 */
export const isRetryable = (kind: SurfErrorKind) => kind === "network";

export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** 每次失败后回调，便于记日志。 */
  onRetry?: (error: unknown, attempt: number, waitMs: number) => void;
}

export const sleepAbortable = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new SurfError("aborted", "已中止"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new SurfError("aborted", "已中止"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** 指数退避重试：只重试 network 类；其余类型第一次失败就抛。 */
export async function withRetry<T>(run: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 2);
  const base = options.baseMs ?? 800;
  const max = options.maxMs ?? 8000;
  const sleep = options.sleep ?? sleepAbortable;
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run(attempt);
    } catch (error) {
      last = error;
      const kind = classifyError(error, options.signal);
      if (!isRetryable(kind) || attempt === attempts) throw error;
      const wait = Math.min(max, base * 2 ** (attempt - 1));
      options.onRetry?.(error, attempt, wait);
      await sleep(wait, options.signal);
    }
  }
  throw last;
}

/**
 * 让一个不认识 AbortSignal 的 Promise 也能被会话取消：取消时立刻抛出，
 * 原来的操作在后台自己收尾（它的结果会被丢掉）。
 */
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    promise.catch(() => undefined);
    return Promise.reject(signal.reason ?? new SurfError("aborted", "已中止"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new SurfError("aborted", "已中止"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
