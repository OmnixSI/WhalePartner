import { openChatDatabase } from "./store/database.ts";
import { ExperienceRepository, type ExperienceInput } from "./store/experiences.ts";
import { FactRepository } from "./store/facts.ts";
import { MemoryJobRepository, type MemoryQueueStatus } from "./store/jobs.ts";
import { clearChatData } from "./store/maintenance.ts";
import { deleteChatSession, type SessionDeletion } from "./store/session-deletion.ts";
import { listMemoryExplorer, type MemoryExplorerFilters } from "./store/explorer.ts";
import { journalSourcesForDay } from "./store/journal-sources.ts";
import { ObservationRepository, type ObservationInput, type StoredObservation } from "./store/observations.ts";
import { rebuildSearchIndexes } from "./store/search-index.ts";
import { matchesTimeWindow, overlapsFactTimeWindow } from "./store/search.ts";
import { SessionRepository } from "./store/sessions.ts";
import type { DatabaseSync } from "node:sqlite";
import type { ArchiveHit, ChatSession, FactCandidate, MemoryJob, StoredExperience, StoredFact, StoredMessage, StoredRole } from "./store/types.ts";

export type { ArchiveHit, ChatSession, FactCandidate, MemoryJob, StoredExperience, StoredFact, StoredMessage, StoredRole } from "./store/types.ts";
export type { ExperienceInput } from "./store/experiences.ts";
export type { MemoryQueueStatus } from "./store/jobs.ts";
export type { ObservationInput, StoredObservation } from "./store/observations.ts";
export type { SessionDeletion } from "./store/session-deletion.ts";
export type { MemoryExplorerFilters, MemoryExplorerItem, MemoryExplorerResult } from "./store/explorer.ts";
export { matchesTimeWindow, overlapsFactTimeWindow } from "./store/search.ts";

/** Stable storage API used by the chat service; feature repositories own each data domain. */
export class ChatStore {
  readonly #db: DatabaseSync;
  readonly #sessions: SessionRepository;
  readonly #facts: FactRepository;
  readonly #experiences: ExperienceRepository;
  readonly #observations: ObservationRepository;
  readonly #jobs: MemoryJobRepository;

  constructor(path: string) {
    this.#db = openChatDatabase(path);
    rebuildSearchIndexes(this.#db);
    this.#db.prepare("UPDATE memory_jobs SET status = 'pending' WHERE status = 'running'").run();
    this.#sessions = new SessionRepository(this.#db);
    this.#facts = new FactRepository(this.#db);
    this.#experiences = new ExperienceRepository(this.#db);
    this.#observations = new ObservationRepository(this.#db);
    this.#jobs = new MemoryJobRepository(this.#db);
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
  searchArchive(query: string, limit?: number, excludeSessionId?: string, character?: string): ArchiveHit[] { return this.#sessions.searchArchive(query, limit, excludeSessionId, character); }
  listMemoryExplorer(filters: MemoryExplorerFilters) { return listMemoryExplorer(this.#db, filters); }
  journalSources(character: string, from: string, to: string) { return journalSourcesForDay(this.#db, character, from, to); }
  getNote(character: string) { return this.#sessions.getNote(character); }
  setNote(character: string, text: string, assistantCount: number) { return this.#sessions.setNote(character, text, assistantCount); }
  countAssistant(character: string) { return this.#sessions.countAssistant(character); }

  saveFacts(sourceMessageId: number, candidates: FactCandidate[]) { return this.#facts.saveFacts(sourceMessageId, candidates); }
  getFact(id: number) { return this.#facts.getFact(id); }
  listFacts(limit?: number) { return this.#facts.listFacts(limit); }
  searchFacts(query: string, limit?: number) { return this.#facts.searchFacts(query, limit); }
  removeFact(id: number) { return this.#facts.removeFact(id); }
  setFactVectorId(id: number, vectorEntryId: string | null) { return this.#facts.setFactVectorId(id, vectorEntryId); }
  factVectorId(id: number) { return this.#facts.factVectorId(id); }
  factVectorIds() { return this.#facts.factVectorIds(); }
  pendingFacts(afterId?: number, limit?: number) { return this.#facts.pendingFacts(afterId, limit); }

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
  markMemoryJobStep(id: number, step: "facts" | "vectors" | "summary" | "legacy") { return this.#jobs.markStep(id, step); }
  completeMemoryJob(id: number) { return this.#jobs.complete(id); }
  failMemoryJob(id: number, attempts: number, error: string) { return this.#jobs.fail(id, attempts, error); }
  hasPendingMemoryJobs() { return this.#jobs.hasPending(); }
  memoryQueueStatus(): MemoryQueueStatus { return this.#jobs.status(); }

  resetMemoryVectorIndexes() {
    this.#facts.resetVectorIndexes();
    this.#experiences.resetVectorIndexes();
  }

  clear() { clearChatData(this.#db); }
  close() { this.#db.close(); }
}
