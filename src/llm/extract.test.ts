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
        return { name: "Camiseta algodón orgánico", price: 19.95, currency: "EUR", availability: "InStock", gtin: null, brand: null };
      },
    });
    const res = fr("https://vieja.test/camisetas/7-camiseta-algodon-organico.html", 200, fixture("html/product-16.html"));
    const { data } = await extractProduct(res, llm);
    expect(data).toMatchObject({ price: 19.95, availability: "InStock", gtin: null });
    expect(sent).not.toContain("<script");
  });

  it("rechaza una disponibilidad fuera del vocabulario de schema.org", async () => {
    const llm = fakeLlm({ structured: () => ({ name: "x", price: 1, currency: "EUR", availability: "En stock", gtin: null, brand: null }) });
    await expect(extractProduct(fr("https://t.test/p.html", 200, "<html></html>"), llm)).rejects.toThrow();
  });
});
