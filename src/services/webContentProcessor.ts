import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
// @ts-ignore
import { gfm } from "turndown-plugin-gfm";
import { FetchOptions, FetchResult } from "../types/index.js";
import { logger } from "../utils/logger.js";

export class WebContentProcessor {
  private options: FetchOptions;
  private logPrefix: string;

  constructor(options: FetchOptions, logPrefix: string = "") {
    this.options = options;
    this.logPrefix = logPrefix;
  }

  async processPageContent(page: any, url: string): Promise<FetchResult> {
    try {
      // Set timeout
      page.setDefaultTimeout(this.options.timeout);

      // Navigate to URL
      logger.info(`${this.logPrefix} Navigating to URL: ${url}`);
      try {
        await page.goto(url, {
          timeout: this.options.timeout,
          waitUntil: this.options.waitUntil,
        });
      } catch (gotoError: any) {
        // If it's a timeout error, try to retrieve page content
        if (gotoError.message.includes("Timeout") || gotoError.message.includes("timeout")) {
          logger.warn(`${this.logPrefix} Navigation timeout: ${gotoError.message}. Attempting to retrieve content anyway...`);
          
          // Try to retrieve page content
          try {
            // Directly get page information without waiting for page stability
            const { pageTitle, html } = await this.safelyGetPageInfo(page, url);
            
            // If content is retrieved, process and return it
            if (html && html.trim().length > 0) {
              logger.info(`${this.logPrefix} Successfully retrieved content despite timeout, length: ${html.length}`);
              
              const processedContent = await this.processContent(html, url);
              const formattedContent = `Title: ${pageTitle}\nURL: ${url}\nContent:\n\n${processedContent}`;
              
              return {
                success: true,
                content: formattedContent,
              };
            }
          } catch (retrieveError: any) {
            logger.error(`${this.logPrefix} Failed to retrieve content after timeout: ${retrieveError.message}`);
          }
        }
        
        // If unable to retrieve content or it's not a timeout error, continue to throw the original error
        throw gotoError;
      }

      // Handle possible anti-bot verification and redirection
      if (this.options.waitForNavigation) {
        logger.info(
          `${this.logPrefix} Waiting for possible navigation/redirection...`
        );

        try {
          // Create a promise to wait for page navigation events
          const navigationPromise = page.waitForNavigation({
            timeout: this.options.navigationTimeout,
            waitUntil: this.options.waitUntil,
          });

          // Set a timeout
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
              reject(new Error("Navigation timeout"));
            }, this.options.navigationTimeout);
          });

          // Wait for navigation event or timeout, whichever occurs first
          await Promise.race([navigationPromise, timeoutPromise])
            .then(() => {
              logger.info(
                `${this.logPrefix} Page navigated/redirected successfully`
              );
            })
            .catch((e) => {
              // If timeout occurs but page may have already loaded, we can continue
              logger.warn(
                `${this.logPrefix} No navigation occurred or navigation timeout: ${e.message}`
              );
            });
        } catch (navError: any) {
          logger.error(
            `${this.logPrefix} Error waiting for navigation: ${navError.message}`
          );
          // Continue processing the page even if there are navigation issues
        }
      }

      // Wait for the page to stabilize before getting content
      await this.ensurePageStability(page);
      
      // Safely retrieve page title and content
      const { pageTitle, html } = await this.safelyGetPageInfo(page, url);

      if (!html) {
        logger.warn(`${this.logPrefix} Browser returned empty content`);
        return {
          success: false,
          content: `Title: Error\nURL: ${url}\nContent:\n\n<error>Failed to retrieve web page content: Browser returned empty content</error>`,
          error: "Browser returned empty content",
        };
      }

      logger.info(
        `${this.logPrefix} Successfully retrieved web page content, length: ${html.length}`
      );

      const processedContent = await this.processContent(html, url);

      // Format the response
      const formattedContent = `Title: ${pageTitle}\nURL: ${url}\nContent:\n\n${processedContent}`;

      return {
        success: true,
        content: formattedContent,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logger.error(`${this.logPrefix} Error: ${errorMessage}`);

      return {
        success: false,
        content: `Title: Error\nURL: ${url}\nContent:\n\n<error>Failed to retrieve web page content: ${errorMessage}</error>`,
        error: errorMessage,
      };
    }
  }

  // Added method: Ensure page stability
  private async ensurePageStability(page: any): Promise<void> {
    try {
      // Check if there are ongoing network requests or navigation
      await page.waitForFunction(
        () => {
          return window.document.readyState === 'complete';
        }, 
        { timeout: this.options.timeout }
      );
      
      // Wait an extra short time to ensure page stability
      await page.waitForTimeout(500);
      
      logger.info(`${this.logPrefix} Page has stabilized`);
    } catch (error) {
      logger.warn(`${this.logPrefix} Error ensuring page stability: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Added method: Safely get page information (title and HTML content)
  private async safelyGetPageInfo(page: any, url: string, retries = 3): Promise<{pageTitle: string, html: string}> {
    let pageTitle = "Untitled";
    let html = "";
    let attempt = 0;
    
    while (attempt < retries) {
      try {
        attempt++;
        
        // Get page title
        pageTitle = await page.title();
        logger.info(`${this.logPrefix} Page title: ${pageTitle}`);
        
        // Get HTML content
        html = await page.content();
        
        // If successfully retrieved, exit the loop
        return { pageTitle, html };
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Check if it's an "execution context was destroyed" error
        if (errorMessage.includes("Execution context was destroyed") && attempt < retries) {
          logger.warn(`${this.logPrefix} Context destroyed, waiting for navigation to complete (attempt ${attempt}/${retries})...`);
          
          // Wait for page to stabilize
          await new Promise(resolve => setTimeout(resolve, 1000));
          await this.ensurePageStability(page);
          
          // If it's the last retry attempt, log the error but continue
          if (attempt === retries) {
            logger.error(`${this.logPrefix} Failed to get page info after ${retries} attempts`);
          }
        } else {
          // Other errors, log and rethrow
          logger.error(`${this.logPrefix} Error getting page info: ${errorMessage}`);
          throw error;
        }
      }
    }
    
    return { pageTitle, html };
  }

  private async processContent(html: string, url: string): Promise<string> {
    let contentToProcess = html;

    // Extract main content if needed
    if (this.options.extractContent) {
      logger.info(`${this.logPrefix} Extracting main content`);
      const dom = new JSDOM(html, { url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();

      if (!article) {
        logger.warn(
          `${this.logPrefix} Could not extract main content, will use full HTML`
        );
      } else {
        contentToProcess = article.content;
        logger.info(
          `${this.logPrefix} Successfully extracted main content, length: ${contentToProcess.length}`
        );
      }
    }

    // Convert to markdown if needed
    let processedContent = contentToProcess;
    if (!this.options.returnHtml) {
      logger.info(`${this.logPrefix} Converting to Markdown`);
      const turndownService = new TurndownService();
      turndownService.use(gfm);  // Enable GFM table support
      processedContent = turndownService.turndown(contentToProcess);
      logger.info(
        `${this.logPrefix} Successfully converted to Markdown, length: ${processedContent.length}`
      );
    }

    // Truncate if needed
    if (
      this.options.maxLength > 0 &&
      processedContent.length > this.options.maxLength
    ) {
      logger.info(
        `${this.logPrefix} Content exceeds maximum length, will truncate to ${this.options.maxLength} characters`
      );
      processedContent = processedContent.substring(0, this.options.maxLength);
    }

    return processedContent;
  }
}
