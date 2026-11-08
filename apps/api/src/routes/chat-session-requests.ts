interface ActiveRequest {
  abort: AbortController;
  finished: Promise<void>;
  finish: () => void;
}

/** Prevents a session deletion from racing an active response or a new chat request. */
export class ChatSessionRequests {
  readonly #active = new Map<string, Set<ActiveRequest>>();
  readonly #deleting = new Set<string>();
  #clearing = false;

  hasActiveRequests(): boolean {
    for (const requests of this.#active.values()) {
      if (requests.size > 0) return true;
    }
    return false;
  }

  begin(sessionId: string, abort: AbortController): (() => void) | undefined {
    if (this.#clearing || this.#deleting.has(sessionId)) return undefined;
    let requests = this.#active.get(sessionId);
    if (!requests) {
      requests = new Set();
      this.#active.set(sessionId, requests);
    }
    let finish = () => {};
    const request: ActiveRequest = { abort, finished: new Promise<void>((resolve) => { finish = resolve; }), finish: () => finish() };
    requests.add(request);
    return () => {
      requests?.delete(request);
      request.finish();
      if (requests?.size === 0) this.#active.delete(sessionId);
    };
  }

  async lockForDeletion(sessionId: string): Promise<(() => void) | undefined> {
    if (this.#clearing || this.#deleting.has(sessionId)) return undefined;
    this.#deleting.add(sessionId);
    const requests = [...(this.#active.get(sessionId) ?? [])];
    for (const request of requests) request.abort.abort();
    await Promise.all(requests.map((request) => request.finished));
    return () => this.#deleting.delete(sessionId);
  }

  async lockForHistoryClear(): Promise<(() => void) | undefined> {
    if (this.#clearing || this.#deleting.size > 0) return undefined;
    this.#clearing = true;
    const requests = [...this.#active.values()].flatMap((active) => [...active]);
    for (const request of requests) request.abort.abort();
    await Promise.all(requests.map((request) => request.finished));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#clearing = false;
    };
  }
}
