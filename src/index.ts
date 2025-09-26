#!/usr/bin/env node

/**
 * MCP server based on Playwright headless browser
 * Provides web content fetching functionality
 * Supports Stdio and HTTP/SSE transport protocols
 */

import { getConfig, isDebugMode } from "./config/index.js";
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
    // Get configuration
    const config = getConfig();

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
    } else {
      logger.info("[Setup] Using standard input/output (stdio) transport");
    }
  } catch (error: any) {
    logger.error(`[Error] Server error: ${error.message}`);
    if (error.stack) {
      logger.debug(error.stack);
    }
    process.exit(1);
  }
}

main();
