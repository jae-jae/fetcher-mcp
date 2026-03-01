import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TransportProvider, ServerFactory } from "./types.js";
import { logger } from "../utils/logger.js";

/**
 * Stdio Transport Provider implementation
 * Handles MCP communication via standard input/output
 */
export class StdioTransportProvider implements TransportProvider {
  private transport: StdioServerTransport | null = null;

  /**
   * Connect server to Stdio transport
   * @param serverOrFactory MCP server instance or factory for per-session servers
   */
  async connect(serverOrFactory: Server | ServerFactory): Promise<void> {
    const server = typeof serverOrFactory === "function"
      ? serverOrFactory()
      : serverOrFactory;
    logger.info("[Transport] Connecting server using Stdio transport");
    this.transport = new StdioServerTransport();
    await server.connect(this.transport);
    logger.info("[Transport] Stdio transport connected");
  }

  /**
   * Close Stdio transport connection
   */
  async close(): Promise<void> {
    if (this.transport) {
      logger.info("[Transport] Closing Stdio transport");
      this.transport.close();
      this.transport = null;
    }
  }
}
