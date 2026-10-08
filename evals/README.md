# Evals

`pnpm eval` imprime la tabla de los 6 evals y falla si alguna métrica no llega a su umbral. También deja el resultado agregado en `evals/results/latest.md` y `latest.json`. Ese es el único resultado que se sube al repo.

| Eval | Dataset | Métrica | Umbral |
|---|---|---|---|
| Checks deterministas | 30 tiendas revisadas a mano | Discrepancias en A2, C2 y C3 | < 3 en A2 |
| Extracción | 50 fichas etiquetadas | Acierto exacto por campo | ≥ 95 % en precio |
| Detección de citas | 100 respuestas etiquetadas sí/no | Precisión y recall | ≥ 0,9 ambas |
| Fidelidad del informe | 20 informes | % de frases respaldadas por su evidencia | 100 % |
| Estabilidad | 10 tiendas × 3 ejecuciones | Variación de `citedIn` | Solo medir |
| Coste y latencia | Todos los informes | € y segundos por informe, p50 y p95 | p95 < 1 € y < 3 min |

## Dónde están los datos

El repo es público y los datasets valoran tiendas reales con nombre propio. Por eso todo vive fuera de git, en `data/private/`:

- `data/private/evals/`: plantillas (`*.todo.csv` y `detection.todo.jsonl`), etiquetas (`*.jsonl`) y la vista «como bot» de cada ficha (`vista-bot/`). Cada importación deja una copia en la tabla `eval_labels` de Supabase.
- `data/private/snapshots/<dominio>.json`: respuestas HTTP y extracción de cada tienda. El eval de checks se recalcula sobre ellas sin red.
- `data/private/reports/`: informes completos. La estabilidad lee `reports/stability/`.

Las etiquetas las pone Isai a mano y **nunca un LLM** (CLAUDE.md). Los criterios están en [GUIDELINES.md](GUIDELINES.md).

## Pasos

```bash
# 1. Datos
pnpm batch data/private/eval-tiendas.csv --mode extract                       # 30 tiendas: escaneo + extracción (C2)
pnpm batch data/private/estabilidad.csv --mode report --tag stability --no-cache   # ejecución 1, en frío
pnpm batch data/private/estabilidad.csv --mode report --tag stability --repeat 2 --start-index 2 --fresh-search

# 2. Plantillas
pnpm eval:prepare checks data/private/eval-tiendas.csv
pnpm eval:prepare extraction data/private/eval-tiendas.csv --n 50
pnpm eval:prepare detection --from stability --n 100
pnpm eval:prepare fidelity --from stability --n 20

# 3. Etiquetado (Isai)
#    checks.todo.csv, extraction.todo.csv y fidelity.todo.csv en una hoja de cálculo; detección en la terminal:
pnpm label detection
pnpm eval:import checks data/private/evals/checks.todo.csv
pnpm eval:import extraction data/private/evals/extraction.todo.csv
pnpm eval:import fidelity data/private/evals/fidelity.todo.csv

# 4. Resultado
pnpm eval
```

La extracción y la detección se repiten con el código actual, llamando al LLM con caché. Repetir un eval sin cambios en el prompt o el modelo no cuesta nada; tras un cambio, la extracción cuesta unos 0,13 $.
