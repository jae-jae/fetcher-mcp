import { z } from "zod";

export const FetchOptionsSchema = z.object({
  timeout: z.number().positive().default(30000),
  waitUntil: z.enum(["load", "domcontentloaded", "networkidle", "commit"]).default("load"),
  extractContent: z.boolean().default(true),
  maxLength: z.number().nonnegative().default(0),
  returnHtml: z.boolean().default(false),
  waitForNavigation: z.boolean().default(false),
  navigationTimeout: z.number().positive().default(10000),
  disableMedia: z.boolean().default(true),
  debug: z.boolean().optional(),
});

export type FetchOptions = z.infer<typeof FetchOptionsSchema>;

export const FetchUrlArgsSchema = z.object({
  ...FetchOptionsSchema.partial().shape,
  url: z.string().min(1, "URL parameter is required"),
});

export const FetchUrlsArgsSchema = z.object({
  ...FetchOptionsSchema.partial().shape,
  urls: z.array(z.string().min(1)).min(1, "URLs array cannot be empty"),
});

export const BrowserInstallArgsSchema = z.object({
  withDeps: z.boolean().default(false),
  force: z.boolean().default(false),
});

export interface FetchResult {
  success: boolean;
  content: string;
  error?: string;
  index?: number;
}
