import { useCallback, useEffect, useState } from "react";
import { createChatSession, fetchHistory, fetchSessions, type ChatSession, type HistoryMessage } from "../lib/chat";

export function useChatSessions(characterId: string, showHistory: (messages: HistoryMessage[]) => void) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionId, setSessionId] = useState<string>();

  useEffect(() => {
    const ctrl = new AbortController();
    showHistory([]);
    setSessions([]);
    setSessionId(undefined);
    void (async () => {
      const available = await fetchSessions(characterId, ctrl.signal);
      const key = `whalepartner:session:${characterId}`;
      const remembered = localStorage.getItem(key);
      let active = available.find((session) => session.id === remembered) ?? available[0];
      let nextSessions = available;
      if (!active) {
        active = await createChatSession(characterId);
        nextSessions = [active];
      }
      if (ctrl.signal.aborted) return;
      setSessions(nextSessions);
      setSessionId(active.id);
      localStorage.setItem(key, active.id);
      const history = await fetchHistory(characterId, 200, ctrl.signal, active.id);
      if (!ctrl.signal.aborted) showHistory(history);
    })().catch((error: unknown) => {
      if (!ctrl.signal.aborted) console.warn("读取本地聊天会话失败：", error instanceof Error ? error.message : error);
    });
    return () => ctrl.abort();
  }, [characterId, showHistory]);

  const selectSession = useCallback(async (id: string) => {
    setSessionId(id);
    localStorage.setItem(`whalepartner:session:${characterId}`, id);
    showHistory(await fetchHistory(characterId, 200, undefined, id));
  }, [characterId, showHistory]);

  const startNewSession = useCallback(async () => {
    try {
      const session = await createChatSession(characterId);
      setSessions((previous) => [session, ...previous]);
      setSessionId(session.id);
      localStorage.setItem(`whalepartner:session:${characterId}`, session.id);
      showHistory([]);
    } catch (error) {
      console.warn("新建聊天失败：", error instanceof Error ? error.message : error);
    }
  }, [characterId, showHistory]);

  return { sessions, sessionId, setSessions, setSessionId, selectSession, startNewSession };
}
