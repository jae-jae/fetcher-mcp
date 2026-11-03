import { parseTransportConfig, isDebugMode } from "./args.js";
import { parseProxySettings, ProxySettings } from "./proxy.js";
import { TransportConfig } from "../transports/types.js";

/**
 * Get application configuration.
 * Throws ProxyConfigError when FETCHER_PROXY is set to an invalid value so the
 * process fails at startup instead of falling back to a direct connection.
 */
export function getConfig(): {
  transport: TransportConfig;
  debug: boolean;
  proxy: ProxySettings | undefined;
} {
  return {
    transport: parseTransportConfig(),
    debug: isDebugMode(),
    proxy: parseProxySettings(process.env),
  };
}

export { isDebugMode };
export { parseProxySettings, describeProxy, ProxyConfigError } from "./proxy.js";
export type { ProxySettings } from "./proxy.js";
