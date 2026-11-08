import type { CharacterId } from "../persona/persona.ts";

interface ClientPresence {
  character: CharacterId;
  visible: boolean;
  busy: boolean;
  voicePlaying: boolean;
  lastSeen: number;
  lastActivity: number;
}

export interface PresenceState {
  otherCharacter: boolean;
  busy: boolean;
  voicePlaying: boolean;
  lastActivity: number;
}

const PRESENCE_TTL_MS = 45_000;

export class PresenceRegistry {
  readonly #clients = new Map<string, ClientPresence>();

  update(input: { clientId: string; character: CharacterId; visible: boolean; active: boolean; busy: boolean; voicePlaying: boolean }, now = Date.now()) {
    const current = this.#clients.get(input.clientId);
    this.#clients.set(input.clientId, {
      character: input.character,
      visible: input.visible,
      busy: input.busy,
      voicePlaying: input.voicePlaying,
      lastSeen: now,
      lastActivity: input.active ? now : current?.lastActivity ?? 0,
    });
  }

  state(now = Date.now()): PresenceState {
    const active: ClientPresence[] = [];
    for (const [clientId, client] of this.#clients) {
      if (now - client.lastSeen > PRESENCE_TTL_MS) this.#clients.delete(clientId);
      else if (client.visible) active.push(client);
    }
    let lastActivity = 0;
    for (const client of this.#clients.values()) lastActivity = Math.max(lastActivity, client.lastActivity);
    return {
      otherCharacter: active.some((client) => client.character !== "deepseek"),
      busy: active.some((client) => client.busy),
      voicePlaying: active.some((client) => client.voicePlaying),
      lastActivity,
    };
  }
}
