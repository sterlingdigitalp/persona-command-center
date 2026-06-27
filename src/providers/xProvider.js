import { registerProvider } from "./registry.js";

/**
 * X (Twitter) Provider (stub)
 *
 * Not yet integrated. Registers to prove extensibility.
 */
export async function collectCandidates(persona, queryConfig, options = {}) {
  throw new Error("NotImplemented: xProvider is registered but not yet functional. Implement collect logic here.");
}

registerProvider("x", collectCandidates);
