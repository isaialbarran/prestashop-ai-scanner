import type { AgentId } from "../../config/agents";
import type { PageSpeedResult } from "../fetch/pagespeed";
import type { FetchResult } from "../fetch/types";

export interface ProductSnapshot {
  url: string;
  /** Intentos por agente, en orden. El navegador hace uno; los rastreadores, uno o dos (A2). */
  fetches: Partial<Record<AgentId, FetchResult[]>>;
}

/** Lo que extract.ts (fase 2) lee de la ficha "como bot"; alimenta C2. */
export interface ExtractedProduct {
  name: string | null;
  price: number | null;
  currency: string | null;
  /** Valor de schema.org: InStock, OutOfStock, PreOrder… */
  availability: string | null;
  gtin: string | null;
  brand: string | null;
}

/** Todo lo descargado de un dominio. Los checks son funciones puras sobre esto. */
export interface ScanSnapshot {
  domain: string;
  origin: string | null;
  home: FetchResult | null;
  robotsUrl: string | null;
  robots: FetchResult | null;
  /** Sitemaps descargados, en orden (índice primero). */
  sitemaps: FetchResult[];
  category: FetchResult | null;
  /** D3: categoría con ?order= y ?q=; null si robots.txt ya las bloquea o no se pidieron. */
  facets: {
    orderUrl: string | null;
    qUrl: string | null;
    order: FetchResult | null;
    q: FetchResult | null;
  };
  products: ProductSnapshot[];
  ucp: FetchResult | null;
  llms: FetchResult | null;
  pagespeed: PageSpeedResult | null;
  /** Una entrada por ficha; null hasta que exista extract.ts. */
  extracted: (ExtractedProduct | null)[] | null;
}
