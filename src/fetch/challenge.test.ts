import { describe, expect, it } from "vitest";
import { detectChallenge } from "./challenge";

const page = (status: number, body: string, headers: Record<string, string> = {}) => ({ status, body, headers });

describe("detectChallenge", () => {
  it("no marca una ficha normal, aunque lleve reCAPTCHA en un formulario", () => {
    const html = `<html><body id="product"><h1>Zapatilla</h1><div class="g-recaptcha"></div></body></html>`;
    expect(detectChallenge(page(200, html, { server: "cloudflare", "cf-ray": "1" }))).toBeNull();
  });

  it("detecta el reto de Cloudflare por la cabecera cf-mitigated", () => {
    expect(detectChallenge(page(403, "<html></html>", { "cf-mitigated": "challenge" }))).toEqual({
      vendor: "cloudflare",
      kind: "challenge",
    });
  });

  it("detecta la página 'Just a moment' de Cloudflare", () => {
    const html = `<title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script>`;
    expect(detectChallenge(page(403, html, { server: "cloudflare" }))?.kind).toBe("challenge");
  });

  it("detecta el bloqueo 1020 de Cloudflare", () => {
    const html = `<title>Attention Required! | Cloudflare</title><h1>Sorry, you have been blocked</h1>`;
    expect(detectChallenge(page(403, html, { server: "cloudflare" }))).toEqual({ vendor: "cloudflare", kind: "block" });
  });

  it("detecta DataDome", () => {
    const html = `<script src="https://ct.captcha-delivery.com/c.js"></script>`;
    expect(detectChallenge(page(403, html, { "x-datadome": "protected" }))?.vendor).toBe("datadome");
  });

  it("detecta Imperva", () => {
    expect(detectChallenge(page(403, `<iframe src="/_Incapsula_Resource?x=1"></iframe>`))?.vendor).toBe("imperva");
  });

  it("detecta Sucuri", () => {
    const html = `<title>Sucuri WebSite Firewall - Access Denied</title>`;
    expect(detectChallenge(page(403, html, { "x-sucuri-id": "1" }))).toEqual({ vendor: "sucuri", kind: "block" });
  });

  it("detecta un captcha genérico solo en respuestas de error", () => {
    const html = `<div class="cf-turnstile"></div>`;
    expect(detectChallenge(page(429, html))?.vendor).toBe("generic");
    expect(detectChallenge(page(200, html))).toBeNull();
  });

  it("no marca un 403 del propio servidor sin firma de cortafuegos", () => {
    expect(detectChallenge(page(403, "<h1>Forbidden</h1>", { server: "nginx" }))).toBeNull();
  });
});
