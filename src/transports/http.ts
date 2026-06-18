import express, { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { TransportProvider } from "./types.js";
import { logger } from "../utils/logger.js";
import { registerOpenApiRoutes } from "./openapi.js";

/**
 * Check if a request is an initialization request
 */
function isInitializeRequest(body: any): boolean {
  return body?.method === "initialize" && body?.jsonrpc === "2.0";
}

/**
 * HTTP Transport Provider implementation
 * Handles HTTP and SSE communication protocols
 */
export class HttpTransportProvider implements TransportProvider {
  private app: express.Application;
  private server: any; // HTTP server instance
  private transports: {
    streamable: Record<string, StreamableHTTPServerTransport>;
    sse: Record<string, SSEServerTransport>;
  };

  /**
   * Create HTTP Transport Provider
   * @param host Host address
   * @param port Port number
   */
  constructor(private host: string = "localhost", private port: number = 3000) {
    this.app = express();
    this.app.use(express.json());

    this.transports = {
      streamable: {},
      sse: {},
    };
  }

  /**
   * Connect server to HTTP transport
   * @param server MCP server instance
   */
  async connect(server: Server): Promise<void> {
    logger.info(
      `[Transport] Connecting server using HTTP transport, listening on ${this.host}:${this.port}`
    );

    // Initialize Express routes
    this.setupRoutes(server);

    // Start HTTP server
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, this.host, () => {
        logger.info(
          `[Transport] HTTP server started, access at http://${this.host}:${this.port}`
        );
        resolve();
      });
    });
  }

  /**
   * Close HTTP transport connection
   */
  async close(): Promise<void> {
    // Close all transports
    Object.values(this.transports.streamable).forEach((transport) => {
      try {
        transport.close();
      } catch (err) {
        logger.error(
          `[Transport] Failed to close Streamable HTTP transport: ${err}`
        );
      }
    });

    Object.values(this.transports.sse).forEach((transport) => {
      try {
        transport.close();
      } catch (err) {
        logger.error(`[Transport] Failed to close SSE transport: ${err}`);
      }
    });

    // Close HTTP server
    if (this.server) {
      return new Promise((resolve, reject) => {
        this.server.close((err: Error) => {
          if (err) {
            logger.error(`[Transport] Failed to close HTTP server: ${err}`);
            reject(err);
          } else {
            logger.info("[Transport] HTTP server closed");
            resolve();
          }
        });
      });
    }

    return Promise.resolve();
  }

  /**
   * Set up Express routes
   * @param mcpServer MCP server instance
   */
  private setupRoutes(mcpServer: Server): void {
    // Streamable HTTP endpoint (modern MCP clients)
    this.app.post("/mcp", async (req: Request, res: Response) => {
      await this.handleStreamableHttpRequest(mcpServer, req, res);
    });

    // Handle GET requests (server-to-client notifications)
    this.app.get("/mcp", async (req: Request, res: Response) => {
      await this.handleSessionRequest(req, res);
    });

    // Handle DELETE requests (session termination)
    this.app.delete("/mcp", async (req: Request, res: Response) => {
      await this.handleSessionRequest(req, res);
    });

    // SSE endpoint (legacy MCP clients)
    this.app.get("/sse", async (req: Request, res: Response) => {
      await this.handleSseRequest(mcpServer, req, res);
    });

    // SSE message endpoint (legacy MCP clients)
    this.app.post("/messages", async (req: Request, res: Response) => {
      await this.handleSseMessageRequest(req, res);
    });

    // OpenAPI REST routes
    registerOpenApiRoutes(this.app);

    // Root path response
    this.app.get("/", (_req: Request, res: Response) => {
      res.send(`
        <html>
          <head><title>MCP Browser Server</title></head>
          <body>
            <h1>MCP Browser Server is running</h1>
            <p>This is an MCP server providing browser automation functionality.</p>
            <p>Supported endpoints:</p>
            <ul>
              <li><code>/mcp</code> - Streamable HTTP endpoint (modern MCP protocol)</li>
              <li><code>/sse</code> - SSE endpoint (legacy MCP protocol)</li>
              <li><code>/openapi.json</code> - OpenAPI 3.1 specification</li>
              <li><code>/tools/{name}</code> - REST tool endpoints</li>
            </ul>
          </body>
        </html>
      `);
    });
  }

  /**
   * Handle Streamable HTTP requests
   */
  private async handleStreamableHttpRequest(
    server: Server,
    req: Request,
    res: Response
  ): Promise<void> {
    // Check for existing session ID
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    try {
      if (sessionId && this.transports.streamable[sessionId]) {
        // Reuse existing transport
        logger.debug(`[Transport] Reusing existing session ID: ${sessionId}`);
        transport = this.transports.streamable[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // Initialize new transport
        logger.debug("[Transport] Initializing new StreamableHTTP transport");
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sessionId: string) => {
            logger.debug(
              `[Transport] StreamableHTTP session initialized: ${sessionId}`
            );
            this.transports.streamable[sessionId] = transport;
          },
        });

        // Clean up transport
        transport.onclose = () => {
          if (transport.sessionId) {
            logger.debug(
              `[Transport] Closing StreamableHTTP session: ${transport.sessionId}`
            );
            delete this.transports.streamable[transport.sessionId];
          }
        };

        // Connect to MCP server
        await server.connect(transport);
      } else {
        // Invalid request
        logger.error(
          "[Transport] Invalid request: No session ID and not an initialization request"
        );
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session ID provided",
          },
          id: null,
        });
        return;
      }

      // Handle request
      await transport.handleRequest(req, res, req.body);
    } catch (error: any) {
      logger.error(
        `[Transport] Error handling StreamableHTTP request: ${error.message}`
      );
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: `Internal server error: ${error.message}`,
          },
          id: null,
        });
      }
    }
  }

  /**
   * Handle session requests (GET/DELETE)
   */
  private async handleSessionRequest(
    req: Request,
    res: Response
  ): Promise<void> {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !this.transports.streamable[sessionId]) {
      logger.error(`[Transport] Invalid or missing session ID: ${sessionId}`);
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    try {
      const transport = this.transports.streamable[sessionId];
      await transport.handleRequest(req, res);
    } catch (error: any) {
      logger.error(
        `[Transport] Error handling session request: ${error.message}`
      );
      if (!res.headersSent) {
        res.status(500).send(`Internal server error: ${error.message}`);
      }
    }
  }

  /**
   * Handle SSE requests (legacy clients)
   */
  private async handleSseRequest(
    server: Server,
    req: Request,
    res: Response
  ): Promise<void> {
    try {
      logger.debug("[Transport] Initializing SSE transport");
      const transport = new SSEServerTransport("/messages", res);
      this.transports.sse[transport.sessionId] = transport;

      res.on("close", () => {
        logger.debug(`[Transport] Closing SSE session: ${transport.sessionId}`);
        delete this.transports.sse[transport.sessionId];
      });

      await server.connect(transport);
    } catch (error: any) {
      logger.error(`[Transport] Error handling SSE request: ${error.message}`);
      if (!res.headersSent) {
        res.status(500).send(`Internal server error: ${error.message}`);
      }
    }
  }

  /**
   * Handle SSE message requests (legacy clients)
   */
  private async handleSseMessageRequest(
    req: Request,
    res: Response
  ): Promise<void> {
    const sessionId = req.query.sessionId as string;
    const transport = sessionId ? this.transports.sse[sessionId] : undefined;

    if (transport) {
      try {
        await transport.handlePostMessage(req, res, req.body);
      } catch (error: any) {
        logger.error(
          `[Transport] Error handling SSE message request: ${error.message}`
        );
        if (!res.headersSent) {
          res.status(500).send(`Internal server error: ${error.message}`);
        }
      }
    } else {
      logger.error(
        `[Transport] No transport found for session ID: ${sessionId}`
      );
      res.status(400).send("No transport found for session ID");
    }
  }
}
