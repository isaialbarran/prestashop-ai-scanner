// Comprueba si los dominios de un CSV sirven para el lote antes de escanearlos.
// Uso: pnpm validate <dominios.csv> [--no-cache]
// Escribe <dominios>.validated.csv al lado (sin datos de contacto) e imprime una tabla.
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import pLimit from "p-limit";
import { POLITENESS } from "../config/scanner";
import { parseDomains } from "../src/batch/csv";
import { validateDomain, type DomainAssessment } from "../src/batch/validate";
import { createDiskCache } from "../src/fetch/cache";
import { createFetcher } from "../src/fetch/client";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { "no-cache": { type: "boolean", default: false } },
});
const csvPath = positionals[0];
if (!csvPath) {
  console.error("Uso: pnpm validate <dominios.csv> [--no-cache]");
  process.exit(2);
}

const domains = parseDomains(await readFile(csvPath, "utf8"));
const cache = values["no-cache"] ? null : createDiskCache();
const limit = pLimit(POLITENESS.parallelDomains);
console.log(`Validando ${domains.length} dominios (${POLITENESS.parallelDomains} en paralelo, como mucho 5 peticiones por dominio)…\n`);

const results: DomainAssessment[] = await Promise.all(
  domains.map((d) =>
    limit(async () => {
      const a = await validateDomain(d, createFetcher({ cache }));
      console.log(`${a.valid ? "✓" : "✗"} ${d}${a.reasons.length ? ` · ${a.reasons.join("; ")}` : ""}`);
      return a;
    }),
  ),
);

console.log();
console.table(
  results.map((a) => ({
    dominio: a.domain,
    válido: a.valid ? "sí" : "no",
    versión: a.version ?? "—",
    idioma: a.lang ?? "—",
    sitemap: a.sitemap ? "sí" : "no",
    fichas: a.productUrls,
    cloudflare: a.cloudflare ? "sí" : "",
    motivo: [...a.reasons, ...a.warnings].join("; "),
  })),
);

const out = csvPath.replace(/\.csv$/i, "") + ".validated.csv";
const csv = (s: string) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
await writeFile(
  out,
  [
    "domain,valid,version,lang,sitemap,product_urls,cloudflare,reasons,warnings",
    ...results.map((a) =>
      [a.domain, a.valid, a.version ?? "", a.lang ?? "", a.sitemap, a.productUrls, a.cloudflare, a.reasons.join("; "), a.warnings.join("; ")]
        .map((v) => csv(String(v)))
        .join(","),
    ),
  ].join("\n") + "\n",
);
console.log(`${results.filter((a) => a.valid).length}/${results.length} válidos · detalle en ${out}`);
