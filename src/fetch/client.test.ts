import { describe, expect, it, vi } from "vitest";
import { AGENTS } from "../../config/agents";
import { createMemoryCache } from "./cache";
import { createFetcher } from "./client";
import { DomainLimiter } from "./limiter";
import type { FetchImpl } from "./types";

const noWait = () => new DomainLimiter({ minIntervalMs: 0, budget: 40 });

function routes(map: Record<string, () => Response>): FetchImpl & { calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const route = map[url];
    if (!route) throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } });
    return route();
  }) as FetchImpl & { calls: typeof calls };
  impl.calls = calls;
  return impl;
}

describe("createFetcher", () => {
  it("envía el user-agent del agente, solo GET y las mismas cabeceras para todos", async () => {
    const fetchImpl = routes({ "https://t.test/p.html": () => new Response("<h1>Hola</h1>", { status: 200 }) });
    const f = createFetcher({ fetchImpl, limiter: noWait() });

    await f.get("https://t.test/p.html", "googlebot");
    await f.get("https://t.test/p.html", "browser");

    const [bot, browser] = fetchImpl.calls.map((c) => new Headers(c.init.headers));
    expect(fetchImpl.calls.every((c) => c.init.method === "GET" && c.init.redirect === "manual")).toBe(true);
    expect(bot.get("user-agent")).toBe(AGENTS.googlebot.userAgent);
    expect(browser.get("user-agent")).toBe(AGENTS.browser.userAgent);
    expect(bot.get("accept-language")).toBe(browser.get("accept-language"));
  });

  it("sigue redirecciones y guarda la cadena; cada salto cuenta como petición", async () => {
    const fetchImpl = routes({
      "http://t.test/": () => new Response(null, { status: 301, headers: { location: "https://t.test/" } }),
      "https://t.test/": () => new Response(null, { status: 302, headers: { location: "/es/" } }),
      "https://t.test/es/": () => new Response("<html>ok</html>", { status: 200, headers: { "content-type": "text/html" } }),
    });
    const f = createFetcher({ fetchImpl, limiter: noWait() });

    const res = await f.get("http://t.test/", "browser");

    expect(res.status).toBe(200);
    expect(res.finalUrl).toBe("https://t.test/es/");
    expect(res.redirects.map((r) => r.status)).toEqual([301, 302]);
    expect(res.headers["content-type"]).toBe("text/html");
    expect(f.stats().network).toBe(3);
  });

  it("corta el cuerpo al superar el tamaño máximo", async () => {
    const fetchImpl = routes({ "https://t.test/big": () => new Response("x".repeat(1000), { status: 200 }) });
    const f = createFetcher({ fetchImpl, limiter: noWait(), maxBodyBytes: 100 });

    const res = await f.get("https://t.test/big", "browser");

    expect(res.truncated).toBe(true);
    expect(res.body).toHaveLength(100);
  });

  it("convierte errores de red en un resultado con error, sin lanzar", async () => {
    const f = createFetcher({ fetchImpl: routes({}), limiter: noWait() });
    const res = await f.get("https://nope.test/", "browser");
    expect(res.status).toBeNull();
    expect(res.error).toMatch(/ENOTFOUND/);
  });

  it("devuelve error de presupuesto cuando se agota", async () => {
    const fetchImpl = routes({ "https://t.test/": () => new Response("ok") });
    const f = createFetcher({ fetchImpl, limiter: new DomainLimiter({ minIntervalMs: 0, budget: 1 }) });

    await f.get("https://t.test/", "browser");
    const second = await f.get("https://t.test/", "googlebot");

    expect(second.error).toMatch(/presupuesto/);
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it("sirve desde la caché sin gastar presupuesto; el reintento usa otra clave", async () => {
    const fetchImpl = routes({ "https://t.test/": () => new Response("ok") });
    const cache = createMemoryCache();
    const first = createFetcher({ fetchImpl, limiter: noWait(), cache });
    await first.get("https://t.test/", "browser");

    const second = createFetcher({ fetchImpl, limiter: noWait(), cache });
    const hit = await second.get("https://t.test/", "browser");
    expect(hit.fromCache).toBe(true);
    expect(second.stats()).toMatchObject({ network: 0, cached: 1 });

    await second.get("https://t.test/", "browser", { attempt: 2 });
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it("no guarda en caché los errores de red", async () => {
    const cache = createMemoryCache();
    const set = vi.spyOn(cache, "set");
    const f = createFetcher({ fetchImpl: routes({}), limiter: noWait(), cache });
    await f.get("https://nope.test/", "browser");
    expect(set).not.toHaveBeenCalled();
  });
});
