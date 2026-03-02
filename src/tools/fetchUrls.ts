import { Browser } from "playwright";
import pLimit from "p-limit";
import { WebContentProcessor } from "../services/webContentProcessor.js";
import { BrowserService } from "../services/browserService.js";
import { FetchUrlsArgsSchema, FetchOptionsSchema, FetchResult } from "../types/index.js";
import { logger } from "../utils/logger.js";
import { validateUrlsProtocol } from "../utils/urlValidator.js";

/**
 * Tool definition for fetch_urls
 */
export const fetchUrlsTool = {
  name: "fetch_urls",
  description: "Retrieve web page content from multiple specified URLs",
  inputSchema: {
    type: "object",
    properties: {
      urls: {
        type: "array",
        items: {
          type: "string",
        },
        description: "Array of URLs to fetch",
      },
      timeout: {
        type: "number",
        description:
          "Page loading timeout in milliseconds, default is 30000 (30 seconds)",
      },
      waitUntil: {
        type: "string",
        description:
          "Specifies when navigation is considered complete, options: 'load', 'domcontentloaded', 'networkidle', 'commit', default is 'load'",
      },
      extractContent: {
        type: "boolean",
        description:
          "Whether to intelligently extract the main content, default is true",
      },
      maxLength: {
        type: "number",
        description:
          "Maximum length of returned content (in characters), default is no limit",
      },
      returnHtml: {
        type: "boolean",
        description:
          "Whether to return HTML content instead of Markdown, default is false",
      },
      waitForNavigation: {
        type: "boolean",
        description:
          "Whether to wait for additional navigation after initial page load (useful for sites with anti-bot verification), default is false",
      },
      navigationTimeout: {
        type: "number",
        description:
          "Maximum time to wait for additional navigation in milliseconds, default is 10000 (10 seconds)",
      },
      disableMedia: {
        type: "boolean",
        description:
          "Whether to disable media resources (images, stylesheets, fonts, media), default is true",
      },
      debug: {
        type: "boolean",
        description:
          "Whether to enable debug mode (showing browser window), overrides the --debug command line flag if specified",
      },
    },
    required: ["urls"],
  },
  annotations: {
    title: "Fetch URLs",
    readOnlyHint: true,
  },
};

/**
 * Implementation of the fetch_urls tool
 */
export async function fetchUrls(args: Record<string, unknown> = {}) {
  const parsed = FetchUrlsArgsSchema.parse(args);
  const urls = parsed.urls;

  // Validate all URL protocols for security (only allow HTTP and HTTPS)
  validateUrlsProtocol(urls);

  const options = FetchOptionsSchema.parse(parsed);

  // Configure concurrency limit for page creation
  let maxConcurrentPages = parseInt(
    process.env.MAX_CONCURRENT_PAGES || "5",
    10
  );
  if (isNaN(maxConcurrentPages) || maxConcurrentPages <= 0) {
    logger.warn(
      `Invalid MAX_CONCURRENT_PAGES value, using default of 5. Got: ${process.env.MAX_CONCURRENT_PAGES}`
    );
    maxConcurrentPages = 5;
  }
  const limit = pLimit(maxConcurrentPages);

  // Create browser service
  const browserService = new BrowserService(options);

  if (browserService.isInDebugMode()) {
    logger.debug(`Debug mode enabled for URLs: ${urls.join(", ")}`);
  }

  let browser: Browser | null = null;
  try {
    browser = await browserService.createBrowser();
    const { context, viewport } = await browserService.createContext(browser);
    const processor = new WebContentProcessor(options, "[FetchURLs]");

    const settled = await Promise.allSettled(
      urls.map((url, index) =>
        limit(async () => {
          const page = await browserService.createPage(context, viewport);
          try {
            const result = await processor.processPageContent(page, url);
            return { index, ...result } as FetchResult;
          } finally {
            if (!browserService.isInDebugMode()) {
              await page
                .close()
                .catch((e) => logger.error(`Failed to close page: ${e.message}`));
            } else {
              logger.debug(`Page kept open for debugging. URL: ${url}`);
            }
          }
        })
      ),
    );

    const results: FetchResult[] = settled.map((outcome, i) => {
      if (outcome.status === "fulfilled") {
        return outcome.value;
      }
      const errorMessage = outcome.reason instanceof Error
        ? outcome.reason.message
        : String(outcome.reason);
      logger.error(`[FetchURLs] Failed to fetch URL ${urls[i]}: ${errorMessage}`);
      return {
        success: false,
        content: `Title: Error\nURL: ${urls[i]}\nContent:\n\n<error>Failed to retrieve web page content: ${errorMessage}</error>`,
        error: errorMessage,
        index: i,
      };
    });

    results.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const combinedResults = results
      .map(
        (result, i) =>
          `[webpage ${i + 1} begin]\n${result.content}\n[webpage ${i + 1} end]`,
      )
      .join("\n\n");

    return {
      content: [{ type: "text", text: combinedResults }],
    };
  } finally {
    if (!browserService.isInDebugMode()) {
      if (browser)
        await browser
          .close()
          .catch((e) => logger.error(`Failed to close browser: ${e.message}`));
    } else {
      logger.debug(`Browser kept open for debugging. URLs: ${urls.join(", ")}`);
    }
  }
}
