/**
 * Shared RSS parsing and fetch utilities.
 * Used by rssProvider, newsProvider (and future providers that consume RSS/Atom).
 * Keeps individual providers independent.
 */

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

export function hasValidDate(value) {
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

export async function fetchFeed(feedUrl, { timeoutMs = 6000, userAgent = "PersonaCommandCenter/0.3 local RSS reader" } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(feedUrl, {
      signal: controller.signal,
      headers: { "user-agent": userAgent }
    });
    if (!response.ok) return null;
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}
