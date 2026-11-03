/**
 * Operator-configured browser proxy.
 *
 * The proxy is read only from the environment (FETCHER_PROXY). It is intentionally
 * not a tool or REST parameter, so a caller or a prompt cannot redirect traffic.
 * When FETCHER_PROXY is unset or blank, no proxy settings are returned and browser
 * launch stays a direct connection.
 *
 * Chromium does not implement SOCKS5 username/password authentication. Playwright
 * refuses that combination instead of connecting without the credentials. This
 * parser rejects it at startup for the same reason.
 */

export class ProxyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProxyConfigError";
  }
}

export interface ProxySettings {
  /** scheme://host:port with no userinfo */
  server: string;
  username?: string;
  password?: string;
  /** Playwright comma-separated bypass list */
  bypass?: string;
}

const SUPPORTED_SCHEMES = new Set(["http:", "https:", "socks5:"]);

function fail(message: string): never {
  throw new ProxyConfigError(message);
}

function decodeUserinfo(value: string): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    fail(
      "Invalid FETCHER_PROXY: the username or password contains invalid percent-encoding. " +
        "URL-encode reserved characters (@ as %40, : as %3A) and use %25 for a literal percent sign."
    );
  }
}

/**
 * Turn one bypass token into a Chromium host pattern.
 * A trailing :port on a hostname or IPv4 address is dropped because the bypass
 * list matches hosts, not ports. Bracketed IPv6 addresses keep the address only.
 */
function normalizeBypassToken(token: string): string {
  let value = token.trim();
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    value = value.slice(1, -1).trim();
  }

  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) return bracketed[1];

  if (!value.includes("/") && !value.startsWith("<")) {
    const colon = value.lastIndexOf(":");
    if (colon > 0 && !value.slice(0, colon).includes(":")) {
      const port = value.slice(colon + 1);
      if (/^\d+$/.test(port)) return value.slice(0, colon);
    }
  }

  return value;
}

function isHostname(value: string): boolean {
  const host = value.endsWith(".") ? value.slice(0, -1) : value;
  if (!host || host.length > 253) return false;
  return /^(?:[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?\.)*[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?$/.test(
    host
  );
}

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isIpv6(value: string): boolean {
  if (!value.includes(":") || !/[0-9A-Fa-f]/.test(value)) return false;
  if (!/^[0-9A-Fa-f:]+$/.test(value)) return false;
  // One "::" compression at most, and at most 8 groups.
  if (value.split("::").length > 2) return false;
  return value.split(":").length <= 8;
}

function isBypassToken(token: string): boolean {
  if (token === "*" || token === "<local>" || token === "<-loopback>") return true;
  if (!token || token.length > 512) return false;
  if (/[\s@?#\\]/.test(token) || token.includes("://")) return false;

  const slash = token.indexOf("/");
  if (slash !== -1) {
    if (token.indexOf("/", slash + 1) !== -1) return false;
    const addr = token.slice(0, slash);
    const prefixText = token.slice(slash + 1);
    if (!/^\d{1,3}$/.test(prefixText)) return false;
    const prefix = Number(prefixText);
    if (isIpv4(addr)) return prefix <= 32;
    if (isIpv6(addr)) return prefix <= 128;
    return false;
  }

  if (token.startsWith("*.")) return isHostname(token.slice(2));
  if (token.startsWith(".")) return isHostname(token.slice(1));
  if (isIpv4(token) || isIpv6(token)) return true;
  return isHostname(token);
}

function parseBypassList(raw: string, source: string): string | undefined {
  const tokens = raw
    .split(/[\s,;]+/)
    .map((token) => normalizeBypassToken(token))
    .filter((token) => token.length > 0);

  if (tokens.length === 0) return undefined;

  for (const token of tokens) {
    if (!isBypassToken(token)) {
      fail(
        `Invalid ${source}: "${token}" is not a host, domain suffix, IP address, or CIDR range. ` +
          `Separate entries with commas or spaces. Examples: localhost, .example.com, 10.0.0.0/8, *.internal.example, *`
      );
    }
  }

  return tokens.join(",");
}

function readBypass(env: NodeJS.ProcessEnv): string | undefined {
  // A present FETCHER_PROXY_BYPASS, even when empty, replaces NO_PROXY so an
  // ambient NO_PROXY cannot be cleared only by unsetting the process environment.
  if (env.FETCHER_PROXY_BYPASS !== undefined) {
    if (env.FETCHER_PROXY_BYPASS.trim() === "") return undefined;
    return parseBypassList(env.FETCHER_PROXY_BYPASS, "FETCHER_PROXY_BYPASS");
  }
  if (env.NO_PROXY !== undefined && env.NO_PROXY.trim() !== "") {
    return parseBypassList(env.NO_PROXY, "NO_PROXY");
  }
  if (env.no_proxy !== undefined && env.no_proxy.trim() !== "") {
    return parseBypassList(env.no_proxy, "no_proxy");
  }
  return undefined;
}

/**
 * Parse proxy settings from an environment-like object.
 * Returns undefined when FETCHER_PROXY is unset or blank (direct connection).
 * Throws ProxyConfigError for any other invalid value. The error text never
 * includes the username or password.
 */
export function parseProxySettings(env: NodeJS.ProcessEnv): ProxySettings | undefined {
  const raw = env.FETCHER_PROXY;
  if (raw === undefined || raw.trim() === "") return undefined;

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    fail(
      "Invalid FETCHER_PROXY: could not parse the proxy URL. " +
        "Expected http://host:port, https://host:port, or socks5://host:port. " +
        "If the username or password contains reserved characters, URL-encode them (@ as %40, : as %3A)."
    );
  }

  if (!SUPPORTED_SCHEMES.has(url.protocol)) {
    // Do not echo the scheme. A value without :// is parsed as scheme:rest, so the
    // scheme text can be an accidental password or other secret.
    fail(
      "Invalid FETCHER_PROXY: unsupported scheme. " +
        "Supported schemes are http://, https://, and socks5://. " +
        "Include the scheme, for example http://proxy.example.com:8080."
    );
  }

  if (!url.hostname) {
    fail(
      "Invalid FETCHER_PROXY: the proxy URL must include a host and an explicit port, " +
        "for example http://proxy.example.com:8080 or socks5://proxy.example.com:1080."
    );
  }

  if (!url.port) {
    fail(
      "Invalid FETCHER_PROXY: the proxy URL must include an explicit port, " +
        "for example http://proxy.example.com:8080 or socks5://proxy.example.com:1080."
    );
  }

  if ((url.pathname !== "" && url.pathname !== "/") || url.search || url.hash) {
    fail(
      "Invalid FETCHER_PROXY: the proxy URL must not include a path, query, or fragment. " +
        "Expected http://host:port, https://host:port, or socks5://host:port."
    );
  }

  const username = decodeUserinfo(url.username);
  const password = decodeUserinfo(url.password);
  if (!username && password) {
    fail(
      "Invalid FETCHER_PROXY: a password was provided without a username. " +
        "Use http://username:password@host:port and URL-encode reserved characters."
    );
  }

  // url.host is hostname:port and, for IPv6, includes brackets. It never includes userinfo.
  const server = `${url.protocol}//${url.host}`;

  if (url.protocol === "socks5:" && (username || password)) {
    fail(
      `Invalid FETCHER_PROXY: ${server} includes a username or password, but Chromium does not support SOCKS5 authentication. ` +
        "Playwright refuses this combination so the browser does not connect without those credentials. " +
        "Use an http:// or https:// proxy for authenticated proxying, or point FETCHER_PROXY at a local SOCKS5 listener that does not require authentication."
    );
  }

  const bypass = readBypass(env);
  const settings: ProxySettings = { server };
  if (username) {
    settings.username = username;
    settings.password = password;
  }
  if (bypass) settings.bypass = bypass;
  return settings;
}

/** Playwright launch `proxy` value. Credentials are separate from `server` so they are not placed in the browser command line. */
export function toPlaywrightProxy(settings: ProxySettings): {
  server: string;
  bypass?: string;
  username?: string;
  password?: string;
} {
  const proxy: {
    server: string;
    bypass?: string;
    username?: string;
    password?: string;
  } = { server: settings.server };
  if (settings.bypass) proxy.bypass = settings.bypass;
  if (settings.username !== undefined) {
    proxy.username = settings.username;
    proxy.password = settings.password ?? "";
  }
  return proxy;
}

/** Startup description. Never includes the username or password. */
export function describeProxy(settings: ProxySettings): string {
  const auth = settings.username !== undefined ? " (authentication configured)" : "";
  const bypass = settings.bypass ? `; bypass ${settings.bypass}` : "";
  return `Using proxy ${settings.server}${auth}${bypass}`;
}

/** Replace a configured password if a downstream error message echoes it. */
export function redactProxySecrets(message: string, settings: ProxySettings | undefined): string {
  const password = settings?.password;
  if (!password) return message;
  return message.split(password).join("***");
}
