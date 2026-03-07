import { Browser, BrowserContext, Page } from "playwright";
import { FetchOptions } from "../types/index.js";

/**
 * Service for managing browser contexts and pages with anti-detection features.
 * Browser lifecycle is now owned by BrowserPool — this service handles
 * context creation, page creation, and stealth configuration.
 */
export class BrowserService {
  private options: FetchOptions;
  private isDebugMode: boolean;

  constructor(options: FetchOptions) {
    this.options = options;
    this.isDebugMode = process.argv.includes("--debug");

    // Debug mode from options takes precedence over command line flag
    if (options.debug !== undefined) {
      this.isDebugMode = options.debug;
    }
  }

  /**
   * Get whether debug mode is enabled
   */
  public isInDebugMode(): boolean {
    return this.isDebugMode;
  }

  /**
   * Generate a random user agent string
   */
  private getRandomUserAgent(): string {
    const userAgents = [
      // Chrome - Windows
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      // Chrome - Mac
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      // Firefox
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0",
      // Safari
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)] ?? userAgents[0]!;
  }

  /**
   * Generate a random viewport size
   */
  private getRandomViewport(): {width: number, height: number} {
    const viewports = [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1536, height: 864 },
      { width: 1440, height: 900 },
      { width: 1280, height: 720 },
    ];
    return viewports[Math.floor(Math.random() * viewports.length)] ?? viewports[0]!;
  }

  /**
   * Setup anti-detection script to evade browser automation detection
   */
  private async setupAntiDetection(context: BrowserContext): Promise<void> {
    await context.addInitScript(() => {
      // Override navigator.webdriver
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });

      // Remove automation fingerprints
      delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Array;
      delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Promise;
      delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Symbol;

      // Add Chrome object for fingerprinting evasion
      const chrome = {
        runtime: {},
      };

      // Add fingerprint characteristics
      (window as any).chrome = chrome;

      // Modify screen and navigator properties
      Object.defineProperty(screen, 'width', { value: window.innerWidth });
      Object.defineProperty(screen, 'height', { value: window.innerHeight });
      Object.defineProperty(screen, 'availWidth', { value: window.innerWidth });
      Object.defineProperty(screen, 'availHeight', { value: window.innerHeight });

      // Add language features
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });

      // Simulate random number of plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          const plugins = [];
          for (let i = 0; i < 5 + Math.floor(Math.random() * 5); i++) {
            plugins.push({
              name: 'Plugin ' + i,
              description: 'Description ' + i,
              filename: 'plugin' + i + '.dll',
            });
          }
          return plugins;
        },
      });
    });
  }

  /**
   * Setup media handling - disable media loading if needed
   */
  private async setupMediaHandling(context: BrowserContext): Promise<void> {
    if (this.options.disableMedia) {
      await context.route("**/*", async (route) => {
        const resourceType = route.request().resourceType();
        if (["image", "stylesheet", "font", "media"].includes(resourceType)) {
          await route.abort();
        } else {
          await route.continue();
        }
      });
    }
  }

  /**
   * Create a new browser context with stealth configurations
   */
  public async createContext(browser: Browser): Promise<{ context: BrowserContext, viewport: {width: number, height: number} }> {
    const viewport = this.getRandomViewport();

    const context = await browser.newContext({
      javaScriptEnabled: true,
      ignoreHTTPSErrors: true,
      userAgent: this.getRandomUserAgent(),
      viewport: viewport,
      deviceScaleFactor: Math.random() > 0.5 ? 1 : 2,
      isMobile: false,
      hasTouch: false,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      colorScheme: 'light',
      acceptDownloads: true,
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
      }
    });

    // Set up anti-detection measures
    await this.setupAntiDetection(context);

    // Configure media handling
    await this.setupMediaHandling(context);

    return { context, viewport };
  }

  /**
   * Create a new page
   */
  public async createPage(context: BrowserContext, _viewport: {width: number, height: number}): Promise<Page> {
    const page = await context.newPage();
    return page;
  }
}
