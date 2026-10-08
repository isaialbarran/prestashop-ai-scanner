import type { ProductMarkup } from "../parse/product";
import { isOrganizationType, type StructuredData } from "../parse/structured";
import type { Check } from "../schema";
import { perProduct } from "./content";
import type { ScanContext } from "./context";
import { evidenceFrom, inconclusive, pickPrimaryProduct } from "./helpers";

const normalizeName = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Diferencias entre dos bloques Product en los campos que un buscador usa. */
function differences(a: ProductMarkup, b: ProductMarkup): string[] {
  const diffs: string[] = [];
  if (a.name && b.name && normalizeName(a.name) !== normalizeName(b.name)) diffs.push(`nombre «${a.name}» ≠ «${b.name}»`);
  if (a.price !== null && b.price !== null && Math.abs(a.price - b.price) > 0.009) diffs.push(`precio ${a.price} ≠ ${b.price}`);
  if (a.currency && b.currency && a.currency.toUpperCase() !== b.currency.toUpperCase()) diffs.push(`moneda ${a.currency} ≠ ${b.currency}`);
  if (a.availability && b.availability && a.availability !== b.availability) diffs.push(`disponibilidad ${a.availability} ≠ ${b.availability}`);
  if (a.sku && b.sku && a.sku !== b.sku) diffs.push(`sku ${a.sku} ≠ ${b.sku}`);
  return diffs;
}

const isValid = (p: ProductMarkup) => Boolean(p.name) && p.price !== null;

export function checkC1(ctx: ScanContext): Check {
  let conflict = false;
  let missing = false;
  const check = perProduct(
    "C1",
    ctx,
    (p) => {
      const { products, sd } = p.page!;
      const snippet = products.map((m) => `${m.source}: ${m.snippet}`).join(" | ");
      if (products.length === 0) {
        missing = true;
        const broken = sd.jsonLdErrors.length ? ` (${sd.jsonLdErrors.length} bloques JSON-LD con JSON inválido: ${sd.jsonLdErrors[0]!.message})` : "";
        return { score: 0, evidence: evidenceFrom(p.browser, `No hay ningún bloque Product${broken}`, broken ? { snippet: sd.jsonLdErrors[0]!.snippet } : {}) };
      }
      if (products.length === 1) {
        const [m] = products;
        return {
          score: isValid(m!) ? 1 : 0.5,
          evidence: evidenceFrom(
            p.browser,
            isValid(m!) ? `Un bloque Product (${m!.source}) con nombre y precio` : `Un bloque Product (${m!.source}) sin nombre o sin precio en offers`,
            { snippet },
          ),
        };
      }
      const diffs = products.slice(1).flatMap((other) => differences(products[0]!, other));
      if (diffs.length) {
        conflict = true;
        return {
          score: 0,
          evidence: evidenceFrom(p.browser, `${products.length} bloques Product en conflicto (${products.map((m) => m.source).join(" + ")}): ${diffs.join("; ")}`, { snippet }),
        };
      }
      return { score: 0.5, evidence: evidenceFrom(p.browser, `${products.length} bloques Product duplicados pero coherentes`, { snippet }) };
    },
    () =>
      conflict
        ? "Tema y módulo publican dos Product con datos distintos. Deja solo uno: desactiva los microdatos del tema o el JSON-LD del módulo de SEO, y comprueba que el que queda tiene el precio y la disponibilidad reales."
        : missing
          ? "Publica un bloque JSON-LD Product en la ficha con nombre, offers (precio, moneda, disponibilidad), marca e identificadores."
          : "Deja un único bloque Product con nombre y offers completos.",
  );
  return check;
}

/** Clases de disponibilidad: dos valores de la misma clase dicen lo mismo a un comprador. */
const AVAILABILITY_CLASS: Record<string, "disponible" | "no disponible" | "más adelante"> = {
  InStock: "disponible",
  LimitedAvailability: "disponible",
  OnlineOnly: "disponible",
  InStoreOnly: "disponible",
  OutOfStock: "no disponible",
  SoldOut: "no disponible",
  Discontinued: "no disponible",
  PreOrder: "más adelante",
  PreSale: "más adelante",
  BackOrder: "más adelante",
};

export function sameAvailability(markup: string | null, visible: string | null): boolean {
  if (!markup || !visible) return false;
  const a = AVAILABILITY_CLASS[markup];
  const b = AVAILABILITY_CLASS[visible];
  return a && b ? a === b : markup === visible;
}

export function checkC2(ctx: ScanContext): Check {
  const extracted = ctx.snap.extracted;
  if (!extracted) {
    return inconclusive(
      "C2",
      ctx.products[0]?.url ?? ctx.snap.origin ?? ctx.snap.domain,
      "Pendiente: el marcado se compara con lo que el LLM extrae de la ficha (extract.ts, fase 2)",
    );
  }
  return perProduct(
    "C2",
    ctx,
    (p) => {
      const visible = extracted[ctx.products.indexOf(p)] ?? null;
      if (!visible) return { score: null, evidence: evidenceFrom(p.browser, "Sin extracción de la ficha") };
      const m = pickPrimaryProduct(p.page!.products);
      if (!m) return { score: 0, evidence: evidenceFrom(p.browser, "No hay Offer en el marcado con el que comparar") };
      const fields = [
        ["precio", m.price, visible.price, m.price !== null && visible.price !== null && Math.abs(m.price - visible.price) < 0.01],
        ["moneda", m.currency, visible.currency, !!m.currency && m.currency.toUpperCase() === visible.currency?.toUpperCase()],
        ["disponibilidad", m.availability, visible.availability, sameAvailability(m.availability, visible.availability)],
      ] as const;
      return {
        score: fields.filter((f) => f[3]).length / fields.length,
        evidence: evidenceFrom(
          p.browser,
          fields.map(([label, markup, seen, ok]) => `${label}: marcado ${markup ?? "—"}, visible ${seen ?? "—"} ${ok ? "✓" : "✗"}`).join("; "),
        ),
      };
    },
    () => "El marcado no dice lo mismo que la ficha. Corrige el módulo o la plantilla que genera el Offer para que use el precio final con IVA, la moneda y el stock reales.",
  );
}

export function checkC3(ctx: ScanContext): Check {
  return perProduct(
    "C3",
    ctx,
    (p) => {
      const m = pickPrimaryProduct(p.page!.products);
      if (!m) return { score: 0, evidence: evidenceFrom(p.browser, "No hay bloque Product") };
      const gtinOk = Boolean(m.gtin && m.gtinValid);
      const score = (gtinOk || m.mpn ? 0.5 : 0) + (m.brand ? 0.25 : 0) + (m.sku ? 0.25 : 0);
      const gtin = m.gtin ? (m.gtinValid ? `gtin ${m.gtin} ✓` : `gtin ${m.gtin} ✗ (dígito de control incorrecto)`) : "gtin ✗";
      return {
        score,
        evidence: evidenceFrom(p.browser, `${gtin}, mpn ${m.mpn ? `✓ ${m.mpn}` : "✗"}, brand ${m.brand ? `✓ ${m.brand}` : "✗"}, sku ${m.sku ? `✓ ${m.sku}` : "✗"}`),
      };
    },
    () =>
      "Rellena EAN-13 (o MPN), marca y referencia en cada producto del back office y comprueba que el bloque Product los publica como gtin13, mpn, brand y sku.",
  );
}

const hasOrgReturnPolicy = (sd: StructuredData | undefined) =>
  !!sd?.nodes.some((n) => isOrganizationType(n.types) && n.data.hasMerchantReturnPolicy != null);

export function checkC4(ctx: ScanContext): Check {
  return perProduct(
    "C4",
    ctx,
    (p) => {
      const m = pickPrimaryProduct(p.page!.products);
      const shipping = !!m?.hasShipping;
      const returns = !!m?.hasReturnPolicy || hasOrgReturnPolicy(p.page!.sd) || hasOrgReturnPolicy(ctx.home?.sd);
      const rating = !!m?.hasRating;
      return {
        score: [shipping, returns, rating].filter(Boolean).length / 3,
        evidence: evidenceFrom(
          p.browser,
          `shippingDetails ${shipping ? "✓" : "✗"}, hasMerchantReturnPolicy ${returns ? "✓" : "✗"}, aggregateRating ${rating ? "✓" : "✗"}`,
        ),
      };
    },
    () => "Añade al Offer los gastos de envío (shippingDetails) y la política de devoluciones (hasMerchantReturnPolicy), y publica aggregateRating si tienes valoraciones.",
  );
}

export function checkC5(ctx: ScanContext): Check {
  const homeOrg = !!ctx.home?.sd.nodes.some((n) => isOrganizationType(n.types));
  return perProduct(
    "C5",
    ctx,
    (p) => {
      const nodes = p.page!.sd.nodes;
      const breadcrumb = nodes.some((n) => n.types.includes("BreadcrumbList"));
      const org = homeOrg || nodes.some((n) => isOrganizationType(n.types));
      return {
        score: ((breadcrumb ? 2 : 0) + (org ? 1 : 0)) / 3,
        evidence: evidenceFrom(p.browser, `BreadcrumbList ${breadcrumb ? "✓" : "✗"}, Organization ${org ? "✓" : "✗"}${homeOrg ? " (en la portada)" : ""}`),
      };
    },
    () => "Publica BreadcrumbList en las fichas y un bloque Organization (u OnlineStore) con nombre, logo y URL en la portada.",
  );
}
