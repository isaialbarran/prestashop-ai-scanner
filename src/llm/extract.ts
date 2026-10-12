import { load } from "cheerio";
import { z } from "zod";
import { LLM_LIMITS, MODELS } from "../../config/models";
import type { ExtractedProduct } from "../checks/types";
import { collapse } from "../parse/html";
import type { FetchResult } from "../fetch/types";
import type { Llm, LlmCall } from "./types";

export const AVAILABILITY = [
  "InStock",
  "OutOfStock",
  "PreOrder",
  "BackOrder",
  "LimitedAvailability",
  "Discontinued",
  "SoldOut",
  "InStoreOnly",
  "OnlineOnly",
] as const;

export const ExtractedProductSchema = z.object({
  name: z.string().nullable(),
  price: z.number().nullable(),
  currency: z.string().nullable(),
  availability: z.enum(AVAILABILITY).nullable(),
  gtin: z.string().nullable(),
  brand: z.string().nullable(),
}) satisfies z.ZodType<ExtractedProduct>;

// Lo que pide al modelo: además, la frase literal de stock, que el código comprueba en la página.
const DraftSchema = ExtractedProductSchema.extend({ availabilityText: z.string().nullable() });

// Una frase de stock o de plazo lleva alguna de estas palabras; un botón de compra, no.
const STOCK_WORDS = /stock|inventario|disponib|existencia|agotad|unidad|ultim|quedan|entrega|envio|plazo|dias|horas|pedido|fabricacion|preventa|proximamente|descatalogad|avisame|notific/;
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Como en la detección de citas: el modelo solo puede afirmar lo que está escrito. La disponibilidad necesita una frase
 * de stock literal y el GTIN tiene que estar en el texto (no en un enlace ni en el nombre de una imagen).
 */
function grounded(draft: z.infer<typeof DraftSchema>, html: string): ExtractedProduct {
  const text = norm(collapse(load(html).root().text()));
  const quote = draft.availabilityText ? norm(draft.availabilityText) : "";
  const availability = draft.availability && quote && STOCK_WORDS.test(quote) && text.includes(quote) ? draft.availability : null;
  const digits = draft.gtin?.replace(/\D/g, "") ?? "";
  const gtin = digits.length >= 8 && text.replace(/\s/g, "").includes(digits) ? digits : null;
  return { name: draft.name, price: draft.price, currency: draft.currency, availability, gtin, brand: draft.brand };
}

// Atributos que conserva el HTML que se envía: los visibles o los que ayudan a orientarse.
// Fuera itemprop, content y meta: son marcado, y C2 compara justo el marcado con lo visible.
const KEEP_ATTRS = new Set(["href", "alt", "title", "id", "class"]);
const MAIN = ["#main", "main", "#center_column", "#content"];

// Lo que el tema oculta con CSS no lo ve el comprador. Los temas de 1.6 meten en el HTML todos los avisos de stock
// («¡Últimas unidades!», «Fecha de disponibilidad»…) con display:none y JavaScript enseña el que toca.
const HIDDEN_STYLE = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/i;
const HIDDEN_CLASSES = new Set(["hidden", "unvisible", "invisible", "hidden-xs-up", "d-none"]);
// d-none d-md-block: oculto en móvil y visible en escritorio, así que se queda.
const SHOWN_FROM_BREAKPOINT = /^d-(?:sm|md|lg|xl|xxl)-(?!none$)/;

function isHidden(attribs: Record<string, string>): boolean {
  if ("hidden" in attribs) return true;
  if (attribs.style && HIDDEN_STYLE.test(attribs.style)) return true;
  const classes = (attribs.class ?? "").split(/\s+/);
  const hiding = classes.filter((c) => HIDDEN_CLASSES.has(c));
  if (!hiding.length) return false;
  return !(hiding.length === 1 && hiding[0] === "d-none" && classes.some((c) => SHOWN_FROM_BREAKPOINT.test(c)));
}

/**
 * HTML de la ficha tal como lo ve un rastreador sin JavaScript, sin scripts ni estilos ni lo que el tema oculta.
 * Solo el body y, si no cabe, solo el contenido principal; después se recorta.
 */
export function cleanHtmlForBot(html: string, maxChars: number = LLM_LIMITS.extractMaxChars): { html: string; truncated: boolean } {
  const $ = load(html);
  $("script, style, template, svg, iframe, link, meta, noscript img").remove();
  $("body *")
    .filter((_, el) => el.type === "tag" && isHidden(el.attribs))
    .remove();
  $("*")
    .contents()
    .filter((_, n) => n.type === "comment")
    .remove();
  $("*").each((_, el) => {
    if (el.type !== "tag") return;
    for (const name of Object.keys(el.attribs)) if (!KEEP_ATTRS.has(name)) $(el).removeAttr(name);
  });

  const squash = (s: string) => s.replace(/\s+/g, " ").replace(/>\s+</g, "><").trim();
  let out = squash($("body").html() ?? $.root().html() ?? "");
  if (out.length > maxChars) {
    const main = MAIN.map((sel) => $(sel).first()).find((el) => el.length);
    if (main) out = squash($.html(main));
  }
  return out.length > maxChars ? { html: out.slice(0, maxChars), truncated: true } : { html: out, truncated: false };
}

export async function extractProduct(res: FetchResult, llm: Llm): Promise<{ data: ExtractedProduct; call: LlmCall; truncated: boolean }> {
  const { html, truncated } = cleanHtmlForBot(res.body ?? "");
  const { data: draft, call } = await llm.structured({
    purpose: "extraction",
    model: MODELS.cheap,
    name: "product_as_seen_by_bot",
    schema: DraftSchema,
    system:
      "Lees el HTML de una ficha de producto tal como lo recibe un rastreador sin JavaScript. Extraes solo lo que un comprador vería escrito en la página. Si un dato no aparece escrito, devuelves null; nunca lo deduces ni lo inventas.",
    // Mismas convenciones que evals/GUIDELINES.md: el eval mide contra etiquetas hechas con ellas.
    user: [
      "Extrae:",
      "- name: nombre del producto, normalmente el título principal. No el nombre de la web.",
      "- price: precio vigente de lo que se compra con el botón de compra, con IVA si la ficha lo da (si solo da el precio sin IVA, ese), como número con punto decimal (89.9). Si hay un precio anterior tachado y uno rebajado, el rebajado. Si la página da un precio por unidad (€/ud, €/m) además del de la caja o la bobina que se compra, el de la caja o la bobina. Ignora el carrito, los gastos de envío, los productos relacionados y los importes de 0.",
      "- currency: código ISO 4217 (EUR si se muestra €). Si no hay precio, null.",
      `- availability: uno de ${AVAILABILITY.join(", ")}, solo si la ficha escribe el estado del stock o un plazo de este producto: "En stock", "Disponible" o "Entrega en 24 h" junto al precio → InStock; "Últimas unidades" → LimitedAvailability; "Agotado", "Sin stock", "Avísame cuando esté disponible" → OutOfStock; "Bajo pedido", "Disponible en X días" → BackOrder; "Preventa" → PreOrder; "Descatalogado" → Discontinued. Un botón de compra, los plazos de envío generales de la tienda o un banner de envío gratis no dicen nada del stock: null.`,
      "- availabilityText: la frase de la página en la que te basas para availability, copiada literalmente. null si availability es null.",
      "- gtin: el EAN, GTIN o UPC solo si aparece escrito en el texto con su etiqueta (EAN, EAN13, GTIN, UPC, código de barras). Solo los dígitos. Nunca lo saques de enlaces, nombres de imagen ni referencias internas.",
      "- brand: la marca o el fabricante solo si la página lo escribe como tal («Marca: X», «Fabricante: X», un enlace a la página del fabricante). No la deduzcas del nombre del producto ni del de la tienda.",
      "",
      "HTML:",
      html,
    ].join("\n"),
  });
  return { data: grounded(draft, html), call, truncated };
}
