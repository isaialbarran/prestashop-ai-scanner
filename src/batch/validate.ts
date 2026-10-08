import { THRESHOLDS } from "../../config/scanner";
import { analyzePage } from "../checks/context";
import { sameSite } from "../checks/helpers";
import { detectPlatform } from "../checks/info";
import { interpretRobots } from "../discover/robots";
import { candidateCount, collectCandidates } from "../discover/candidates";
import { parseSitemap, preferLanguage } from "../discover/sitemap";
import { detectChallenge } from "../fetch/challenge";
import type { FetchResult, Fetcher } from "../fetch/types";

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
  if (challenge) {
    const vendor = challenge.vendor === "generic" ? "un sistema antibots" : challenge.vendor;
    warnings.push(`la portada devuelve un ${challenge.kind === "challenge" ? "reto" : "bloqueo"} de ${vendor}`);
  }
  if (home.status !== 200 && !challenge) reasons.push(`la portada responde ${home.status}`);
  if (home.redirects.length && !sameSite(home.url, home.finalUrl)) warnings.push(`redirige a otro dominio (${home.finalUrl})`);

  const platform = detectPlatform([home]);
  if (!platform.prestashop && !challenge) reasons.push("no se detecta PrestaShop");
  if (platform.prestashop && !platform.version) warnings.push("versión no identificable");

  const page = analyzePage(home);
  const lang = page?.$("html").attr("lang")?.toLowerCase() ?? home.headers["content-language"]?.toLowerCase() ?? null;
  if (page && !lang && !/\/es(\/|$)/.test(home.finalUrl)) warnings.push("la portada no declara idioma");
  else if (page && lang && !lang.startsWith("es") && !/\/es(\/|$)/.test(home.finalUrl)) reasons.push(`idioma de la portada: ${lang}`);

  const docs = sitemaps.map((res) => parseSitemap(res.status === 200 ? res.body : null));
  const sitemap = docs.some((d) => d.kind !== "invalid");
  const origin = new URL(home.finalUrl).origin;
  const productUrls = candidateCount(collectCandidates(docs, page, origin));
  if (!sitemap) warnings.push("sin sitemap: las fichas salen de la portada");
  if (page && productUrls < THRESHOLDS.productsPerDomain) reasons.push(`solo ${productUrls} fichas localizables`);

  return {
    ...base,
    valid: reasons.length === 0 && !challenge,
    version: platform.version ?? (platform.prestashop ? "?" : null),
    lang,
    sitemap,
    productUrls,
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
