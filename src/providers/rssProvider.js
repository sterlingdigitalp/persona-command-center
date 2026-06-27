import { registerProvider } from "./registry.js";
import { parseFeed, fetchFeed, hasValidDate } from "./rssUtils.js";

const DEFAULT_FEEDS = [
  "https://feeds.bbci.co.uk/news/world/rss.xml",
  "https://www.npr.org/rss/rss.php?id=1001",
  "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml"
];

export async function collectCandidates(persona, queryConfig, options = {}) {
  const feeds = queryConfig.feedUrls || options.feedUrls || DEFAULT_FEEDS;
  const candidates = [];

  for (const feedUrl of feeds.slice(0, options.maxFeeds || 2)) {
    try {
      const xml = await fetchFeed(feedUrl, { timeoutMs: options.timeoutMs || 6000 });
      if (!xml) continue;
      const source = (() => { try { return new URL(feedUrl).hostname; } catch { return "rss"; } })();
      const parsed = parseFeed(xml, {
        query: queryConfig.query,
        provider: "rss",
        source
      });
      candidates.push(...parsed);
    } catch {
      // per-feed soft fail
    }
  }

  return candidates.map((candidate) => ({
    ...candidate,
    rawData: {
      ...candidate.rawData,
      personaId: persona.id,
      queryId: queryConfig.id,
      weight: queryConfig.weight || 1
    }
  }));
}

// Legacy alias for transitional use
export { collectCandidates as collectRssCandidates };
export { DEFAULT_FEEDS };

// Re-export shared parser for tests / transitional (impl lives in rssUtils)
export { parseFeed } from "./rssUtils.js";

// Self-register as "rss"
registerProvider("rss", collectCandidates);
