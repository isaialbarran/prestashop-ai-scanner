import { describe, expect, it } from "vitest";
import { availabilityFromKey, evidenceLines, gtinFromInput, headingOf, labelSummary, progress, textAnswer } from "./label";

describe("asistente de etiquetado", () => {
  it("convierte la tecla del menú de disponibilidad", () => {
    expect(availabilityFromKey("2")).toBe("LimitedAvailability");
    expect(availabilityFromKey("")).toBeNull();
    expect(availabilityFromKey("9")).toBeUndefined();
  });

  it("Enter acepta la sugerencia, - es «no aparece»", () => {
    expect(textAnswer("", "Toga Talla")).toBe("Toga Talla");
    expect(textAnswer("-", "Toga Talla")).toBeNull();
    expect(textAnswer("  Otra  ", "Toga Talla")).toBe("Otra");
    expect(textAnswer("", null)).toBeNull();
  });

  it("sugiere el título principal de la página", () => {
    expect(headingOf("<html><body><h1> Traje  Completo </h1><h1>otro</h1></body></html>")).toBe("Traje Completo");
    expect(headingOf("<html><body><p>sin título</p></body></html>")).toBeNull();
  });

  it("no sugiere el título de la web cuando hay otro <h1>", () => {
    const html = `<h1 class="contact-link">Costura Ejemplo - Patchwork y costura creativa</h1><h1>Kit de costura - Azul</h1>`;
    expect(headingOf(html, "costuraejemplo.es")).toBe("Kit de costura - Azul");
    // Si el único <h1> empieza por la marca de la tienda, es el producto.
    expect(headingOf("<h1>Marcax PRO Negra</h1>", "www.marcax.es")).toBe("Marcax PRO Negra");
  });

  it("lee el GTIN escrito y avisa si no es un código válido", () => {
    expect(gtinFromInput("ean13 4006381333931")).toEqual({ gtin: "4006381333931", valid: true });
    expect(gtinFromInput("715891502624")).toEqual({ gtin: "715891502624", valid: true });
    expect(gtinFromInput("8412345678904")).toEqual({ gtin: "8412345678904", valid: false });
    // Dígitos pegados (el «13» de EAN13 delante): no es un código, hay que volver a escribirlo.
    expect(gtinFromInput("134006381333931")).toBeNull();
    expect(gtinFromInput("abc")).toBeNull();
  });

  it("resume una etiqueta para la revisión", () => {
    expect(labelSummary("extraction", { id: "x", name: "A", price: 16.99, currency: "EUR", availability: null, gtin: null, brand: null })).toBe(
      "nombre A · precio 16.99 · moneda EUR · disponibilidad — · gtin — · marca —",
    );
    expect(labelSummary("detection", { id: "x", label: false, note: "productor" })).toBe("no la cita · nota: productor");
    expect(labelSummary("fidelity", { id: "x", supported: false, note: null })).toBe("no respaldada");
  });

  it("separa la evidencia en líneas", () => {
    expect(evidenceLines("a (200) uno | b dos || [q1] tres")).toEqual(["a (200) uno", "b dos", "[q1] tres"]);
  });

  it("dibuja el progreso", () => {
    expect(progress(5, 20)).toBe("[█████░░░░░░░░░░░░░░░] 5/20");
  });
});
