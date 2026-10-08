import type { CheckId } from "../schema";

export interface CheckDefinition {
  title: string;
  maxPoints: number;
}

/** Títulos y puntos de la tabla del brief. Los checks I son informativos. */
export const CHECKS: Record<CheckId, CheckDefinition> = {
  A1: { title: "robots.txt permite a los rastreadores de búsqueda de IA y a Googlebot leer las fichas", maxPoints: 10 },
  A2: { title: "La ficha responde igual a un rastreador que a un navegador", maxPoints: 15 },
  A3: { title: "No hay muro previo", maxPoints: 5 },
  B1: { title: "Nombre, precio y disponibilidad en el HTML inicial", maxPoints: 10 },
  B2: { title: "Descripción y atributos en texto", maxPoints: 5 },
  C1: { title: "Un único bloque Product válido", maxPoints: 8 },
  C2: { title: "Offer con precio, moneda y disponibilidad iguales a lo visible", maxPoints: 12 },
  C3: { title: "Identificadores de producto", maxPoints: 8 },
  C4: { title: "Envío, devoluciones y valoraciones", maxPoints: 4 },
  C5: { title: "Migas y organización", maxPoints: 3 },
  D1: { title: "Sitemap accesible y declarado en robots.txt", maxPoints: 4 },
  D2: { title: "Canonical y hreflang coherentes", maxPoints: 3 },
  D3: { title: "Filtros y ordenaciones fuera del rastreo", maxPoints: 3 },
  E1: { title: "Tiempo de respuesta", maxPoints: 4 },
  E2: { title: "Core Web Vitals de campo", maxPoints: 6 },
  I1: { title: "/.well-known/ucp", maxPoints: 0 },
  I2: { title: "/llms.txt", maxPoints: 0 },
  I3: { title: "Versión de PrestaShop", maxPoints: 0 },
};
