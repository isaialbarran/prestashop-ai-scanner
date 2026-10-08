import { describe, expect, it } from "vitest";
import { fakeLlm } from "../../test/llm";
import { snapshot } from "../../test/snapshot";
import { runAllChecks } from "../checks/index";
import { computeScore } from "../scoring/score";
import type { ScanResult, VisibilityResult } from "../schema";
import { enforceEvidence, reportContext, splitSentences, writeReport } from "./report";

const ids = new Set(["A2", "C4", "q3"]);

describe("splitSentences", () => {
  it("corta tras el punto y las referencias", () => {
    expect(splitSentences("Falta el envío en el marcado [C4]. ChatGPT no te cita [q3]. ¿Por qué? Porque no estás [A2].")).toEqual([
      "Falta el envío en el marcado [C4].",
      "ChatGPT no te cita [q3].",
      "¿Por qué?",
      "Porque no estás [A2].",
    ]);
  });
});

describe("enforceEvidence", () => {
  it("quita frases sin referencia o con referencias inexistentes", () => {
    const r = enforceEvidence("Falta el envío [C4]. Tu web es lenta. Revisa el tema [Z9]. Googlebot entra bien [A2].", ids);
    expect(r.kept).toBe("Falta el envío [C4]. Googlebot entra bien [A2].");
    expect(r.dropped).toEqual(["Tu web es lenta.", "Revisa el tema [Z9]."]);
  });
});

const scan = (): ScanResult => {
  const checks = runAllChecks(snapshot());
  return {
    id: "6f1c2b0e-3a4d-4e5f-8a9b-0c1d2e3f4a5b",
    domain: "tienda.test",
    origin: "https://tienda.test",
    scannedAt: "2026-10-08T10:00:00.000Z",
    scannerVersion: "0.1.0",
    platform: { prestashop: true, version: "1.7 o posterior" },
    pages: { home: null, category: null, products: [] },
    checks,
    score: computeScore(checks),
    requests: { network: 0, cached: 0, budget: 40 },
    durationMs: 0,
    errors: [],
  };
};

const visibility: VisibilityResult = {
  providers: ["openai", "perplexity"],
  queries: [{ id: "q1", kind: "purchase", text: "dónde comprar zapatillas de trail en España", sanitized: false }],
  total: 2,
  citedIn: 0,
  byProvider: { openai: { cited: 0, total: 1 }, perplexity: { cited: 0, total: 1 } },
  topCompetitors: [{ domain: "decathlon.es", answers: 2 }],
  answers: [],
};

describe("writeReport", () => {
  it("pasa los checks y las consultas al modelo y filtra lo que no tiene evidencia", async () => {
    let prompt = "";
    const llm = fakeLlm({
      structured: (req) => {
        prompt = req.user;
        return {
          headline: "Ningún asistente te cita en compras de zapatillas [q1]. Te faltan envío y devoluciones en el marcado [C4].",
          findings: ["Sin datos de envío ni devoluciones [C4]. Añádelos al Offer [C4].", "Decathlon aparece donde tú no [q1].", "Somos líderes del sector."],
        };
      },
    });
    const { report } = await writeReport(scan(), visibility, llm);
    expect(prompt).toContain("[C4]");
    expect(prompt).toContain('[q1] "dónde comprar zapatillas de trail en España": no cita la tienda; dominios citados: ninguno');
    expect(report.headline).toMatch(/^Ningún asistente/);
    expect(report.findings).toHaveLength(2);
    expect(report.dropped).toEqual(["Somos líderes del sector."]);
  });

  it("el contexto incluye nota, tope y competidores", () => {
    expect(reportContext(scan(), visibility)).toMatch(/Competidores más citados: decathlon\.es \(2\)/);
  });
});
