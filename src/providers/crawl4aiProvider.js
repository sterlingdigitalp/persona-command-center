import { registerProvider } from "./registry.js";

/**
 * Crawl4AI Provider (stub)
 *
 * Not yet integrated. Registers to prove extensibility.
 * When implemented, replace the throw with real collection logic.
 */
export async function collectCandidates(persona, queryConfig, options = {}) {
  throw new Error("NotImplemented: crawl4aiProvider is registered but not yet functional. Implement collect logic here.");
}

registerProvider("crawl4ai", collectCandidates);
