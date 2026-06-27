/**
 * Default providers configuration.
 *
 * Used as fallback when a persona query has no provider specified,
 * or when Hermes / pipeline requests a default list.
 *
 * To customize, edit this array. Future: could be loaded from env or settings.
 */
export const DEFAULT_PROVIDERS = ["rss", "news"];

export function getDefaultProviders() {
  return [...DEFAULT_PROVIDERS];
}
