#!/usr/bin/env node

/**
 * MCP server based on Playwright headless browser
 * Provides web content fetching functionality
 * Supports Stdio and HTTP/SSE transport protocols
 */

import { describeProxy, getConfig, isDebugMode, ProxyConfigError } from "./config/index.js";
import { createTransportProvider } from "./transports/index.js";
import { startServer } from "./server.js";
import { logger } from "./utils/logger.js";

/**
 * Start the server
 */
async function main() {
  logger.info("[Setup] Initializing browser MCP server...");

  if (isDebugMode()) {
    logger.warn(
      "[Setup] Debug mode enabled, Chrome browser window will be visible"
    );
  }

  try {
    // Get configuration. Invalid FETCHER_PROXY throws before the server listens.
    const config = getConfig();

    if (config.proxy) {
      // stderr, not the MCP stdout stream. The line never includes credentials.
      console.error(`[fetcher-mcp] ${describeProxy(config.proxy)}`);
      if (config.proxy.bypass?.split(",").includes("*")) {
        console.error(
          '[fetcher-mcp] Warning: proxy bypass includes "*", so matching requests are sent directly instead of through FETCHER_PROXY. URL validation still applies.'
        );
      }
    }

    // Create transport provider
    const transportProvider = createTransportProvider(config.transport);

    // Start server
    await startServer(transportProvider);

    logger.info("[Setup] Server started");

    // Print transport information
    if (config.transport.type === "http") {
      logger.info(
        `[Setup] HTTP server running at http://${
          config.transport.host || "localhost"
        }:${config.transport.port || 3000}`
      );
      logger.info("[Setup] Available endpoints:");
      logger.info(
        "[Setup] - /mcp - Streamable HTTP endpoint (modern MCP protocol)"
      );
      logger.info("[Setup] - /sse - SSE endpoint (legacy MCP protocol)");
      logger.info("[Setup] - /openapi.json - OpenAPI 3.1 specification");
      logger.info("[Setup] - /tools/{name} - REST tool endpoints");
    } else {
      logger.info("[Setup] Using standard input/output (stdio) transport");
    }
  } catch (error: any) {
    if (error instanceof ProxyConfigError) {
      console.error(error.message);
    } else {
      logger.error(`[Error] Server error: ${error.message}`);
      if (error.stack) {
        logger.debug(error.stack);
      }
    }
    process.exit(1);
  }
}

main();
