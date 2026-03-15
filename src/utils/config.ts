import { FetchOptions } from "../types/index.js";

/**
 * 配置管理工具 - 支持从环境变量读取配置
 * 环境变量优先级：工具参数 > 环境变量 > 默认值
 */

// 环境变量前缀
const ENV_PREFIX = "FETCHER_";

/**
 * 从环境变量读取字符串值
 */
function getEnvString(key: string, defaultValue?: string): string | undefined {
  const value = process.env[`${ENV_PREFIX}${key}`];
  return value !== undefined ? value : defaultValue;
}

/**
 * 从环境变量读取数值
 */
function getEnvNumber(key: string, defaultValue?: number): number | undefined {
  const value = process.env[`${ENV_PREFIX}${key}`];
  if (value === undefined) return defaultValue;
  const num = Number(value);
  return isNaN(num) ? defaultValue : num;
}

/**
 * 从环境变量读取布尔值
 */
function getEnvBoolean(key: string, defaultValue?: boolean): boolean | undefined {
  const value = process.env[`${ENV_PREFIX}${key}`];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === "true" || value === "1";
}

/**
 * 获取默认配置（从环境变量读取）
 */
export function getDefaultConfig(): Partial<FetchOptions> {
  return {
    timeout: getEnvNumber("TIMEOUT", 30000),
    waitUntil: (getEnvString("WAIT_UNTIL", "load") as FetchOptions["waitUntil"]),
    extractContent: getEnvBoolean("EXTRACT_CONTENT", true),
    maxLength: getEnvNumber("MAX_LENGTH", 0),
    returnHtml: getEnvBoolean("RETURN_HTML", false),
    waitForNavigation: getEnvBoolean("WAIT_FOR_NAVIGATION", false),
    navigationTimeout: getEnvNumber("NAVIGATION_TIMEOUT", 10000),
    disableMedia: getEnvBoolean("DISABLE_MEDIA", true),
    debug: getEnvBoolean("DEBUG", false),
    proxy: getEnvString("PROXY"),
  };
}

/**
 * 合并配置：工具参数 > 环境变量 > 默认值
 */
export function mergeConfig(toolArgs: any): FetchOptions {
  const defaults = getDefaultConfig();

  return {
    timeout: Number(toolArgs?.timeout) || defaults.timeout || 30000,
    waitUntil: String(toolArgs?.waitUntil || defaults.waitUntil || "load") as
      | "load"
      | "domcontentloaded"
      | "networkidle"
      | "commit",
    extractContent: toolArgs?.extractContent !== undefined
      ? toolArgs.extractContent
      : (defaults.extractContent !== undefined ? defaults.extractContent : true),
    maxLength: Number(toolArgs?.maxLength) || defaults.maxLength || 0,
    returnHtml: toolArgs?.returnHtml !== undefined
      ? toolArgs.returnHtml
      : (defaults.returnHtml !== undefined ? defaults.returnHtml : false),
    waitForNavigation: toolArgs?.waitForNavigation !== undefined
      ? toolArgs.waitForNavigation
      : (defaults.waitForNavigation !== undefined ? defaults.waitForNavigation : false),
    navigationTimeout: Number(toolArgs?.navigationTimeout) || defaults.navigationTimeout || 10000,
    disableMedia: toolArgs?.disableMedia !== undefined
      ? toolArgs.disableMedia
      : (defaults.disableMedia !== undefined ? defaults.disableMedia : true),
    debug: toolArgs?.debug !== undefined
      ? toolArgs.debug
      : defaults.debug,
    proxy: toolArgs?.proxy !== undefined
      ? toolArgs.proxy
      : defaults.proxy,
  };
}

/**
 * 获取可用的环境变量列表（用于文档）
 */
export function getAvailableEnvVars(): { name: string; description: string; type: string; default?: string }[] {
  return [
    { name: "FETCHER_TIMEOUT", description: "页面加载超时时间（毫秒）", type: "number", default: "30000" },
    { name: "FETCHER_WAIT_UNTIL", description: "导航完成条件", type: "string", default: "load" },
    { name: "FETCHER_EXTRACT_CONTENT", description: "是否智能提取主要内容", type: "boolean", default: "true" },
    { name: "FETCHER_MAX_LENGTH", description: "返回内容最大长度", type: "number", default: "0" },
    { name: "FETCHER_RETURN_HTML", description: "是否返回HTML内容", type: "boolean", default: "false" },
    { name: "FETCHER_WAIT_FOR_NAVIGATION", description: "是否等待额外导航", type: "boolean", default: "false" },
    { name: "FETCHER_NAVIGATION_TIMEOUT", description: "额外导航超时时间（毫秒）", type: "number", default: "10000" },
    { name: "FETCHER_DISABLE_MEDIA", description: "是否禁用媒体资源", type: "boolean", default: "true" },
    { name: "FETCHER_DEBUG", description: "是否启用调试模式", type: "boolean", default: "false" },
    { name: "FETCHER_PROXY", description: "代理服务器URL", type: "string" },
  ];
}
