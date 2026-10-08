// Genera las plantillas de etiquetado en data/private/evals/ (fuera de git).
// Uso: pnpm eval:prepare checks <dominios.csv>
//      pnpm eval:prepare extraction <dominios.csv> [--n 50]
//      pnpm eval:prepare detection [--n 100] [--from stability]
//      pnpm eval:prepare fidelity [--n 20] [--from stability]
// Extracción y detección van a ciegas: la plantilla no muestra lo que predijo el sistema.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { parseDomains } from "../src/batch/csv";
import { runAllChecks } from "../src/checks/index";
import { seededShuffle } from "../src/discover/sitemap";
import { toCsv } from "../src/evals/csv";
import { DATASETS_DIR, writeJsonl } from "../src/evals/datasets";
import { listReports, loadSnapshot, type StoredReport } from "../src/evals/sources";
import { detectChallenge } from "../src/fetch/challenge";
import { cleanHtmlForBot } from "../src/llm/extract";
import { storeNames } from "../src/llm/queries";
import { splitSentences } from "../src/llm/report";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { n: { type: "string" }, from: { type: "string" } },
});
const [kind, domainsCsv] = positionals;
await mkdir(DATASETS_DIR, { recursive: true });

const domainsFrom = async (file: string | undefined) => {
  if (!file) throw new Error("Falta el CSV de dominios");
  return parseDomains(await readFile(file, "utf8"));
};

switch (kind) {
  case "checks":
    await prepareChecks(await domainsFrom(domainsCsv));
    break;
  case "extraction":
    await prepareExtraction(await domainsFrom(domainsCsv), Number(values.n ?? 50));
    break;
  case "detection":
    await prepareDetection(Number(values.n ?? 100), values.from);
    break;
  case "fidelity":
    await prepareFidelity(Number(values.n ?? 20), values.from);
    break;
  default:
    console.error("Uso: pnpm eval:prepare checks|extraction|detection|fidelity …");
    process.exit(2);
}

async function prepareChecks(domains: string[]) {
  const rows: Record<string, unknown>[] = [];
  const missing: string[] = [];
  for (const domain of domains) {
    const snapshot = loadSnapshot(domain);
    if (!snapshot) {
      missing.push(domain);
      continue;
    }
    for (const check of runAllChecks(snapshot).filter((c) => ["A2", "C2", "C3"].includes(c.id))) {
      rows.push({
        id: `${domain}:${check.id}`,
        dominio: domain,
        check: check.id,
        estado_escaner: check.status,
        puntos: `${check.points}/${check.maxPoints}`,
        evidencia: check.evidence.map((e) => `${e.agent ? `${e.agent} ` : ""}${e.httpStatus ? `(${e.httpStatus}) ` : ""}${e.note}`).join(" | "),
        urls: snapshot.products.map((p) => p.url).join(" "),
        de_acuerdo: "",
        estado_correcto: "",
        nota: "",
      });
    }
  }
  const file = path.join(DATASETS_DIR, "checks.todo.csv");
  await writeFile(file, toCsv(rows, ["id", "dominio", "check", "estado_escaner", "puntos", "evidencia", "urls", "de_acuerdo", "estado_correcto", "nota"]));
  report(file, rows.length, missing);
}

async function prepareExtraction(domains: string[], n: number) {
  const viewDir = path.join(DATASETS_DIR, "vista-bot");
  await mkdir(viewDir, { recursive: true });
  // Reparto por turnos entre tiendas para que ninguna domine la muestra.
  const perDomain = domains.map((domain) => {
    const snapshot = loadSnapshot(domain);
    const products = (snapshot?.products ?? [])
      .map((p, index) => ({ domain, index, url: p.url, res: p.fetches.browser?.[0] ?? null }))
      .filter((p) => p.res?.status === 200 && p.res.body && !detectChallenge(p.res));
    return seededShuffle(products, `extraction:${domain}`);
  });
  const picked: (typeof perDomain)[number] = [];
  for (let round = 0; picked.length < n && perDomain.some((list) => list.length > round); round++) {
    for (const list of perDomain) if (list[round] && picked.length < n) picked.push(list[round]!);
  }

  const rows = [];
  for (const p of picked) {
    const view = `${p.domain}-${p.index}.html`;
    const { html } = cleanHtmlForBot(p.res!.body!);
    await writeFile(
      path.join(viewDir, view),
      `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Vista como bot · ${p.domain}</title></head><body>` +
        `<p style="background:#fff3cd;padding:8px;font:14px sans-serif">Vista como bot de <a href="${p.url}">${p.url}</a>: el mismo HTML que recibe el modelo, sin scripts ni estilos. Etiqueta lo que se ve aquí.</p>${html}</body></html>`,
    );
    rows.push({
      id: `${p.domain}:${p.index}`,
      dominio: p.domain,
      indice: p.index,
      url: p.url,
      vista_bot: `vista-bot/${view}`,
      nombre: "",
      precio: "",
      moneda: "",
      disponibilidad: "",
      gtin: "",
      marca: "",
      revisada: "",
      nota: "",
    });
  }
  const file = path.join(DATASETS_DIR, "extraction.todo.csv");
  await writeFile(file, toCsv(rows, ["id", "dominio", "indice", "url", "vista_bot", "nombre", "precio", "moneda", "disponibilidad", "gtin", "marca", "revisada", "nota"]));
  report(file, rows.length, domains.filter((d) => !loadSnapshot(d)));
}

async function prepareDetection(n: number, from?: string) {
  const answers = listReports(undefined, from ?? "").flatMap(({ file, report: r }) =>
    r.visibility.answers
      .filter((a) => !a.error && a.text)
      .map((a) => ({ file, report: r, answer: a, query: r.visibility.queries.find((q) => q.id === a.queryId)?.text ?? "" })),
  );
  // Estratificado: un tercio con enlace a la tienda (fácil) y el resto sin enlace, con prioridad a las menciones por nombre.
  const byDomainLink = seededShuffle(answers.filter((a) => a.answer.method === "domain"), "detection:domain");
  const byName = seededShuffle(answers.filter((a) => a.answer.method === "name"), "detection:name");
  const rest = seededShuffle(answers.filter((a) => a.answer.method === null), "detection:rest");
  const linkQuota = Math.round(n / 3);
  const picked = [...byDomainLink.slice(0, linkQuota), ...byName.slice(0, n - linkQuota)];
  picked.push(...rest.slice(0, n - picked.length));
  if (picked.length < n) picked.push(...byDomainLink.slice(linkQuota, linkQuota + n - picked.length));

  const names = new Map<string, string[]>();
  const items = seededShuffle(picked, "detection:order").map(({ file, report: r, answer: a, query }) => {
    if (!names.has(r.domain)) {
      const snapshot = loadSnapshot(r.domain);
      names.set(r.domain, snapshot ? storeNames(snapshot) : [r.domain]);
    }
    return {
      id: `${file}:${a.queryId}:${a.provider}`,
      report: file,
      domain: r.domain,
      storeNames: names.get(r.domain),
      queryId: a.queryId,
      provider: a.provider,
      query,
      text: a.text,
      citations: (a.citations ?? []).map((c) => c.url),
    };
  });
  const file = path.join(DATASETS_DIR, "detection.todo.jsonl");
  writeJsonl(file, items);
  report(file, items.length, [], answers.length < n ? `solo hay ${answers.length} respuestas con texto` : undefined);
}

async function prepareFidelity(n: number, from?: string) {
  const all = listReports(undefined, from ?? "");
  // Una ejecución por tienda primero, luego segundas ejecuciones: máxima variedad.
  const byRun = [...all].sort((a, b) => (a.report.run.index ?? 0) - (b.report.run.index ?? 0) || a.file.localeCompare(b.file));
  const picked: StoredReport[] = [];
  for (const r of byRun) if (picked.length < n && !picked.some((p) => p.report.domain === r.report.domain)) picked.push(r);
  for (const r of byRun) if (picked.length < n && !picked.includes(r)) picked.push(r);

  const rows = picked.flatMap(({ file, report: r }) => {
    const parts = [
      ["titular", r.report.headline ?? ""],
      ...r.report.findings.map((f, i) => [`hallazgo ${i + 1}`, f]),
    ] as const;
    return parts.flatMap(([part, textPart]) =>
      splitSentences(textPart).map((sentence, i) => {
        const refs = [...sentence.matchAll(/\[([A-Z]\d|q\d{1,2})\]/g)].map((m) => m[1]!);
        return {
          id: `${file}:${part}:${i + 1}`,
          informe: file,
          dominio: r.domain,
          parte: part,
          frase: sentence,
          referencias: refs.join(" "),
          evidencia: refs.map((ref) => evidenceFor(r, ref)).join(" || "),
          respaldada: "",
          nota: "",
        };
      }),
    );
  });
  const file = path.join(DATASETS_DIR, "fidelity.todo.csv");
  await writeFile(file, toCsv(rows, ["id", "informe", "dominio", "parte", "frase", "referencias", "evidencia", "respaldada", "nota"]));
  report(file, rows.length, [], `${picked.length} informes`);
}

function evidenceFor(r: StoredReport["report"], ref: string): string {
  const check = r.scan.checks.find((c) => c.id === ref);
  if (check) return `[${ref}] ${check.title}: ${check.status} ${check.points}/${check.maxPoints}. ${check.evidence.map((e) => e.note).join(" / ")}`;
  const query = r.visibility.queries.find((q) => q.id === ref);
  if (query) {
    const answers = r.visibility.answers.filter((a) => a.queryId === ref && !a.error);
    const detail = answers.map((a) => `${a.provider}: ${a.cited ? "cita la tienda" : "no la cita"}; dominios ${a.citedDomains.join(", ") || "—"}`).join("; ");
    return `[${ref}] "${query.text}": ${detail}`;
  }
  return `[${ref}] no existe en este informe`;
}

function report(file: string, count: number, missing: string[], extra?: string) {
  console.log(`✓ ${file}: ${count} filas${extra ? ` (${extra})` : ""}`);
  if (missing.length) console.log(`  Sin snapshot (lanza antes pnpm batch --mode extract): ${missing.join(", ")}`);
}
