// User-agents que imita el escáner. Verificados el 2026-10-08 en:
// - https://developers.openai.com/api/docs/bots (OAI-SearchBot, ChatGPT-User)
// - https://docs.perplexity.ai/guides/bots (PerplexityBot)
// - https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers (Googlebot)
// Google publica la versión de Chrome como W.X.Y.Z; usamos la misma que el navegador de referencia.

const CHROME_VERSION = "150.0.0.0";

export const AGENT_IDS = [
  "browser",
  "oai-searchbot",
  "chatgpt-user",
  "perplexitybot",
  "googlebot",
] as const;

export type AgentId = (typeof AGENT_IDS)[number];

export interface AgentConfig {
  id: AgentId;
  label: string;
  userAgent: string;
  /** Token con el que el agente se identifica en robots.txt; null si no aplica. */
  robotsToken: string | null;
}

export const AGENTS: Record<AgentId, AgentConfig> = {
  browser: {
    id: "browser",
    label: "Navegador",
    userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`,
    robotsToken: null,
  },
  "oai-searchbot": {
    id: "oai-searchbot",
    label: "OAI-SearchBot",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot",
    robotsToken: "OAI-SearchBot",
  },
  "chatgpt-user": {
    id: "chatgpt-user",
    label: "ChatGPT-User",
    userAgent:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
    // OpenAI: al ser peticiones iniciadas por un usuario, robots.txt puede no aplicar.
    robotsToken: "ChatGPT-User",
  },
  perplexitybot: {
    id: "perplexitybot",
    label: "PerplexityBot",
    userAgent:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
    robotsToken: "PerplexityBot",
  },
  googlebot: {
    id: "googlebot",
    label: "Googlebot",
    userAgent: `Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)`,
    robotsToken: "Googlebot",
  },
};

/** Rastreadores de búsqueda que A1 evalúa contra robots.txt. */
export const SEARCH_CRAWLERS = ["oai-searchbot", "perplexitybot", "googlebot"] as const satisfies readonly AgentId[];

/** Rastreadores que A2 compara con el navegador. */
export const CRAWLERS = ["oai-searchbot", "chatgpt-user", "perplexitybot", "googlebot"] as const satisfies readonly AgentId[];

/** Si A1 o A2 fallan para alguno de estos, la nota máxima es 40. */
export const CAP_AGENTS = ["oai-searchbot", "googlebot"] as const satisfies readonly AgentId[];
