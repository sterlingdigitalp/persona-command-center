/**
 * Provider Registry
 *
 * Central registry for plug-in data providers.
 * Providers self-register by importing this module and calling registerProvider.
 *
 * Adding a new provider:
 *   1. Create src/providers/<name>Provider.js that exports collectCandidates and calls registerProvider(name, collectCandidates)
 *   2. Add `import './<name>Provider.js';` in src/providers/index.js
 *   3. Done. No changes to pipeline, scoring, velocity, Hermes, etc.
 */

import { getDefaultProviders as getConfiguredDefaults } from "../../config/defaultProviders.js";

const registry = new Map();

export function registerProvider(name, collectFn) {
  if (typeof name !== "string" || !name) {
    throw new Error("Provider name must be a non-empty string");
  }
  if (typeof collectFn !== "function") {
    throw new Error(`Provider ${name} must provide a collectCandidates function`);
  }
  const key = name.toLowerCase();
  if (registry.has(key)) {
    // allow re-register in tests, but warn not in prod? keep silent for simplicity
  }
  registry.set(key, collectFn);
}

export function getProvider(name) {
  if (!name) return null;
  return registry.get(String(name).toLowerCase()) || null;
}

export function listProviders() {
  return Array.from(registry.keys());
}

export async function collectCandidatesForQuery(persona, queryConfig, options = {}) {
  // forceMock (used by tests and mock ingestion paths) takes precedence
  if (options && (options.forceMock || options.useMockProviders)) {
    const mockFn = getProvider("mock");
    if (mockFn) {
      const effective = { ...(queryConfig || {}), provider: "mock" };
      return mockFn(persona, effective, options);
    }
  }
  const providerName = (queryConfig && queryConfig.provider) ? String(queryConfig.provider).trim().toLowerCase() : "";
  const fn = getProvider(providerName);
  if (!fn) {
    const available = listProviders().join(", ") || "(none registered)";
    throw new Error(`Unknown provider "${providerName || "(none)"}". Registered providers: ${available}`);
  }
  return fn(persona, queryConfig, options);
}

export function getDefaultProviders() {
  try {
    const d = getConfiguredDefaults();
    if (Array.isArray(d) && d.length) return [...d];
  } catch {}
  return ["rss", "news"];
}
