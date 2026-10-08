# Escáner de preparación para IA en tiendas PrestaShop

Brief del proyecto para Claude Code. Léelo entero antes de escribir código.

## Objetivo

Generador de informes por lotes que mide dos cosas de una tienda PrestaShop:

1. **Nota técnica (0–100):** si los rastreadores de IA y de Google pueden entrar y leer bien precio, stock e identificadores de producto.
2. **Visibilidad (X de N consultas):** si ChatGPT, Gemini y Perplexity citan la tienda cuando un comprador busca sus productos.

Meta doble, en este orden:

- **Caso técnico de AI engineering** con números defendibles en una entrevista: evals, coste y latencia por informe, 100 tiendas reales.
- **Validación de negocio:** 100 informes enviados y 10 agencias contactadas. Es secundaria; no bloquea la construcción.

Pregunta de investigación que el dataset debe responder: **¿la nota técnica predice la visibilidad?**

## Stack

- Next.js + TypeScript (strict), runtime Node, despliegue en Vercel.
- `cheerio` (HTML sin ejecutar JavaScript), `robots-parser`, `zod`, `p-limit`.
- Supabase (Postgres) para resultados y evals.
- Vitest para tests y para el runner de evals.
- LLM: SDK oficial de cada proveedor. **Antes de implementar, consulta la documentación actual** de cada API (nombres de modelo, herramienta de búsqueda web, precios). No fijes nombres de modelo de memoria; ponlos en `config/models.ts`.

## Estructura

```
scripts/batch.ts            # entrada: CSV de dominios → ScanResult por dominio
src/fetch/                  # capa de peticiones con 5 agentes
src/checks/                 # una función pura por comprobación (A1…I3)
src/scoring/                # reglas de puntuación
src/llm/queries.ts          # genera consultas de comprador
src/llm/visibility.ts       # lanza consultas y detecta citas
src/llm/extract.ts          # extrae datos de la ficha "como bot"
src/llm/report.ts           # redacta titular y 3 hallazgos
src/schema.ts               # tipos zod: ScanResult, Check, VisibilityResult
evals/datasets/             # JSONL etiquetados a mano
evals/run.ts                # runner: imprime tabla de métricas
app/r/[id]/page.tsx         # informe de una página, con CSS de impresión
config/models.ts
```

## Capa determinista

**Entrada por dominio:** portada, una categoría y 3 fichas de producto sacadas del sitemap (en PrestaShop suele ser `1_index_sitemap.xml`).

**Agentes:** cada URL se pide como navegador (referencia), OAI-SearchBot, ChatGPT-User, PerplexityBot y Googlebot.

**Resultado:** `ScanResult` con `checks[]`; cada check tiene `id`, `status` (`pass` | `fail` | `hint` | `inconclusive`), `points`, `maxPoints`, `evidence` (URL, cabeceras, fragmento) y `fix`.

| Id | Comprobación | Cómo se mide | Pts |
| --- | --- | --- | --- |
| A1 | robots.txt permite rastreadores de búsqueda de IA y Googlebot en las fichas | Reglas por agente sobre las 3 URLs de producto | 10 |
| A2 | La ficha responde igual a un rastreador que a un navegador | Mismo 200 y tamaño similar; falla con 403, 429 o página de reto solo para el rastreador | 15 |
| A3 | No hay muro previo | Sin mantenimiento, login, modo catálogo ni redirección por país que vacíe el HTML | 5 |
| B1 | Nombre, precio y disponibilidad en el HTML inicial | Búsqueda en el HTML crudo | 10 |
| B2 | Descripción y atributos en texto | ≥ 300 caracteres de descripción en el HTML | 5 |
| C1 | Un único bloque Product válido | JSON-LD o microdatos; falla si tema y módulo publican dos bloques en conflicto | 8 |
| C2 | Offer con precio, moneda y disponibilidad iguales a lo visible | Marcado frente a lo extraído de la ficha (ver `extract.ts`) | 12 |
| C3 | Identificadores | `gtin` o `mpn`, más `brand` y `sku` | 8 |
| C4 | Envío, devoluciones y valoraciones | `shippingDetails`, `hasMerchantReturnPolicy`, `aggregateRating` | 4 |
| C5 | Migas y organización | `BreadcrumbList` y `Organization` | 3 |
| D1 | Sitemap accesible y declarado en robots.txt | — | 4 |
| D2 | Canonical y hreflang coherentes | Fichas en tiendas multiidioma | 3 |
| D3 | Filtros y ordenaciones fuera del rastreo | `?q=` y `?order=` bloqueados o con canonical | 3 |
| E1 | Tiempo de respuesta | TTFB < 800 ms desde el escáner | 4 |
| E2 | Core Web Vitals de campo | LCP, INP y CLS en verde (API de PageSpeed Insights) | 6 |
| I1 | `/.well-known/ucp` | Informativo | 0 |
| I2 | `/llms.txt` | Informativo | 0 |
| I3 | Versión de PrestaShop | 1.6 y 1.7 se marcan como antiguas | 0 |

**Reglas de puntuación**

- Tope por bloqueo: si A1 o A2 fallan para OAI-SearchBot o Googlebot, la nota máxima es 40.
- B y C se calculan en las 3 fichas y se promedian.
- A2 solo marca `fail` si el navegador pasa y el rastreador falla en dos intentos.
- Tramos: 0–49 ilegible, 50–79 legible con errores, 80–100 preparada.

## Capa LLM

### 1. Consultas de comprador (`queries.ts`)

A partir de la categoría y las 3 fichas, genera 10 consultas en español: 4 de categoría ("mejor X para Y"), 4 de producto con atributos y 2 con intención de compra ("dónde comprar X en España"). **Nunca incluyas el nombre de la tienda ni su dominio**: citarla sería trivial.

### 2. Test de visibilidad (`visibility.ts`)

- Lanza cada consulta contra los 3 proveedores con búsqueda web activada: 30 llamadas por tienda.
- Guarda la respuesta completa, las URLs citadas, tokens, coste y latencia de cada llamada.
- Detección de cita en dos pasos: primero coincidencia de dominio en las URLs citadas (determinista); si no hay, un LLM barato decide si el texto menciona la tienda por nombre.
- Salida: `citedIn` (X de 30), desglose por proveedor y los 3 competidores más citados.
- La visibilidad **no suma a la nota técnica**. Son dos métricas separadas.

### 3. Lectura como bot (`extract.ts`)

Un LLM recibe el HTML crudo de la ficha (limpio de scripts y estilos, tal como lo ve el rastreador) y devuelve `{ name, price, currency, availability, gtin, brand }` validado con zod, con `null` cuando no está. Alimenta C2.

### 4. Informe (`report.ts`)

Redacta el titular y los 3 hallazgos principales **solo** a partir del `ScanResult` y del resultado de visibilidad. Cada frase debe referenciar el `id` de un check o una consulta concreta. Si no hay evidencia, no se escribe.

## Evals

`pnpm eval` debe imprimir esta tabla y fallar si una métrica cae por debajo del umbral.

| Eval | Dataset | Métrica | Umbral inicial |
| --- | --- | --- | --- |
| Checks deterministas | 30 tiendas revisadas a mano | Discrepancias en A2, C2, C3 | < 3 en A2 |
| Extracción | 50 fichas etiquetadas | Acierto exacto por campo | ≥ 95 % en precio |
| Detección de citas | 100 respuestas etiquetadas sí/no | Precisión y recall | ≥ 0,9 ambas |
| Fidelidad del informe | 20 informes | % de frases con evidencia válida | 100 % |
| Estabilidad | 10 tiendas × 3 repeticiones | Variación de `citedIn` entre ejecuciones | Solo medir |
| Coste y latencia | Todas las ejecuciones | € y segundos por informe, p50 y p95 | < 1 € y < 3 min |

Los datasets los etiqueta Isai a mano. No los generes ni los rellenes con un LLM.

## Fases y definición de terminado

| Fase | Horas | Terminado cuando |
| --- | --- | --- |
| 0. Setup | 2 | Repo, claves en `.env.local`, Supabase y Vercel conectados, `pnpm test` en verde |
| 1. Capa determinista | 8 | `batch.ts` escanea 10 dominios y devuelve `ScanResult` válido con evidencia |
| 2. Capa LLM | 10 | Un dominio produce informe completo de punta a punta, con coste registrado |
| 3. Evals | 8 | `pnpm eval` imprime la tabla con los 6 evals sobre datasets reales |
| 4. Informe y lote | 8 | `/r/[id]` publicado y 100 tiendas escaneadas |

Fuera del código, a cargo de Isai: lista de 150 tiendas (3 h), 30 revisiones manuales (4 h), verificar a mano el hallazgo principal de cada informe antes de enviarlo (4 h).

## Reglas de trabajo

- Una fase cada vez. No empieces la siguiente sin cumplir su "terminado cuando".
- Tests antes que implementación en `src/checks/` y `src/scoring/`; usa fixtures HTML guardados, no red, en los tests.
- Cortesía con las tiendas: 1 petición por segundo y dominio, 5 dominios en paralelo, máximo 40 peticiones por dominio, solo GET, sin formularios ni login.
- Presupuesto: registra el coste de cada llamada LLM. Detén el lote si un informe supera 2 € o el lote supera el límite de `MAX_BATCH_EUR`.
- Cachea por hash de entrada toda respuesta HTTP y LLM en desarrollo, para no pagar dos veces.
- Nunca subas claves, CSV de dominios con datos de contacto ni datasets con nombres de personas.
- No construyas formulario público, autenticación ni marca blanca hasta terminar la fase 4.

## Límites que el informe debe declarar

- A2 es un indicio: los cortafuegos verifican rastreadores por IP y el escáner solo imita el agente. La prueba real son los registros del servidor.
- El feed de Merchant Center no se puede comprobar desde fuera.
- La visibilidad se mide por API con búsqueda web: aproxima lo que ve un usuario en la app, no lo reproduce.
- UCP y llms.txt aparecen sin puntos porque hoy no cambian nada en España.
