import { collapse, type Doc } from "./html";

/** Lo que un lector sin JavaScript encuentra en la ficha (B1, B2, A3). */
export interface VisibleSignals {
  name: string | null;
  price: { text: string; selector: string } | null;
  availability: { text: string; selector: string } | null;
  addToCart: boolean;
  description: { text: string; selector: string; heuristic: boolean } | null;
}

// Selectores de los temas classic (1.7/8), hummingbird (9) y default-bootstrap (1.6).
const PRICE_SELECTORS = [
  ".current-price-value",
  ".current-price",
  "#our_price_display",
  ".product-price",
  ".product__current-price",
  "[itemprop=price]",
];
const AVAILABILITY_SELECTORS = [
  "#product-availability",
  "#availability_value",
  ".product-availability",
  ".product__availability",
  "#availability_statut",
];
const DESCRIPTION_SELECTORS = [
  "#description .product-description",
  "#description",
  ".product-description",
  "[itemprop=description]",
  "[id^=product-description-short]",
  "#short_description_content",
  ".page-product-box .rte",
  "#idTab1",
  ".product__description",
];
const ADD_TO_CART_SELECTORS = [
  "#add-to-cart-or-refresh",
  "[data-button-action=add-to-cart]",
  "#add_to_cart",
  "#buy_block button[type=submit]",
  ".add-to-cart",
];

const CURRENCY_AMOUNT = /(?:\d{1,3}(?:[.\s ]\d{3})*|\d+)[.,]\d{2}\s?(?:€|EUR)|€\s?\d+(?:[.,]\d{2})?/i;
const AVAILABILITY_WORDS =
  /\b(en stock|disponible|disponibilidad inmediata|últimas unidades|agotado|sin stock|fuera de stock|no disponible|bajo pedido|en existencias?|in stock|out of stock)\b/i;

export function visibleSignals($: Doc): VisibleSignals {
  const main = mainScope($);

  const name = collapse($("h1").first().text()) || null;

  let price: VisibleSignals["price"] = null;
  for (const sel of PRICE_SELECTORS) {
    const t = collapse(main.find(sel).first().text());
    if (CURRENCY_AMOUNT.test(t)) {
      price = { text: t.match(CURRENCY_AMOUNT)![0], selector: sel };
      break;
    }
  }
  if (!price) {
    const m = collapse(visibleTextOf(main)).match(CURRENCY_AMOUNT);
    if (m) price = { text: m[0], selector: "texto visible" };
  }

  let availability: VisibleSignals["availability"] = null;
  for (const sel of AVAILABILITY_SELECTORS) {
    const t = collapse(main.find(sel).first().text());
    if (t) {
      availability = { text: t, selector: sel };
      break;
    }
  }
  if (!availability) {
    const m = collapse(visibleTextOf(main)).match(AVAILABILITY_WORDS);
    if (m) availability = { text: m[0], selector: "texto visible" };
  }

  const addToCart = ADD_TO_CART_SELECTORS.some((sel) => $(sel).length > 0);

  return { name, price, availability, addToCart, description: description($) };
}

function description($: Doc): VisibleSignals["description"] {
  let best: VisibleSignals["description"] = null;
  for (const sel of DESCRIPTION_SELECTORS) {
    $(sel).each((_, el) => {
      const t = collapse(visibleTextOf($(el)));
      if (t && (!best || t.length > best.text.length)) best = { text: t, selector: sel, heuristic: false };
    });
  }
  if (best) return best;

  // Sin selector conocido: el contenedor con más texto en párrafos propios.
  mainScope($)
    .find("div, section, article")
    .each((_, el) => {
      const t = collapse(
        $(el)
          .children("p")
          .toArray()
          .map((p) => $(p).text())
          .join(" "),
      );
      if (t && (!best || t.length > best.text.length)) best = { text: t, selector: "heurística", heuristic: true };
    });
  return best;
}

function mainScope($: Doc) {
  for (const sel of ["#main", "main", "#center_column", "#content", "body"]) {
    const el = $(sel).first();
    if (el.length) return el;
  }
  return $.root();
}

function visibleTextOf(el: ReturnType<Doc>): string {
  const clone = el.clone();
  clone.find("script, style, noscript, template, svg").remove();
  return clone.text();
}
