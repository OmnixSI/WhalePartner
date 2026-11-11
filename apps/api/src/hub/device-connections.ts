/**
 * 按设备登记已建立的长连接（SSE / WebSocket）。
 *
 * 撤销设备时 `DeviceRegistry` 只是删掉记录，已经连着的流不会自动重新鉴权；
 * 这里让每个长连接在建立时登记「怎么关」，撤销时一次关掉这台设备的全部连接。
 * 用本机 token 或开发便利模式建立的连接没有 deviceId，不登记，也不受撤销影响。
 */
export class DeviceConnections {
  readonly #byDevice = new Map<string, Set<() => void>>();

  /** 登记一个连接，返回注销函数；没有 deviceId 时什么也不做。 */
  add(deviceId: string | undefined, close: () => void): () => void {
    if (!deviceId) return () => {};
    let set = this.#byDevice.get(deviceId);
    if (!set) {
      set = new Set();
      this.#byDevice.set(deviceId, set);
    }
    set.add(close);
    return () => {
      set.delete(close);
      if (set.size === 0 && this.#byDevice.get(deviceId) === set) this.#byDevice.delete(deviceId);
    };
  }

  /** 结束某台设备的全部长连接，返回关掉的连接数。 */
  closeDevice(deviceId: string): number {
    const set = this.#byDevice.get(deviceId);
    this.#byDevice.delete(deviceId);
    if (!set) return 0;
    for (const close of set) {
      try { close(); } catch { /* 连接可能已经自己断开 */ }
    }
    return set.size;
  }

  get size(): number {
    return this.#byDevice.size;
  }
}
