// Vuelca cada fallo de los evals con su contexto para el análisis de errores (data/private/evals/errores.md).
// Uso: pnpm eval:errors   (usa la caché del LLM: sin cambios en prompts o modelos no cuesta nada)
import { writeFileSync } from "node:fs";
import path from "node:path";
import { load } from "cheerio";
import { datasetPath, DATASETS_DIR, DetectionLabelSchema, ExtractionLabelSchema, FidelityLabelSchema, readJsonl } from "../src/evals/datasets";
import { fieldMatches, FIELDS } from "../src/evals/metrics";
import { listReports, loadSnapshot } from "../src/evals/sources";
import { cleanHtmlForBot, extractProduct } from "../src/llm/extract";
import { domainOf } from "../src/llm/openai";
import { storeNames } from "../src/llm/queries";
import { detectMention, storeCitations } from "../src/llm/visibility";
import { collapse } from "../src/parse/html";
import { evalLlm } from "../evals/lib";

const out: string[] = [`# Análisis de errores · ${new Date().toISOString().slice(0, 10)}`, ""];
const { llm } = evalLlm();

// ── Extracción ──────────────────────────────────────────────────────────────
const AMOUNT = /(?:\d{1,3}(?:[.\s ]\d{3})*|\d+)[.,]\d{2}\s?(?:€|EUR)|€\s?\d+(?:[.,]\d{2})?/gi;
const STOCK = /(en stock|disponible|disponibilidad[^.]{0,40}|últimas unidades|agotado|sin stock|fuera de stock|no disponible|bajo pedido|preventa|descatalogado|añadir al carrito|comprar)/gi;
const around = (text: string, re: RegExp, width = 45) =>
  [...text.matchAll(re)].slice(0, 12).map((m) => `«…${text.slice(Math.max(0, m.index! - width), m.index! + m[0].length + width).replace(/\s+/g, " ")}…»`);

const extraction = readJsonl(datasetPath("extraction"), ExtractionLabelSchema) ?? [];
out.push(`## Extracción (${extraction.length} fichas)`, "");
for (const l of extraction) {
  const res = loadSnapshot(l.domain)?.products[l.productIndex]?.fetches.browser?.[0];
  if (!res?.body) continue;
  const { data } = await extractProduct(res, llm);
  const truth = { name: l.name, price: l.price, currency: l.currency, availability: l.availability, gtin: l.gtin, brand: l.brand };
  const wrong = FIELDS.filter((f) => !fieldMatches(f, truth, data));
  if (!wrong.length) continue;
  const text = collapse(load(cleanHtmlForBot(res.body).html).root().text());
  out.push(`### ${l.id} · ${wrong.join(", ")}`, l.url, "");
  for (const f of wrong) out.push(`- **${f}**: etiqueta \`${truth[f] ?? "∅"}\` · modelo \`${data[f] ?? "∅"}\``);
  if (wrong.includes("price") || wrong.includes("currency")) out.push("", "Importes en la vista como bot:", ...around(text, AMOUNT).map((s) => `  - ${s}`));
  if (wrong.includes("availability")) out.push("", "Texto de stock en la vista como bot:", ...around(text, STOCK, 30).map((s) => `  - ${s}`));
  if (l.note) out.push("", `Nota de Isai: ${l.note}`);
  out.push("");
}

// ── Detección ───────────────────────────────────────────────────────────────
const detection = readJsonl(datasetPath("detection"), DetectionLabelSchema) ?? [];
const reports = new Map(listReports().map((r) => [r.file, r.report]));
out.push(`## Detección de citas (${detection.length} respuestas): falsos positivos y negativos`, "");
for (const l of detection) {
  const report = reports.get(l.report);
  const answer = report?.visibility.answers.find((a) => a.queryId === l.queryId && a.provider === l.provider);
  if (!report || !answer?.text) continue;
  const snapshot = loadSnapshot(l.domain);
  const store = {
    domains: [...new Set([domainOf(`https://${report.domain}`), ...(report.scan.origin ? [domainOf(report.scan.origin)] : [])])],
    names: snapshot ? storeNames(snapshot) : [report.domain],
  };
  const citations = (answer.citations ?? []).map((c) => ({ ...c, title: null }));
  const byDomain = storeCitations(citations, store.domains);
  const mention = byDomain.length ? null : await detectMention(answer.text, store, llm);
  const pred = byDomain.length > 0 || !!mention?.mentioned;
  if (pred === l.label) continue;
  const query = report.visibility.queries.find((q) => q.id === l.queryId)?.text;
  out.push(
    `### ${pred ? "Falso positivo" : "Falso negativo"} · ${l.id}`,
    `Tienda ${l.domain} (nombres que se buscan: ${store.names.join(", ")}) · ${l.provider} · «${query}»`,
    "",
    `- Detección: ${byDomain.length ? `por dominio (${byDomain.map((c) => c.url).join(", ")})` : `por nombre, cita «${mention?.quote}»`}`,
    `- URLs citadas: ${citations.map((c) => c.url).join(", ") || "ninguna"}`,
    l.note ? `- Nota de Isai: ${l.note}` : "",
    "",
    "```",
    answer.text.slice(0, 1500),
    "```",
    "",
  );
}

// ── Fidelidad ───────────────────────────────────────────────────────────────
const fidelity = readJsonl(datasetPath("fidelity"), FidelityLabelSchema) ?? [];
out.push(`## Fidelidad (${fidelity.length} frases): no respaldadas`, "");
for (const l of fidelity.filter((f) => !f.supported)) {
  const report = reports.get(l.report);
  const evidence = l.refs.map((ref) => {
    const check = report?.scan.checks.find((c) => c.id === ref);
    if (check) return `[${ref}] ${check.status} ${check.points}/${check.maxPoints}: ${check.evidence.map((e) => e.note).join(" / ")}`;
    const q = report?.visibility.queries.find((x) => x.id === ref);
    const answers = report?.visibility.answers.filter((a) => a.queryId === ref && !a.error) ?? [];
    return q ? `[${ref}] «${q.text}»: ${answers.map((a) => `${a.provider} ${a.cited ? "cita" : "no cita"} (${a.citedDomains.join(", ") || "—"})`).join("; ")}` : `[${ref}] no existe`;
  });
  out.push(`### ${l.id}`, "", `> ${l.sentence}`, "", `- Nota de Isai: ${l.note ?? "—"}`, ...evidence.map((e) => `- ${e.slice(0, 600)}`), "");
}

const file = path.join(DATASETS_DIR, "errores.md");
writeFileSync(file, out.join("\n"));
console.log(`✓ ${file}`);
