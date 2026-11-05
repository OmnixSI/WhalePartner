export type StoredRole = "user" | "assistant";

export interface StoredMessage {
  id: number;
  role: StoredRole;
  content: string;
  emotion: string | null;
  character: string;
  sessionId: string;
  createdAt: string;
}

export interface ChatSession {
  id: string;
  character: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
}

export interface FactCandidate {
  subject: string;
  predicate: string;
  value: string;
  kind: "fact" | "preference" | "plan" | "relationship";
  evidence: string;
  confidence: number;
  importance: number;
  supersedes: boolean;
}

export interface StoredFact {
  id: number;
  subject: string;
  predicate: string;
  value: string;
  kind: FactCandidate["kind"];
  confidence: number;
  importance: number;
  validFrom: string;
  validTo: string | null;
  status: "active" | "superseded";
  createdAt: string;
  vectorEntryId?: string;
  sources: Array<{ messageId: number; sessionId: string; createdAt: string; quote: string }>;
}

export interface StoredExperience {
  id: number;
  kind: string;
  title: string;
  text: string;
  url?: string;
  sourceId: string;
  sourceSessionId?: string;
  sourceMessageId?: number;
  createdAt: string;
  vectorIndexed: boolean;
  vectorEntryId?: string;
  attempts: number;
  lastError?: string;
}

export interface ArchiveHit {
  message: StoredMessage;
  sessionTitle: string;
  rank: number;
}

export interface MemoryJob {
  id: number;
  sessionId: string;
  character: string;
  userMessageId: number;
  assistantMessageId: number;
  attempts: number;
  factsDone: boolean;
  vectorsDone: boolean;
  summaryDone: boolean;
  legacyDone: boolean;
}
