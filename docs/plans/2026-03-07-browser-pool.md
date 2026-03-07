# Browser Pool Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a singleton browser pool with lazy creation, idle eviction, warm browsers, and burst overflow to eliminate per-request Chromium cold starts.

**Architecture:** A `BrowserPool` singleton manages headless Chromium instances with acquire/release semantics. Tool handlers acquire a browser, create an isolated `BrowserContext` for the request, then release. Debug requests bypass the pool with temporary visible browsers. Pool integrates with server lifecycle for graceful shutdown.

**Tech Stack:** Playwright (chromium), Node.js timers for idle eviction

---

### Task 1: Create BrowserPool service

**Files:**
- Create: `src/services/browserPool.ts`

**Step 1: Write the BrowserPool class**

This is the core pool implementation. No test framework exists in this project, so we verify manually via `npm run check`.

```typescript
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
```

**Step 2: Verify it compiles**

Run: `npm run check`
Expected: 0 errors

**Step 3: Commit**

```bash
git add src/services/browserPool.ts
git commit -m "feat: add BrowserPool with lazy creation, idle eviction, burst overflow"
```

---

### Task 2: Refactor BrowserService — remove createBrowser, keep context/page

**Files:**
- Modify: `src/services/browserService.ts`

**Step 1: Remove `createBrowser()`, `isBrowserNotInstalledError()`, and the `chromium` import**

The pool now owns browser creation. BrowserService keeps context creation, page creation, anti-detection, and media handling. Also remove `cleanup()` — callers will close contexts directly, and the pool handles browser lifecycle.

Remove:
- Line 1: `chromium` from the import
- Lines 133-177: `createBrowser()` and `isBrowserNotInstalledError()`
- Lines 232-250: `cleanup()` method

The `chromium` import becomes unused. The remaining import should be:
```typescript
import { Browser, BrowserContext, Page } from "playwright";
```

**Step 2: Verify it compiles**

Run: `npm run check`
Expected: Errors in fetchUrl.ts and fetchUrls.ts (they still call `createBrowser()` and `cleanup()`). That's expected — we fix those next.

**Step 3: Commit**

```bash
git add src/services/browserService.ts
git commit -m "refactor: remove browser lifecycle from BrowserService (pool owns it now)"
```

---

### Task 3: Refactor fetchUrl to use BrowserPool

**Files:**
- Modify: `src/tools/fetchUrl.ts`

**Step 1: Replace browser creation with pool acquire/release**

The new flow: acquire handle from pool → create context → create page → process → close context → release handle.

```typescript
import { Page } from "playwright";
import { WebContentProcessor } from "../services/webContentProcessor.js";
import { BrowserService } from "../services/browserService.js";
import { BrowserPool, BrowserHandle } from "../services/browserPool.js";
import { FetchUrlArgsSchema, FetchOptionsSchema } from "../types/index.js";
import { logger } from "../utils/logger.js";
import { validateUrlProtocol } from "../utils/urlValidator.js";

// ... fetchUrlTool definition unchanged ...

export async function fetchUrl(args: Record<string, unknown> = {}) {
  const parsed = FetchUrlArgsSchema.parse(args);
  const url = parsed.url;

  validateUrlProtocol(url);

  const options = FetchOptionsSchema.parse(parsed);
  const browserService = new BrowserService(options);
  const processor = new WebContentProcessor(options, "[FetchURL]");

  const pool = BrowserPool.getInstance();
  let handle: BrowserHandle | null = null;
  let page: Page | null = null;

  try {
    handle = await pool.acquire(browserService.isInDebugMode());
    const { context, viewport } = await browserService.createContext(handle.browser);

    try {
      page = await browserService.createPage(context, viewport);
      const result = await processor.processPageContent(page, url);

      return {
        content: [{ type: "text", text: result.content }],
      };
    } finally {
      if (!browserService.isInDebugMode()) {
        await context.close().catch((e) =>
          logger.error(`[FetchURL] Failed to close context: ${e.message}`)
        );
      }
    }
  } finally {
    if (handle) await handle.release();
  }
}
```

**Step 2: Verify it compiles**

Run: `npm run check`
Expected: fetchUrl clean, fetchUrls still has errors (next task)

**Step 3: Commit**

```bash
git add src/tools/fetchUrl.ts
git commit -m "refactor: fetchUrl uses BrowserPool acquire/release"
```

---

### Task 4: Refactor fetchUrls to use BrowserPool

**Files:**
- Modify: `src/tools/fetchUrls.ts`

**Step 1: Replace browser creation with pool acquire/release**

Same pattern as fetchUrl. One acquire for the entire batch (all pages share the same browser). Context-per-page for isolation within the batch.

```typescript
import pLimit from "p-limit";
import { WebContentProcessor } from "../services/webContentProcessor.js";
import { BrowserService } from "../services/browserService.js";
import { BrowserPool, BrowserHandle } from "../services/browserPool.js";
import { FetchUrlsArgsSchema, FetchOptionsSchema, FetchResult } from "../types/index.js";
import { logger } from "../utils/logger.js";
import { validateUrlsProtocol } from "../utils/urlValidator.js";

// ... fetchUrlsTool definition unchanged ...

export async function fetchUrls(args: Record<string, unknown> = {}) {
  const parsed = FetchUrlsArgsSchema.parse(args);
  const urls = parsed.urls;

  validateUrlsProtocol(urls);

  const options = FetchOptionsSchema.parse(parsed);

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

  const browserService = new BrowserService(options);
  const processor = new WebContentProcessor(options, "[FetchURLs]");

  const pool = BrowserPool.getInstance();
  let handle: BrowserHandle | null = null;

  try {
    handle = await pool.acquire(browserService.isInDebugMode());

    const settled = await Promise.allSettled(
      urls.map((url, index) =>
        limit(async () => {
          const { context, viewport } = await browserService.createContext(handle!.browser);
          try {
            const page = await browserService.createPage(context, viewport);
            try {
              const result = await processor.processPageContent(page, url);
              return { index, ...result } as FetchResult;
            } finally {
              if (!browserService.isInDebugMode()) {
                await page.close().catch((e) =>
                  logger.error(`[FetchURLs] Failed to close page: ${e.message}`)
                );
              }
            }
          } finally {
            if (!browserService.isInDebugMode()) {
              await context.close().catch((e) =>
                logger.error(`[FetchURLs] Failed to close context: ${e.message}`)
              );
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
    if (handle) await handle.release();
  }
}
```

**Step 2: Verify it compiles**

Run: `npm run check`
Expected: 0 errors

**Step 3: Commit**

```bash
git add src/tools/fetchUrls.ts
git commit -m "refactor: fetchUrls uses BrowserPool acquire/release"
```

---

### Task 5: Wire pool into server lifecycle

**Files:**
- Modify: `src/server.ts` — add pool shutdown to graceful shutdown
- Modify: `src/index.ts` — warm pool after server starts

**Step 1: Add pool shutdown to server.ts**

In `setupProcessHandlers`, update `gracefulShutdown` to also shut down the pool:

```typescript
import { BrowserPool } from "./services/browserPool.js";

// In setupProcessHandlers, change gracefulShutdown to:
const gracefulShutdown = async () => {
  logger.info("[Server] Starting graceful shutdown...");
  await BrowserPool.getInstance().shutdown();
  return transportProvider.close();
};
```

**Step 2: Add pool warming to index.ts**

After `await startServer(transportProvider)`, add:

```typescript
import { BrowserPool } from "./services/browserPool.js";

// After startServer call:
await BrowserPool.getInstance().warm();
```

**Step 3: Verify it compiles and builds**

Run: `npm run check && npm run build`
Expected: 0 errors, clean build

**Step 4: Commit**

```bash
git add src/server.ts src/index.ts
git commit -m "feat: wire BrowserPool into server startup/shutdown lifecycle"
```

---

### Task 6: Clean up BrowserService

**Files:**
- Modify: `src/services/browserService.ts`

**Step 1: Remove dead code**

After tasks 2-5, `createBrowser()`, `isBrowserNotInstalledError()`, and `cleanup()` should already be removed. Verify no dead methods remain. Also check that the browser-not-installed error hint still surfaces somewhere useful — it should, since `BrowserPool.launchBrowser()` will throw Playwright's native error which includes install instructions.

**Step 2: Verify full pipeline**

Run: `npm run check && npm run build`
Expected: 0 errors, clean build

**Step 3: Commit (if any cleanup was needed)**

```bash
git add src/services/browserService.ts
git commit -m "refactor: clean up BrowserService after pool integration"
```

---

### Task 7: Final verification

**Step 1: Full quality check**

Run: `npm run check && npm run build`
Expected: 0 errors, clean build

**Step 2: Manual smoke test**

```bash
# Quick test — start server, it should warm 1 browser
node build/index.js --transport=http --host=127.0.0.1 --port=3000 --log 2>&1 &
sleep 3

# Check logs show pool warming
# Kill with Ctrl+C — should show graceful shutdown + pool shutdown
kill %1
```

**Step 3: Commit any final fixes, push**

```bash
git push origin main
```
