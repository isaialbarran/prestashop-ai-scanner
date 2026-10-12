import { describe, expect, it } from "vitest";
import { fixture } from "../../test/fixtures";
import { fakeLlm } from "../../test/llm";
import { fr } from "../../test/snapshot";
import { cleanHtmlForBot, extractProduct } from "./extract";

describe("cleanHtmlForBot", () => {
  it("quita scripts, JSON-LD, estilos, head y atributos de marcado", () => {
    const { html, truncated } = cleanHtmlForBot(fixture("html/product-16.html"));
    expect(truncated).toBe(false);
    expect(html).not.toMatch(/<script|<style|application\/ld\+json|<head|itemprop|content=|baseDir/);
    expect(html).toContain("19,95 €");
    expect(html).toContain('id="our_price_display"');
  });

  it("quita lo que el tema oculta con CSS: avisos de stock de 1.6, [hidden], .hidden", () => {
    const html = `<html><body><h1>Mascarilla</h1><p id="availability_statut" style="display: none;">Disponible</p>
      <p id="last_quantities" class="warning_inline" style="display:none">¡Últimas unidades!</p>
      <span class="unvisible">Fecha de disponibilidad</span><div hidden>Agotado</div><div class="hidden">Sin stock</div>
      <span style="visibility: hidden">Preventa</span><p class="d-none d-md-block">Envío en 24 h</p><p>En stock</p></body></html>`;
    const { html: out } = cleanHtmlForBot(html);
    expect(out).not.toMatch(/Disponible|Últimas|Fecha de disponibilidad|Agotado|Sin stock|Preventa/);
    // d-none con d-md-block se ve en escritorio: se queda.
    expect(out).toContain("Envío en 24 h");
    expect(out).toContain("En stock");
  });

  it("si no cabe, se queda con el contenido principal y recorta", () => {
    const big = `<html><body><header>${"menú ".repeat(5000)}</header><section id="main"><h1>Ficha</h1>${"texto ".repeat(50)}</section></body></html>`;
    const { html } = cleanHtmlForBot(big, 1000);
    expect(html.startsWith('<section id="main"><h1>Ficha</h1>')).toBe(true);
    const { truncated } = cleanHtmlForBot(big, 100);
    expect(truncated).toBe(true);
  });
});

describe("extractProduct", () => {
  it("devuelve los datos validados y envía el HTML limpio", async () => {
    let sent = "";
    const llm = fakeLlm({
      structured: (req) => {
        sent = req.user;
        return { name: "Camiseta algodón orgánico", price: 19.95, currency: "EUR", availability: "InStock", availabilityText: "Disponible", gtin: null, brand: null };
      },
    });
    const res = fr("https://vieja.test/camisetas/7-camiseta-algodon-organico.html", 200, fixture("html/product-16.html"));
    const { data } = await extractProduct(res, llm);
    expect(data).toMatchObject({ price: 19.95, availability: "InStock", gtin: null });
    expect(sent).not.toContain("<script");
    // La URL no se envía: el modelo sacaba de ella GTIN y referencias que la página no muestra.
    expect(sent).not.toContain("7-camiseta-algodon-organico");
  });

  const page = `<html><body><h1>Armario ICT</h1><p>59,90 €</p><a href="/armario-ict-8412345678905.html">ficha</a>
    <p>Disponibilidad: <span>Últimas unidades</span></p><button>Añadir al carrito</button><dl><dt>EAN13</dt><dd>4006381333931</dd></dl></body></html>`;
  const draft = (over: Record<string, unknown>) => ({
    name: "Armario ICT",
    price: 59.9,
    currency: "EUR",
    availability: "LimitedAvailability",
    availabilityText: "Últimas unidades",
    gtin: "4006381333931",
    brand: null,
    ...over,
  });

  it("acepta disponibilidad y GTIN cuando están escritos en el texto de la página", async () => {
    const { data } = await extractProduct(fr("https://t.test/p.html", 200, page), fakeLlm({ structured: () => draft({}) }));
    expect(data).toEqual({ name: "Armario ICT", price: 59.9, currency: "EUR", availability: "LimitedAvailability", gtin: "4006381333931", brand: null });
  });

  it("reconoce los avisos de stock de los temas de 1.6", async () => {
    const html = page.replace("Últimas unidades", "Advertencia: ¡Últimos artículos en inventario!");
    const llm = fakeLlm({ structured: () => draft({ availabilityText: "Advertencia: ¡Últimos artículos en inventario!" }) });
    expect((await extractProduct(fr("https://t.test/p.html", 200, html), llm)).data.availability).toBe("LimitedAvailability");
  });

  it("descarta una disponibilidad sin frase literal que la respalde", async () => {
    const run = (over: Record<string, unknown>) => extractProduct(fr("https://t.test/p.html", 200, page), fakeLlm({ structured: () => draft(over) }));
    expect((await run({ availability: "InStock", availabilityText: null })).data.availability).toBeNull();
    expect((await run({ availability: "InStock", availabilityText: "Añadir al carrito" })).data.availability).toBeNull();
  });

  it("descarta un GTIN que solo está en un enlace", async () => {
    const { data } = await extractProduct(fr("https://t.test/p.html", 200, page), fakeLlm({ structured: () => draft({ gtin: "8412345678905" }) }));
    expect(data.gtin).toBeNull();
  });

  it("rechaza una disponibilidad fuera del vocabulario de schema.org", async () => {
    const llm = fakeLlm({ structured: () => ({ name: "x", price: 1, currency: "EUR", availability: "En stock", availabilityText: "En stock", gtin: null, brand: null }) });
    await expect(extractProduct(fr("https://t.test/p.html", 200, "<html></html>"), llm)).rejects.toThrow();
  });
});
