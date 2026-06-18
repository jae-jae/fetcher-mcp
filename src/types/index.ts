export interface FetchOptions {
    timeout: number;
    waitUntil: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
    extractContent: boolean;
    maxLength: number;
    returnHtml: boolean;
    returnText: boolean;
    waitForNavigation: boolean;
    navigationTimeout: number;
    disableMedia: boolean;
    debug?: boolean;
  }
  
  export interface FetchResult {
    success: boolean;
    content: string;
    error?: string;
    index?: number;
  }