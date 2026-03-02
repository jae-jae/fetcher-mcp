import { TransportConfig } from "../transports/types.js";

/**
 * Parse command line arguments
 * @returns Transport configuration object
 */
export function parseTransportConfig(): TransportConfig {
  const args = process.argv.slice(2);
  const config: TransportConfig = {
    type: "stdio",
  };

  // Parse transport type
  const transportArg = args.find((arg) => arg.startsWith("--transport="));
  if (transportArg) {
    const transportValue = transportArg.split("=")[1]?.toLowerCase();
    if (transportValue === "http") {
      config.type = "http";
    }
  }

  // If HTTP transport, parse port and host
  if (config.type === "http") {
    // Parse port
    const portArg = args.find((arg) => arg.startsWith("--port="));
    if (portArg) {
      const portValue = parseInt(portArg.split("=")[1] ?? "", 10);
      if (!isNaN(portValue)) {
        config.port = portValue;
      }
    }

    // Parse host
    const hostArg = args.find((arg) => arg.startsWith("--host="));
    if (hostArg) {
      config.host = hostArg.split("=")[1] ?? "localhost";
    }
  }

  return config;
}

/**
 * Check debug mode
 * @returns Whether debug mode is enabled
 */
export function isDebugMode(): boolean {
  return process.argv.includes("--debug");
}
