class Logger {
  private logMode: boolean;

  constructor(options: { logMode?: boolean } = {}) {
    this.logMode = options.logMode || false;
  }

  private log(level: string, message: string) {
    if (!this.logMode) return;
    
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} [${level}] ${message}`;
    console.error(logMessage);
  }

  info(message: string) {
    this.log("INFO", message);
  }

  warn(message: string) {
    this.log("WARN", message);
  }

  error(message: string) {
    this.log("ERROR", message);
  }

  debug(message: string) {
    this.log("DEBUG", message);
  }
}

// Create default logger instance
// 支持命令行参数 --log 或环境变量 FETCHER_LOG=true
export const logger = new Logger({
  logMode: process.argv.includes("--log") || process.env.FETCHER_LOG === "true",
});
