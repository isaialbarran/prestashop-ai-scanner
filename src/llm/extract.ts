import { load } from "cheerio";
import { z } from "zod";
import { LLM_LIMITS, MODELS } from "../../config/models";
import type { ExtractedProduct } from "../checks/types";
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

// Atributos que conserva el HTML que se envía: los visibles o los que ayudan a orientarse.
// Fuera itemprop, content y meta: son marcado, y C2 compara justo el marcado con lo visible.
const KEEP_ATTRS = new Set(["href", "alt", "title", "id", "class"]);
const MAIN = ["#main", "main", "#center_column", "#content"];

/**
 * HTML de la ficha tal como lo ve un rastreador sin JavaScript, sin scripts ni estilos.
 * Solo el body y, si no cabe, solo el contenido principal; después se recorta.
 */
export function cleanHtmlForBot(html: string, maxChars: number = LLM_LIMITS.extractMaxChars): { html: string; truncated: boolean } {
  const $ = load(html);
  $("script, style, template, svg, iframe, link, meta, noscript img").remove();
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
  const { data, call } = await llm.structured({
    purpose: "extraction",
    model: MODELS.cheap,
    name: "product_as_seen_by_bot",
    schema: ExtractedProductSchema,
    system:
      "Lees el HTML de una ficha de producto tal como lo recibe un rastreador sin JavaScript. Extraes solo lo que un comprador vería escrito en la página. Si un dato no aparece en el HTML, devuelves null; nunca lo deduces ni lo inventas.",
    user: [
      "Extrae:",
      "- name: nombre del producto.",
      "- price: precio final que paga el comprador, como número con punto decimal (89.9). Si hay precio tachado y precio rebajado, el rebajado.",
      "- currency: código ISO 4217 (EUR si se muestra €).",
      `- availability: uno de ${AVAILABILITY.join(", ")}, según el texto visible ("En stock" → InStock, "Agotado" → OutOfStock…).`,
      "- gtin: EAN/GTIN solo si aparece escrito en la página.",
      "- brand: marca o fabricante si aparece.",
      "",
      `URL: ${res.finalUrl}`,
      "HTML:",
      html,
    ].join("\n"),
  });
  return { data, call, truncated };
}
