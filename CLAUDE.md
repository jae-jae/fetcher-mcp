# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

MCP server that fetches web page content using Playwright headless browser. Exposes three tools (`fetch_url`, `fetch_urls`, `browser_install`) over MCP protocol via stdio or HTTP transport.

## Commands

```bash
npm install                    # Install dependencies
npm run install-browser        # Install Playwright Chromium
npm run build                  # Clean build (rm -rf build && tsc)
npm run watch                  # TypeScript watch mode
npm run inspector              # Build + launch MCP Inspector with --debug

# Run locally
node build/index.js                                          # stdio mode
node build/index.js --transport=http --host=0.0.0.0 --port=3000 --log  # HTTP mode
node build/index.js --debug                                  # visible browser window
```

No test suite or linter is configured.

## Architecture

### Transport Layer (`src/transports/`)

Two transport modes selected via `--transport=` CLI arg (parsed in `src/config/args.ts`):

- **stdio** (default): Single `Server` instance, direct stdin/stdout. `StdioTransportProvider` receives the server directly.
- **http**: Express server with per-session MCP server instances. `HttpTransportProvider` receives a `ServerFactory` (not a server instance) and calls it for each new session. Exposes:
  - `POST /mcp` — Streamable HTTP (modern MCP). Session tracked via `mcp-session-id` header.
  - `GET /sse` + `POST /messages` — Legacy SSE transport.

The `TransportProvider` interface (`src/transports/types.ts`) accepts `Server | ServerFactory` — this dual signature is the key abstraction enabling per-session isolation in HTTP mode while keeping stdio simple.

### Tool Registration (`src/tools/`)

Tools are registered in `src/tools/index.ts` as a flat `tools` array (definitions) and `toolHandlers` map (name → async function). `server.ts` wires these to MCP's `ListToolsRequestSchema` and `CallToolRequestSchema`.

Each tool file exports both the schema object and the handler function. Adding a new tool: create the file, export both, register in `src/tools/index.ts`.

### Content Pipeline (`src/services/`)

`fetchUrl` and `fetchUrls` both follow the same flow:

1. **`BrowserService`** — Launches Chromium with anti-detection (random UA, viewport, stealth init scripts). Creates browser → context → page. Handles cleanup. Debug mode (`--debug` or per-request `debug: true`) keeps browser visible and skips cleanup.
2. **`WebContentProcessor`** — Navigates page, handles timeouts gracefully (attempts content extraction even after timeout), optional `waitForNavigation` for anti-bot sites, then extracts content:
   - Raw HTML from Playwright page
   - Optional Readability extraction (JSDOM + `@mozilla/readability`)
   - Optional HTML→Markdown conversion (Turndown + GFM plugin)
   - Optional truncation via `maxLength`

`fetch_urls` shares a single browser instance across all URLs but creates parallel pages via `Promise.all`.

### Logging

`src/utils/logger.ts` — Only active when `--log` CLI flag is present. All output goes to `stderr` (not stdout, which would corrupt stdio MCP transport).

### URL Security

`src/utils/urlValidator.ts` — Restricts URLs to `http:` and `https:` protocols only. Throws `URLSecurityError` for anything else.

## Deployment

Docker image: `ghcr.io/jae-jae/fetcher-mcp:latest`. The Dockerfile bakes in `--transport=http --host=0.0.0.0 --port=3000` as the default CMD. Don't pass CLI args via K8s `args` field — the image has a baked-in entrypoint.

## Key Types

- `FetchOptions` / `FetchResult` — in `src/types/index.ts`
- `TransportConfig` / `TransportProvider` / `ServerFactory` — in `src/transports/types.ts`
