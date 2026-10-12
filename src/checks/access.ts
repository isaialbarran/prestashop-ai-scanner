import { AGENTS, CRAWLERS, SEARCH_CRAWLERS, type AgentId } from "../../config/agents";
import { THRESHOLDS } from "../../config/scanner";
import { robotsVerdict } from "../discover/robots";
import { detectChallenge } from "../fetch/challenge";
import type { FetchResult } from "../fetch/types";
import type { BlockKind, Check, CheckStatus, Evidence } from "../schema";
import { analyzePage, mainSelector, textLength, type PageAnalysis, type ScanContext } from "./context";
import { evidenceFrom, inconclusive, makeCheck, pathOf, sameSite, statusFromScores } from "./helpers";

export function checkA1(ctx: ScanContext): Check {
  const robotsUrl = ctx.snap.robotsUrl ?? `${ctx.snap.origin ?? ctx.snap.domain}/robots.txt`;
  if (!ctx.robots || ctx.robots.kind === "unreachable") {
    return inconclusive("A1", robotsUrl, `robots.txt no responde${ctx.robots?.kind === "unreachable" ? `: ${ctx.robots.error}` : ""}`);
  }
  if (ctx.products.length === 0) return inconclusive("A1", robotsUrl, "No se encontraron fichas de producto que evaluar");

  const perAgent: Partial<Record<AgentId, CheckStatus>> = {};
  const evidence: Evidence[] = [];
  const scores: (number | null)[] = [];
  const blocked: string[] = [];

  for (const agent of SEARCH_CRAWLERS) {
    const token = AGENTS[agent].robotsToken!;
    const verdicts = ctx.products.map((p) => robotsVerdict(ctx.robots!, p.url, token));
    const conclusive = verdicts.filter((v) => v.allowed !== null);
    const allowed = conclusive.filter((v) => v.allowed).length;
    scores.push(...verdicts.map((v) => (v.allowed === null ? null : v.allowed ? 1 : 0)));
    perAgent[agent] = conclusive.length === 0 ? "inconclusive" : allowed === conclusive.length ? "pass" : "fail";

    const denial = verdicts.find((v) => v.allowed === false);
    evidence.push({
      url: robotsUrl,
      agent,
      note: denial
        ? `${token} bloqueado en ${conclusive.length - allowed} de ${verdicts.length} fichas (${denial.reason})`
        : `${token} puede leer ${allowed} de ${verdicts.length} fichas (${verdicts[0]!.reason})`,
      ...(denial?.lineText ? { snippet: denial.lineText } : {}),
    });
    if (denial) blocked.push(token);
  }

  const { status, score } = statusFromScores(scores);
  const fix = blocked.length
    ? `Permite ${blocked.join(", ")} en robots.txt: quita el Disallow que los afecta o añade un grupo "User-agent: ${blocked[0]}" con "Allow: /". En PrestaShop, robots.txt se regenera desde Preferencias > Tráfico y SEO; edita el archivo después de regenerarlo.`
    : null;
  return makeCheck("A1", { status, score, evidence, fix, perAgent });
}

export interface CrawlerVerdict {
  ok: boolean | null;
  kind?: BlockKind;
  reason: string;
}

/**
 * Compara la respuesta de un rastreador con la del navegador para la misma URL.
 * `browserFailsLater`: las peticiones del navegador posteriores también fallaron por red; un fallo de red
 * del rastreador no se puede atribuir entonces a su user-agent (suele ser un límite por IP).
 */
export function crawlerVerdict(
  browser: FetchResult | null,
  crawler: FetchResult | null,
  opts: { browserFailsLater?: boolean } = {},
): CrawlerVerdict {
  if (!browser || browser.status !== 200 || detectChallenge(browser)) {
    return { ok: null, reason: "el navegador tampoco recibe la ficha" };
  }
  if (!crawler || crawler.status === null) {
    if (crawler?.error?.includes("presupuesto") || crawler?.error?.includes("dejan de enviar")) return { ok: null, reason: crawler.error };
    if (opts.browserFailsLater) {
      return { ok: null, reason: `${crawler?.error ?? "sin respuesta"}; el navegador también falla después (posible límite por IP)` };
    }
    return { ok: false, kind: "origen", reason: crawler?.error ?? "sin respuesta" };
  }
  const challenge = detectChallenge(crawler);
  if (challenge) {
    return {
      ok: false,
      kind: "waf",
      reason: `${challenge.kind === "challenge" ? "reto" : "bloqueo"} de ${challenge.vendor} (${crawler.status})`,
    };
  }
  if (crawler.status !== 200) return { ok: false, kind: "origen", reason: `responde ${crawler.status}; el navegador recibe 200` };
  if (pathOf(crawler.finalUrl) !== pathOf(browser.finalUrl)) {
    return { ok: false, kind: "origen", reason: `redirige a ${crawler.finalUrl}` };
  }
  const scope = mainSelector(browser);
  const ratio = textLength(crawler, scope) / Math.max(1, textLength(browser, scope));
  if (ratio < THRESHOLDS.a2MinTextRatio) {
    // Googlebot se identifica como móvil y el navegador de referencia como escritorio: muchos temas sirven otra
    // plantilla con menos texto. Si el rastreador recibe la misma ficha (mismo título y precio visible), le llega.
    if (sameProduct(browser, crawler)) {
      return { ok: true, reason: `la misma ficha con otra plantilla (${Math.round(ratio * 100)} % del texto${scope ? ` de ${scope}` : ""})` };
    }
    return {
      ok: false,
      kind: "origen",
      reason: `recibe el ${Math.round(ratio * 100)} % del texto${scope ? ` de ${scope}` : ""} que ve el navegador`,
    };
  }
  return { ok: true, reason: `200 con el ${Math.min(100, Math.round(ratio * 100))} % del texto` };
}

function sameProduct(browser: FetchResult, crawler: FetchResult): boolean {
  const a = analyzePage(browser)?.signals;
  const b = analyzePage(crawler)?.signals;
  if (!a?.name || !b?.name) return false;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return norm(a.name) === norm(b.name) && (!a.price || !!b.price);
}

export function checkA2(ctx: ScanContext): Check {
  if (ctx.products.length === 0) return inconclusive("A2", ctx.snap.origin ?? ctx.snap.domain, "No se encontraron fichas de producto");

  // Peticiones del navegador posteriores a las de los rastreadores (ver scan.ts): si todas fallan por red, el host nos cortó por IP.
  const later = [ctx.snap.category, ctx.snap.facets.order, ctx.snap.facets.q, ctx.snap.ucp, ctx.snap.llms].filter((r): r is FetchResult => !!r);
  const browserFailsLater = later.length > 0 && later.every((r) => r.status === null);

  const perAgent: Partial<Record<AgentId, CheckStatus>> = {};
  const blockKind: Partial<Record<AgentId, BlockKind>> = {};
  const evidence: Evidence[] = [];
  const scores: (number | null)[] = [];

  for (const agent of CRAWLERS) {
    const pairs = ctx.products.map((p) => {
      const attempts = p.fetches[agent] ?? [];
      const verdicts = attempts.map((a) => crawlerVerdict(p.browser, a, { browserFailsLater }));
      if (verdicts.some((v) => v.ok === true)) return { ok: true as const, last: attempts.at(-1)!, v: verdicts.find((v) => v.ok)! };
      if (verdicts.length === 0 || verdicts.some((v) => v.ok === null)) {
        return { ok: null, last: attempts.at(-1) ?? null, v: verdicts.at(-1) ?? { ok: null, reason: "sin petición" } };
      }
      // Solo es fallo si falla en los dos intentos.
      if (verdicts.length < 2) return { ok: null, last: attempts.at(-1)!, v: { ok: null, reason: `${verdicts[0]!.reason} en el único intento` } };
      return { ok: false as const, last: attempts.at(-1)!, v: verdicts.at(-1)! };
    });

    scores.push(...pairs.map((p) => (p.ok === null ? null : p.ok ? 1 : 0)));
    const failures = pairs.filter((p) => p.ok === false);
    const passes = pairs.filter((p) => p.ok === true);
    perAgent[agent] = failures.length ? "fail" : passes.length ? "pass" : "inconclusive";

    if (failures.length) {
      blockKind[agent] = failures.some((f) => f.v.kind === "origen") ? "origen" : "waf";
      const f = failures[0]!;
      evidence.push(
        evidenceFrom(f.last, `${AGENTS[agent].label}: ${f.v.reason} en ${failures.length} de ${pairs.length} fichas, tras dos intentos`, {
          withHeaders: true,
          snippet: titleOrText(f.last),
        }),
      );
    } else {
      const sample = passes[0] ?? pairs[0]!;
      evidence.push(
        evidenceFrom(sample.last, `${AGENTS[agent].label}: ${passes.length ? `${sample.v.reason} en ${passes.length} de ${pairs.length} fichas` : sample.v.reason}`, {
          url: sample.last?.finalUrl ?? ctx.products[0]!.url,
        }),
      );
    }
  }

  const { status, score } = statusFromScores(scores);
  const kinds = Object.values(blockKind);
  const fix = kinds.length
    ? [
        kinds.includes("origen") &&
          "El servidor rechaza a algunos rastreadores por su user-agent: revisa reglas de .htaccess, módulos antibots de PrestaShop y la configuración del hosting.",
        kinds.includes("waf") &&
          "El cortafuegos reta o bloquea a algunos rastreadores. El escáner solo imita el user-agent y los WAF verifican por IP, así que confirma en los registros del servidor si el rastreador real entra. Si bloqueas bots de IA a propósito, deja pasar al menos a OAI-SearchBot y PerplexityBot.",
      ]
        .filter(Boolean)
        .join(" ")
    : null;
  return makeCheck("A2", { status, score, evidence, fix, perAgent, blockKind });
}

const LOGIN_URL = /controller=authentication|\/(login|iniciar-sesion|inicio-sesion|autenticacion|identificacion|connexion)(\b|\?|$)/i;

interface Wall {
  url: string;
  res: FetchResult;
  note: string;
}

function findWall(res: FetchResult | null, page: PageAnalysis | null, isProduct: boolean): Wall | null {
  if (!res || detectChallenge(res)) return null;
  const at = (note: string): Wall => ({ url: res.finalUrl, res, note });
  if (res.redirects.length && !sameSite(res.url, res.finalUrl)) return at(`redirige a otro dominio (${res.finalUrl})`);
  if (res.status === 503 || page?.bodyId === "maintenance" || page?.$(".page-maintenance").length) {
    return at(`la tienda está en modo mantenimiento (${res.status})`);
  }
  if ((res.redirects.length && LOGIN_URL.test(res.finalUrl)) || page?.bodyId === "authentication") {
    return at(`redirige al login (${res.finalUrl})`);
  }
  if (isProduct && page && page.signals.name && !page.signals.price && (page.isCatalog || !page.signals.addToCart)) {
    return at(`modo catálogo: la ficha no muestra precio ni botón de compra${page.isCatalog ? " (is_catalog activo)" : ""}`);
  }
  if (res.status === 451) return at("bloqueo legal o por país (451)");
  return null;
}

export function checkA3(ctx: ScanContext): Check {
  const pages: { res: FetchResult | null; page: PageAnalysis | null; isProduct: boolean }[] = [
    { res: ctx.snap.home, page: ctx.home, isProduct: false },
    ...ctx.products.map((p) => ({ res: p.browser, page: p.page ?? analyzePage(p.browser), isProduct: true })),
  ];
  const fetched = pages.filter((p) => p.res && p.res.status !== null);
  if (fetched.length === 0) return inconclusive("A3", ctx.snap.origin ?? ctx.snap.domain, "Ni la portada ni las fichas respondieron");

  const walls = fetched.map((p) => findWall(p.res, p.page, p.isProduct)).filter((w): w is Wall => w !== null);
  if (walls.length) {
    return makeCheck("A3", {
      status: "fail",
      score: 0,
      evidence: walls.map((w) => evidenceFrom(w.res, w.note, { withHeaders: true })),
      fix: "Quita el muro para los visitantes anónimos: desactiva el modo mantenimiento o el modo catálogo, no obligues a iniciar sesión para ver las fichas y no redirijas por país sin dejar acceder a la versión española.",
    });
  }

  // Sin muro reconocible: solo cuentan las páginas que el navegador recibió de verdad (200 y sin reto).
  const loaded = (p: (typeof pages)[number]) => p.res?.status === 200 && !detectChallenge(p.res);
  const products = pages.filter((p) => p.isProduct);
  const loadedProducts = products.filter(loaded);
  const blocked = products.find((p) => p.res && !loaded(p));
  const blockedNote = blocked?.res
    ? `${products.length - loadedProducts.length} fichas no cargan para el navegador (${describeBlock(blocked.res)})`
    : null;
  if (loadedProducts.length === 0) {
    return inconclusive("A3", blocked?.res?.finalUrl ?? ctx.snap.origin ?? ctx.snap.domain, blockedNote ?? "No hay fichas que evaluar");
  }
  const homeLoaded = loaded(pages[0]!);
  return makeCheck("A3", {
    status: "pass",
    score: 1,
    evidence: [
      evidenceFrom(
        loadedProducts[0]!.res,
        `${homeLoaded ? "La portada y " : ""}${loadedProducts.length} fichas cargan sin muro${blockedNote ? `; ${blockedNote}` : ""}`,
      ),
    ],
    fix: null,
  });
}

function describeBlock(res: FetchResult): string {
  const challenge = detectChallenge(res);
  if (challenge) return `${res.status}, ${challenge.kind === "challenge" ? "reto" : "bloqueo"} de ${challenge.vendor}`;
  return res.status === null ? (res.error ?? "sin respuesta") : String(res.status);
}

function titleOrText(res: FetchResult | null): string | undefined {
  if (!res?.body) return undefined;
  const title = res.body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
  return title || res.body.slice(0, 200);
}
