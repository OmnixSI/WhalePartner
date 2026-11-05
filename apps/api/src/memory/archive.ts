import type { ChatStore, ExperienceInput } from "../store.ts";
import type { MemoryEntry, MemoryStore } from "./types.ts";

/** SQLite 是经历原件；本地向量索引只作为可重建的检索副本。 */
export async function archiveExperience(
  store: ChatStore,
  memory: MemoryStore | undefined,
  input: ExperienceInput,
  label: string,
): Promise<MemoryEntry> {
  const archived = store.upsertExperience(input);
  if (memory) {
    try {
      const indexed = await memory.addExperience({ ...input, sourceId: archived.sourceId });
      if (!indexed.id.startsWith("local-exp:")) store.markExperienceIndexed(archived.id, indexed.id);
      return indexed;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      store.markExperienceIndexFailed(archived.id, reason);
      console.warn(`${label}语义索引失败，本机经历仍已保存：`, reason);
    }
  }
  return {
    id: `local-exp:${archived.id}`,
    text: `${archived.title}\n${archived.text}`.trim(),
    kind: "experience",
    createdAt: archived.createdAt,
    source: archived.kind,
    title: archived.title,
    url: archived.url ?? undefined,
    sourceId: archived.sourceId,
  };
}
