import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv";

describe("CSV de etiquetado", () => {
  it("ida y vuelta con comillas, comas y saltos de línea", () => {
    const rows = [{ id: "a", nota: 'dice "hola", y\nsigue', precio: 4.55 }, { id: "b", nota: null, precio: "" }];
    expect(parseCsv(toCsv(rows, ["id", "nota", "precio"]))).toEqual([
      { id: "a", nota: 'dice "hola", y\nsigue', precio: "4.55" },
      { id: "b", nota: "", precio: "" },
    ]);
  });

  it("lee el CSV con punto y coma que exporta Excel en español", () => {
    expect(parseCsv("﻿id;precio;nota\r\nx;4,55;ok\r\n")).toEqual([{ id: "x", precio: "4,55", nota: "ok" }]);
  });

  it("ignora filas vacías", () => {
    expect(parseCsv("id,a\n\n1,2\n,\n")).toEqual([{ id: "1", a: "2" }]);
  });
});
