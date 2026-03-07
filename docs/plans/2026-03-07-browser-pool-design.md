# Browser Pool Design

## Date: 2026-03-07

## Context

The fetcher-mcp server launches and kills a Chromium process per `fetch_url` call (~1-2s cold start). With multiple simultaneous clients in HTTP transport mode, this is wasteful. Need browser pooling.

## Decision

Singleton pool of headless browser instances with acquire/release semantics.

### Configuration (env vars)

| Var | Default | Description |
|-----|---------|-------------|
| `BROWSER_POOL_SIZE` | 3 | Max pooled browsers |
| `BROWSER_POOL_WARM` | 1 | Pre-warmed at startup (capped at pool size) |
| `BROWSER_IDLE_TIMEOUT` | 300 | Seconds before idle eviction |

### Behavior

- **Lazy + warm**: Pre-warm N browsers at startup, create more on demand up to max
- **Burst overflow**: When pool is exhausted, create temporary browsers beyond max — destroyed on release
- **Idle eviction**: Browsers idle > timeout are closed, but never drops below warm count
- **Debug bypass**: `debug: true` requests always get a burst browser with `headless: false`, never pooled
- **Crash recovery**: Dead browsers (`!browser.isConnected()`) are discarded on acquire, replaced with fresh ones
- **Context-per-request**: Each request creates an isolated `BrowserContext` on the acquired browser

### Integration

- `src/services/browserPool.ts` — pool implementation
- `src/services/browserService.ts` — keeps context/page creation, loses `createBrowser()`
- `src/tools/fetchUrl.ts` / `fetchUrls.ts` — acquire from pool
- `src/server.ts` — wire pool shutdown into graceful shutdown
- `src/index.ts` — warm pool after server starts

### BrowserHandle contract

```typescript
interface BrowserHandle {
  browser: Browser;
  release(): Promise<void>;
}
```

Callers MUST call `release()` in a `finally` block.
