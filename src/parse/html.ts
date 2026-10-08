import { load, type CheerioAPI } from "cheerio";

export type Doc = CheerioAPI;

export function loadHtml(html: string): Doc {
  return load(html);
}

const INVISIBLE = "script, style, noscript, template, svg, iframe, head";

/** Texto que ve un lector sin JavaScript: sin scripts, estilos ni plantillas, con espacios colapsados. */
export function visibleText(html: string): string {
  const $ = load(html);
  $(INVISIBLE).remove();
  return collapse($.root().text());
}

export function textOf($: Doc, selector: string): string {
  const $clone = $(selector).first().clone();
  $clone.find(INVISIBLE).remove();
  return collapse($clone.text());
}

export function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function bodyId($: Doc): string | null {
  return $("body").attr("id") ?? null;
}

export function absoluteUrl(href: string | undefined | null, base: string): string | null {
  if (!href) return null;
  try {
    return new URL(href.trim(), base).toString();
  } catch {
    return null;
  }
}

export function canonicalOf($: Doc, base: string): string | null {
  return absoluteUrl($('link[rel="canonical"]').first().attr("href"), base);
}

export function hreflangOf($: Doc, base: string): { lang: string; href: string | null }[] {
  return $('link[rel="alternate"][hreflang]')
    .toArray()
    .map((el) => ({ lang: ($(el).attr("hreflang") ?? "").toLowerCase(), href: absoluteUrl($(el).attr("href"), base) }));
}

export function metaRobots($: Doc): string | null {
  return $('meta[name="robots"]').attr("content")?.toLowerCase() ?? null;
}

/** Recorta un fragmento para evidencia sin pasarse del límite del esquema. */
export function snippet(text: string, max = 300): string {
  const clean = collapse(text);
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
