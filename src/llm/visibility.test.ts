import { describe, expect, it } from "vitest";
import { fakeLlm } from "../../test/llm";
import { snapshot } from "../../test/snapshot";
import { BudgetExceededError } from "./cost";
import type { BuyerQuery } from "./queries";
import type { Citation } from "./types";
import { runVisibility, storeCitations, storeIdentity, type StoreIdentity } from "./visibility";

const store: StoreIdentity = { domains: ["tienda.test"], names: ["Tienda Test", "tienda.test"] };
const queries: BuyerQuery[] = [
  { id: "q1", kind: "category", text: "mejor zapatilla de trail", sanitized: false },
  { id: "q2", kind: "purchase", text: "dónde comprar zapatillas de trail en España", sanitized: false },
];
const cite = (url: string): Citation => ({ url, title: null, domain: new URL(url).hostname.replace(/^www\./, "") });

describe("storeCitations", () => {
  it("acepta el dominio y sus subdominios, no dominios que solo lo contienen", () => {
    const hits = storeCitations([cite("https://www.tienda.test/p.html"), cite("https://blog.tienda.test/x"), cite("https://mitienda.test/")], ["tienda.test"]);
    expect(hits.map((h) => h.url)).toEqual(["https://www.tienda.test/p.html", "https://blog.tienda.test/x"]);
  });

  it("storeIdentity junta dominio de la petición y origen", () => {
    expect(storeIdentity(snapshot()).domains).toEqual(["tienda.test"]);
  });
});

describe("runVisibility", () => {
  it("cuenta citas por dominio y por nombre, con desglose y competidores", async () => {
    const llm = fakeLlm({
      search: (provider, query) =>
        provider === "openai" && query.startsWith("mejor")
          ? { text: "Mira Tienda Test y Decathlon.", cited: [cite("https://tienda.test/p.html"), cite("https://www.decathlon.es/x")] }
          : provider === "perplexity" && query.startsWith("dónde")
            ? { text: "En Tienda Test tienen envío gratis [1].", cited: [cite("https://www.decathlon.es/y")] }
            : { text: "Decathlon o Forum Sport.", cited: [cite("https://www.decathlon.es/z"), cite("https://forum-sport.com/")] },
      structured: (req) => {
        const text = req.user.split("Respuesta del asistente:\n")[1] ?? "";
        return text.includes("Tienda Test") ? { mentioned: true, quote: "En Tienda Test tienen envío gratis" } : { mentioned: false, quote: null };
      },
    });

    const v = await runVisibility(queries, store, llm);
    expect(v).toMatchObject({ total: 4, citedIn: 2, byProvider: { openai: { cited: 1, total: 2 }, perplexity: { cited: 1, total: 2 } } });
    const byKey = Object.fromEntries(v.answers.map((a) => [`${a.provider}:${a.queryId}`, a]));
    expect(byKey["openai:q1"]).toMatchObject({ method: "domain", storeUrls: ["https://tienda.test/p.html"] });
    expect(byKey["perplexity:q2"]).toMatchObject({ method: "name", quote: "En Tienda Test tienen envío gratis" });
    expect(v.topCompetitors).toEqual([
      { domain: "decathlon.es", answers: 4 },
      { domain: "forum-sport.com", answers: 2 },
    ]);
    // El paso 2 solo se lanza cuando el dominio no coincide.
    expect(llm.calls.filter((c) => c.purpose === "detection")).toHaveLength(3);
  });

  it("descarta una mención cuya cita no aparece en la respuesta", async () => {
    const llm = fakeLlm({
      search: () => ({ text: "Decathlon tiene buenas opciones.", cited: [] }),
      structured: () => ({ mentioned: true, quote: "Tienda Test es la mejor" }),
    });
    const v = await runVisibility(queries.slice(0, 1), store, llm, { providers: ["openai"] });
    expect(v.citedIn).toBe(0);
  });

  it("deja fuera del total las llamadas que fallan", async () => {
    const llm = fakeLlm({
      search: (provider) => {
        if (provider === "perplexity") throw new Error("Perplexity 503");
        return { text: "x", cited: [cite("https://tienda.test/")] };
      },
    });
    const v = await runVisibility(queries, store, llm);
    expect(v.total).toBe(2);
    expect(v.answers.filter((a) => a.error)).toHaveLength(2);
  });

  it("propaga el corte por presupuesto", async () => {
    const llm = fakeLlm({
      search: () => {
        throw new BudgetExceededError(2.1, 2);
      },
    });
    await expect(runVisibility(queries, store, llm)).rejects.toThrow(BudgetExceededError);
  });
});
