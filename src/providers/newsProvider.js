import { collectRssCandidates } from "./rssProvider.js";

function googleNewsFeed(query) {
  const params = new URLSearchParams({
    q: query,
    hl: "en-US",
    gl: "US",
    ceid: "US:en"
  });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

export async function collectNewsCandidates(persona, queryConfig, options = {}) {
  const feedUrl = queryConfig.feedUrl || googleNewsFeed(queryConfig.query);
  const candidates = await collectRssCandidates(persona, {
    ...queryConfig,
    feedUrls: [feedUrl]
  }, {
    ...options,
    maxFeeds: 1
  });

  return candidates.map((candidate) => ({
    ...candidate,
    provider: "news",
    source: candidate.source || "news.google.com",
    rawData: {
      ...candidate.rawData,
      providerKind: "google_news_rss"
    }
  }));
}
