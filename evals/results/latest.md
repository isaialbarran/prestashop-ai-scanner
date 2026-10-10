# Evals · 2026-10-08

| | Eval | Dataset | Métrica | Valor | Umbral |
|---|---|---|---|---|---|
| ? | Checks deterministas | — | Discrepancias A2 · C2 · C3 | — | < 3 en A2 |
| ? | Extracción | — | Acierto exacto por campo | — | ≥ 95 % en precio |
| ? | Detección de citas | — | Precisión · recall | — | ≥ 0,9 ambas |
| ? | Fidelidad del informe | — | % frases respaldadas | — | 100 % |
| · | Estabilidad | 10 tiendas × 3 | Variación de citedIn | rango medio 0.7 · σ media 0.33 · pares estables 96.5 % | Solo medir |
| ✓ | Coste y latencia | 31 informes (10 en frío) | € y s por informe (p50 · p95) | 0,54 € · 0,59 €; 89 s · 129 s | p95 < 1 € y < 3 min |
