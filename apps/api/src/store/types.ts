export type StoredRole = "user" | "assistant";

export interface StoredMessage {
  id: number;
  role: StoredRole;
  content: string;
  emotion: string | null;
  character: string;
  sessionId: string;
  createdAt: string;
  /** B6.3：随消息附带的材料（她逛到的明信片等）；没有就是 null。 */
  attachment?: unknown | null;
}

export interface ChatSession {
  id: string;
  character: string;
  title: string;
  titleManual?: boolean;
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

export interface SourcedFactCandidate extends FactCandidate {
  sourceMessageId: number;
  supersedesFactIds?: number[];
  planStatus?: "active" | "completed" | "cancelled";
}

export interface MemoryTopicCandidate {
  key: string;
  title: string;
  summary: string;
  sourceMessageIds: number[];
}

export interface MemoryDistillation {
  facts: SourcedFactCandidate[];
  topics: MemoryTopicCandidate[];
  core?: string;
  coreSourceMessageIds: number[];
  observation?: string;
}

export interface StoredMemoryTopic extends MemoryTopicCandidate {
  updatedAt: string;
}

export interface MemoryDistillationContext {
  core?: string;
  coreSourceMessageIds: number[];
  topics: StoredMemoryTopic[];
  facts: StoredFact[];
  activePlanSubjects?: string[];
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
  sources: Array<{ messageId: number; sessionId: string; character: string; createdAt: string; quote: string }>;
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
  sourceMissing?: boolean;
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

export interface MemoryJobBatch {
  jobs: MemoryJob[];
  messages: StoredMessage[];
}
