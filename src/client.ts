import { apiClient, httpCommunication } from "typed-api";
import {
  type CrawlInput,
  type CrawlPage,
  type ImagesInput,
  type ScrapeInput,
  type ScrapeOutput,
  scraperApi,
} from "./api.ts";

export const makeScraperClient = (
  serviceUrl: string,
  token: string,
) => {
  const client = apiClient(httpCommunication(serviceUrl), scraperApi);

  return {
    scrape: (payload: ScrapeInput): Promise<ScrapeOutput> =>
      client({
        endpoint: "scrape",
        token,
        payload,
      }),

    images: async (payload: ImagesInput): Promise<string[]> => {
      const { images } = await client({
        endpoint: "images",
        token,
        payload,
      });
      return images;
    },

    crawl: async (payload: CrawlInput): Promise<CrawlPage[]> => {
      const { pages } = await client({
        endpoint: "crawl",
        token,
        payload,
      });
      return pages;
    },

    crawlAndCallback: async (
      payload: Parameters<typeof client>[0]["payload"],
    ): Promise<boolean> => {
      const { ok } = await client({
        endpoint: "crawlAndCallback",
        token,
        // @ts-expect-error payload mapping
        payload,
      });
      return ok;
    },
  };
};
