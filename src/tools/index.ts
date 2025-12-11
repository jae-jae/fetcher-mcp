import { fetchUrlTool, fetchUrl } from './fetchUrl.js';
import { fetchUrlsTool, fetchUrls } from './fetchUrls.js';
import { browserInstallTool, browserInstall } from './browserInstall.js';
import { downloadUrlTool, downloadUrl } from './downloadUrl.js';

// Export tool definitions
export const tools = [
  fetchUrlTool,
  fetchUrlsTool,
  browserInstallTool,
  downloadUrlTool
];

// Export tool implementations
export const toolHandlers = {
  [fetchUrlTool.name]: fetchUrl,
  [fetchUrlsTool.name]: fetchUrls,
  [browserInstallTool.name]: browserInstall,
  [downloadUrlTool.name]: downloadUrl
};