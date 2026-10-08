import { describe, expect, it } from "vitest";
import { fixture } from "../../test/fixtures";
import { costUsd } from "./cost";
import { domainOf, openAISearchBody, openAIUsage, parseOpenAISearch } from "./openai";
import { parsePerplexity, perplexityBody, perplexityUsage } from "./perplexity";

const openai = () => JSON.parse(fixture("llm/openai-search.json"));
const pplx = () => JSON.parse(fixture("llm/perplexity-agent.json"));

describe("OpenAI", () => {
  it("pide búsqueda forzada con ubicación España y lista de fuentes", () => {
    const body = openAISearchBody("chat-latest", "mejor freidora de aire");
    expect(body.tools[0]).toMatchObject({ type: "web_search", user_location: { country: "ES" } });
    expect(body.tool_choice).toBe("required");
    expect(body.include).toContain("web_search_call.action.sources");
  });

  it("separa URLs citadas de consultadas", () => {
    const a = parseOpenAISearch(openai(), "chat-latest");
    expect(a.cited.map((c) => c.domain)).toEqual(["ocu.org", "amazon.es"]);
    expect(a.consulted.map((c) => c.domain)).toEqual(["ocu.org", "jocca.es", "amazon.es"]);
    expect(a.searchQueries).toEqual(["mejor freidora de aire 4 personas"]);
    expect(a.text).toMatch(/^Para 4 personas/);
  });

  it("lee el uso y cuenta las búsquedas para el coste", () => {
    const u = openAIUsage(openai());
    expect(u).toMatchObject({ inputTokens: 9200, outputTokens: 420, searchCalls: 1 });
    expect(costUsd("openai", "chat-latest", u)).toBeCloseTo(0.046 + 0.0126 + 0.01, 6);
  });
});

describe("Perplexity", () => {
  it("toma como citadas solo las fuentes marcadas con [n]", () => {
    const a = parsePerplexity(pplx(), "perplexity/sonar");
    expect(a.citationMode).toBe("markers");
    expect(a.cited.map((c) => c.domain)).toEqual(["forum-sport.com", "decathlon.es"]);
    expect(a.consulted).toHaveLength(3);
  });

  it("sin marcas no cuenta ninguna cita: los resultados solo son consultados", () => {
    const r = pplx();
    r.output[1].content[0].text = "Puedes comprarlas en Forum Sport o Decathlon.";
    const a = parsePerplexity(r, "perplexity/sonar");
    expect(a.citationMode).toBe("no-markers");
    expect(a.cited).toEqual([]);
    expect(a.consulted).toHaveLength(3);
  });

  it("usa el preset fast (citas [n]) con el modelo propio de Perplexity y ubicación España", () => {
    expect(perplexityBody("perplexity/sonar", "x")).toEqual({
      preset: "fast",
      model: "perplexity/sonar",
      input: "x",
      tools: [{ type: "web_search", user_location: { country: "ES" } }],
    });
  });

  it("usa el coste que informa la API y las invocaciones de búsqueda", () => {
    const { usage, reportedCostUsd } = perplexityUsage(pplx());
    expect(usage).toMatchObject({ inputTokens: 3100, outputTokens: 180, searchCalls: 1 });
    expect(reportedCostUsd).toBe(0.003725);
    expect(costUsd("perplexity", "perplexity/sonar", usage)).toBeCloseTo(reportedCostUsd!, 6);
  });
});

describe("domainOf", () => {
  it("quita www y normaliza", () => {
    expect(domainOf("https://WWW.Tienda.es/x")).toBe("tienda.es");
    expect(domainOf("tienda.es")).toBe("tienda.es");
  });
});
