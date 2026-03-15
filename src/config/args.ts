import { TransportConfig } from "../transports/types.js";

/**
 * Parse command line arguments and environment variables
 * Priority: command line args > environment variables > defaults
 * @returns Transport configuration object
 */
export function parseTransportConfig(): TransportConfig {
  const args = process.argv.slice(2);
  const config: TransportConfig = {
    type: "stdio",
  };

  // Parse transport type (args > env > default)
  const transportArg = args.find((arg) => arg.startsWith("--transport="));
  if (transportArg) {
    const transportValue = transportArg.split("=")[1].toLowerCase();
    if (transportValue === "http") {
      config.type = "http";
    }
  } else if (process.env.FETCHER_TRANSPORT === "http") {
    config.type = "http";
  }

  // If HTTP transport, parse port and host
  if (config.type === "http") {
    // Parse port (args > env > default)
    const portArg = args.find((arg) => arg.startsWith("--port="));
    if (portArg) {
      const portValue = parseInt(portArg.split("=")[1], 10);
      if (!isNaN(portValue)) {
        config.port = portValue;
      }
    } else if (process.env.FETCHER_PORT) {
      const portValue = parseInt(process.env.FETCHER_PORT, 10);
      if (!isNaN(portValue)) {
        config.port = portValue;
      }
    }

    // Parse host (args > env > default)
    const hostArg = args.find((arg) => arg.startsWith("--host="));
    if (hostArg) {
      config.host = hostArg.split("=")[1];
    } else if (process.env.FETCHER_HOST) {
      config.host = process.env.FETCHER_HOST;
    }
  }

  return config;
}

/**
 * Check debug mode
 * Priority: command line args > environment variables
 * @returns Whether debug mode is enabled
 */
export function isDebugMode(): boolean {
  return process.argv.includes("--debug") || process.env.FETCHER_DEBUG === "true";
}
