import net from "node:net";
import { lookup } from "node:dns/promises";
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
 * metadata endpoint 169.254.169.254) and to loopback/metadata hostnames are rejected. Operators who
 * legitimately fetch internal hosts can set FETCHER_MCP_ALLOW_PRIVATE_IPS=true to disable both checks.
 * The variable is read on each validation so a process can change it without a restart.
 */
export function allowPrivateIps(): boolean {
  return /^(1|true|yes)$/i.test(process.env.FETCHER_MCP_ALLOW_PRIVATE_IPS ?? "");
}

/** Hostnames that must never be targeted (bypass IP checks via name resolution). */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
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

/**
 * Decode the two trailing hextets of an IPv4-mapped IPv6 address into a dotted IPv4 string.
 * `7f00` + `0001` -> `127.0.0.1`.
 */
function ipv4FromHexGroups(hi: string, lo: string): string | null {
  if (!/^[0-9a-f]{1,4}$/i.test(hi) || !/^[0-9a-f]{1,4}$/i.test(lo)) {
    return null;
  }
  const high = parseInt(hi, 16);
  const low = parseInt(lo, 16);
  return [
    (high >>> 8) & 0xff,
    high & 0xff,
    (low >>> 8) & 0xff,
    low & 0xff,
  ].join(".");
}

/**
 * Node's WHATWG URL parser rewrites IPv4-mapped IPv6 to `::ffff:hhhh:hhhh`
 * (`[::ffff:127.0.0.1]` becomes `::ffff:7f00:1`). A dotted-quad strip of the
 * `::ffff:` prefix does not see that form, so the embedded IPv4 is decoded here.
 * The dotted form is still accepted in case a caller bypasses URL canonicalization.
 */
function ipv4FromMappedIpv6(host: string): string | null {
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
  if (hex) {
    return ipv4FromHexGroups(hex[1], hex[2]);
  }
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(host);
  if (dotted && net.isIPv4(dotted[1])) {
    return dotted[1];
  }
  return null;
}

/** True when [host] is a literal address in a blocked (private/reserved/loopback) range. */
function isBlockedLiteralAddress(host: string): boolean {
  const mappedIpv4 = ipv4FromMappedIpv6(host);
  if (mappedIpv4) {
    return BLOCKED_RANGES.check(mappedIpv4, "ipv4");
  }
  const ipv4 = net.isIPv4(host) ? host : normalizeNumericIpv4(host);
  if (ipv4) {
    return BLOCKED_RANGES.check(ipv4, "ipv4");
  }
  if (net.isIPv6(host)) {
    return BLOCKED_RANGES.check(host, "ipv6");
  }
  return false;
}

/**
 * Hostname as used for the block checks: brackets removed, lowercased, and a trailing
 * DNS root dot stripped so `localhost.` cannot bypass the hostname list.
 */
export function canonicalHostname(hostname: string): string {
  return hostname
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .toLowerCase()
    .replace(/\.+$/, "");
}

/**
 * Reason string when [hostname] is a blocked destination by its LITERAL form — the loopback/metadata
 * hostname list, or a private/reserved address in any of the numeric/mapped notations — or null when
 * it is allowed. Honours the FETCHER_MCP_ALLOW_PRIVATE_IPS opt-out (returns null when it is set).
 * Shared by the input-time check and the egress guard so both apply exactly the same rules.
 */
export function blockedLiteralReason(hostname: string): string | null {
  if (allowPrivateIps()) {
    return null;
  }
  const host = canonicalHostname(hostname);
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost")) {
    return `URL host "${host}" is not allowed (loopback/internal). Set FETCHER_MCP_ALLOW_PRIVATE_IPS=true to permit internal targets.`;
  }
  if (isBlockedLiteralAddress(host)) {
    return (
      `URL host "${host}" resolves to a private or reserved address (SSRF protection). ` +
      `Set FETCHER_MCP_ALLOW_PRIVATE_IPS=true to permit internal targets.`
    );
  }
  return null;
}

/**
 * True when [hostname] must be refused as a request destination, resolving DNS names so that a public
 * name pointing at a private address (classic SSRF-via-DNS) is also caught. Literal/numeric hosts are
 * decided synchronously by {@link blockedLiteralReason}; a genuine DNS name is resolved and EVERY
 * A/AAAA record is checked against the blocked ranges. Honours the FETCHER_MCP_ALLOW_PRIVATE_IPS opt-out.
 *
 * NOTE: this validates the resolved address but does not PIN it for the connection that follows, so a
 * fast DNS-rebinding attacker can still race the check (the name re-resolving to a private address
 * between this lookup and the browser's own connect). Fully closing that needs connection-level pinning
 * — Chromium `--host-resolver-rules` or an egress proxy — which is a larger change; see the PR notes.
 */
export async function isBlockedRequestHost(hostname: string): Promise<boolean> {
  if (allowPrivateIps()) {
    return false;
  }
  const host = canonicalHostname(hostname);
  if (!host) {
    return false;
  }
  if (blockedLiteralReason(host)) {
    return true;
  }
  // Already a literal address in some notation: the synchronous check above is authoritative, and a
  // DNS lookup of an IP literal is meaningless.
  if (net.isIP(host) || normalizeNumericIpv4(host) || ipv4FromMappedIpv6(host)) {
    return false;
  }
  try {
    const records = await lookup(host, { all: true });
    return records.some((r) =>
      BLOCKED_RANGES.check(r.address, r.family === 6 ? "ipv6" : "ipv4")
    );
  } catch {
    // Unresolvable name: the browser cannot reach a private address through it either, and a transient
    // DNS error should not become a hard fetch failure. The literal check above has already run.
    return false;
  }
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
  // FETCHER_MCP_ALLOW_PRIVATE_IPS covers literal addresses and blocked hostnames. The same rules are
  // re-applied to every request (redirects, subresources) by the egress guard in BrowserService.
  const reason = blockedLiteralReason(parsedUrl.hostname);
  if (reason) {
    logger.error(
      `Blocked URL targeting a disallowed host: ${canonicalHostname(parsedUrl.hostname)} (URL: ${trimmedUrl})`
    );
    throw new URLSecurityError(reason);
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
