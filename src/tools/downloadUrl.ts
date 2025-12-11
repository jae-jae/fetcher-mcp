import { Browser, Page } from "playwright";
import { promises as fs } from "fs";
import * as path from "path";
import { WebContentProcessor } from "../services/webContentProcessor.js";
import { BrowserService } from "../services/browserService.js";
import { FetchOptions } from "../types/index.js";
import { logger } from "../utils/logger.js";
import { validateUrlProtocol } from "../utils/urlValidator.js";

/**
 * Tool definition for download_url
 */
export const downloadUrlTool = {
	name: "download_url",
	description: "Download web page content from a specified URL to a file",
	inputSchema: {
		type: "object",
		properties: {
			url: {
				type: "string",
				description:
					"URL to fetch. Make sure to include the schema (http:// or https:// if not defined, preferring https for most cases)",
			},
			filePath: {
				type: "string",
				description:
					"Path to the file where the content will be saved. The directory will be created if it doesn't exist.",
			},
			timeout: {
				type: "number",
				description:
					"Page loading timeout in milliseconds, default is 30000 (30 seconds)",
			},
			waitUntil: {
				type: "string",
				description:
					"Specifies when navigation is considered complete, options: 'load', 'domcontentloaded', 'networkidle', 'commit', default is 'load'",
			},
			extractContent: {
				type: "boolean",
				description:
					"Whether to intelligently extract the main content, default is true",
			},
			maxLength: {
				type: "number",
				description:
					"Maximum length of returned content (in characters), default is no limit",
			},
			returnHtml: {
				type: "boolean",
				description:
					"Whether to return HTML content instead of Markdown, default is false",
			},
			waitForNavigation: {
				type: "boolean",
				description:
					"Whether to wait for additional navigation after initial page load (useful for sites with anti-bot verification), default is false",
			},
			navigationTimeout: {
				type: "number",
				description:
					"Maximum time to wait for additional navigation in milliseconds, default is 10000 (10 seconds)",
			},
			disableMedia: {
				type: "boolean",
				description:
					"Whether to disable media resources (images, stylesheets, fonts, media), default is true",
			},
			debug: {
				type: "boolean",
				description:
					"Whether to enable debug mode (showing browser window), overrides the --debug command line flag if specified",
			},
		},
		required: ["url", "filePath"],
	},
};

/**
 * Implementation of the download_url tool
 */
export async function downloadUrl(args: any) {
	const url = String(args?.url || "");
	if (!url) {
		logger.error(`URL parameter missing`);
		throw new Error("URL parameter is required");
	}

	const filePath = String(args?.filePath || "");
	if (!filePath) {
		logger.error(`filePath parameter missing`);
		throw new Error("filePath parameter is required");
	}

	// Validate URL protocol for security (only allow HTTP and HTTPS)
	validateUrlProtocol(url);

	const options: FetchOptions = {
		timeout: Number(args?.timeout) || 30000,
		waitUntil: String(args?.waitUntil || "load") as
			| "load"
			| "domcontentloaded"
			| "networkidle"
			| "commit",
		extractContent: args?.extractContent !== false,
		maxLength: Number(args?.maxLength) || 0,
		returnHtml: args?.returnHtml === true,
		waitForNavigation: args?.waitForNavigation === true,
		navigationTimeout: Number(args?.navigationTimeout) || 10000,
		disableMedia: args?.disableMedia !== false,
		debug: args?.debug,
	};

	// Create browser service
	const browserService = new BrowserService(options);

	// Create content processor
	const processor = new WebContentProcessor(options, "[DownloadURL]");
	let browser: Browser | null = null;
	let page: Page | null = null;

	if (browserService.isInDebugMode()) {
		logger.debug(`Debug mode enabled for URL: ${url}`);
	}

	try {
		// Create a stealth browser with anti-detection measures
		browser = await browserService.createBrowser();

		// Create a stealth browser context
		const { context, viewport } = await browserService.createContext(browser);

		// Create a new page with human-like behavior
		page = await browserService.createPage(context, viewport);

		// Set timeout
		page.setDefaultTimeout(options.timeout);

		// Navigate to URL and capture response
		logger.info(`[DownloadURL] Navigating to URL: ${url}`);
		const response = await page.goto(url, {
			timeout: options.timeout,
			waitUntil: options.waitUntil,
		});

		if (!response) {
			throw new Error("Failed to get response from URL");
		}

		// Check content type to determine if it's a binary file or HTML/text
		const contentTypeHeader = response.headers()["content-type"] || "";
		const contentType = contentTypeHeader.split(";")[0].trim().toLowerCase();

		// Extract filename from Content-Disposition header if present
		const contentDisposition = response.headers()["content-disposition"] || "";
		let serverFilenameExtension: string | null = null;
		if (contentDisposition) {
			// Parse Content-Disposition header: attachment; filename="document.pdf" or filename=document.pdf
			const filenameMatch = contentDisposition.match(
				/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i,
			);
			if (filenameMatch) {
				let serverFilename = filenameMatch[1];
				// Remove quotes if present
				serverFilename = serverFilename.replace(/^["']|["']$/g, "");
				// Extract extension from filename
				const ext = path.extname(serverFilename);
				if (ext) {
					serverFilenameExtension = ext.toLowerCase();
					logger.info(
						`[DownloadURL] Found filename in Content-Disposition header, extension: ${serverFilenameExtension}`,
					);
				}
			}
		}

		// Map common content types to file extensions
		const contentTypeToExtension: Record<string, string> = {
			"application/pdf": ".pdf",
			"application/zip": ".zip",
			"application/x-zip-compressed": ".zip",
			"application/x-tar": ".tar",
			"application/gzip": ".gz",
			"application/x-gzip": ".gz",
			"application/json": ".json",
			"application/xml": ".xml",
			"text/xml": ".xml",
			"application/msword": ".doc",
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document":
				".docx",
			"application/vnd.ms-excel": ".xls",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
				".xlsx",
			"application/vnd.ms-powerpoint": ".ppt",
			"application/vnd.openxmlformats-officedocument.presentationml.presentation":
				".pptx",
			"application/octet-stream": "",
			"image/jpeg": ".jpg",
			"image/jpg": ".jpg",
			"image/png": ".png",
			"image/gif": ".gif",
			"image/webp": ".webp",
			"image/svg+xml": ".svg",
			"image/bmp": ".bmp",
			"image/tiff": ".tiff",
			"text/plain": ".txt",
			"text/html": ".html",
			"text/css": ".css",
			"text/javascript": ".js",
			"application/javascript": ".js",
			"text/csv": ".csv",
		};

		// Map file extensions to content types (for fallback detection)
		const extensionToContentType: Record<string, string> = {
			".pdf": "application/pdf",
			".zip": "application/zip",
			".tar": "application/x-tar",
			".gz": "application/gzip",
			".json": "application/json",
			".xml": "application/xml",
			".doc": "application/msword",
			".docx":
				"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			".xls": "application/vnd.ms-excel",
			".xlsx":
				"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			".ppt": "application/vnd.ms-powerpoint",
			".pptx":
				"application/vnd.openxmlformats-officedocument.presentationml.presentation",
			".jpg": "image/jpeg",
			".jpeg": "image/jpeg",
			".png": "image/png",
			".gif": "image/gif",
			".webp": "image/webp",
			".svg": "image/svg+xml",
			".bmp": "image/bmp",
			".tiff": "image/tiff",
			".txt": "text/plain",
			".html": "text/html",
			".htm": "text/html",
			".css": "text/css",
			".js": "application/javascript",
			".csv": "text/csv",
		};

		// Server-side script extensions that should be ignored (these URLs typically return HTML, not the file type)
		const serverSideScriptExtensions = [
			".php",
			".cfm",
			".cfml",
			".jsp",
			".asp",
			".aspx",
			".java",
			".py",
			".rb",
			".pl",
			".cgi",
			".do",
			".action",
		];

		// Get extensions from URL and filePath
		const urlLower = url.toLowerCase();
		const filePathLower = filePath.toLowerCase();
		const urlExtensionRaw = path.extname(urlLower);
		const urlExtension =
			urlExtensionRaw &&
			!serverSideScriptExtensions.includes(urlExtensionRaw.toLowerCase())
				? urlExtensionRaw
				: null;
		const pathExtension = path.extname(filePathLower);

		// Determine effective content type (use Content-Type header, fallback to extension-based detection)
		// Priority: URL extension > path extension
		let effectiveContentType = contentType;
		if (
			!effectiveContentType ||
			effectiveContentType === "application/octet-stream" ||
			effectiveContentType === "text/plain"
		) {
			// Try to infer from URL extension first (if not a server-side script), then path extension
			const inferredType =
				(urlExtension && extensionToContentType[urlExtension]) ||
				(pathExtension && extensionToContentType[pathExtension]) ||
				null;
			if (inferredType) {
				effectiveContentType = inferredType;
				const source = urlExtension ? "URL extension" : "file path extension";
				logger.info(
					`[DownloadURL] Inferred content type ${effectiveContentType} from ${source}`,
				);
			}
		}

		// Determine if this is a binary file (not HTML/text that we want to process)
		// Binary files are anything that's not text/html or text/plain, or has a known binary extension
		// Priority: URL extension > server filename > content-type > path extension
		// If server provides a filename in Content-Disposition, it's almost certainly a binary file
		const isBinaryFile =
			(urlExtension &&
				extensionToContentType.hasOwnProperty(urlExtension) &&
				extensionToContentType[urlExtension] !== "text/html" &&
				extensionToContentType[urlExtension] !== "text/plain") ||
			serverFilenameExtension !== null ||
			(effectiveContentType &&
				effectiveContentType !== "text/html" &&
				effectiveContentType !== "text/plain" &&
				contentTypeToExtension.hasOwnProperty(effectiveContentType)) ||
			(pathExtension &&
				extensionToContentType.hasOwnProperty(pathExtension) &&
				extensionToContentType[pathExtension] !== "text/html" &&
				extensionToContentType[pathExtension] !== "text/plain");

		// Determine final file path with appropriate extension
		// Priority: URL extension (if not server-side script) > server filename extension > content-type extension > path extension
		let finalFilePath = filePath;
		// Check if content type has a mapping (even if it's empty string for octet-stream)
		// We need to check hasOwnProperty to distinguish between "not in mapping" vs "maps to empty string"
		const hasContentTypeMapping =
			effectiveContentType &&
			contentTypeToExtension.hasOwnProperty(effectiveContentType);
		const contentTypeExtension = hasContentTypeMapping
			? contentTypeToExtension[effectiveContentType]
			: undefined;
		// Use nullish coalescing (??) for undefined, but respect empty strings from the mapping
		const expectedExtension =
			urlExtension ??
			serverFilenameExtension ??
			(hasContentTypeMapping ? contentTypeExtension : undefined) ??
			pathExtension;

		if (isBinaryFile && expectedExtension) {
			const currentExtension = path.extname(finalFilePath).toLowerCase();
			if (
				!currentExtension ||
				currentExtension !== expectedExtension.toLowerCase()
			) {
				// If filePath is a directory or has no extension, add the expected extension
				if (finalFilePath.endsWith(path.sep)) {
					finalFilePath = path.join(
						finalFilePath,
						`download${expectedExtension}`,
					);
				} else if (!currentExtension) {
					finalFilePath = finalFilePath + expectedExtension;
				} else {
					// Replace existing extension with correct one
					finalFilePath =
						finalFilePath.slice(0, -currentExtension.length) +
						expectedExtension;
				}
				const extensionSource = urlExtension
					? "URL extension"
					: serverFilenameExtension
						? "Content-Disposition header"
						: contentTypeToExtension[effectiveContentType]
							? `Content-Type header (${effectiveContentType})`
							: "file path extension";
				logger.info(
					`[DownloadURL] Detected extension ${expectedExtension} from ${extensionSource}, updating file path to: ${finalFilePath}`,
				);
			}
		}

		// Ensure the directory exists
		const dir = path.dirname(finalFilePath);
		try {
			await fs.mkdir(dir, { recursive: true });
			logger.info(`[DownloadURL] Created directory: ${dir}`);
		} catch (mkdirError: any) {
			// Ignore error if directory already exists
			if (mkdirError.code !== "EEXIST") {
				logger.error(
					`[DownloadURL] Failed to create directory: ${mkdirError.message}`,
				);
				throw new Error(`Failed to create directory: ${mkdirError.message}`);
			}
		}

		if (isBinaryFile) {
			// Handle binary files: download as binary
			logger.info(
				`[DownloadURL] Detected binary file (${effectiveContentType || contentType}), downloading as binary`,
			);

			// Wait for navigation if needed (for files that might redirect)
			if (options.waitForNavigation) {
				try {
					await page
						.waitForNavigation({
							timeout: options.navigationTimeout,
							waitUntil: options.waitUntil,
						})
						.catch(() => {
							// Navigation might not occur for direct file links
							logger.info(`[DownloadURL] No additional navigation detected`);
						});
				} catch (navError: any) {
					logger.warn(
						`[DownloadURL] Navigation wait completed or timed out: ${navError.message}`,
					);
				}
			}

			// Get the final response (in case of redirect)
			let finalResponse = response;
			if (response.status() !== 200 && page) {
				try {
					const currentPageUrl = page.url();
					finalResponse = await page.waitForResponse(
						(r) => r.url() === currentPageUrl && r.status() === 200,
						{ timeout: options.timeout },
					);
				} catch {
					// Use original response if wait fails
					finalResponse = response;
				}
			}

			// Download file as binary
			const buffer = await finalResponse.body();
			await fs.writeFile(finalFilePath, buffer);

			const fileSizeKB = Math.round(buffer.length / 1024);
			const fileSizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
			logger.info(
				`[DownloadURL] Successfully downloaded file to: ${finalFilePath} (${fileSizeKB} KB)`,
			);

			return {
				content: [
					{
						type: "text",
						text: `Successfully downloaded ${effectiveContentType || contentType || "file"} from ${url} to ${finalFilePath}\n\nFile size: ${fileSizeKB} KB (${buffer.length} bytes)`,
					},
				],
			};
		} else {
			// Handle HTML content: use existing processing logic
			logger.info(`[DownloadURL] Processing as HTML content`);

			// Process page content using already-loaded page (avoid duplicate navigation)
			const result = await processor.processLoadedPageContent(page, url);

			if (!result.success) {
				throw new Error(result.error || "Failed to process page content");
			}

			// Write content to file
			await fs.writeFile(finalFilePath, result.content, "utf-8");
			logger.info(
				`[DownloadURL] Successfully wrote content to file: ${finalFilePath}`,
			);

			return {
				content: [
					{
						type: "text",
						text: `Successfully downloaded content from ${url} to ${finalFilePath}\n\nFile size: ${result.content.length} characters`,
					},
				],
			};
		}
	} finally {
		// Clean up resources
		await browserService.cleanup(browser, page);

		if (browserService.isInDebugMode()) {
			logger.debug(`Browser and page kept open for debugging. URL: ${url}`);
		}
	}
}
