const DEFAULT_FEEDS = [
  "https://feeds.bbci.co.uk/news/world/rss.xml",
  "https://www.npr.org/rss/rss.php?id=1001",
  "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml"
];

function decodeXml(value = "") {
  return value
    .replaceAll("<![CDATA[", "")
    .replaceAll("]]>", "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .trim();
}

function tagValue(item, tag) {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeXml(match?.[1] || "");
}

function linkValue(item) {
  const direct = tagValue(item, "link");
  if (direct) return direct;
  const href = item.match(/<link[^>]+href=["']([^"']+)["']/i);
  return decodeXml(href?.[1] || "");
}

function itemBlocks(xml) {
  const rssItems = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  const atomItems = xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  return [...rssItems, ...atomItems];
}

function safeDate(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function hasValidDate(value) {
  if (!value) return false;
  return !Number.isNaN(new Date(value).getTime());
}

export function parseFeed(xml, { query = "", provider = "rss", source = "rss" } = {}) {
  return itemBlocks(xml).map((item) => {
    const title = tagValue(item, "title");
    const summary = tagValue(item, "description") || tagValue(item, "summary") || tagValue(item, "content");
    const publishedAt = tagValue(item, "pubDate") || tagValue(item, "published") || tagValue(item, "updated");
    return {
      topic: title,
      source,
      url: linkValue(item),
      title,
      summary: summary.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      publishedAt: safeDate(publishedAt),
      provider,
      rawData: { query, hasPublishedAt: hasValidDate(publishedAt) }
    };
  }).filter((candidate) => candidate.title && candidate.url);
}

export async function collectRssCandidates(persona, queryConfig, options = {}) {
  const feeds = queryConfig.feedUrls || options.feedUrls || DEFAULT_FEEDS;
  const candidates = [];

  for (const feedUrl of feeds.slice(0, options.maxFeeds || 2)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 6000);
    try {
      const response = await fetch(feedUrl, {
        signal: controller.signal,
        headers: { "user-agent": "PersonaCommandCenter/0.3 local RSS reader" }
      });
      if (!response.ok) continue;
      const xml = await response.text();
      candidates.push(...parseFeed(xml, {
        query: queryConfig.query,
        provider: "rss",
        source: new URL(feedUrl).hostname
      }));
    } finally {
      clearTimeout(timeout);
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
