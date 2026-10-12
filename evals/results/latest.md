# Evals · 2026-10-12

| | Eval | Dataset | Métrica | Valor | Umbral |
|---|---|---|---|---|---|
| ✓ | Checks deterministas | 30 tiendas | Discrepancias A2 · C2 · C3 | 1 · 7 · 1 | < 3 en A2 |
| ✗ | Extracción | 50 fichas | Acierto exacto por campo | nombre 92 % · precio 78 % · moneda 86 % · disponib. 64 % · gtin 78 % · marca 70 % | ≥ 95 % en precio |
| ✓ | Detección de citas | 100 respuestas | Precisión · recall | 1,00 · 0,94 (VP 33, FP 0, FN 2) | ≥ 0,9 ambas |
| ✗ | Fidelidad del informe | 20 informes | % frases respaldadas (juicio humano) | 90.1 % (164/182); borrador con referencia válida 100 % | 100 % |
| · | Estabilidad | 10 tiendas × 3 | Variación de citedIn | rango medio 0.7 · σ media 0.33 · pares estables 96.5 % | Solo medir |
| ✓ | Coste y latencia | 31 informes (10 en frío) | € y s por informe (p50 · p95) | 0,54 € · 0,59 €; 89 s · 129 s | p95 < 1 € y < 3 min |
