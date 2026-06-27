import { registerProvider } from "./registry.js";

/**
 * Reddit Provider (stub)
 *
 * Not yet integrated. Registers to prove extensibility.
 */
export async function collectCandidates(persona, queryConfig, options = {}) {
  throw new Error("NotImplemented: redditProvider is registered but not yet functional. Implement collect logic here.");
}

registerProvider("reddit", collectCandidates);
