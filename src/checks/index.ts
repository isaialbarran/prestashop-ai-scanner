import { CHECK_IDS, type Check, type CheckId } from "../schema";
import { checkA1, checkA2, checkA3 } from "./access";
import { checkB1, checkB2 } from "./content";
import { buildContext, type ScanContext } from "./context";
import { checkD1, checkD2, checkD3 } from "./crawl";
import { inconclusive } from "./helpers";
import { checkI1, checkI2, checkI3 } from "./info";
import { checkE1, checkE2 } from "./performance";
import { checkC1, checkC2, checkC3, checkC4, checkC5 } from "./structured-data";
import type { ScanSnapshot } from "./types";

export const CHECK_FUNCTIONS: Record<CheckId, (ctx: ScanContext) => Check> = {
  A1: checkA1,
  A2: checkA2,
  A3: checkA3,
  B1: checkB1,
  B2: checkB2,
  C1: checkC1,
  C2: checkC2,
  C3: checkC3,
  C4: checkC4,
  C5: checkC5,
  D1: checkD1,
  D2: checkD2,
  D3: checkD3,
  E1: checkE1,
  E2: checkE2,
  I1: checkI1,
  I2: checkI2,
  I3: checkI3,
};

function safeRun(id: CheckId, ctx: ScanContext): Check {
  try {
    return CHECK_FUNCTIONS[id](ctx);
  } catch (err) {
    return inconclusive(id, ctx.snap.origin ?? ctx.snap.domain, `Error interno del check: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function runCheck(id: CheckId, snap: ScanSnapshot): Check {
  return CHECK_FUNCTIONS[id](buildContext(snap));
}

export function runAllChecks(snap: ScanSnapshot): Check[] {
  const ctx = buildContext(snap);
  return CHECK_IDS.map((id) => safeRun(id, ctx));
}
