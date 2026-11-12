import { openChatDatabase } from "./database.ts";
import { ExperienceRepository, type ExperienceInput } from "./experiences.ts";
import { FactRepository } from "./facts.ts";
import { MemoryJobRepository, type MemoryQueueStatus } from "./jobs.ts";
import { MemoryDistillationRepository } from "./memory-distillation.ts";
import { clearAllData, clearChatData, dumpUserTable, type UserDataTable } from "./maintenance.ts";
import { deleteChatSession, type SessionDeletion } from "./session-deletion.ts";
import { listMemoryExplorer, type MemoryExplorerFilters } from "./explorer.ts";
import { journalSourcesForDay } from "./journal-sources.ts";
import { ObservationRepository, type ObservationInput, type StoredObservation } from "./observations.ts";
import { rebuildSearchIndexes } from "./search-index.ts";
import { matchesTimeWindow, overlapsFactTimeWindow } from "./search.ts";
import { SessionRepository } from "./sessions.ts";
import { ProactiveRepository } from "./proactive.ts";
import { RelationshipRepository } from "./relationship.ts";
import type { DatabaseSync } from "node:sqlite";
import type { ArchiveHit, ChatSession, FactCandidate, MemoryDistillation, MemoryDistillationContext, MemoryJob, MemoryJobBatch, StoredExperience, StoredFact, StoredMessage, StoredRole } from "./types.ts";

export type { ArchiveHit, ChatSession, FactCandidate, MemoryDistillation, MemoryDistillationContext, MemoryJob, MemoryJobBatch, StoredExperience, StoredFact, StoredMessage, StoredRole } from "./types.ts";
export type { ExperienceInput } from "./experiences.ts";
export type { MemoryQueueStatus } from "./jobs.ts";
export type { ObservationInput, StoredObservation } from "./observations.ts";
export type { SessionDeletion } from "./session-deletion.ts";
export type { MemoryExplorerFilters, MemoryExplorerItem, MemoryExplorerResult } from "./explorer.ts";
export { matchesTimeWindow, overlapsFactTimeWindow } from "./search.ts";

/** Stable storage API used by the chat service; feature repositories own each data domain. */
export class ChatStore {
  readonly #db: DatabaseSync;
  readonly #sessions: SessionRepository;
  readonly #facts: FactRepository;
  readonly #distillation: MemoryDistillationRepository;
  readonly #experiences: ExperienceRepository;
  readonly #observations: ObservationRepository;
  readonly #jobs: MemoryJobRepository;
  readonly #proactive: ProactiveRepository;
  readonly #relationship: RelationshipRepository;
  #proactiveWake?: (id: string) => void;

  readonly dbPath: string;

  constructor(path: string) {
    this.dbPath = path;
    this.#db = openChatDatabase(path);
    rebuildSearchIndexes(this.#db);
    this.#db.prepare("UPDATE memory_jobs SET status = 'pending' WHERE status = 'running'").run();
    this.#sessions = new SessionRepository(this.#db);
    this.#facts = new FactRepository(this.#db);
    this.#distillation = new MemoryDistillationRepository(this.#db, this.#facts);
    this.#experiences = new ExperienceRepository(this.#db);
    this.#observations = new ObservationRepository(this.#db);
    this.#jobs = new MemoryJobRepository(this.#db);
    this.#jobs.reviveDead();
    this.#proactive = new ProactiveRepository(this.#db, this.#sessions);
    this.#relationship = new RelationshipRepository(this.#db);
  }

  createSession(character: string, title?: string) { return this.#sessions.createSession(character, title); }
  getSession(id: string, character?: string) { return this.#sessions.getSession(id, character); }
  getOrCreateSession(character: string, id?: string) { return this.#sessions.getOrCreateSession(character, id); }
  listSessions(character: string, limit?: number) { return this.#sessions.listSessions(character, limit); }
  renameSession(id: string, character: string, title: string) { return this.#sessions.renameSession(id, character, title); }
  deleteSession(id: string, character: string): SessionDeletion | undefined { return deleteChatSession(this.#db, id, character); }
  add(role: StoredRole, content: string, emotion?: string | null, character?: string, sessionId?: string) { return this.#sessions.add(role, content, emotion, character, sessionId); }
  recent(limit: number, character?: string, sessionId?: string) { return this.#sessions.recent(limit, character, sessionId); }
  messagesBetween(sessionId: string, fromId: number, throughId: number) { return this.#sessions.messagesBetween(sessionId, fromId, throughId); }
  messagesAround(sessionId: string, messageId: number, radius?: number) { return this.#sessions.messagesAround(sessionId, messageId, radius); }
  message(id: number) { return this.#sessions.message(id); }
  remove(id: number) { return this.#sessions.remove(id); }
  markInterrupted(id: number) { return this.#sessions.markInterrupted(id); }
  searchArchive(query: string, limit?: number, excludeSessionId?: string, character?: string): ArchiveHit[] { return this.#sessions.searchArchive(query, limit, excludeSessionId, character); }
  listMemoryExplorer(filters: MemoryExplorerFilters) { return listMemoryExplorer(this.#db, filters); }
  journalSources(_character: string | undefined, from: string, to: string) { return journalSourcesForDay(this.#db, undefined, from, to); }
  getNote(character: string) { return this.#sessions.getNote(character); }
  setNote(character: string, text: string, assistantCount: number) { return this.#sessions.setNote(character, text, assistantCount); }
  listNoteHistory() { return this.#sessions.listNoteHistory(); }
  listSessionObservations() { return this.#observations.list(); }
  countAssistant(character?: string) { return this.#sessions.countAssistant(character); }
  recordCompletedInteraction(input: { userMessageId: number; assistantMessageId: number; character: string; emotion: import("../chat/emotion.ts").Emotion }, now?: Date) {
    return this.#relationship.recordCompletedInteraction(input, now);
  }
  relationshipSnapshot(character: string, now?: Date) { return this.#relationship.snapshot(character, now); }

  saveFacts(sourceMessageId: number, candidates: FactCandidate[]) { return this.#facts.saveFacts(sourceMessageId, candidates); }
  getFact(id: number) { return this.#facts.getFact(id); }
  listFacts(limit?: number) { return this.#facts.listFacts(limit); }
  searchFacts(query: string, limit?: number) { return this.#facts.searchFacts(query, limit); }
  removeFact(id: number) { return this.#distillation.removeFact(id); }
  setFactVectorId(id: number, vectorEntryId: string | null) { return this.#facts.setFactVectorId(id, vectorEntryId); }
  factVectorId(id: number) { return this.#facts.factVectorId(id); }
  factVectorIds() { return this.#facts.factVectorIds(); }
  pendingFacts(afterId?: number, limit?: number) { return this.#facts.pendingFacts(afterId, limit); }
  memoryDistillation(query: string) { return this.#distillation.context(query); }
  memoryDistillationWorkingSet(query: string) { return this.#distillation.workingSet(query); }
  publishMemoryDistillation(input: MemoryDistillation, jobIds: number[], completeFactsAndSummary: boolean, observation?: { sessionId: string; fromMessageId: number; throughMessageId: number }) {
    return this.#distillation.publish(input, jobIds, completeFactsAndSummary, observation);
  }

  companionSettings() { return this.#proactive.settings(); }
  putCompanionSettings(patch: import("../proactive/policy.ts").CompanionSettingsPatch) { return this.#proactive.putSettings(patch); }
  enqueueProactiveTrigger(input: { sourceMessageId: number; factId: number; sessionId: string; planText: string; evidence: string }, now?: Date) {
    const id = this.#proactive.enqueue(input, now);
    if (id) this.#proactiveWake?.(id);
    return id;
  }
  setProactiveWake(wake?: (id: string) => void) { this.#proactiveWake = wake; }
  proactiveTrigger(id: string) { return this.#proactive.trigger(id); }
  proactiveFactActive(id: number) { return this.#proactive.activePlanFact(id); }
  pendingProactiveTriggers(now?: Date) { return this.#proactive.pending(now); }
  recoverProactiveTriggers(now?: Date) { return this.#proactive.recover(now); }
  claimProactiveTrigger(id: string, now?: Date) { return this.#proactive.claim(id, now); }
  deferProactiveTrigger(id: string, dueAt: Date, now?: Date) { return this.#proactive.defer(id, dueAt, now); }
  suppressProactiveTrigger(id: string, now?: Date) { return this.#proactive.suppress(id, now); }
  expireProactiveTrigger(id: string, now?: Date) { return this.#proactive.expire(id, now); }
  failProactiveTrigger(id: string, error: string, retryAt: Date, now?: Date) { return this.#proactive.fail(id, error, retryAt, now); }
  proactiveSendCheck(frequency: "rare" | "normal", now?: Date) { return this.#proactive.sendCheck(frequency, now); }
  deliverProactiveMessage(id: string, content: string, emotion: string, now?: Date) { return this.#proactive.deliver(id, content, emotion, now); }

  upsertExperience(input: ExperienceInput) { return this.#experiences.upsertExperience(input); }
  getExperience(id: number) { return this.#experiences.getExperience(id); }
  listExperiences(limit?: number, includeChat?: boolean) { return this.#experiences.listExperiences(limit, includeChat); }
  searchExperiences(query: string, limit?: number, character?: string) { return this.#experiences.searchExperiences(query, limit, character); }
  recentExperiences(limit?: number, includeChat?: boolean, character?: string) { return this.#experiences.recentExperiences(limit, includeChat, character); }
  recentLearnings(limit?: number, character?: string) { return this.#experiences.recentLearnings(limit, character); }
  pendingExperienceIndexes(limit?: number) { return this.#experiences.pendingExperienceIndexes(limit); }
  markExperienceIndexed(id: number, vectorEntryId?: string) { return this.#experiences.markExperienceIndexed(id, vectorEntryId); }
  experienceBySourceId(sourceId: string) { return this.#experiences.experienceBySourceId(sourceId); }
  experienceVisibleToCharacter(sourceId: string, character: string) { return this.#experiences.experienceVisibleToCharacter(sourceId, character); }
  experienceVectorIds(kind?: string) { return this.#experiences.experienceVectorIds(kind); }
  chatDerivedExperienceVectorIds() { return this.#experiences.chatDerivedExperienceVectorIds(); }
  setExperienceVectorId(id: number, vectorEntryId: string | null) { return this.#experiences.setExperienceVectorId(id, vectorEntryId); }
  markExperienceIndexFailed(id: number, error: string) { return this.#experiences.markExperienceIndexFailed(id, error); }
  removeExperience(id: number) { return this.#experiences.removeExperience(id); }
  removeExperienceBySourceId(sourceId: string) { return this.#experiences.removeExperienceBySourceId(sourceId); }
  addLegacyMemorySource(vectorEntryId: string, sessionId: string) { return this.#experiences.addLegacyMemorySource(vectorEntryId, sessionId); }

  observation(sessionId: string): StoredObservation | undefined { return this.#observations.get(sessionId); }
  observationInput(sessionId: string, keepRecent?: number): ObservationInput | undefined { return this.#observations.input(sessionId, keepRecent); }
  saveObservation(sessionId: string, summary: string, fromMessageId: number, throughMessageId: number) { return this.#observations.save(sessionId, summary, fromMessageId, throughMessageId); }

  enqueueMemoryJob(input: { sessionId: string; character: string; userMessageId: number; assistantMessageId: number }) { return this.#jobs.enqueue(input); }
  claimMemoryJob() { return this.#jobs.claim(); }
  claimMemoryJobBatch() { return this.#jobs.claimBatch(); }
  markMemoryJobStep(id: number, step: "facts" | "vectors" | "summary" | "legacy") { return this.#jobs.markStep(id, step); }
  completeMemoryJob(id: number) { return this.#jobs.complete(id); }
  failMemoryJob(id: number, attempts: number, error: string) { return this.#jobs.fail(id, attempts, error); }
  pauseMemoryJob(id: number) { return this.#jobs.pause(id); }
  hasPendingMemoryJobs() { return this.#jobs.hasPending(); }
  memoryQueueStatus(): MemoryQueueStatus { return this.#jobs.status(); }

  resetMemoryVectorIndexes() {
    this.#facts.resetVectorIndexes();
    this.#experiences.resetVectorIndexes();
  }

  clear() { clearChatData(this.#db); }
  /** 「删除我的全部数据」：清空所有用户数据表，保留设置。 */
  clearAll() { clearAllData(this.#db); }
  /** 导出用：整表读出用户数据。 */
  dumpTable(table: UserDataTable) { return dumpUserTable(this.#db, table); }
  close() { this.#db.close(); }
}
