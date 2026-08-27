import { endpoint } from "typed-api";
import { z } from "zod/v4";

export const crawlPage = z.object({
  url: z.string(),
  title: z.string().nullable().optional(),
  content: z.string().nullable(),
  links: z.array(z.string()).optional(),
  images: z.array(z.string()).optional(),
});

export type CrawlPage = z.infer<typeof crawlPage>;

export const scrapeInput = z.object({
  url: z.string(),
  clickWords: z.array(z.string()).optional(),
  requirePattern: z.string().optional(),
  maxScrolls: z.number().optional(),
  proxy: z.enum(["auto", "always", "never"]).optional(),
  closePopups: z.boolean().optional(),
  extractImages: z.boolean().optional(),
  extractLinks: z.boolean().optional(),
  forceFresh: z.boolean().optional(),
  country: z.string().optional(),
});

export type ScrapeInput = z.infer<typeof scrapeInput>;

export const scrapeOutput = z.object({
  status: z.enum([
    "success",
    "no-valid-text",
    "page-did-not-load",
    "blacklisted-url",
    "error",
  ]),
  title: z.string().nullable().optional(),
  content: z.string().nullable(),
  links: z.array(z.string()).optional(),
  images: z.array(z.string()).optional(),
  proxyUsed: z.boolean().optional(),
});

export type ScrapeOutput = z.infer<typeof scrapeOutput>;

export const imagesInput = z.object({
  url: z.string(),
  proxy: z.enum(["auto", "always", "never"]).optional(),
  forceFresh: z.boolean().optional(),
  country: z.string().optional(),
});

export type ImagesInput = z.infer<typeof imagesInput>;

export const imagesOutput = z.object({
  images: z.array(z.string()),
});

export type ImagesOutput = z.infer<typeof imagesOutput>;

export const crawlInput = z.object({
  url: z.string(),
  maxDepth: z.number(),
  maxPages: z.number(),
  clickWords: z.array(z.string()).optional(),
  sameDomainOnly: z.boolean().optional(),
  proxy: z.enum(["auto", "always", "never"]).optional(),
  country: z.string().optional(),
});

export type CrawlInput = z.infer<typeof crawlInput>;

export const crawlOutput = z.object({
  pages: z.array(crawlPage),
});

export type CrawlOutput = z.infer<typeof crawlOutput>;

export const crawlAndCallbackInput = z.object({
  url: z.string(),
  maxDepth: z.number(),
  maxPages: z.number(),
  callbackUrl: z.string(),
  crawlId: z.string(),
  initiatorBotId: z.string().optional(),
  clickWords: z.array(z.string()).optional(),
  sameDomainOnly: z.boolean().optional(),
  proxy: z.enum(["auto", "always", "never"]).optional(),
  country: z.string().optional(),
});

export type CrawlAndCallbackInput = z.infer<typeof crawlAndCallbackInput>;

export const crawlAndCallbackOutput = z.object({
  ok: z.boolean(),
});

export type CrawlAndCallbackOutput = z.infer<typeof crawlAndCallbackOutput>;

export const scraperApi = {
  scrape: endpoint({
    authRequired: true,
    input: scrapeInput,
    output: scrapeOutput,
  }),
  images: endpoint({
    authRequired: true,
    input: imagesInput,
    output: imagesOutput,
  }),
  crawl: endpoint({
    authRequired: true,
    input: crawlInput,
    output: crawlOutput,
  }),
  crawlAndCallback: endpoint({
    authRequired: true,
    input: crawlAndCallbackInput,
    output: crawlAndCallbackOutput,
  }),
};
