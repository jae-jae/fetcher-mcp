import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Response, Request } from "express";

/**
 * Transport configuration interface
 */
export interface TransportConfig {
  type: "stdio" | "http";
  port?: number;
  host?: string;
}

/**
 * Transport provider interface
 * Defines common methods for creating and connecting transports
 */
export type ServerFactory = () => Server;

export interface TransportProvider {
  /**
   * Connect server to transport layer
   * @param serverOrFactory MCP server instance or factory for per-session servers
   */
  connect(serverOrFactory: Server | ServerFactory): Promise<void>;

  /**
   * Close transport connection
   */
  close(): Promise<void>;
}

/**
 * HTTP transport session
 */
export interface HttpSession {
  sessionId: string;
  transport: any; // Actual type depends on implementation
}

/**
 * SSE transport request handler interface
 */
export interface SseRequestHandler {
  handleRequest(req: Request, res: Response, body?: any): Promise<void>;
  handlePostMessage(req: Request, res: Response, body?: any): Promise<void>;
}
