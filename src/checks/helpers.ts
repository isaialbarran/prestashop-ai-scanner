import type { AgentId } from "../../config/agents";
import type { FetchResult } from "../fetch/types";
import { snippet as clip } from "../parse/html";
import type { BlockKind, Check, CheckId, CheckStatus, Evidence } from "../schema";
import { CHECKS } from "./catalog";

/** Cabeceras que explican un bloqueo o una redirección; el resto no se guarda en la evidencia. */
const EVIDENCE_HEADERS = [
  "server",
  "content-type",
  "location",
  "retry-after",
  "x-robots-tag",
  "cf-ray",
  "cf-mitigated",
  "x-datadome",
  "x-sucuri-id",
  "x-iinfo",
];

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function makeCheck(
  id: CheckId,
  parts: {
    status: CheckStatus;
    /** Fracción 0–1 de los puntos del check. */
    score: number;
    evidence: Evidence[];
    fix: string | null;
    perAgent?: Partial<Record<AgentId, CheckStatus>>;
    blockKind?: Partial<Record<AgentId, BlockKind>>;
  },
): Check {
  const { title, maxPoints } = CHECKS[id];
  const score = parts.status === "inconclusive" ? 0 : Math.min(1, Math.max(0, parts.score));
  return {
    id,
    title,
    status: parts.status,
    points: round2(score * maxPoints),
    maxPoints,
    evidence: parts.evidence,
    fix: parts.fix,
    ...(parts.perAgent ? { perAgent: parts.perAgent } : {}),
    ...(parts.blockKind && Object.keys(parts.blockKind).length ? { blockKind: parts.blockKind } : {}),
  };
}

export function inconclusive(id: CheckId, url: string, note: string): Check {
  return makeCheck(id, { status: "inconclusive", score: 0, evidence: [{ url, note }], fix: null });
}

export function evidenceFrom(
  res: FetchResult | null,
  note: string,
  extra: { snippet?: string; withHeaders?: boolean; url?: string } = {},
): Evidence {
  const ev: Evidence = { url: extra.url ?? res?.finalUrl ?? res?.url ?? "-", note };
  if (res?.agent) ev.agent = res.agent;
  if (res?.status != null) ev.httpStatus = res.status;
  if (extra.withHeaders && res) {
    const headers = Object.fromEntries(EVIDENCE_HEADERS.filter((h) => res.headers[h]).map((h) => [h, res.headers[h]!]));
    if (Object.keys(headers).length) ev.headers = headers;
  }
  if (extra.snippet) ev.snippet = clip(extra.snippet, 300);
  return ev;
}

/** Estado a partir de fracciones por elemento (fichas, agentes…); null = inconcluso. */
export function statusFromScores(scores: (number | null)[]): { status: CheckStatus; score: number } {
  const conclusive = scores.filter((s): s is number => s !== null);
  if (conclusive.length === 0) return { status: "inconclusive", score: 0 };
  const score = conclusive.reduce((a, b) => a + b, 0) / conclusive.length;
  const status: CheckStatus = score >= 1 - 1e-9 ? "pass" : score <= 1e-9 ? "fail" : "hint";
  return { status, score };
}

export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`;
  } catch {
    return url;
  }
}

export function sameSite(a: string, b: string): boolean {
  try {
    return new URL(a).hostname.replace(/^www\./, "") === new URL(b).hostname.replace(/^www\./, "");
  } catch {
    return false;
  }
}

export function pickPrimaryProduct<T extends { source: string; name: string | null; price: number | null }>(list: T[]): T | null {
  return (
    list.find((p) => p.source === "jsonld" && p.name && p.price !== null) ??
    list.find((p) => p.name && p.price !== null) ??
    list[0] ??
    null
  );
}
