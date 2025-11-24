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

  logger.debug(`URL protocol validation passed: ${trimmedUrl}`);
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
