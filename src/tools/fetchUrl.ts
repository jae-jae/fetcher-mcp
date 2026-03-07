import { WebContentProcessor } from "../services/webContentProcessor.js";
import { BrowserService } from "../services/browserService.js";
import { BrowserPool, BrowserHandle } from "../services/browserPool.js";
import { FetchUrlArgsSchema, FetchOptionsSchema } from "../types/index.js";
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
export async function fetchUrl(args: Record<string, unknown> = {}) {
  const parsed = FetchUrlArgsSchema.parse(args);
  const url = parsed.url;

  validateUrlProtocol(url);

  const options = FetchOptionsSchema.parse(parsed);
  const browserService = new BrowserService(options);
  const processor = new WebContentProcessor(options, "[FetchURL]");

  const pool = BrowserPool.getInstance();
  let handle: BrowserHandle | null = null;

  try {
    handle = await pool.acquire(browserService.isInDebugMode());
    const { context, viewport } = await browserService.createContext(handle.browser);

    try {
      const page = await browserService.createPage(context, viewport);
      const result = await processor.processPageContent(page, url);

      return {
        content: [{ type: "text", text: result.content }],
      };
    } finally {
      if (!browserService.isInDebugMode()) {
        await context.close().catch((e: Error) =>
          logger.error(`[FetchURL] Failed to close context: ${e.message}`)
        );
      }
    }
  } finally {
    if (handle) await handle.release();
  }
}
