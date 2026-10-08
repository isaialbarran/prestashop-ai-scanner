import type { LlmCache } from "./live";

export function createMemoryLlmCache(): LlmCache & { size(): number } {
  const store = new Map<string, Awaited<ReturnType<LlmCache["get"]>>>();
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value) {
      store.set(key, value);
    },
    size: () => store.size,
  };
}
