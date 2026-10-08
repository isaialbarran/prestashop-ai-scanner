import { describe, expect, it } from "vitest";
import { fixture } from "../../test/fixtures";
import { classicAt, fr, ORIGIN, product, PRODUCT_URLS, snapshot } from "../../test/snapshot";
import { CheckSchema } from "../schema";
import { runCheck } from "./index";

const robots = (body: string, status = 200) => fr(`${ORIGIN}/robots.txt`, status, body);
const challenge = fixture("html/cloudflare-challenge.html");

describe("A1 robots.txt", () => {
  it("pasa con el robots.txt por defecto de PrestaShop", () => {
    const c = runCheck("A1", snapshot());
    expect(CheckSchema.parse(c)).toMatchObject({ status: "pass", points: 10 });
    expect(c.perAgent).toEqual({ "oai-searchbot": "pass", perplexitybot: "pass", googlebot: "pass" });
  });

  it("marca al agente bloqueado con la línea exacta y da puntos parciales", () => {
    const c = runCheck("A1", snapshot({ robots: robots(fixture("robots/block-oai.txt")) }));
    expect(c.status).toBe("hint");
    expect(c.points).toBeCloseTo(6.67, 2);
    expect(c.perAgent?.["oai-searchbot"]).toBe("fail");
    const ev = c.evidence.find((e) => e.agent === "oai-searchbot");
    expect(ev?.snippet).toBe("Disallow: /");
    expect(c.fix).toMatch(/OAI-SearchBot/);
  });

  it("falla si robots.txt da 5xx", () => {
    expect(runCheck("A1", snapshot({ robots: robots("", 503) }))).toMatchObject({ status: "fail", points: 0 });
  });

  it("es inconcluso si robots.txt no responde", () => {
    expect(runCheck("A1", snapshot({ robots: fr(`${ORIGIN}/robots.txt`, null, null) })).status).toBe("inconclusive");
  });
});

describe("A2 misma respuesta para rastreadores", () => {
  const blockedGooglebot = (body: string, status: number, headers: Record<string, string>) =>
    PRODUCT_URLS.map((url) =>
      product(url, classicAt(url), {
        googlebot: [1, 2].map((attempt) => fr(url, status, body, { agent: "googlebot", attempt, headers })),
      }),
    );

  it("pasa si todos reciben la misma ficha", () => {
    const c = runCheck("A2", snapshot());
    expect(CheckSchema.parse(c)).toMatchObject({ status: "pass", points: 15 });
  });

  it("clasifica un reto de Cloudflare como waf", () => {
    const c = runCheck("A2", snapshot({ products: blockedGooglebot(challenge, 403, { server: "cloudflare", "cf-mitigated": "challenge" }) }));
    expect(c.status).toBe("hint");
    expect(c.points).toBeCloseTo(11.25, 2);
    expect(c.perAgent?.googlebot).toBe("fail");
    expect(c.blockKind?.googlebot).toBe("waf");
    expect(c.evidence.find((e) => e.agent === "googlebot")?.headers?.["cf-mitigated"]).toBe("challenge");
  });

  it("clasifica un 403 del propio servidor como origen", () => {
    const c = runCheck("A2", snapshot({ products: blockedGooglebot("<h1>Forbidden</h1>", 403, { server: "nginx" }) }));
    expect(c.blockKind?.googlebot).toBe("origen");
  });

  it("no falla si el segundo intento sale bien", () => {
    const products = PRODUCT_URLS.map((url) =>
      product(url, classicAt(url), {
        perplexitybot: [
          fr(url, 429, "", { agent: "perplexitybot", attempt: 1 }),
          fr(url, 200, classicAt(url), { agent: "perplexitybot", attempt: 2 }),
        ],
      }),
    );
    expect(runCheck("A2", snapshot({ products }))).toMatchObject({ status: "pass", points: 15 });
  });

  it("no marca fallo con un solo intento fallido", () => {
    const products = PRODUCT_URLS.map((url) =>
      product(url, classicAt(url), { perplexitybot: [fr(url, 429, "", { agent: "perplexitybot" })] }),
    );
    const c = runCheck("A2", snapshot({ products }));
    expect(c.perAgent?.perplexitybot).toBe("inconclusive");
    expect(c.points).toBe(15);
  });

  it("falla si el rastreador recibe una página mucho más corta", () => {
    const products = PRODUCT_URLS.map((url) =>
      product(url, classicAt(url), {
        "chatgpt-user": [1, 2].map((attempt) => fr(url, 200, "<html><body><p>Hola</p></body></html>", { agent: "chatgpt-user", attempt })),
      }),
    );
    const c = runCheck("A2", snapshot({ products }));
    expect(c.perAgent?.["chatgpt-user"]).toBe("fail");
    expect(c.blockKind?.["chatgpt-user"]).toBe("origen");
  });

  it("compara el contenido principal: un banner de cookies que solo ve el navegador no es un fallo", () => {
    const banner = `<div id="cookiesplus-modal"><p>${"Usamos cookies propias y de terceros para analizar tus hábitos. ".repeat(80)}</p></div>`;
    const products = PRODUCT_URLS.map((url) =>
      product(url, classicAt(url), { browser: [fr(url, 200, classicAt(url).replace("</body>", `${banner}</body>`))] }),
    );
    const c = runCheck("A2", snapshot({ products }));
    expect(c).toMatchObject({ status: "pass", points: 15 });
  });

  it("acepta la misma ficha con plantilla móvil para Googlebot aunque tenga menos texto", () => {
    const mobile = () =>
      `<html><head><meta name="viewport" content="width=device-width"></head><body id="product"><h1>Zapatilla trail Ligera 2</h1><span class="current-price">89,90 €</span></body></html>`;
    const products = PRODUCT_URLS.map((url) =>
      product(url, classicAt(url), { googlebot: [fr(url, 200, mobile(), { agent: "googlebot" })] }),
    );
    const c = runCheck("A2", snapshot({ products }));
    expect(c.perAgent?.googlebot).toBe("pass");
    expect(c.evidence.find((e) => e.agent === "googlebot")?.note).toMatch(/misma ficha con otra plantilla/);
  });

  it("no culpa al user-agent si el navegador también deja de responder después (límite por IP)", () => {
    const down = (url: string) => fr(url, null, null, { error: "fetch failed (UND_ERR_CONNECT_TIMEOUT)" });
    const products = PRODUCT_URLS.map((url) =>
      product(url, classicAt(url), { googlebot: [1, 2].map((attempt) => ({ ...down(url), agent: "googlebot" as const, attempt })) }),
    );
    const cut = snapshot({ products, category: down(`${ORIGIN}/3-zapatillas`), ucp: down(`${ORIGIN}/.well-known/ucp`), llms: down(`${ORIGIN}/llms.txt`) });
    const c = runCheck("A2", cut);
    expect(c.perAgent?.googlebot).toBe("inconclusive");
    expect(c.blockKind?.googlebot).toBeUndefined();

    const stillUp = snapshot({ products });
    expect(runCheck("A2", stillUp).blockKind?.googlebot).toBe("origen");
  });

  it("es inconcluso si el navegador tampoco entra", () => {
    const products = PRODUCT_URLS.map((url) => product(url, challenge, {}));
    for (const p of products) {
      for (const list of Object.values(p.fetches)) list[0] = { ...list[0]!, status: 403, headers: { "cf-mitigated": "challenge" } };
    }
    expect(runCheck("A2", snapshot({ products })).status).toBe("inconclusive");
  });
});

describe("A3 muro previo", () => {
  it("pasa si portada y fichas cargan", () => {
    expect(runCheck("A3", snapshot())).toMatchObject({ status: "pass", points: 5 });
  });

  it("detecta el modo mantenimiento", () => {
    const c = runCheck("A3", snapshot({ home: fr(`${ORIGIN}/`, 503, fixture("html/maintenance.html")) }));
    expect(c).toMatchObject({ status: "fail", points: 0 });
    expect(c.evidence[0]?.note).toMatch(/mantenimiento/);
  });

  it("detecta una redirección al login", () => {
    const url = PRODUCT_URLS[0]!;
    const login = fr(url, 200, fixture("html/login.html"), {
      finalUrl: `${ORIGIN}/iniciar-sesion?back=${encodeURIComponent(url)}`,
      redirects: [{ url, status: 302, location: `${ORIGIN}/iniciar-sesion` }],
    });
    const products = [product(url, "", { browser: [login] }), ...snapshot().products.slice(1)];
    expect(runCheck("A3", snapshot({ products })).evidence.some((e) => /login/.test(e.note))).toBe(true);
  });

  it("detecta el modo catálogo", () => {
    const products = PRODUCT_URLS.map((url) => product(url, fixture("html/product-catalog-mode.html")));
    const c = runCheck("A3", snapshot({ products }));
    expect(c.status).toBe("fail");
    expect(c.evidence.some((e) => /catálogo/.test(e.note))).toBe(true);
  });

  it("no da por cargadas las fichas que devuelven un reto al navegador", () => {
    const products = PRODUCT_URLS.map((url) =>
      product(url, classicAt(url), {
        browser: [fr(url, 403, challenge, { headers: { server: "cloudflare", "cf-mitigated": "challenge" } })],
      }),
    );
    const c = runCheck("A3", snapshot({ products }));
    expect(c.status).toBe("inconclusive");
    expect(c.evidence[0]?.note).toMatch(/3 fichas no cargan para el navegador \(403, reto de cloudflare\)/);
  });

  it("detecta la redirección a otro dominio", () => {
    const home = fr(`${ORIGIN}/`, 200, fixture("html/home.html"), {
      finalUrl: "https://tienda-internacional.test/en/",
      redirects: [{ url: `${ORIGIN}/`, status: 302, location: "https://tienda-internacional.test/en/" }],
    });
    expect(runCheck("A3", snapshot({ home })).status).toBe("fail");
  });
});
