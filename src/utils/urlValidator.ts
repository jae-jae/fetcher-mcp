import net from "node:net";
import { logger } from "./logger.js";

/**
 * Security error class for URL validation failures
 */
export class URLSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "URLSecurityError";
  }
}

/**
 * Allowed URL protocols for security
 */
const ALLOWED_PROTOCOLS = ["http:", "https:"];

/**
 * SSRF protection — opt-out for trusted internal use.
 *
 * By default, requests to loopback / private / link-local / reserved addresses (including the cloud
 * metadata endpoint 169.254.169.254) are rejected. Operators who legitimately fetch internal hosts can
 * set FETCHER_MCP_ALLOW_PRIVATE_IPS=true to disable this check.
 */
const ALLOW_PRIVATE_IPS = /^(1|true|yes)$/i.test(
  process.env.FETCHER_MCP_ALLOW_PRIVATE_IPS ?? ""
);

/** Hostnames that must never be targeted (bypass IP checks via name resolution). */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "instance-data",
]);

/** Private / reserved IP ranges that are not allowed as request destinations. */
const BLOCKED_RANGES = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // RFC 1918 private
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (cloud metadata lives here)
  ["172.16.0.0", 12], // RFC 1918 private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // RFC 1918 private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
] as Array<[string, number]>) {
  BLOCKED_RANGES.addSubnet(addr, prefix, "ipv4");
}
for (const [addr, prefix] of [
  ["::1", 128], // loopback
  ["::", 128], // unspecified
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
] as Array<[string, number]>) {
  BLOCKED_RANGES.addSubnet(addr, prefix, "ipv6");
}

/**
 * Normalise the numeric host notations that browsers/libcurl accept but that `net.isIP` rejects, so a
 * decimal/hex integer form of a private address cannot bypass the range check:
 *   2130706433 -> 127.0.0.1, 0x7f000001 -> 127.0.0.1
 * Returns a canonical dotted-quad IPv4 string, or null when the host is not an unambiguous numeric IP.
 */
function normalizeNumericIpv4(host: string): string | null {
  let value: number | null = null;
  if (/^[0-9]+$/.test(host)) {
    value = Number(host);
  } else if (/^0x[0-9a-f]+$/i.test(host)) {
    value = parseInt(host, 16);
  }
  if (value === null || !Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    return null;
  }
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join(".");
}

/** True when [host] resolves to a literal address in a blocked (private/reserved/loopback) range. */
function isBlockedLiteralAddress(host: string): boolean {
  // IPv4-mapped IPv6 (::ffff:127.0.0.1) — check the embedded IPv4.
  const mapped = host.replace(/^::ffff:/i, "");
  const ipv4 = net.isIPv4(mapped) ? mapped : normalizeNumericIpv4(host);
  if (ipv4) {
    return BLOCKED_RANGES.check(ipv4, "ipv4");
  }
  if (net.isIPv6(host)) {
    return BLOCKED_RANGES.check(host, "ipv6");
  }
  return false;
}

/**
 * Validates if a URL uses an allowed protocol (http or https only)
 *
 * @param url - The URL string to validate
 * @throws {URLSecurityError} If the URL protocol is not allowed
 * @returns The validated URL string
 */
export function validateUrlProtocol(url: string): string {
  if (!url || typeof url !== "string") {
    throw new URLSecurityError("URL must be a non-empty string");
  }

  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    throw new URLSecurityError("URL cannot be empty or whitespace only");
  }

  let parsedUrl: URL;
  try {
    // Try to parse the URL
    parsedUrl = new URL(trimmedUrl);
  } catch (error) {
    // If parsing fails, it might be a relative URL or malformed
    throw new URLSecurityError(`Invalid URL format: ${trimmedUrl}`);
  }

  // Check if the protocol is in the allowed list
  if (!ALLOWED_PROTOCOLS.includes(parsedUrl.protocol)) {
    logger.error(
      `Blocked URL with disallowed protocol: ${parsedUrl.protocol} (URL: ${trimmedUrl})`
    );
    throw new URLSecurityError(
      `URL protocol "${parsedUrl.protocol}" is not allowed. Only HTTP and HTTPS protocols are permitted.`
    );
  }

  // SSRF protection: reject loopback / private / link-local / metadata destinations (default-deny).
  const host = parsedUrl.hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost")) {
    logger.error(`Blocked URL targeting a disallowed host: ${host} (URL: ${trimmedUrl})`);
    throw new URLSecurityError(
      `URL host "${host}" is not allowed (loopback/internal). Set FETCHER_MCP_ALLOW_PRIVATE_IPS=true to permit internal targets.`
    );
  }
  if (!ALLOW_PRIVATE_IPS && isBlockedLiteralAddress(host)) {
    logger.error(`Blocked URL targeting a private/reserved address: ${host} (URL: ${trimmedUrl})`);
    throw new URLSecurityError(
      `URL host "${host}" resolves to a private or reserved address (SSRF protection). ` +
        `Set FETCHER_MCP_ALLOW_PRIVATE_IPS=true to permit internal targets.`
    );
  }

  logger.debug(`URL validation passed: ${trimmedUrl}`);
  return trimmedUrl;
}

/**
 * Validates multiple URLs to ensure they all use allowed protocols
 *
 * @param urls - Array of URL strings to validate
 * @throws {URLSecurityError} If any URL has a disallowed protocol
 * @returns The validated URLs array
 */
export function validateUrlsProtocol(urls: string[]): string[] {
  if (!Array.isArray(urls)) {
    throw new URLSecurityError("URLs must be an array");
  }

  if (urls.length === 0) {
    throw new URLSecurityError("URLs array cannot be empty");
  }

  const validatedUrls: string[] = [];
  const errors: Array<{ url: string; error: string }> = [];

  for (let i = 0; i < urls.length; i++) {
    try {
      const validatedUrl = validateUrlProtocol(urls[i]);
      validatedUrls.push(validatedUrl);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      errors.push({
        url: urls[i],
        error: errorMessage,
      });
    }
  }

  // If any URL failed validation, throw an error with all failures
  if (errors.length > 0) {
    const errorDetails = errors
      .map((e, idx) => `  ${idx + 1}. ${e.url}: ${e.error}`)
      .join("\n");
    throw new URLSecurityError(
      `${errors.length} URL(s) failed validation:\n${errorDetails}`
    );
  }

  return validatedUrls;
}
