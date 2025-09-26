import { chromium } from "playwright";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { logger } from "./logger.js";

/**
 * Check if Playwright Chromium browser is installed
 */
export async function checkBrowserInstallation(): Promise<boolean> {
  try {
    // Method 1: Try to actually launch the browser to detect if it's installed
    const browser = await chromium.launch({ 
      headless: true,
      timeout: 5000  // 5 seconds timeout
    });
    await browser.close();
    logger.debug(`[Browser Check] Chromium browser successfully launched and closed`);
    return true;
  } catch (error: any) {
    logger.debug(`[Browser Check] Failed to launch Chromium: ${error.message}`);
    
    // Method 2: Check if executable file exists
    try {
      const executablePath = chromium.executablePath();
      if (executablePath && existsSync(executablePath)) {
        logger.debug(`[Browser Check] Chromium executable found at: ${executablePath}`);
        return true;
      }
    } catch (pathError: any) {
      logger.debug(`[Browser Check] Could not get executable path: ${pathError.message}`);
    }
    
    return false;
  }
}

/**
 * Install Playwright Chromium browser
 */
export async function installBrowser(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    logger.info("[Browser Install] Installing Chromium browser...");
    logger.info("[Browser Install] This may take a few minutes on first run.");
    
    // Execute installation command
    const installProcess = spawn("npx", ["playwright", "install", "chromium"], {
      stdio: ["inherit", "pipe", "pipe"],
      shell: true
    });

    let stdout = "";
    let stderr = "";

    // Handle standard output
    installProcess.stdout?.on("data", (data) => {
      const output = data.toString();
      stdout += output;
      // Display installation progress in real-time
      process.stdout.write(output);
    });

    // Handle error output
    installProcess.stderr?.on("data", (data) => {
      const output = data.toString();
      stderr += output;
      // Display error messages, but they may not be fatal errors
      process.stderr.write(output);
    });

    // Handle process completion
    installProcess.on("close", (code) => {
      if (code === 0) {
        logger.info("[Browser Install] Chromium installation completed successfully!");
        resolve(true);
      } else {
        logger.error(`[Browser Install] Installation failed with exit code: ${code}`);
        if (stderr) {
          logger.error(`[Browser Install] Error details: ${stderr}`);
        }
        reject(new Error(`Browser installation failed with exit code: ${code}`));
      }
    });

    // Handle process errors
    installProcess.on("error", (error) => {
      logger.error(`[Browser Install] Failed to start installation process: ${error.message}`);
      reject(error);
    });
  });
}

/**
 * Ensure browser is installed, automatically install if not present
 */
export async function ensureBrowserInstalled(): Promise<void> {
  logger.info("[Browser Setup] Checking Chromium browser installation...");
  
  try {
    const isInstalled = await checkBrowserInstallation();
    
    if (isInstalled) {
      logger.info("[Browser Setup] Chromium browser is already installed ✓");
      return;
    }
    
    logger.info("[Browser Setup] Chromium browser not found, installing automatically...");
    
    // Automatically install browser
    await installBrowser();
    
    // Check again after installation
    const isInstalledAfter = await checkBrowserInstallation();
    if (!isInstalledAfter) {
      throw new Error("Browser installation verification failed");
    }
    
    logger.info("[Browser Setup] Browser installation and verification completed ✓");
    
  } catch (error: any) {
    logger.error(`[Browser Setup] Failed to ensure browser installation: ${error.message}`);
    logger.error("[Browser Setup] Please try manually installing with: npx playwright install chromium");
    throw error;
  }
}
