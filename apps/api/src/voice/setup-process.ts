import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** How long a setup process group gets between SIGTERM and SIGKILL. */
const KILL_GRACE_MS = 5_000;

/**
 * Runs voice setup scripts in their own process group.
 *
 * `bash script.sh` alone is not enough: cmake, ninja, curl and pip children keep the pipes open after bash is
 * killed, so `close` never fires and a rebuild waits forever. Killing the group (`process.kill(-pid)`) ends the
 * script and every child with it, on timeout, on rebuild and when the app exits.
 */
export class SetupProcessRunner {
  readonly #active = new Set<ChildProcess>();
  #closed = false;

  /** True while a setup script is running. */
  get running(): boolean {
    return this.#active.size > 0;
  }

  run(scriptPath: string, dataDirectory: string, timeoutMs: number, failureMessage: string): Promise<void> {
    if (!existsSync(scriptPath)) return Promise.reject(new Error("本地语音安装脚本缺失，请重新安装 WhalePartner。"));
    if (this.#closed) return Promise.reject(new Error(`${failureMessage}（语音服务已关闭）。`));
    return new Promise<void>((resolveSetup, rejectSetup) => {
      const child = spawn("bash", [scriptPath], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, WP_DATA_DIR: resolve(dataDirectory) },
        // A detached child leads its own process group, so the whole install tree can be signalled at once.
        detached: true,
      });
      this.#active.add(child);
      let output = "";
      let timedOut = false;
      const saveOutput = (chunk: Buffer) => { output = (output + chunk.toString("utf8")).slice(-4000); };
      child.stdout?.on("data", saveOutput);
      child.stderr?.on("data", saveOutput);
      const timeout = setTimeout(() => {
        timedOut = true;
        killTree(child, "SIGTERM");
        const force = setTimeout(() => killTree(child, "SIGKILL"), KILL_GRACE_MS);
        force.unref();
      }, timeoutMs);
      child.once("error", (error) => {
        clearTimeout(timeout);
        this.#active.delete(child);
        rejectSetup(new Error(`${failureMessage} ${error.message}`));
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        this.#active.delete(child);
        if (code === 0) resolveSetup();
        else rejectSetup(new Error(timedOut ? `${failureMessage}（安装超时）。` : output.trim() || `${failureMessage}（${code ?? "unknown"}）。`));
      });
    });
  }

  /** Ends running setup scripts; used by rebuild, which replaces the directories they write to. */
  kill(): void {
    if (this.#active.size === 0) return;
    const children = [...this.#active];
    for (const child of children) killTree(child, "SIGTERM");
    const force = setTimeout(() => { for (const child of children) killTree(child, "SIGKILL"); }, KILL_GRACE_MS);
    force.unref();
  }

  /** Ends running setup scripts for good with SIGKILL on the whole process group; no grace period. */
  killNow(): void {
    for (const child of this.#active) killTree(child, "SIGKILL");
  }

  /**
   * Stops the runner for good: running scripts are killed and new ones are refused.
   * Closing happens on app exit, where a SIGTERM grace period would outlive the process (the SIGKILL timer is unref'd
   * and shutdown calls process.exit), so the whole group gets SIGKILL straight away.
   */
  close(): void {
    this.#closed = true;
    this.killNow();
  }
}

function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    // The whole group is already gone.
  }
}
