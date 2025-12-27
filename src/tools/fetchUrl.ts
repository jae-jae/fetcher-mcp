import { Browser, Page } from "playwright";
import { WebContentProcessor } from "../services/webContentProcessor.js";
import { BrowserService } from "../services/browserService.js";
import { FetchOptions } from "../types/index.js";
import { logger } from "../utils/logger.js";
import { validateUrlProtocol } from "../utils/urlValidator.js";

/**
 * Tool definition for fetch_url
 */
export const fetchUrlTool = {
  name: "fetch_url",
  description: "Retrieve web page content from a specified URL",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "URL to fetch. Make sure to include the schema (http:// or https:// if not defined, preferring https for most cases)",
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
    required: ["url"],
  },
  annotations: {
    title: "Fetch URL",
    readOnlyHint: true,
  },
};

/**
 * Implementation of the fetch_url tool
 */
export async function fetchUrl(args: any) {
  const url = String(args?.url || "");
  if (!url) {
    logger.error(`URL parameter missing`);
    throw new Error("URL parameter is required");
  }

  // Validate URL protocol for security (only allow HTTP and HTTPS)
  validateUrlProtocol(url);

  const options: FetchOptions = {
    timeout: Number(args?.timeout) || 30000,
    waitUntil: String(args?.waitUntil || "load") as
      | "load"
      | "domcontentloaded"
      | "networkidle"
      | "commit",
    extractContent: args?.extractContent !== false,
    maxLength: Number(args?.maxLength) || 0,
    returnHtml: args?.returnHtml === true,
    waitForNavigation: args?.waitForNavigation === true,
    navigationTimeout: Number(args?.navigationTimeout) || 10000,
    disableMedia: args?.disableMedia !== false,
    debug: args?.debug,
  };

  // Create browser service
  const browserService = new BrowserService(options);

  // Create content processor
  const processor = new WebContentProcessor(options, "[FetchURL]");
  let browser: Browser | null = null;
  let page: Page | null = null;

  if (browserService.isInDebugMode()) {
    logger.debug(`Debug mode enabled for URL: ${url}`);
  }

  try {
    // Create a stealth browser with anti-detection measures
    browser = await browserService.createBrowser();

    // Create a stealth browser context
    const { context, viewport } = await browserService.createContext(browser);

    // Create a new page with human-like behavior
    page = await browserService.createPage(context, viewport);

    // Process page content
    const result = await processor.processPageContent(page, url);

    return {
      content: [{ type: "text", text: result.content }],
    };
  } finally {
    // Clean up resources
    await browserService.cleanup(browser, page);

    if (browserService.isInDebugMode()) {
      logger.debug(`Browser and page kept open for debugging. URL: ${url}`);
    }
  }
}
