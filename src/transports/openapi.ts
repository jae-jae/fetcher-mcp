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
            description: "The fetched content as markdown (or plain text when returnText is true).",
            content: {
              "text/plain": {
                schema: { type: "string" },
              },
            },
          },
          "500": {
            description: "Tool execution error.",
            content: {
              "text/plain": {
                schema: { type: "string" },
              },
            },
          },
        },
      },
    };
  }

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
        const text = result?.content?.[0]?.text ?? "";
        res.type("text/plain").send(text);
      } catch (error: any) {
        logger.error(`[OpenAPI] /tools/${tool.name} failed: ${error.message}`);
        res.status(500).type("text/plain").send(error.message);
      }
    });
  }
}
