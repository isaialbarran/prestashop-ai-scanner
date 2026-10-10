import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv";
import { carryOverLabels, importRows } from "./import";

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

describe("plantillas", () => {
  it("al regenerar conserva lo etiquetado en las filas con el mismo id", () => {
    const previous = toCsv(
      [
        { id: "a.es:A2", estado_escaner: "fail", de_acuerdo: "no", estado_correcto: "inconclusive", nota: "reto CF" },
        { id: "b.es:A2", estado_escaner: "pass", de_acuerdo: "", estado_correcto: "", nota: "" },
      ],
      ["id", "estado_escaner", "de_acuerdo", "estado_correcto", "nota"],
    );
    const rows: Record<string, unknown>[] = [
      { id: "a.es:A2", estado_escaner: "fail", de_acuerdo: "", estado_correcto: "", nota: "" },
      { id: "b.es:A2", estado_escaner: "pass", de_acuerdo: "", estado_correcto: "", nota: "" },
      { id: "c.es:A2", estado_escaner: "pass", de_acuerdo: "", estado_correcto: "", nota: "" },
    ];
    expect(carryOverLabels(previous, rows, ["de_acuerdo", "estado_correcto", "nota"])).toBe(1);
    expect(rows[0]).toMatchObject({ de_acuerdo: "no", estado_correcto: "inconclusive", nota: "reto CF" });
    expect(rows[2]).toMatchObject({ de_acuerdo: "" });
  });

  it("importa solo las filas etiquetadas y explica las que están mal", () => {
    const rows = parseCsv(
      toCsv(
        [
          { id: "a.es:A2", dominio: "a.es", check: "A2", estado_escaner: "fail", de_acuerdo: "sí", estado_correcto: "", nota: "" },
          { id: "b.es:A2", dominio: "b.es", check: "A2", estado_escaner: "pass", de_acuerdo: "", estado_correcto: "", nota: "" },
          { id: "c.es:A2", dominio: "c.es", check: "A2", estado_escaner: "pass", de_acuerdo: "no", estado_correcto: "", nota: "" },
        ],
        ["id", "dominio", "check", "estado_escaner", "de_acuerdo", "estado_correcto", "nota"],
      ),
    );
    const r = importRows("checks", rows);
    expect(r.labels).toHaveLength(1);
    expect(r.skipped).toBe(1);
    expect(r.errors[0]).toMatch(/fila 4 \(c\.es:A2\).*estado correcto/);
  });
});
