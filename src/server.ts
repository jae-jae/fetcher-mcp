import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { tools, toolHandlers } from "./tools/index.js";
import { TransportProvider } from "./transports/types.js";
import { logger } from "./utils/logger.js";

/**
 * Create MCP server instance
 * @returns MCP server instance
 */
function createServer() {
  const server = new Server(
    {
      name: "browser-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.info("[Tools] Listing available tools");
    return {
      tools,
    };
  });

  /**
   * Handle tool call requests
   * Dispatch to the appropriate tool implementation
   */
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const handler = toolHandlers[toolName];

    if (!handler) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    return handler(request.params.arguments ?? {});
  });

  return server;
}

/**
 * Set up process signal handlers
 * @param transportProvider Transport provider
 */
function setupProcessHandlers(transportProvider: TransportProvider): void {
  // Handle SIGINT signal (Ctrl+C)
  process.on("SIGINT", async () => {
    logger.info("[Server] Received SIGINT signal, gracefully shutting down...");
    await transportProvider.close();
    process.exit(0);
  });

  // Handle SIGTERM signal
  process.on("SIGTERM", async () => {
    logger.info(
      "[Server] Received SIGTERM signal, gracefully shutting down..."
    );
    await transportProvider.close();
    process.exit(0);
  });

  // Handle uncaught exceptions
  process.on("uncaughtException", async (error) => {
    logger.error(`[Server] Uncaught exception: ${error.message}`);
    if (error.stack) {
      logger.error(error.stack);
    }
    await transportProvider.close();
    process.exit(1);
  });
}

/**
 * Start MCP server using the specified transport provider
 * @param transportProvider Transport provider
 */
export async function startServer(
  transportProvider: TransportProvider
): Promise<void> {
  try {
    logger.info("[Server] Starting MCP server...");
    // Connect to transport (pass factory so HTTP can create per-session servers)
    await transportProvider.connect(createServer);

    logger.info("[Server] MCP server started");

    // Set up process termination handlers
    setupProcessHandlers(transportProvider);
  } catch (error: any) {
    logger.error(`[Server] Failed to start MCP server: ${error.message}`);
    throw error;
  }
}
