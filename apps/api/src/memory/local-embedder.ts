import { resolve } from "node:path";

export const EMBEDDING_MODEL = "Xenova/bge-small-zh-v1.5";
export const EMBEDDING_DIMENSION = 512;

type Extractor = (texts: string[], options: { pooling: "mean"; normalize: boolean }) => Promise<{ tolist(): number[][] }>;

/**
 * 本地中文向量模型（Apache-2.0 的 transformers.js 跑 bge-small-zh，量化版约 25 MB）。
 * 首次使用时从 Hugging Face 下载到 cacheDir，之后离线可用。
 * 接口形状对齐 mem0 的 "langchain" embedder：embedQuery / embedDocuments。
 */
export class LocalEmbedder {
  readonly #cacheDir: string;
  #extractor?: Promise<Extractor>;

  constructor(cacheDir: string) {
    this.#cacheDir = resolve(cacheDir);
  }

  #load(): Promise<Extractor> {
    this.#extractor ??= (async () => {
      const { env, pipeline } = await import("@huggingface/transformers");
      env.cacheDir = this.#cacheDir;
      return (await pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "q8" })) as unknown as Extractor;
    })().catch((error: unknown) => {
      this.#extractor = undefined; // 下次调用允许重试（例如网络恢复后）
      throw error;
    });
    return this.#extractor;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await this.#load();
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    return output.tolist();
  }

  async embedQuery(text: string): Promise<number[]> {
    return (await this.embedDocuments([text]))[0];
  }
}
