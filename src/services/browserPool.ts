import { Browser, chromium } from "playwright";
import { logger } from "../utils/logger.js";

export interface BrowserHandle {
  browser: Browser;
  release(): Promise<void>;
}

interface PooledBrowser {
  browser: Browser;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export class BrowserPool {
  private static instance: BrowserPool | null = null;

  private idle: PooledBrowser[] = [];
  private inUse = 0;
  private poolSize: number;
  private warmCount: number;
  private idleTimeoutMs: number;
  private shutdownRequested = false;

  private constructor() {
    this.poolSize = this.envInt("BROWSER_POOL_SIZE", 3);
    this.warmCount = Math.min(
      this.envInt("BROWSER_POOL_WARM", 1),
      this.poolSize,
    );
    this.idleTimeoutMs = this.envInt("BROWSER_IDLE_TIMEOUT", 300) * 1000;
  }

  static getInstance(): BrowserPool {
    if (!BrowserPool.instance) {
      BrowserPool.instance = new BrowserPool();
    }
    return BrowserPool.instance;
  }

  /** Pre-warm browsers up to warmCount. Call after server starts. */
  async warm(): Promise<void> {
    const toCreate = this.warmCount - this.idle.length;
    for (let i = 0; i < toCreate; i++) {
      try {
        const browser = await this.launchBrowser();
        this.addToIdle(browser);
        logger.info(`[BrowserPool] Warmed browser ${i + 1}/${toCreate}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[BrowserPool] Failed to warm browser: ${msg}`);
      }
    }
  }

  /**
   * Acquire a browser from the pool.
   * - If debug is true, creates a temporary visible browser (never pooled).
   * - Otherwise returns a pooled browser, creating or bursting as needed.
   */
  async acquire(debug = false): Promise<BrowserHandle> {
    if (this.shutdownRequested) {
      throw new Error("BrowserPool is shutting down");
    }

    // Debug requests always get a temporary visible browser
    if (debug) {
      const browser = await this.launchBrowser(false);
      logger.debug("[BrowserPool] Created burst browser for debug request");
      return {
        browser,
        release: async () => {
          // Debug browsers stay open — don't close
          logger.debug("[BrowserPool] Debug browser kept open");
        },
      };
    }

    // Try to get an idle browser
    while (this.idle.length > 0) {
      const pooled = this.idle.pop()!;
      if (pooled.idleTimer) clearTimeout(pooled.idleTimer);

      if (pooled.browser.isConnected()) {
        this.inUse++;
        logger.debug(
          `[BrowserPool] Acquired idle browser (idle=${this.idle.length} inUse=${this.inUse})`,
        );
        return this.createHandle(pooled.browser, false);
      }
      // Dead browser — discard and try next
      logger.warn("[BrowserPool] Discarded dead browser from pool");
    }

    // No idle browsers — create a new one
    const isBurst = this.inUse >= this.poolSize;
    const browser = await this.launchBrowser();
    this.inUse++;

    if (isBurst) {
      logger.info(
        `[BrowserPool] Created burst browser (inUse=${this.inUse}, poolSize=${this.poolSize})`,
      );
    } else {
      logger.debug(
        `[BrowserPool] Created new pooled browser (idle=${this.idle.length} inUse=${this.inUse})`,
      );
    }

    return this.createHandle(browser, isBurst);
  }

  /** Graceful shutdown — close all browsers. */
  async shutdown(): Promise<void> {
    this.shutdownRequested = true;
    logger.info("[BrowserPool] Shutting down...");

    // Clear idle timers and close idle browsers
    for (const pooled of this.idle) {
      if (pooled.idleTimer) clearTimeout(pooled.idleTimer);
      await this.closeBrowser(pooled.browser);
    }
    this.idle = [];

    // In-use browsers will be closed when their handles are released
    // (release() checks shutdownRequested)
    logger.info("[BrowserPool] Shutdown complete");
  }

  /** Reset singleton — for testing only. */
  static resetInstance(): void {
    BrowserPool.instance = null;
  }

  private createHandle(browser: Browser, isBurst: boolean): BrowserHandle {
    let released = false;
    return {
      browser,
      release: async () => {
        if (released) return;
        released = true;
        this.inUse--;

        if (isBurst || this.shutdownRequested) {
          await this.closeBrowser(browser);
          if (isBurst) {
            logger.debug("[BrowserPool] Destroyed burst browser");
          }
          return;
        }

        if (browser.isConnected()) {
          this.addToIdle(browser);
          logger.debug(
            `[BrowserPool] Released browser to pool (idle=${this.idle.length} inUse=${this.inUse})`,
          );
        } else {
          logger.warn("[BrowserPool] Released browser was dead, discarding");
        }
      },
    };
  }

  private addToIdle(browser: Browser): void {
    const pooled: PooledBrowser = { browser, idleTimer: null };

    // Only set idle timer if we're above warm count
    if (this.idle.length >= this.warmCount) {
      pooled.idleTimer = setTimeout(() => {
        const idx = this.idle.indexOf(pooled);
        if (idx !== -1 && this.idle.length > this.warmCount) {
          this.idle.splice(idx, 1);
          this.closeBrowser(pooled.browser);
          logger.info(
            `[BrowserPool] Evicted idle browser (idle=${this.idle.length})`,
          );
        }
      }, this.idleTimeoutMs);
    }

    this.idle.push(pooled);
  }

  private async launchBrowser(headless = true): Promise<Browser> {
    return chromium.launch({
      headless,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-webgl",
        "--disable-infobars",
        "--disable-extensions",
      ],
    });
  }

  private async closeBrowser(browser: Browser): Promise<void> {
    try {
      if (browser.isConnected()) await browser.close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[BrowserPool] Failed to close browser: ${msg}`);
    }
  }

  private envInt(name: string, defaultVal: number): number {
    const val = process.env[name];
    if (!val) return defaultVal;
    const parsed = parseInt(val, 10);
    if (isNaN(parsed) || parsed <= 0) {
      logger.warn(
        `[BrowserPool] Invalid ${name}=${val}, using default ${defaultVal}`,
      );
      return defaultVal;
    }
    return parsed;
  }
}
