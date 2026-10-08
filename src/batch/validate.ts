import { THRESHOLDS } from "../../config/scanner";
import { analyzePage } from "../checks/context";
import { sameSite } from "../checks/helpers";
import { detectPlatform } from "../checks/info";
import { interpretRobots } from "../discover/robots";
import { classifyUrl, parseSitemap, preferLanguage } from "../discover/sitemap";
import { detectChallenge } from "../fetch/challenge";
import type { FetchResult, Fetcher } from "../fetch/types";
import { absoluteUrl } from "../parse/html";

/** Si un dominio sirve para el lote: responde, es PrestaShop, vende en español y tiene fichas localizables. */
export interface DomainAssessment {
  domain: string;
  valid: boolean;
  /** Motivos de descarte. */
  reasons: string[];
  /** Avisos que no descartan pero conviene saber (WAF, versión desconocida…). */
  warnings: string[];
  finalUrl: string | null;
  version: string | null;
  lang: string | null;
  cloudflare: boolean;
  sitemap: boolean;
  productUrls: number;
}

export function assess(domain: string, home: FetchResult | null, sitemaps: FetchResult[]): DomainAssessment {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const base: DomainAssessment = {
    domain,
    valid: false,
    reasons,
    warnings,
    finalUrl: home?.finalUrl ?? null,
    version: null,
    lang: null,
    cloudflare: !!home?.headers["cf-ray"],
    sitemap: false,
    productUrls: 0,
  };
  if (!home || home.status === null) return { ...base, reasons: [`no responde (${home?.error ?? "sin respuesta"})`] };

  const challenge = detectChallenge(home);
  if (challenge) warnings.push(`la portada devuelve un ${challenge.kind === "challenge" ? "reto" : "bloqueo"} de ${challenge.vendor}`);
  if (home.status !== 200 && !challenge) reasons.push(`la portada responde ${home.status}`);
  if (home.redirects.length && !sameSite(home.url, home.finalUrl)) warnings.push(`redirige a otro dominio (${home.finalUrl})`);

  const platform = detectPlatform([home]);
  if (!platform.prestashop && !challenge) reasons.push("no se detecta PrestaShop");
  if (platform.prestashop && !platform.version) warnings.push("versión no identificable");

  const page = analyzePage(home);
  const lang = page?.$("html").attr("lang")?.toLowerCase() ?? null;
  const spanish = !!lang?.startsWith("es") || /\/es(\/|$)/.test(home.finalUrl);
  if (page && !spanish) reasons.push(`idioma de la portada: ${lang ?? "sin declarar"}`);

  const products = new Set<string>();
  let sitemap = false;
  for (const res of sitemaps) {
    const doc = parseSitemap(res.status === 200 ? res.body : null);
    if (doc.kind !== "invalid") sitemap = true;
    for (const e of doc.entries) if (classifyUrl(e.loc, e.hasImage) === "product") products.add(e.loc);
  }
  page?.$("a[href]").each((_, a) => {
    const url = absoluteUrl(page.$(a).attr("href"), page.url);
    if (url && classifyUrl(url) === "product") products.add(url.split("#")[0]!);
  });
  if (!sitemap) warnings.push("sin sitemap: las fichas salen de los enlaces de la portada");
  if (page && products.size < THRESHOLDS.productsPerDomain) reasons.push(`solo ${products.size} fichas localizables`);

  return {
    ...base,
    valid: reasons.length === 0 && !challenge,
    version: platform.version ?? (platform.prestashop ? "?" : null),
    lang,
    sitemap,
    productUrls: products.size,
  };
}

/** Pide la portada, robots.txt y el sitemap (y su primer hijo si es un índice): como mucho 4 peticiones más redirecciones. */
export async function validateDomain(domain: string, fetcher: Fetcher): Promise<DomainAssessment> {
  let home = await fetcher.get(`https://${domain}/`, "browser");
  if (home.status === null) {
    const plain = await fetcher.get(`http://${domain}/`, "browser");
    if (plain.status !== null) home = plain;
  }
  if (home.status === null) return assess(domain, home, []);

  const origin = new URL(home.finalUrl).origin;
  const robotsUrl = `${origin}/robots.txt`;
  const robots = interpretRobots(await fetcher.get(robotsUrl, "browser"), robotsUrl);
  const declared = robots.kind === "parsed" ? robots.sitemaps.filter((s) => sameSite(s, origin)) : [];

  const sitemaps: FetchResult[] = [];
  const first = await fetcher.get(declared[0] ?? `${origin}/1_index_sitemap.xml`, "browser");
  sitemaps.push(first);
  const doc = parseSitemap(first.status === 200 ? first.body : null);
  if (doc.kind === "index" && doc.entries.length) {
    sitemaps.push(await fetcher.get(preferLanguage(doc.entries.map((e) => e.loc))[0]!, "browser"));
  }
  return assess(domain, home, sitemaps);
}
