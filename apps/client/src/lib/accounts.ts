import { API_BASE } from "./api";

export interface AccountStatus {
  platform: "bilibili";
  name: string;
  connected: boolean;
  valid: boolean | null;
  savedAt: string | null;
}

export type LoginState = "waiting" | "scanned" | "expired" | "success" | "error";

export interface LoginStart {
  key: string;
  url: string;
  expiresInSeconds: number;
}

async function readError(response: Response): Promise<never> {
  let detail = `请求失败（HTTP ${response.status}）`;
  try { detail = ((await response.json()) as { error?: string }).error ?? detail; } catch { /* 非 JSON */ }
  throw new Error(detail);
}

export async function fetchAccounts(signal?: AbortSignal): Promise<AccountStatus[]> {
  const response = await fetch(`${API_BASE}/api/accounts`, { signal });
  if (!response.ok) return readError(response);
  return ((await response.json()) as { accounts: AccountStatus[] }).accounts;
}

export async function startLogin(platform: string): Promise<LoginStart> {
  const response = await fetch(`${API_BASE}/api/accounts/${platform}/login`, { method: "POST" });
  if (!response.ok) return readError(response);
  return (await response.json()) as LoginStart;
}

export async function checkLogin(platform: string, key: string, signal?: AbortSignal): Promise<LoginState> {
  const response = await fetch(`${API_BASE}/api/accounts/${platform}/login?key=${encodeURIComponent(key)}`, { signal });
  if (!response.ok) return readError(response);
  return ((await response.json()) as { status: LoginState }).status;
}

export async function logout(platform: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/accounts/${platform}`, { method: "DELETE" });
  if (!response.ok) return readError(response);
}
