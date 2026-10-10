# Criterios de etiquetado

Etiqueta lo que es verdad, no lo que crees que dirá el escáner. En extracción y detección, la plantilla no muestra lo que predijo el sistema, para que la etiqueta no se ancle a su respuesta.

Lo normal es etiquetar con el asistente (`pnpm label checks|extraction|detection|fidelity`), que hace las preguntas de esta guía caso a caso. Si prefieres hoja de cálculo: en `de_acuerdo`, `revisada` y `respaldada` vale `sí`/`si`/`s`/`x` o `no`/`n`. Las filas con esa columna vacía no se importan, así que puedes etiquetar por partes. Las celdas vacías cuentan como `null`. El precio admite coma o punto decimal.

## Checks deterministas

Por cada tienda revisas tres veredictos del escáner, con su evidencia. Si estás de acuerdo, escribe `de_acuerdo = sí`. Si no, escribe `no` y pon el estado correcto (`pass`, `fail`, `hint` o `inconclusive`) en `estado_correcto`.

- **A2: la ficha responde igual a un rastreador que a un navegador.**
  - `fail` solo si el navegador recibe la ficha y el rastreador no, en los dos intentos.
  - Si el navegador tampoco la recibe (reto de Cloudflare, error), lo correcto es `inconclusive`.
  - Para comprobarlo:
    - Con curl: `curl -s -o /dev/null -w "%{http_code} %{size_download}\n" -A "<user-agent de config/agents.ts>" <url>`.
    - En el navegador: herramientas de desarrollo → Network conditions → User agent.
  - Un 403 con página de Cloudflare es `waf`. Un 403 o 429 del propio servidor es `origen`. Si el tipo de bloqueo está mal, márcalo en `nota`.
- **C2: el Offer coincide con lo visible (precio, moneda, disponibilidad).**
  - Compara el marcado (código fuente, `application/ld+json` o microdatos) con lo que se ve en la ficha.
  - La disponibilidad se compara por clases:
    - «disponible»: InStock, LimitedAvailability, OnlineOnly, InStoreOnly;
    - «no disponible»: OutOfStock, SoldOut, Discontinued;
    - «más adelante»: PreOrder, BackOrder.
- **C3: identificadores.**
  - `pass` si hay GTIN válido o MPN, más marca y SKU, en el bloque Product.
  - Un EAN con el dígito de control mal no cuenta.

## Extracción

El asistente abre la vista como bot (en `data/private/evals/vista-bot/`): es el mismo HTML que recibe el modelo, sin scripts ni estilos. Para el nombre sugiere el título principal de la página; Enter lo acepta. **Etiqueta lo que aparece ahí, no lo que ves en la web con JavaScript.** Si el precio solo sale con JavaScript, el valor correcto es vacío (null).

- `nombre`: el nombre del producto tal como aparece (normalmente el título principal).
- `precio`: el precio final que paga el comprador, con IVA. Si hay precio tachado y rebajado, el rebajado. Sin símbolo: `4,55`.
- `moneda`: código ISO 4217, `EUR` si se ve €.
- `disponibilidad`: un valor de schema.org según el texto visible:
  - «En stock», «Disponible», «Entrega en 24 h» → `InStock`.
  - «Últimas unidades», «Quedan pocas» → `LimitedAvailability`.
  - «Agotado», «Sin stock», «No disponible» → `OutOfStock`.
  - «Bajo pedido», «Disponible en X días» → `BackOrder`.
  - «Preventa», «Próximamente» → `PreOrder`.
  - «Descatalogado» → `Discontinued`.
  - Sin texto de disponibilidad → vacío.
- `gtin`: solo si el EAN/GTIN aparece **escrito** en la página. Si solo está en el marcado, déjalo vacío.
- `marca`: la marca o el fabricante si aparece escrito.
- `revisada`: `sí` cuando termines la fila.

## Detección de citas

¿La respuesta **cita o menciona la tienda** como sitio donde comprar o informarse?

- **Sí:**
  - entre las URLs citadas hay una del dominio de la tienda o de un subdominio suyo;
  - o el texto nombra la tienda («en Lylo Tools tienen…», «lylotools.es»).
- **No:**
  - solo aparecen productos de una marca que la tienda vende, sin nombrar la tienda;
  - o solo aparecen otras tiendas.
- **Marca propia:** si la tienda se llama como la marca (FITmask en fitmask.es), cuenta como mención cuando el texto presenta a la marca como vendedor o como web donde comprar. No cuenta cuando solo nombra el producto.
- Usa `o` (omitir) si de verdad no se puede decidir, y apúntalo en la nota.

## Fidelidad del informe

Cada fila es una frase del titular o de un hallazgo, con la evidencia que cita. `respaldada = sí` solo si **todo** lo que afirma la frase está en esa evidencia: cifras, número de fichas, competidores, qué consulta. Una recomendación genérica de arreglo («añade shippingDetails al Offer») cuenta como respaldada si se deriva del fallo citado. Cualquier dato inventado o atribuido a la referencia equivocada es `no`.
