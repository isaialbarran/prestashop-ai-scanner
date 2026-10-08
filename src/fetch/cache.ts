import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentId } from "../../config/agents";
import type { FetchResult } from "./types";

/** Caché de desarrollo: evita repetir peticiones a las tiendas entre ejecuciones. */
export interface HttpCache {
  get(key: string): Promise<FetchResult | null>;
  set(key: string, value: FetchResult): Promise<void>;
}

export function cacheKey(agent: AgentId, url: string, attempt: number): string {
  return createHash("sha256").update(`${agent}\n${attempt}\n${url}`).digest("hex");
}

export function createDiskCache(dir = path.join(process.cwd(), ".cache", "http")): HttpCache {
  const file = (key: string) => path.join(dir, key.slice(0, 2), `${key}.json`);
  return {
    async get(key) {
      try {
        return JSON.parse(await readFile(file(key), "utf8")) as FetchResult;
      } catch {
        return null;
      }
    },
    async set(key, value) {
      await mkdir(path.dirname(file(key)), { recursive: true });
      await writeFile(file(key), JSON.stringify(value));
    },
  };
}

export function createMemoryCache(): HttpCache {
  const store = new Map<string, FetchResult>();
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value) {
      store.set(key, value);
    },
  };
}
