import { AGENTS, CAP_AGENTS } from "../../config/agents";
import { robotsVerdict } from "../discover/robots";
import { parseSitemap } from "../discover/sitemap";
import type { FetchResult } from "../fetch/types";
import type { Check, Evidence } from "../schema";
import { perProduct } from "./content";
import { analyzePage, type ScanContext } from "./context";
import { evidenceFrom, inconclusive, makeCheck, pathOf, statusFromScores } from "./helpers";

export function checkD1(ctx: ScanContext): Check {
  const robots = ctx.robots;
  const fetched = ctx.snap.sitemaps;
  if (fetched.length === 0 && (!robots || robots.kind === "unreachable")) {
    return inconclusive("D1", ctx.snap.origin ?? ctx.snap.domain, "No se pudo pedir robots.txt ni ningún sitemap");
  }
  const ok = fetched.find((r) => r.status === 200 && parseSitemap(r.body).entries.length > 0) ?? null;
  const declared = robots?.kind === "parsed" ? robots.sitemaps : [];
  const evidence: Evidence[] = [
    ok
      ? evidenceFrom(ok, `Sitemap accesible (${parseSitemap(ok.body).entries.length} entradas)`)
      : evidenceFrom(fetched[0] ?? null, "No hay sitemap accesible", { url: fetched[0]?.url ?? `${ctx.snap.origin}/1_index_sitemap.xml` }),
    {
      url: ctx.snap.robotsUrl ?? `${ctx.snap.origin}/robots.txt`,
      note: declared.length ? `robots.txt declara ${declared.length} sitemap(s)` : "robots.txt no declara ningún sitemap",
      ...(declared.length ? { snippet: declared.map((s) => `Sitemap: ${s}`).join(" ") } : {}),
    },
  ];
  const { status, score } = statusFromScores([((ok ? 1 : 0) + (declared.length ? 1 : 0)) / 2]);
  return makeCheck("D1", {
    status,
    score,
    evidence,
    fix:
      status === "pass"
        ? null
        : "Activa el módulo Google sitemap (gsitemap), genera el sitemap y añade la línea \"Sitemap: https://tu-tienda/1_index_sitemap.xml\" al final de robots.txt.",
  });
}

export function checkD2(ctx: ScanContext): Check {
  return perProduct(
    "D2",
    ctx,
    (p) => {
      const page = p.page!;
      const notes: string[] = [];
      let score = 0;
      if (page.canonical) {
        score += 1 / 3;
        if (pathOf(page.canonical) === pathOf(page.url)) {
          score += 1 / 3;
          notes.push("canonical a sí misma ✓");
        } else {
          notes.push(`canonical a otra URL ✗ (${page.canonical})`);
        }
      } else {
        notes.push("sin canonical ✗");
      }

      const alternates = page.hreflang;
      if (alternates.length) {
        const self = page.canonical ?? page.url;
        const valid = alternates.every((h) => h.href) && alternates.some((h) => h.href && pathOf(h.href) === pathOf(self));
        if (valid) score += 1 / 3;
        notes.push(valid ? `hreflang (${alternates.length}) incluye la propia URL ✓` : "hreflang sin la propia URL o con URLs inválidas ✗");
      } else if (ctx.multilingual) {
        notes.push("tienda multiidioma sin hreflang ✗");
      } else {
        score += 1 / 3;
        notes.push("un solo idioma, hreflang no necesario");
      }
      return { score, evidence: evidenceFrom(p.browser, notes.join("; ")) };
    },
    () =>
      "Cada ficha debe tener un canonical absoluto a su propia URL limpia (sin parámetros) y, si la tienda tiene varios idiomas, hreflang recíprocos que incluyan la propia página.",
  );
}

const DEFAULT_PARAMS = { order: "order=product.price.asc", q: "q=Precio-%E2%82%AC-1-1000" } as const;

export function checkD3(ctx: ScanContext): Check {
  const category = ctx.snap.category;
  if (!category || category.status !== 200) {
    return inconclusive("D3", category?.url ?? ctx.snap.origin ?? ctx.snap.domain, "No se encontró una categoría que evaluar");
  }
  const base = category.finalUrl.split("?")[0]!;
  const parts = [
    { name: "?order=", url: ctx.snap.facets.orderUrl ?? `${base}?${DEFAULT_PARAMS.order}`, res: ctx.snap.facets.order },
    { name: "?q=", url: ctx.snap.facets.qUrl ?? `${base}?${DEFAULT_PARAMS.q}`, res: ctx.snap.facets.q },
  ];

  const evidence: Evidence[] = [];
  const scores = parts.map(({ name, url, res }) => {
    const verdicts = ctx.robots ? CAP_AGENTS.map((a) => robotsVerdict(ctx.robots!, url, AGENTS[a].robotsToken!)) : [];
    if (verdicts.length && verdicts.every((v) => v.allowed === false)) {
      evidence.push({ url, note: `${name} bloqueado en robots.txt (${verdicts[0]!.reason})` });
      return 1;
    }
    if (!res) {
      evidence.push({ url, note: `${name} rastreable y no se pidió para comprobar el canonical` });
      return null;
    }
    const verdict = facetVerdict(res, base);
    evidence.push(evidenceFrom(res, `${name} rastreable; ${verdict.note}`));
    return verdict.ok ? 1 : 0;
  });

  const { status, score } = statusFromScores(scores);
  return makeCheck("D3", {
    status,
    score,
    evidence,
    fix:
      status === "fail" || status === "hint"
        ? "Bloquea las URLs de filtros y ordenaciones en robots.txt (Disallow: /*?order= y Disallow: /*?q=, como trae PrestaShop por defecto) o haz que su canonical apunte a la categoría sin parámetros."
        : null,
  });
}

function facetVerdict(res: FetchResult, base: string): { ok: boolean; note: string } {
  if (res.status !== null && res.status >= 400) return { ok: true, note: `responde ${res.status}, no indexable` };
  const page = analyzePage(res);
  if (!page) return { ok: false, note: `respuesta ${res.status ?? res.error}` };
  if (page.metaRobots?.includes("noindex") || /noindex/i.test(res.headers["x-robots-tag"] ?? "")) {
    return { ok: true, note: "noindex ✓" };
  }
  if (page.canonical && pathOf(page.canonical) === pathOf(base)) return { ok: true, note: "canonical a la categoría limpia ✓" };
  return { ok: false, note: page.canonical ? `canonical a ${page.canonical} ✗` : "sin canonical ✗" };
}
