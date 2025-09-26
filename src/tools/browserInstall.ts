import { spawn } from "child_process";
import { logger } from "../utils/logger.js";

/**
 * Tool definition for browser_install
 */
export const browserInstallTool = {
  name: "browser_install",
  description: "Install Playwright Chromium browser binary. Call this if you get an error about the browser not being installed.",
  inputSchema: {
    type: "object",
    properties: {
      withDeps: {
        type: "boolean",
        description: "Install system dependencies required by Chromium browser. Default is false",
        default: false
      },
      force: {
        type: "boolean",
        description: "Force installation even if Chromium is already installed. Default is false",
        default: false
      }
    },
    required: []
  }
};

/**
 * Implementation of the browser_install tool
 */
export async function browserInstall(args: any) {
  const withDeps = args?.withDeps === true;
  const force = args?.force === true;

  logger.info("[BrowserInstall] Starting installation of Chromium browser...");

  try {
    // Build the command arguments
    const installArgs = ["playwright", "install"];

    if (withDeps) {
      installArgs.push("--with-deps");
    }

    if (force) {
      installArgs.push("--force");
    }

    installArgs.push("chromium");

    logger.debug(`[BrowserInstall] Executing: npx ${installArgs.join(" ")}`);

    // Execute the installation command
    const result = await executePlaywrightInstall(installArgs);

    if (result.success) {
      const successMessage = `Successfully installed Chromium browser${withDeps ? " with system dependencies" : ""}`;
      logger.info(`[BrowserInstall] ${successMessage}`);

      return {
        content: [
          {
            type: "text",
            text: `✅ ${successMessage}\n\n${result.output}`
          }
        ]
      };
    } else {
      const errorMessage = `Failed to install Chromium browser: ${result.error}`;
      logger.error(`[BrowserInstall] ${errorMessage}`);

      return {
        content: [
          {
            type: "text",
            text: `❌ ${errorMessage}\n\nOutput:\n${result.output}\n\nError:\n${result.error}`
          }
        ]
      };
    }
  } catch (error: any) {
    const errorMessage = `Chromium installation failed: ${error.message}`;
    logger.error(`[BrowserInstall] ${errorMessage}`);

    return {
      content: [
        {
          type: "text",
          text: `❌ ${errorMessage}\n\nPlease check your internet connection and try again. You may also need to run with elevated privileges.`
        }
      ]
    };
  }
}

/**
 * Execute playwright install command
 */
function executePlaywrightInstall(args: string[]): Promise<{success: boolean, output: string, error: string}> {
  return new Promise((resolve) => {
    const child = spawn("npx", args, {
      stdio: "pipe",
      shell: process.platform === "win32"
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      const output = data.toString();
      stdout += output;
      logger.debug(`[BrowserInstall] stdout: ${output.trim()}`);
    });

    child.stderr?.on("data", (data) => {
      const output = data.toString();
      stderr += output;
      logger.debug(`[BrowserInstall] stderr: ${output.trim()}`);
    });

    child.on("close", (code) => {
      const success = code === 0;
      logger.debug(`[BrowserInstall] Process exited with code: ${code}`);

      resolve({
        success,
        output: stdout,
        error: stderr
      });
    });

    child.on("error", (error) => {
      logger.error(`[BrowserInstall] Process error: ${error.message}`);
      resolve({
        success: false,
        output: stdout,
        error: error.message
      });
    });
  });
}