import type { PageAnalysis } from "../checks/context";
import { sameSite } from "../checks/helpers";
import { absoluteUrl } from "../parse/html";
import { classifyUrl, type SitemapDoc } from "./sitemap";

export interface Candidates {
  /** Fichas por niveles de fiabilidad; se baraja dentro de cada nivel y se recorren en orden. */
  productTiers: string[][];
  categories: string[];
}

const clean = (url: string) => url.split("#")[0]!;

/**
 * Enlaces de las miniaturas de producto (`[data-id-product]` en classic, hummingbird y la mayoría de temas;
 * `a.product_img_link` en 1.6). No dependen del formato de la URL.
 */
export function productLinksFromPage(page: PageAnalysis, origin: string): string[] {
  const { $ } = page;
  const links = new Set<string>();
  $("[data-id-product]").each((_, el) => {
    const href = $(el)
      .find("a[href]")
      .toArray()
      .map((a) => absoluteUrl($(a).attr("href"), page.url))
      .find((u) => u?.startsWith("http") && sameSite(u, origin));
    if (href) links.add(clean(href));
  });
  $("a.product_img_link[href], .product-name a[href]").each((_, a) => {
    const href = absoluteUrl($(a).attr("href"), page.url);
    if (href && sameSite(href, origin)) links.add(clean(href));
  });
  return [...links];
}

/** Categoría de una ficha a partir de sus migas (BreadcrumbList o `.breadcrumb a`): el último enlace que no es la portada ni la propia ficha. */
export function categoryFromProductPage(page: PageAnalysis, origin: string): string | null {
  const isCandidate = (u: string | null): u is string =>
    !!u && sameSite(u, origin) && new URL(u).pathname.replace(/\/[a-z]{2}\/?$/, "/") !== "/" && clean(u) !== clean(page.url);

  for (const node of page.sd.nodes.filter((n) => n.types.includes("BreadcrumbList"))) {
    const items = (Array.isArray(node.data.itemListElement) ? node.data.itemListElement : [node.data.itemListElement])
      .map((li) => {
        const item = (li as { item?: unknown })?.item;
        const raw = typeof item === "string" ? item : (item as { "@id"?: string; url?: string } | undefined)?.["@id"] ?? (item as { url?: string } | undefined)?.url;
        return absoluteUrl(raw, page.url);
      })
      .filter(isCandidate);
    if (items.length) return clean(items.at(-1)!);
  }
  const links = page.$(".breadcrumb a[href], nav.breadcrumb a[href]")
    .toArray()
    .map((a) => absoluteUrl(page.$(a).attr("href"), page.url))
    .filter(isCandidate);
  return links.length ? clean(links.at(-1)!) : null;
}

/** Junta candidatas del sitemap y de la portada, de más a menos fiables. */
export function collectCandidates(docs: SitemapDoc[], home: PageAnalysis | null, origin: string): Candidates {
  const byPattern = new Set<string>();
  const byImage = new Set<string>();
  const categories = new Set<string>();
  for (const doc of docs) {
    for (const e of doc.entries) {
      if (!sameSite(e.loc, origin)) continue;
      const kind = classifyUrl(e.loc, e.hasImage);
      if (kind === "product") byPattern.add(clean(e.loc));
      else if (kind === "category") categories.add(clean(e.loc));
      else if (e.hasImage && doc.kind === "urlset") byImage.add(clean(e.loc));
    }
  }

  const fromHome = new Set<string>();
  if (home) {
    for (const url of productLinksFromPage(home, origin)) if (!byPattern.has(url)) fromHome.add(url);
    home.$("a[href]").each((_, a) => {
      const url = absoluteUrl(home.$(a).attr("href"), home.url);
      if (!url || !sameSite(url, origin)) return;
      const kind = classifyUrl(clean(url));
      if (kind === "product" && !byPattern.has(clean(url))) fromHome.add(clean(url));
      if (kind === "category" && categories.size < 200) categories.add(clean(url));
    });
  }

  const tiers = [[...byPattern], [...fromHome], [...byImage].filter((u) => !fromHome.has(u))];
  return { productTiers: tiers.filter((t) => t.length > 0), categories: [...categories] };
}

export function candidateCount(c: Candidates): number {
  return c.productTiers.reduce((s, t) => s + t.length, 0);
}
