import { fixture } from "./fixtures";
import { classicAt } from "./snapshot";
import type { FetchImpl } from "../src/fetch/types";

export const O = "https://tienda.test";

/** Tienda falsa servida desde fixtures; `blockAgent` responde 403 a ese user-agent en las fichas. */
export function fakeShop(opts: { blockAgent?: string } = {}) {
  const pages: Record<string, () => string> = {
    [`${O}/`]: () => fixture("html/home.html"),
    [`${O}/robots.txt`]: () => fixture("robots/allow-all.txt"),
    [`${O}/1_index_sitemap.xml`]: () => fixture("sitemap/index.xml"),
    [`${O}/1_es_0_sitemap.xml`]: () => fixture("sitemap/es.xml"),
    [`${O}/3-zapatillas`]: () => fixture("html/category.html"),
    [`${O}/4-mochilas`]: () => fixture("html/category.html"),
    [`${O}/zapatillas/12-zapatilla-trail-ligera-2.html`]: () => fixture("html/product-classic.html"),
    [`${O}/zapatillas/13-zapatilla-asfalto.html`]: () => classicAt(`${O}/zapatillas/13-zapatilla-asfalto.html`),
    [`${O}/mochilas/31-mochila-urbana-20l.html`]: () => fixture("html/product-conflict.html"),
    [`${O}/mochilas/32-1-mochila-trail-12l.html`]: () => classicAt(`${O}/mochilas/32-1-mochila-trail-12l.html`),
    [`${O}/index.php?id_product=40&controller=product&id_lang=1`]: () => fixture("html/product-16.html"),
  };
  const calls: { url: string; ua: string; method: string }[] = [];
  const fetchImpl: FetchImpl = async (url, init) => {
    const ua = new Headers(init.headers).get("user-agent") ?? "";
    calls.push({ url, ua, method: init.method ?? "GET" });
    if (url === "http://tienda.test/") return new Response(null, { status: 301, headers: { location: `${O}/` } });
    const page = pages[url];
    if (!page) return new Response("<html><body>404</body></html>", { status: 404 });
    if (opts.blockAgent && ua.includes(opts.blockAgent) && /\.html|id_product/.test(url)) {
      return new Response("<h1>Forbidden</h1>", { status: 403, headers: { server: "nginx" } });
    }
    return new Response(page(), { status: 200, headers: { "content-type": url.endsWith(".xml") ? "application/xml" : "text/html" } });
  };
  return { fetchImpl, calls };
}

