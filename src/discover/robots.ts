import robotsParser from "robots-parser";
import type { FetchResult } from "../fetch/types";

type Robot = ReturnType<typeof robotsParser>;

/**
 * Cómo trata Google cada respuesta de robots.txt:
 * 2xx → se aplican las reglas; 4xx (salvo 429) → todo permitido;
 * 5xx o 429 → todo bloqueado; sin respuesta → no se puede saber.
 */
export type RobotsInfo =
  | { kind: "parsed"; url: string; status: number; lines: string[]; robot: Robot; sitemaps: string[] }
  | { kind: "missing"; url: string; status: number }
  | { kind: "error"; url: string; status: number }
  | { kind: "unreachable"; url: string; error: string };

export interface RobotsVerdict {
  allowed: boolean | null;
  line: number | null;
  lineText: string | null;
  reason: string;
}

export function interpretRobots(res: FetchResult | null, url: string): RobotsInfo {
  if (!res || res.status === null) return { kind: "unreachable", url, error: res?.error ?? "sin respuesta" };
  if (res.status === 429 || res.status >= 500) return { kind: "error", url, status: res.status };
  if (res.status >= 400) return { kind: "missing", url, status: res.status };
  if (res.status >= 300) return { kind: "unreachable", url, error: `redirección sin resolver (${res.status})` };
  const txt = res.body ?? "";
  const robot = robotsParser(url, txt);
  return { kind: "parsed", url, status: res.status, lines: txt.split(/\r?\n/), robot, sitemaps: robot.getSitemaps() };
}

export function robotsVerdict(info: RobotsInfo, target: string, token: string): RobotsVerdict {
  switch (info.kind) {
    case "unreachable":
      return { allowed: null, line: null, lineText: null, reason: `robots.txt no responde: ${info.error}` };
    case "missing":
      return { allowed: true, line: null, lineText: null, reason: `robots.txt devuelve ${info.status}: todo permitido` };
    case "error":
      return {
        allowed: false,
        line: null,
        lineText: null,
        reason: `robots.txt devuelve ${info.status}: Google lo trata como bloqueo total`,
      };
    case "parsed": {
      const allowed = info.robot.isAllowed(target, token);
      if (allowed === undefined) {
        return { allowed: null, line: null, lineText: null, reason: "la URL no pertenece al mismo origen que robots.txt" };
      }
      const n = info.robot.getMatchingLineNumber(target, token);
      const line = n > 0 ? n : null;
      const lineText = line ? (info.lines[line - 1] ?? "").trim() : null;
      return {
        allowed,
        line,
        lineText,
        reason: line ? `línea ${line}: ${lineText}` : allowed ? "ninguna regla lo bloquea" : "bloqueado",
      };
    }
  }
}

/** Crawl-delay más alto declarado para cualquiera de los tokens, en ms. */
export function crawlDelayMs(info: RobotsInfo, tokens: string[]): number | null {
  if (info.kind !== "parsed") return null;
  const delays = ["*", ...tokens].map((t) => info.robot.getCrawlDelay(t)).filter((d): d is number => typeof d === "number");
  return delays.length ? Math.max(...delays) * 1000 : null;
}
