import { registerProvider } from "./registry.js";
import { parseFeed, fetchFeed } from "./rssUtils.js";

function googleNewsFeed(query) {
  const params = new URLSearchParams({
    q: query,
    hl: "en-US",
    gl: "US",
    ceid: "US:en"
  });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

export async function collectCandidates(persona, queryConfig, options = {}) {
  const feedUrl = queryConfig.feedUrl || googleNewsFeed(queryConfig.query);
  try {
    const xml = await fetchFeed(feedUrl, { timeoutMs: options.timeoutMs || 6000 });
    if (!xml) return [];
    const parsed = parseFeed(xml, {
      query: queryConfig.query,
      provider: "news",
      source: "news.google.com"
    });
    return parsed.map((candidate) => ({
      ...candidate,
      provider: "news",
      source: candidate.source || "news.google.com",
      rawData: {
        ...candidate.rawData,
        personaId: persona.id,
        queryId: queryConfig.id,
        weight: queryConfig.weight || 1,
        providerKind: "google_news_rss"
      }
    }));
  } catch {
    return [];
  }
}

// Legacy alias
export { collectCandidates as collectNewsCandidates };

// Self-register as "news"
registerProvider("news", collectCandidates);
