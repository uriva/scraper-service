import { simplifiedHtmlToString, simplifyHtml } from "@uri/simplify-html";
import { coerce, map, pipe, sortKey, throttle } from "gamla";
import type { Browser, Page } from "puppeteer";
import { protectPage } from "puppeteer-afp";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { CrawlPage, ScrapeInput, ScrapeOutput } from "./api.ts";
import {
  dataImpulseDomain,
  dataImpulsePassword,
  dataImpulseUsername,
} from "./dataimpulse.ts";

// @ts-expect-error stealth plugin typing
puppeteer.use(StealthPlugin());

const commonFlags = [
  "--disable-dev-shm-usage",
  "--no-sandbox",
  "--unsafely-disable-devtools-self-xss-warnings",
  "--disable-gpu",
  "--disable-extensions",
  "--js-flags=--max-old-space-size=512",
];

const navigationTimeout = 45_000;
const maxHtmlBeforeParse = 300_000;
const maxTextChars = 150_000;

const truncateText = (text: string) =>
  text.length > maxTextChars ? text.slice(0, maxTextChars) : text;

const htmlToText = (html: string) =>
  truncateText(
    simplifiedHtmlToString(
      simplifyHtml(
        html.length > maxHtmlBeforeParse
          ? html.slice(0, maxHtmlBeforeParse)
          : html,
      ),
    ),
  );

type Image = { src: string; area: number; type: string | undefined };

const extractImagesFromPage = (page: Page): Promise<string[]> =>
  page.$$eval(
    "img",
    (els) =>
      els.map((el) => {
        const img = el as HTMLImageElement;
        return {
          src: img.currentSrc || img.src,
          area: (img.naturalWidth || img.width || 0) *
            (img.naturalHeight || img.height || 0),
          type: (img.currentSrc || img.src).split("?")[0].split(".").pop()
            ?.toLowerCase(),
        };
      }),
  ).then((images: Image[]) =>
    pipe(
      sortKey(({ type, area }: Image) => [
        !["png", "jpg", "jpeg", "webp", "gif"].includes(type || ""),
        -area,
      ]),
      map(({ src }: Image) => src),
    )(images.filter((img) => img.src && img.src.startsWith("http")))
  ).catch(() => []);

const extractLinksFromPage = (page: Page): Promise<string[]> =>
  page.$$eval(
    "a[href]",
    (anchors) =>
      (anchors as HTMLAnchorElement[])
        .map((a) => a.href)
        .filter((href) =>
          href && href.startsWith("http") && !href.startsWith("javascript:")
        ),
  ).catch(() => []);

const closePopupsOnPage = (page: Page) =>
  page.evaluate(() => {
    const closeButtons = Array.from(
      document.querySelectorAll(
        '[aria-label="Close"], [aria-label="close"], button.close, .modal-close',
      ),
    );
    closeButtons.slice(0, 2).forEach((btn) => {
      if (btn && typeof (btn as HTMLElement).click === "function") {
        (btn as HTMLElement).click();
      }
    });
  }).catch(() => {});

const clickWordsOnPage = (page: Page, words: string[]) =>
  page.evaluate((wordsToClick) => {
    const elements = Array.from(document.querySelectorAll("*"));
    const matching = elements.filter((el) => {
      const aria = el.getAttribute("aria-label")?.toLowerCase() || "";
      const text = (el as HTMLElement).innerText?.toLowerCase() || "";
      return wordsToClick.some((w) =>
        aria.includes(w.toLowerCase()) || text.includes(w.toLowerCase())
      );
    });
    matching.slice(0, 3).forEach((el) => {
      if (typeof (el as HTMLElement).click === "function") {
        (el as HTMLElement).click();
      }
    });
  }, words).catch(() => {});

const scrollPage = (page: Page, maxScrolls: number) =>
  page.evaluate(
    ({ scrolls, waitMs, distance }) =>
      new Promise<void>((resolve) => {
        let count = 0;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          globalThis.scrollBy(0, distance);
          count++;
          if (
            globalThis.scrollY + globalThis.innerHeight >= scrollHeight ||
            count >= scrolls
          ) {
            clearInterval(timer);
            resolve();
          }
        }, waitMs);
      }),
    { scrolls: maxScrolls, waitMs: 150, distance: 800 },
  ).catch(() => {});

const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

const isSameDomain = (url1: string, url2: string) =>
  domainOf(url1) === domainOf(url2);

const randomDir = () =>
  Deno.makeTempDirSync({
    prefix: "scraper-browsers-",
    dir: Deno.env.get("CHROME_USER_DATA_DIR") || "/tmp",
  });

const launchBrowserInstance = (proxyServer?: string): Promise<Browser> => {
  const flags = [...commonFlags, `--user-data-dir=${randomDir()}`];
  if (proxyServer) flags.push(`--proxy-server=${proxyServer}`);
  const options = {
    timeout: 0,
    protocolTimeout: 60000,
    executablePath: coerce(Deno.env.get("CHROME_PATH")),
    args: flags,
  };
  // @ts-expect-error typing mismatch in puppeteer launch
  return puppeteer.launch(options);
};

const runWithPage = async <T>(
  browser: Browser,
  country: string,
  isProxy: boolean,
  fn: (page: Page) => Promise<T>,
): Promise<T> => {
  const page = await browser.newPage();
  try {
    await protectPage(page);
    if (isProxy) {
      await page.authenticate({
        username: dataImpulseUsername(country),
        password: dataImpulsePassword(),
      });
    }
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
};

export const makeBrowserSuite = async () => {
  const directBrowser = await launchBrowserInstance();
  const proxyBrowser = await launchBrowserInstance(dataImpulseDomain);

  const throttledDirect = throttle(4)(
    <T>(country: string, fn: (page: Page) => Promise<T>) =>
      runWithPage(directBrowser, country, false, fn),
  );

  const throttledProxy = throttle(4)(
    <T>(country: string, fn: (page: Page) => Promise<T>) =>
      runWithPage(proxyBrowser, country, true, fn),
  );

  const scrapePageWithBrowser = async (
    page: Page,
    input: ScrapeInput,
  ): Promise<{
    title: string;
    content: string;
    links: string[];
    images: string[];
  }> => {
    await page.goto(input.url, {
      waitUntil: "networkidle2",
      timeout: navigationTimeout,
    });

    if (input.closePopups !== false) {
      await closePopupsOnPage(page);
    }

    if (input.clickWords && input.clickWords.length > 0) {
      await clickWordsOnPage(page, input.clickWords);
    }

    const pattern = input.requirePattern
      ? new RegExp(input.requirePattern, "i")
      : null;
    const maxScrolls = input.maxScrolls ?? (pattern ? 15 : 1);

    if (pattern) {
      let attempts = 0;
      while (attempts < maxScrolls) {
        await scrollPage(page, 1);
        const html = await page.content();
        const text = htmlToText(html);
        if (pattern.test(text)) break;
        attempts++;
      }
    } else if (maxScrolls > 0) {
      await scrollPage(page, maxScrolls);
    }

    const html = await page.content();
    const text = htmlToText(html);
    const title = await page.title().catch(() => "");
    const links = input.extractLinks ? await extractLinksFromPage(page) : [];
    const images = input.extractImages ? await extractImagesFromPage(page) : [];

    return { title, content: text, links, images };
  };

  const scrape = async (input: ScrapeInput): Promise<ScrapeOutput> => {
    const country = input.country || "il";
    const proxyMode = input.proxy || "auto";

    if (proxyMode === "always") {
      try {
        const result = await throttledProxy(
          country,
          (page) => scrapePageWithBrowser(page, input),
        );
        return {
          status: result.content ? "success" : "no-valid-text",
          title: result.title,
          content: result.content,
          links: result.links,
          images: result.images,
          proxyUsed: true,
        };
      } catch (e) {
        console.error("Proxy scrape error:", e);
        return {
          status: "page-did-not-load",
          content: null,
          proxyUsed: true,
        };
      }
    }

    try {
      const result = await throttledDirect(
        country,
        (page) => scrapePageWithBrowser(page, input),
      );
      if (result.content && result.content.trim().length > 0) {
        return {
          status: "success",
          title: result.title,
          content: result.content,
          links: result.links,
          images: result.images,
          proxyUsed: false,
        };
      }
      if (proxyMode === "never") {
        return { status: "no-valid-text", content: null, proxyUsed: false };
      }
    } catch (e) {
      if (proxyMode === "never") {
        console.error("Direct scrape error:", e);
        return {
          status: "page-did-not-load",
          content: null,
          proxyUsed: false,
        };
      }
    }

    // Fallback to proxy
    try {
      const result = await throttledProxy(
        country,
        (page) => scrapePageWithBrowser(page, input),
      );
      return {
        status: result.content ? "success" : "no-valid-text",
        title: result.title,
        content: result.content,
        links: result.links,
        images: result.images,
        proxyUsed: true,
      };
    } catch (e) {
      console.error("Fallback proxy scrape error:", e);
      return {
        status: "page-did-not-load",
        content: null,
        proxyUsed: true,
      };
    }
  };

  const images = async (
    url: string,
    proxy = "auto",
    country = "il",
  ): Promise<string[]> => {
    const fn = (page: Page) =>
      page.goto(url, {
        waitUntil: "networkidle2",
        timeout: navigationTimeout,
      }).then(() => extractImagesFromPage(page));

    if (proxy === "always") {
      return throttledProxy(country, fn).catch(() => []);
    }
    try {
      const directImgs = await throttledDirect(country, fn);
      if (directImgs.length > 0) return directImgs;
      if (proxy === "never") return [];
    } catch (_) {
      if (proxy === "never") return [];
    }
    return throttledProxy(country, fn).catch(() => []);
  };

  const crawl = async ({
    url: startUrl,
    maxDepth,
    maxPages,
    clickWords,
    sameDomainOnly = true,
    proxy = "auto",
    country = "il",
  }: {
    url: string;
    maxDepth: number;
    maxPages: number;
    clickWords?: string[];
    sameDomainOnly?: boolean;
    proxy?: "auto" | "always" | "never";
    country?: string;
  }): Promise<CrawlPage[]> => {
    const seen = new Set<string>([startUrl]);
    const queue: { url: string; depth: number }[] = [{
      url: startUrl,
      depth: 0,
    }];
    const results: CrawlPage[] = [];

    while (queue.length > 0 && results.length < maxPages) {
      const item = queue.shift()!;
      if (sameDomainOnly && !isSameDomain(startUrl, item.url)) continue;

      const scrapeRes = await scrape({
        url: item.url,
        clickWords,
        extractLinks: true,
        proxy,
        country,
      });

      results.push({
        url: item.url,
        title: scrapeRes.title ?? null,
        content: scrapeRes.content,
        links: scrapeRes.links || [],
      });

      if (item.depth < maxDepth && scrapeRes.links) {
        for (const link of scrapeRes.links) {
          if (
            !seen.has(link) && (!sameDomainOnly || isSameDomain(startUrl, link))
          ) {
            seen.add(link);
            queue.push({ url: link, depth: item.depth + 1 });
          }
        }
      }
    }

    return results;
  };

  return {
    scrape,
    images,
    crawl,
    cleanup: async () => {
      await Promise.all([
        directBrowser.close().catch(() => {}),
        proxyBrowser.close().catch(() => {}),
      ]);
    },
  };
};
