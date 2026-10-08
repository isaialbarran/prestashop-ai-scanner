export interface Challenge {
  vendor: "cloudflare" | "datadome" | "imperva" | "sucuri" | "akamai" | "generic";
  /** `challenge`: reto (JS o captcha) que un rastreador no resuelve; `block`: denegación directa. */
  kind: "challenge" | "block";
}

interface ResponseLike {
  status: number | null;
  headers: Record<string, string>;
  body: string | null;
}

/**
 * Reconoce páginas de reto o bloqueo de cortafuegos. Solo mira la firma del
 * proveedor, no el código de estado, para separar un WAF de un 403 del origen.
 */
export function detectChallenge(res: ResponseLike): Challenge | null {
  const h = res.headers;
  const body = (res.body ?? "").slice(0, 200_000);
  const isError = res.status !== null && res.status >= 400;

  if (h["cf-mitigated"] === "challenge") return { vendor: "cloudflare", kind: "challenge" };
  if (/<title>\s*Just a moment\.\.\.\s*<\/title>|\/cdn-cgi\/challenge-platform\/|window\._cf_chl_opt/i.test(body)) {
    return { vendor: "cloudflare", kind: "challenge" };
  }
  if (/Attention Required! \| Cloudflare|Sorry, you have been blocked|cf-error-details|error code: 1020/i.test(body)) {
    return { vendor: "cloudflare", kind: "block" };
  }

  if (h["x-datadome"] || h["x-dd-b"] || /captcha-delivery\.com/i.test(body)) {
    return { vendor: "datadome", kind: "challenge" };
  }

  if (/_Incapsula_Resource|Incapsula incident ID/i.test(body)) return { vendor: "imperva", kind: "block" };

  if (h["x-sucuri-block"] || /Sucuri WebSite Firewall - Access Denied/i.test(body)) {
    return { vendor: "sucuri", kind: "block" };
  }

  if (isError && /AkamaiGHost/i.test(h["server"] ?? "") && /Access Denied/i.test(body)) {
    return { vendor: "akamai", kind: "block" };
  }

  if (isError && /g-recaptcha|h-captcha|hcaptcha\.com|cf-turnstile/i.test(body)) {
    return { vendor: "generic", kind: "challenge" };
  }

  return null;
}
