/**
 * Crawl4AI Provider Configuration
 *
 * Configure connection to self-hosted or remote Crawl4AI service.
 * No hardcoded values.
 */

export const DEFAULT_CRAWL4AI_CONFIG = {
  endpoint: process.env.CRAWL4AI_ENDPOINT || "http://localhost:11235",
  apiKey: process.env.CRAWL4AI_API_KEY || null,
  timeout: Number(process.env.CRAWL4AI_TIMEOUT_MS || 30000),
  maxPages: Number(process.env.CRAWL4AI_MAX_PAGES || 5),
  maxDepth: Number(process.env.CRAWL4AI_MAX_DEPTH || 2),
  defaultExtractionStrategy: process.env.CRAWL4AI_EXTRACTION || "markdown", // markdown | json etc.
};

export function getCrawl4AIConfig(overrides = {}) {
  return {
    ...DEFAULT_CRAWL4AI_CONFIG,
    ...overrides,
  };
}
