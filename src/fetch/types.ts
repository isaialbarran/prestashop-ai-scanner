import type { AgentId } from "../../config/agents";

export interface RedirectHop {
  url: string;
  status: number;
  location: string;
}

export interface FetchResult {
  /** URL pedida. */
  url: string;
  /** URL tras seguir las redirecciones. */
  finalUrl: string;
  agent: AgentId;
  /** 1 en el primer intento; A2 repite con 2. */
  attempt: number;
  /** null si no hubo respuesta (error de red, timeout o presupuesto agotado). */
  status: number | null;
  /** Cabeceras de la última respuesta, en minúsculas. */
  headers: Record<string, string>;
  body: string | null;
  bytes: number;
  truncated: boolean;
  redirects: RedirectHop[];
  /** Tiempo hasta recibir cabeceras de la primera petición de la cadena. */
  ttfbMs: number | null;
  totalMs: number | null;
  error: string | null;
  fromCache: boolean;
}

export interface FetchStats {
  network: number;
  cached: number;
  budget: number;
  remaining: number;
}

export interface Fetcher {
  get(url: string, agent: AgentId, opts?: { attempt?: number }): Promise<FetchResult>;
  /** Aplica el Crawl-delay de robots.txt (acotado) a las peticiones siguientes. */
  setMinInterval(ms: number): void;
  stats(): FetchStats;
}

export type FetchImpl = (input: string, init: RequestInit) => Promise<Response>;
