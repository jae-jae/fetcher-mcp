import { fetchUrlTool, fetchUrl } from './fetchUrl.js';
import { fetchUrlsTool, fetchUrls } from './fetchUrls.js';
import { browserInstallTool, browserInstall } from './browserInstall.js';

// Export tool definitions
export const tools = [
  fetchUrlTool,
  fetchUrlsTool,
  browserInstallTool
];

// Export tool implementations
type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[] }>;

export const toolHandlers: Record<string, ToolHandler> = {
  [fetchUrlTool.name]: fetchUrl,
  [fetchUrlsTool.name]: fetchUrls,
  [browserInstallTool.name]: browserInstall
};