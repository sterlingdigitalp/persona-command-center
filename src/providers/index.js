import { collectMockCandidates } from "./mockProvider.js";
import { collectNewsCandidates } from "./newsProvider.js";
import { collectRssCandidates } from "./rssProvider.js";

export async function collectCandidatesForQuery(persona, queryConfig, options = {}) {
  if (options.forceMock || queryConfig.provider === "mock") {
    return collectMockCandidates(persona, queryConfig, options);
  }

  if (queryConfig.provider === "rss") {
    return collectRssCandidates(persona, queryConfig, options);
  }

  return collectNewsCandidates(persona, queryConfig, options);
}
