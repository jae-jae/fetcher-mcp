# Quality Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden fetcher-mcp with Zod input validation, resource leak fixes, and ESLint/strict TypeScript.

**Architecture:** Three-phase approach — Zod at tool input boundaries first (highest leverage), then fix resource leaks in browser lifecycle, then add mechanical safety nets (ESLint + strict tsconfig). Each phase commits independently.

**Tech Stack:** zod, eslint, @typescript-eslint/eslint-plugin, @typescript-eslint/parser, typescript (strict)

---

### Task 1: Install zod dependency

**Files:**
- Modify: `package.json`

**Step 1: Install zod**

Run: `npm install zod`

**Step 2: Verify installation**

Run: `npm ls zod`
Expected: `zod@3.x.x`

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add zod dependency"
```

---

### Task 2: Replace FetchOptions interface with Zod schema

**Files:**
- Modify: `src/types/index.ts`

**Step 1: Replace the FetchOptions interface and add schemas**

Replace the entire file with:

```ts
import { z } from "zod";

export const FetchOptionsSchema = z.object({
  timeout: z.number().positive().default(30000),
  waitUntil: z.enum(["load", "domcontentloaded", "networkidle", "commit"]).default("load"),
  extractContent: z.boolean().default(true),
  maxLength: z.number().nonnegative().default(0),
  returnHtml: z.boolean().default(false),
  waitForNavigation: z.boolean().default(false),
  navigationTimeout: z.number().positive().default(10000),
  disableMedia: z.boolean().default(true),
  debug: z.boolean().optional(),
});

export type FetchOptions = z.infer<typeof FetchOptionsSchema>;

export const FetchUrlArgsSchema = z.object({
  url: z.string().min(1, "URL parameter is required"),
}).merge(FetchOptionsSchema.partial());

export const FetchUrlsArgsSchema = z.object({
  urls: z.array(z.string().min(1)).min(1, "URLs array cannot be empty"),
}).merge(FetchOptionsSchema.partial());

export const BrowserInstallArgsSchema = z.object({
  withDeps: z.boolean().default(false),
  force: z.boolean().default(false),
});

export interface FetchResult {
  success: boolean;
  content: string;
  error?: string;
  index?: number;
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: Errors in fetchUrl.ts/fetchUrls.ts (expected — we haven't updated them yet). No errors in types/index.ts itself.

**Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "refactor: replace FetchOptions interface with Zod schemas"
```

---

### Task 3: Update fetchUrl to use Zod schema

**Files:**
- Modify: `src/tools/fetchUrl.ts:1-6` (imports)
- Modify: `src/tools/fetchUrl.ts:79-103` (handler signature + manual parsing)
- Modify: `src/tools/fetchUrl.ts:117-140` (finally block — add context cleanup)

**Step 1: Update the handler**

Replace import line 4:
```ts
import { FetchOptions } from "../types/index.js";
```
with:
```ts
import { FetchUrlArgsSchema, FetchOptionsSchema } from "../types/index.js";
```

Replace the handler function (lines 79-103) with:

```ts
export async function fetchUrl(args: Record<string, unknown> = {}) {
  const parsed = FetchUrlArgsSchema.parse(args);
  const url = parsed.url;

  // Validate URL protocol for security (only allow HTTP and HTTPS)
  validateUrlProtocol(url);

  const options = FetchOptionsSchema.parse(parsed);
```

Replace the finally block (lines 133-140) with:

```ts
  } finally {
    // Clean up resources (context is closed implicitly by browser.close())
    await browserService.cleanup(browser, page);

    if (browserService.isInDebugMode()) {
      logger.debug(`Browser and page kept open for debugging. URL: ${url}`);
    }
  }
```

Also remove unused `Browser, Page` import if the variables are now typed via inference. Actually keep them — they're used for the `let browser: Browser | null = null` declarations.

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: Still errors in fetchUrls.ts (not updated yet). No errors in fetchUrl.ts.

**Step 3: Commit**

```bash
git add src/tools/fetchUrl.ts
git commit -m "refactor: use Zod schema for fetchUrl input validation"
```

---

### Task 4: Update fetchUrls to use Zod schema + Promise.allSettled

**Files:**
- Modify: `src/tools/fetchUrls.ts:1-6` (imports)
- Modify: `src/tools/fetchUrls.ts:81-165` (handler — Zod + allSettled + context cleanup)

**Step 1: Update the handler**

Replace import line 4:
```ts
import { FetchOptions, FetchResult } from "../types/index.js";
```
with:
```ts
import { FetchUrlsArgsSchema, FetchOptionsSchema, FetchResult } from "../types/index.js";
```

Replace the handler function (lines 81-165) with:

```ts
export async function fetchUrls(args: Record<string, unknown> = {}) {
  const parsed = FetchUrlsArgsSchema.parse(args);
  const urls = parsed.urls;

  // Validate all URLs protocols for security (only allow HTTP and HTTPS)
  validateUrlsProtocol(urls);

  const options = FetchOptionsSchema.parse(parsed);

  // Create browser service
  const browserService = new BrowserService(options);

  if (browserService.isInDebugMode()) {
    logger.debug(`Debug mode enabled for URLs: ${urls.join(", ")}`);
  }

  let browser: Browser | null = null;
  try {
    // Create a stealth browser with anti-detection measures
    browser = await browserService.createBrowser();

    // Create a stealth browser context
    const { context, viewport } = await browserService.createContext(browser);

    const processor = new WebContentProcessor(options, "[FetchURLs]");

    const settled = await Promise.allSettled(
      urls.map(async (url, index) => {
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
      }),
    );

    // Convert settled results to FetchResults (handle rejections gracefully)
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
    // Clean up browser resources (closes all contexts implicitly)
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
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors in fetchUrls.ts.

**Step 3: Commit**

```bash
git add src/tools/fetchUrls.ts
git commit -m "refactor: use Zod schema + Promise.allSettled for fetchUrls"
```

---

### Task 5: Update browserInstall to use Zod schema

**Files:**
- Modify: `src/tools/browserInstall.ts:4` (add import)
- Modify: `src/tools/browserInstall.ts:40-42` (handler signature + parsing)

**Step 1: Update the handler**

Add import after line 4:
```ts
import { BrowserInstallArgsSchema } from "../types/index.js";
```

Replace lines 40-42:
```ts
export async function browserInstall(args: any) {
  const withDeps = args?.withDeps === true;
  const force = args?.force === true;
```
with:
```ts
export async function browserInstall(args: Record<string, unknown> = {}) {
  const { withDeps, force } = BrowserInstallArgsSchema.parse(args);
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/tools/browserInstall.ts
git commit -m "refactor: use Zod schema for browserInstall input validation"
```

---

### Task 6: Fix StdioTransportProvider type mismatch

**Files:**
- Modify: `src/transports/stdio.ts:1-3` (imports)
- Modify: `src/transports/stdio.ts:17-21` (connect method)

**Step 1: Fix the connect method**

Replace lines 1-3:
```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TransportProvider } from "./types.js";
```
with:
```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TransportProvider, ServerFactory } from "./types.js";
```

Replace lines 17-21:
```ts
  async connect(server: Server): Promise<void> {
    logger.info("[Transport] Connecting server using Stdio transport");
    this.transport = new StdioServerTransport();
    await server.connect(this.transport);
    logger.info("[Transport] Stdio transport connected");
  }
```
with:
```ts
  async connect(serverOrFactory: Server | ServerFactory): Promise<void> {
    const server = typeof serverOrFactory === "function"
      ? serverOrFactory()
      : serverOrFactory;
    logger.info("[Transport] Connecting server using Stdio transport");
    this.transport = new StdioServerTransport();
    await server.connect(this.transport);
    logger.info("[Transport] Stdio transport connected");
  }
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/transports/stdio.ts
git commit -m "fix: StdioTransportProvider accepts Server | ServerFactory"
```

---

### Task 7: Kill remaining `any` types

**Files:**
- Modify: `src/transports/http.ts:12-13` (isInitializeRequest param)
- Modify: `src/transports/http.ts:22` (server field type)
- Modify: `src/services/webContentProcessor.ts:18,144,164` (page param types)
- Modify: `src/server.ts:46` (handler args type)
- Modify: `src/tools/index.ts` (toolHandlers type)

**Step 1: Fix http.ts types**

Add import at top of `src/transports/http.ts`:
```ts
import { Server as HttpServer } from "node:http";
```

Replace line 12-13:
```ts
function isInitializeRequest(body: any): boolean {
  return body?.method === "initialize" && body?.jsonrpc === "2.0";
```
with:
```ts
function isInitializeRequest(body: Record<string, unknown>): boolean {
  return body?.method === "initialize" && body?.jsonrpc === "2.0";
```

Replace line 22:
```ts
  private server: any; // HTTP server instance
```
with:
```ts
  private server: HttpServer | null = null;
```

This will require updating the `close()` method's null check (line 95) — it already checks `if (this.server)` so that's fine. But the `.close()` callback typing on line 97 needs to handle `Error | undefined`:
```ts
        this.server.close((err?: Error) => {
```

**Step 2: Fix webContentProcessor.ts page types**

Add `Page` to existing playwright imports or add new import in `src/services/webContentProcessor.ts`:
```ts
import { Page } from "playwright";
```

Replace `page: any` with `page: Page` at lines 18, 144, and 164.

**Step 3: Fix server.ts handler args**

In `src/server.ts` line 46, the `request.params.arguments` is already typed by the MCP SDK — no change needed, it's `Record<string, unknown> | undefined`. The handlers now accept `Record<string, unknown>` so this is compatible.

**Step 4: Type the toolHandlers map**

In `src/tools/index.ts`, add a type for the handlers map:

```ts
type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[] }>;

export const toolHandlers: Record<string, ToolHandler> = {
  [fetchUrlTool.name]: fetchUrl,
  [fetchUrlsTool.name]: fetchUrls,
  [browserInstallTool.name]: browserInstall
};
```

**Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 6: Commit**

```bash
git add src/transports/http.ts src/services/webContentProcessor.ts src/server.ts src/tools/index.ts
git commit -m "refactor: eliminate any types across codebase"
```

---

### Task 8: Add ESLint + strict tsconfig

**Files:**
- Create: `eslint.config.js`
- Modify: `tsconfig.json`
- Modify: `package.json` (scripts + devDeps)

**Step 1: Install ESLint devDeps**

Run: `npm install --save-dev eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser`

**Step 2: Create eslint.config.js**

```js
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        projectService: true,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
```

**Step 3: Add noUncheckedIndexedAccess to tsconfig.json**

Add to `compilerOptions`:
```json
"noUncheckedIndexedAccess": true
```

**Step 4: Add scripts to package.json**

```json
"lint": "eslint src/",
"check": "tsc --noEmit && eslint src/"
```

**Step 5: Run lint and fix any issues**

Run: `npm run check`
Expected: Clean pass (or only `any` warnings from the `@ts-ignore` on turndown-plugin-gfm in webContentProcessor.ts — that one is acceptable because the package has no types).

**Step 6: Handle noUncheckedIndexedAccess fallout**

The `toolHandlers[toolName]` access in `server.ts:40` will now be `ToolHandler | undefined`. The existing `if (!handler)` guard on line 42 already handles this — TypeScript should narrow correctly.

**Step 7: Commit**

```bash
git add eslint.config.js tsconfig.json package.json package-lock.json
git commit -m "chore: add ESLint + strict TypeScript settings"
```

---

### Task 9: Build and verify

**Files:** None (verification only)

**Step 1: Full build**

Run: `npm run build`
Expected: Clean build, `build/` directory populated.

**Step 2: Full check**

Run: `npm run check`
Expected: No errors, only acceptable warnings.

**Step 3: Smoke test stdio mode**

Run: `echo '{"jsonrpc":"2.0","method":"initialize","params":{"capabilities":{}},"id":1}' | node build/index.js`
Expected: JSON-RPC response with server capabilities.

**Step 4: Smoke test HTTP mode**

Run in background: `node build/index.js --transport=http --port=3001 --log &`
Then: `curl -s -X POST http://localhost:3001/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"initialize","params":{"capabilities":{}},"id":1}'`
Expected: JSON-RPC response with session ID in header.
Cleanup: kill the background process.
