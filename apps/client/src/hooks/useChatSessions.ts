import { useCallback, useEffect, useRef, useState } from "react";
import { createChatSession, deleteChatSession as deleteSessionRequest, fetchHistory, fetchSessions, renameChatSession as renameSessionRequest, type ChatSession, type HistoryMessage } from "../lib/chat";

export function useChatSessions(characterId: string, showHistory: (messages: HistoryMessage[]) => void) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  const historyRequestId = useRef(0);
  const currentCharacterId = useRef(characterId);
  currentCharacterId.current = characterId;

  useEffect(() => {
    const requestId = ++historyRequestId.current;
    const ctrl = new AbortController();
    const isCurrent = () => !ctrl.signal.aborted
      && historyRequestId.current === requestId
      && currentCharacterId.current === characterId;
    showHistory([]);
    setSessions([]);
    setSessionId(undefined);
    void (async () => {
      const available = await fetchSessions(characterId, ctrl.signal);
      if (!isCurrent()) return;
      const key = "whalepartner:session:shared";
      const targetMessageId = Number(localStorage.getItem("whalepartner:open-message:shared")) || undefined;
      const remembered = targetMessageId
        ? localStorage.getItem("whalepartner:open-session:shared")
        : localStorage.getItem(key);
      let active = available.find((session) => session.id === remembered) ?? available[0];
      let nextSessions = available;
      if (!active) {
        active = await createChatSession(characterId);
        nextSessions = [active];
      }
      if (!isCurrent()) return;
      setSessions(nextSessions);
      setSessionId(active.id);
      localStorage.setItem(key, active.id);
      const history = await fetchHistory(characterId, 200, ctrl.signal, active.id, targetMessageId);
      if (isCurrent()) {
        showHistory(history);
        if (targetMessageId) {
          localStorage.removeItem("whalepartner:open-session:shared");
        }
      }
    })().catch((error: unknown) => {
      if (isCurrent()) console.warn("读取本地聊天会话失败：", error instanceof Error ? error.message : error);
    });
    return () => {
      ctrl.abort();
      if (historyRequestId.current === requestId) historyRequestId.current++;
    };
  }, [characterId, showHistory]);

  const selectSession = useCallback(async (id: string) => {
    const requestId = ++historyRequestId.current;
    setSessionId(id);
    localStorage.setItem("whalepartner:session:shared", id);
    const history = await fetchHistory(characterId, 200, undefined, id);
    if (historyRequestId.current === requestId && currentCharacterId.current === characterId) showHistory(history);
  }, [characterId, showHistory]);

  const startNewSession = useCallback(async () => {
    const requestId = ++historyRequestId.current;
    try {
      const session = await createChatSession(characterId);
      if (currentCharacterId.current !== characterId) return;
      setSessions((previous) => [session, ...previous]);
      if (historyRequestId.current !== requestId) return;
      setSessionId(session.id);
      localStorage.setItem("whalepartner:session:shared", session.id);
      showHistory([]);
    } catch (error) {
      console.warn("新建聊天失败：", error instanceof Error ? error.message : error);
    }
  }, [characterId, showHistory]);

  const renameSession = useCallback(async (title: string) => {
    if (!sessionId) return;
    const session = await renameSessionRequest(sessionId, characterId, title);
    setSessions((previous) => previous.map((item) => item.id === session.id ? session : item));
  }, [characterId, sessionId]);

  const deleteSession = useCallback(async (id = sessionId) => {
    if (!id) return;
    const requestId = ++historyRequestId.current;
    await deleteSessionRequest(id, characterId);
    const remaining = sessions.filter((session) => session.id !== id);
    setSessions(remaining);
    if (sessionId !== id) return;
    showHistory([]);
    const next = remaining[0];
    if (!next) {
      setSessionId(undefined);
      localStorage.removeItem("whalepartner:session:shared");
      return;
    }
    setSessionId(next.id);
    localStorage.setItem("whalepartner:session:shared", next.id);
    const history = await fetchHistory(characterId, 200, undefined, next.id);
    if (historyRequestId.current === requestId && currentCharacterId.current === characterId) showHistory(history);
  }, [characterId, sessionId, sessions, showHistory]);

  return { sessions, sessionId, setSessions, setSessionId, selectSession, startNewSession, renameSession, deleteSession };
}
