import type { FetchResult } from "../fetch/types";
import type { Check } from "../schema";
import type { ScanContext } from "./context";
import { evidenceFrom, inconclusive, makeCheck } from "./helpers";

export function checkI1(ctx: ScanContext): Check {
  const res = ctx.snap.ucp;
  const url = res?.url ?? `${ctx.snap.origin}/.well-known/ucp`;
  if (!res || res.status === null) return inconclusive("I1", url, `Sin respuesta${res?.error ? `: ${res.error}` : ""}`);
  let json = false;
  try {
    JSON.parse(res.body ?? "");
    json = true;
  } catch {
    json = false;
  }
  const published = res.status === 200 && json;
  return makeCheck("I1", {
    status: published ? "pass" : "hint",
    score: 0,
    evidence: [evidenceFrom(res, published ? "Perfil UCP publicado" : `No hay perfil UCP (${res.status}${res.status === 200 ? ", no es JSON" : ""})`, { snippet: published ? res.body ?? "" : undefined })],
    fix: null,
  });
}

export function checkI2(ctx: ScanContext): Check {
  const res = ctx.snap.llms;
  const url = res?.url ?? `${ctx.snap.origin}/llms.txt`;
  if (!res || res.status === null) return inconclusive("I2", url, `Sin respuesta${res?.error ? `: ${res.error}` : ""}`);
  const head = (res.body ?? "").trimStart().slice(0, 500).toLowerCase();
  const published = res.status === 200 && head.length > 0 && !head.startsWith("<") && !head.includes("<html");
  return makeCheck("I2", {
    status: published ? "pass" : "hint",
    score: 0,
    evidence: [
      evidenceFrom(res, published ? "llms.txt publicado" : res.status === 200 ? "Responde 200 pero es una página HTML, no un llms.txt" : `No hay llms.txt (${res.status})`, {
        snippet: published ? res.body ?? "" : undefined,
      }),
    ],
    fix: null,
  });
}

export interface PlatformInfo {
  prestashop: boolean;
  version: string | null;
  signals: string[];
}

const SIGNALS: [string, (body: string, cookies: string) => boolean][] = [
  ["meta generator", (b) => /<meta[^>]+name=["']generator["'][^>]+content=["']PrestaShop/i.test(b)],
  ["var prestashop", (b) => /var prestashop\s*=/.test(b)],
  ["cookie PrestaShop", (_, c) => /PrestaShop-[a-f0-9]{8,}/i.test(c)],
  ["tema classic", (b) => /\/themes\/classic\//.test(b)],
  ["tema hummingbird", (b) => /\/themes\/hummingbird\//.test(b)],
  ["tema default-bootstrap", (b) => /\/themes\/default-bootstrap\//.test(b)],
  ["var baseDir", (b) => /var baseDir\s*=/.test(b)],
  ["jQuery 1.11 de 1.6", (b) => /\/js\/jquery\/jquery-1\.11\.0\.min\.js/.test(b)],
  ["módulos ps_*", (b) => /\/modules\/ps_[a-z_]+\//.test(b)],
];

/** Detecta PrestaShop y su rama a partir del HTML y las cookies. Desde fuera no se distingue 1.7 de 8. */
export function detectPlatform(responses: (FetchResult | null)[]): PlatformInfo {
  const found = new Set<string>();
  for (const res of responses) {
    if (!res?.body) continue;
    for (const [name, test] of SIGNALS) if (test(res.body, res.headers["set-cookie"] ?? "")) found.add(name);
  }
  const signals = [...found];
  const has = (s: string) => found.has(s);
  const prestashop = signals.length > 0 && !(signals.length === 1 && has("var baseDir"));
  let version: string | null = null;
  if (has("var prestashop")) version = has("tema hummingbird") ? "8 o 9 (tema hummingbird)" : "1.7 o posterior";
  else if (has("tema default-bootstrap") || has("jQuery 1.11 de 1.6") || (has("var baseDir") && has("meta generator"))) version = "1.6";
  return { prestashop, version, signals };
}

export function checkI3(ctx: ScanContext): Check {
  const responses = [ctx.snap.home, ...ctx.products.map((p) => p.browser)];
  const platform = detectPlatform(responses);
  const url = ctx.snap.home?.finalUrl ?? ctx.snap.origin ?? ctx.snap.domain;
  if (!platform.prestashop) return inconclusive("I3", url, "No se detecta PrestaShop en la portada ni en las fichas");
  const signals = `señales: ${platform.signals.join(", ")}`;
  if (platform.version === "1.6") {
    return makeCheck("I3", {
      status: "hint",
      score: 0,
      evidence: [{ url, note: `PrestaShop 1.6, versión antigua sin soporte (${signals})` }],
      fix: "PrestaShop 1.6 no recibe actualizaciones. Planifica la migración a la 8 o la 9.",
    });
  }
  const note = platform.version
    ? `PrestaShop ${platform.version}${platform.version === "1.7 o posterior" ? " (desde fuera no se distingue 1.7, que ya es antigua, de 8)" : ""}`
    : "PrestaShop, versión no identificable";
  return makeCheck("I3", { status: "pass", score: 0, evidence: [{ url, note: `${note} (${signals})` }], fix: null });
}
