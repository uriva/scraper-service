import { coerce } from "gamla";
import { apiHandler } from "typed-api";
import { scraperApi } from "./api.ts";
import { makeBrowserSuite } from "./browser.ts";

type ClientUser = {
  name: string;
};

const resolveClient = (token: string): ClientUser | null => {
  if (!token) return null;

  const clientsJson = Deno.env.get("SCRAPER_CLIENTS");
  if (clientsJson) {
    try {
      const parsed = JSON.parse(clientsJson) as Record<string, string>;
      if (parsed[token]) return { name: parsed[token] };
    } catch (_) {
      // ignore json parse error
    }
  }

  const p2bToken = Deno.env.get("SCRAPER_TOKEN_PROMPT2BOT");
  if (p2bToken && token === p2bToken) return { name: "prompt2bot" };

  const fomoToken = Deno.env.get("SCRAPER_TOKEN_AGENT_FOMO");
  if (fomoToken && token === fomoToken) return { name: "agent-fomo" };

  // Fallback for dev / shared secret token
  const genericSecret = Deno.env.get("SCRAPER_SECRET");
  if (genericSecret && token === genericSecret) return { name: "default" };

  return null;
};

const browserSuite = await makeBrowserSuite();

const implementation = {
  authenticate: (token: string): Promise<ClientUser> => {
    const client = resolveClient(token);
    if (!client) return Promise.reject(new Error("Unauthorized: invalid token"));
    return Promise.resolve(client);
  },
  handlers: {
    scrape: async (client: ClientUser, payload: Parameters<typeof browserSuite.scrape>[0]) => {
      console.log(`[${client.name}] scrape: ${payload.url}`);
      return await browserSuite.scrape(payload);
    },
    images: async (
      client: ClientUser,
      payload: { url: string; proxy?: "auto" | "always" | "never"; country?: string },
    ) => {
      console.log(`[${client.name}] images: ${payload.url}`);
      const images = await browserSuite.images(
        payload.url,
        payload.proxy,
        payload.country,
      );
      return { images };
    },
    crawl: async (client: ClientUser, payload: Parameters<typeof browserSuite.crawl>[0]) => {
      console.log(
        `[${client.name}] crawl: ${payload.url} (maxDepth=${payload.maxDepth}, maxPages=${payload.maxPages})`,
      );
      const pages = await browserSuite.crawl(payload);
      return { pages };
    },
    crawlAndCallback: (
      client: ClientUser,
      payload: Parameters<typeof browserSuite.crawl>[0] & {
        callbackUrl: string;
        crawlId: string;
        initiatorBotId?: string;
      },
    ) => {
      console.log(`[${client.name}] crawlAndCallback: ${payload.url}`);
      const startedAt = Date.now();
      // Background execution
      (async () => {
        try {
          const pages = await browserSuite.crawl(payload);
          await fetch(payload.callbackUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              crawlId: payload.crawlId,
              seedUrl: payload.url,
              maxDepth: payload.maxDepth,
              maxPages: payload.maxPages,
              initiatorBotId: payload.initiatorBotId,
              startedAt,
              completedAt: Date.now(),
              pages,
            }),
          });
        } catch (e) {
          console.error("Crawl callback error:", e);
          await fetch(payload.callbackUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              crawlId: payload.crawlId,
              seedUrl: payload.url,
              maxDepth: payload.maxDepth,
              maxPages: payload.maxPages,
              initiatorBotId: payload.initiatorBotId,
              startedAt,
              failedAt: Date.now(),
              error: e instanceof Error ? e.message : String(e),
              pages: [],
            }),
          });
        }
      })();
      return Promise.resolve({ ok: true });
    },
  },
};

const fatalBrowserErrors = ["ConnectionClosedError", "ProtocolError"];

const handler = async (request: Request): Promise<Response> => {
  if (request.method === "GET") {
    return new Response(JSON.stringify({ status: "healthy", service: "scraper-service" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const body = await request.json();
    const result = await apiHandler(scraperApi, implementation, body);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    if (e instanceof Error && fatalBrowserErrors.includes(e.name)) {
      console.error("Fatal browser error, triggering container restart:", e.name);
      Deno.exit(1);
    }
    const message = e instanceof Error ? e.message : String(e);
    const status = message.includes("Unauthorized") ? 401 : 500;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }
};

const port = Number.parseInt(coerce(Deno.env.get("PORT") || "8080"), 10);
Deno.serve({ port }, handler);
