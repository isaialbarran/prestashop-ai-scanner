import { describe, expect, it } from "vitest";
import { availabilityFromKey, evidenceLines, headingOf, progress, textAnswer } from "./label";

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

  it("separa la evidencia en líneas", () => {
    expect(evidenceLines("a (200) uno | b dos || [q1] tres")).toEqual(["a (200) uno", "b dos", "[q1] tres"]);
  });

  it("dibuja el progreso", () => {
    expect(progress(5, 20)).toBe("[█████░░░░░░░░░░░░░░░] 5/20");
  });
});
