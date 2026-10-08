import { AGENTS, type AgentId } from "../../config/agents";
import { POLITENESS } from "../../config/scanner";
import { cacheKey, type HttpCache } from "./cache";
import { BUDGET_EXCEEDED, DomainLimiter } from "./limiter";
import type { FetchImpl, FetchResult, Fetcher, RedirectHop } from "./types";

// Todas las peticiones llevan las mismas cabeceras salvo el user-agent,
// para que A2 aísle el efecto del agente.
const ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const ACCEPT_LANGUAGE = "es-ES,es;q=0.9";

export interface FetcherOptions {
  fetchImpl?: FetchImpl;
  cache?: HttpCache | null;
  limiter?: DomainLimiter;
  timeoutMs?: number;
  maxBodyBytes?: number;
  maxRedirects?: number;
}

export function createFetcher(opts: FetcherOptions = {}): Fetcher {
  const fetchImpl: FetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const limiter =
    opts.limiter ??
    new DomainLimiter({ minIntervalMs: POLITENESS.minIntervalMs, budget: POLITENESS.maxRequestsPerDomain });
  const timeoutMs = opts.timeoutMs ?? POLITENESS.timeoutMs;
  const maxBodyBytes = opts.maxBodyBytes ?? POLITENESS.maxBodyBytes;
  const maxRedirects = opts.maxRedirects ?? POLITENESS.maxRedirects;
  let cached = 0;
  // Cortesía: tras varios errores de red seguidos el host nos está cortando; se deja de insistir.
  let consecutiveNetworkErrors = 0;
  const MAX_NETWORK_ERRORS = 3;

  async function network(url: string, agent: AgentId, attempt: number): Promise<FetchResult> {
    const base: FetchResult = {
      url,
      finalUrl: url,
      agent,
      attempt,
      status: null,
      headers: {},
      body: null,
      bytes: 0,
      truncated: false,
      redirects: [],
      ttfbMs: null,
      totalMs: null,
      error: null,
      fromCache: false,
    };
    const redirects: RedirectHop[] = [];
    let current = url;
    let ttfbMs: number | null = null;
    let totalMs = 0;

    for (let hop = 0; hop <= maxRedirects; hop++) {
      const outcome = await limiter
        .schedule(async () => {
          const t0 = performance.now();
          const res = await fetchImpl(current, {
            method: "GET",
            headers: { "user-agent": AGENTS[agent].userAgent, accept: ACCEPT, "accept-language": ACCEPT_LANGUAGE },
            redirect: "manual",
            signal: AbortSignal.timeout(timeoutMs),
          });
          return { res, t0, firstByteMs: performance.now() - t0 };
        })
        .catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))));

      if (outcome === BUDGET_EXCEEDED) {
        return { ...base, finalUrl: current, redirects, error: "presupuesto de peticiones agotado" };
      }
      if (outcome instanceof Error) {
        return { ...base, finalUrl: current, redirects, error: describeError(outcome, timeoutMs) };
      }

      const { res, t0, firstByteMs } = outcome;
      ttfbMs ??= round(firstByteMs);
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        const next = new URL(location, current).toString();
        redirects.push({ url: current, status: res.status, location: next });
        await res.body?.cancel();
        totalMs += performance.now() - t0;
        current = next;
        continue;
      }

      const headers = headersToRecord(res.headers);
      try {
        const { text, bytes, truncated } = await readBody(res, maxBodyBytes);
        totalMs += performance.now() - t0;
        return {
          ...base,
          finalUrl: current,
          status: res.status,
          headers,
          body: text,
          bytes,
          truncated,
          redirects,
          ttfbMs,
          totalMs: round(totalMs),
        };
      } catch (err) {
        return { ...base, finalUrl: current, status: res.status, headers, redirects, ttfbMs, error: describeError(err, timeoutMs) };
      }
    }
    return { ...base, finalUrl: current, redirects, ttfbMs, error: `más de ${maxRedirects} redirecciones` };
  }

  return {
    async get(url, agent, { attempt = 1 } = {}) {
      const key = cacheKey(agent, url, attempt);
      const hit = await opts.cache?.get(key);
      if (hit) {
        cached++;
        return { ...hit, fromCache: true };
      }
      if (consecutiveNetworkErrors >= MAX_NETWORK_ERRORS) {
        return {
          url,
          finalUrl: url,
          agent,
          attempt,
          status: null,
          headers: {},
          body: null,
          bytes: 0,
          truncated: false,
          redirects: [],
          ttfbMs: null,
          totalMs: null,
          fromCache: false,
          error: `${MAX_NETWORK_ERRORS} errores de red seguidos: se dejan de enviar peticiones a este host`,
        };
      }
      const result = await network(url, agent, attempt);
      if (result.status === null && result.error && !result.error.includes("presupuesto")) consecutiveNetworkErrors++;
      else if (result.status !== null) consecutiveNetworkErrors = 0;
      if (!result.error) await opts.cache?.set(key, result);
      return result;
    },
    setMinInterval(ms) {
      limiter.setMinInterval(Math.min(ms, POLITENESS.maxCrawlDelayMs));
    },
    stats() {
      return {
        network: limiter.consumed,
        cached,
        budget: limiter.consumed + limiter.remaining,
        remaining: limiter.remaining,
      };
    },
  };
}

async function readBody(res: Response, maxBytes: number): Promise<{ text: string; bytes: number; truncated: boolean }> {
  if (!res.body) return { text: "", bytes: 0, truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (bytes + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - bytes));
      bytes = maxBytes;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    bytes += value.byteLength;
  }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder("utf-8").decode(buffer), bytes, truncated };
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  const cookies = headers.getSetCookie();
  if (cookies.length > 0) out["set-cookie"] = cookies.join("\n");
  return out;
}

function describeError(err: unknown, timeoutMs: number): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return `timeout tras ${timeoutMs / 1000} s`;
    const code = (err.cause as { code?: string } | undefined)?.code;
    return code ? `${err.message} (${code})` : err.message;
  }
  return String(err);
}

const round = (ms: number) => Math.round(ms);
