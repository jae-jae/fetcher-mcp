import { Request, Response } from "express";
import { tools, toolHandlers } from "../tools/index.js";
import { logger } from "../utils/logger.js";

function buildOpenApiSpec(publicUrl: string) {
  const paths: Record<string, any> = {};
  const schemas: Record<string, any> = {};

  for (const tool of tools) {
    schemas[`${tool.name}_input`] = tool.inputSchema;
    paths[`/tools/${tool.name}`] = {
      post: {
        operationId: tool.name,
        summary: tool.description,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: `#/components/schemas/${tool.name}_input` },
            },
          },
        },
        responses: {
          "200": {
            description: "Tool result.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ToolResult" },
              },
            },
          },
          "500": {
            description: "Tool execution error.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    };
  }

  schemas["ToolResult"] = {
    type: "object",
    required: ["content"],
    properties: {
      content: {
        type: "array",
        items: {
          type: "object",
          required: ["type", "text"],
          properties: {
            type: { type: "string" },
            text: { type: "string" },
          },
        },
      },
    },
  };

  schemas["ErrorResponse"] = {
    type: "object",
    required: ["error"],
    properties: {
      error: { type: "string" },
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "Fetcher MCP",
      version: "0.1.0",
      description:
        "Web content fetching tools. This server also speaks MCP over Streamable HTTP at POST /mcp.",
    },
    servers: [{ url: publicUrl }],
    paths,
    components: { schemas },
  };
}

export function registerOpenApiRoutes(app: any): void {
  app.get("/openapi.json", (req: Request, res: Response) => {
    const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
    res.json(buildOpenApiSpec(`${proto}://${req.get("host")}`));
  });

  for (const tool of tools) {
    app.post(`/tools/${tool.name}`, async (req: Request, res: Response) => {
      try {
        const result = await toolHandlers[tool.name](req.body);
        res.json(result);
      } catch (error: any) {
        logger.error(`[OpenAPI] /tools/${tool.name} failed: ${error.message}`);
        res.status(500).json({ error: error.message });
      }
    });
  }
}
