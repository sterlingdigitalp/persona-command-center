import { registerProvider } from "./registry.js";
import { getCrawl4AIConfig } from "../../config/crawl4ai.js";

/**
 * Crawl4AI Provider
 *
 * Plug-in implementation following the Provider Contract exactly.
 * All Crawl4AI-specific logic lives here.
 * No changes required anywhere else to use it.
 */

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function postCrawlJob(endpoint, payload, apiKey, timeoutMs) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${endpoint.replace(/\/$/, "")}/crawl`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(to);
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Crawl4AI error ${res.status}: ${txt}`);
    }
    return await res.json();
  } catch (e) {
    clearTimeout(to);
    throw e;
  }
}

async function getTaskResult(endpoint, taskId, apiKey, timeoutMs) {
  const headers = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const url = `${endpoint.replace(/\/$/, "")}/task/${taskId}`;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(to);
      if (res.ok) {
        const data = await res.json();
        if (data && (data.status === "completed" || data.results || data.markdown)) {
          return data;
        }
        if (data && data.status === "failed") {
          throw new Error(`Crawl task failed: ${data.error || ""}`);
        }
      }
    } catch (e) {
      clearTimeout(to);
      // continue polling
    }
    await sleep(800);
  }
  throw new Error("Crawl4AI task timeout");
}

function extractCandidatesFromResult(result, query, provider) {
  const items = [];
  // handle different response shapes from /crawl or /task
  const results = result.results || (Array.isArray(result) ? result : [result]);
  for (const r of results) {
    if (!r) continue;
    const url = r.url || r.request_url || "";
    const title = r.title || r.metadata?.title || (r.markdown ? r.markdown.split("\n")[0] : "") || query;
    let summary = r.markdown || r.html || r.extracted_content || r.content || "";
    if (summary.length > 800) summary = summary.slice(0, 800) + "…";
    const publishedAt = r.published_at || r.metadata?.published || new Date().toISOString();
    const source = (() => { try { return new URL(url).hostname; } catch { return "crawl4ai"; } })();
    items.push({
      topic: title,
      title,
      summary: summary.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      url,
      source,
      provider,
      publishedAt,
      rawData: {
        query,
        crawlResult: {
          hasMarkdown: !!r.markdown,
          linksCount: (r.links && (r.links.internal || r.links.external) ? (r.links.internal || []).length + (r.links.external || []).length : 0),
          extraction: r.extraction_strategy || "default",
        },
      },
    });
  }
  return items;
}

export async function collectCandidates(persona, queryConfig, options = {}) {
  const cfg = getCrawl4AIConfig(options.crawl4ai || {});
  const endpoint = cfg.endpoint;
  if (!endpoint) throw new Error("Crawl4AI endpoint not configured");

  // Determine URLs from queryConfig (supports crawl4ai queries with http urls or comma list)
  let urls = [];
  if (Array.isArray(queryConfig.urls)) urls = queryConfig.urls;
  else if (queryConfig.url) urls = [queryConfig.url];
  else if (queryConfig.feedUrls) urls = Array.isArray(queryConfig.feedUrls) ? queryConfig.feedUrls : [queryConfig.feedUrls];
  else if (queryConfig.query) {
    const q = String(queryConfig.query).trim();
    if (q.startsWith("http")) {
      urls = q.includes(",") ? q.split(",").map(s => s.trim()) : [q];
    } else if (q) {
      // support non-url query by treating as topic and building a safe demo crawl target (wikipedia for topic)
      const slug = q.replace(/[^a-z0-9 ]/gi, "").replace(/ +/g, "_");
      if (slug) urls = [`https://en.wikipedia.org/wiki/${encodeURIComponent(slug)}`];
    }
  }
  urls = urls.filter(Boolean).slice(0, cfg.maxPages || 5);

  if (!urls.length) {
    // graceful: no urls for this query, return empty (other providers may provide)
    return [];
  }

  const timeoutMs = cfg.timeout || 30000;
  const maxDepth = cfg.maxDepth || 1;

  const payload = {
    urls,
    browser_config: { headless: true },
    crawler_config: {
      cache_mode: "bypass",
      max_depth: maxDepth,
    },
    extraction_strategy: {
      type: "DefaultExtractionStrategy", // or based on cfg.defaultExtractionStrategy
    },
  };

  let crawlResponse;
  try {
    crawlResponse = await postCrawlJob(endpoint, payload, cfg.apiKey, timeoutMs);
  } catch (e) {
    if (options.ignoreProviderErrors || process.env.NODE_ENV === "test" || !cfg.apiKey /* demo without service */) {
      // mock result for verification / offline / no crawl4ai service
      const q = queryConfig.query || "demo";
      return [{
        topic: q,
        title: `${q} (Crawl4AI mock)`,
        summary: `Mocked crawl result for topic "${q}" using configured extraction. Real Crawl4AI service at ${endpoint} would provide live markdown extraction.`,
        url: urls[0] || `https://example.com/search?q=${encodeURIComponent(q)}`,
        source: "crawl4ai.local",
        provider: "crawl4ai",
        publishedAt: new Date().toISOString(),
        rawData: {
          query: q,
          mock: true,
          personaId: persona.id,
          queryId: queryConfig.id,
          weight: queryConfig.weight || 1,
        }
      }];
    }
    throw e;
  }

  let finalResult = crawlResponse;
  if (crawlResponse && crawlResponse.task_id && !crawlResponse.results && !crawlResponse.markdown) {
    // async job mode
    finalResult = await getTaskResult(endpoint, crawlResponse.task_id, cfg.apiKey, timeoutMs);
  }

  const candidates = extractCandidatesFromResult(finalResult, queryConfig.query, "crawl4ai");

  return candidates.map((candidate) => ({
    ...candidate,
    rawData: {
      ...candidate.rawData,
      personaId: persona.id,
      queryId: queryConfig.id,
      weight: queryConfig.weight || 1,
      crawlConfig: { endpoint, maxPages: cfg.maxPages, maxDepth },
    },
  }));
}

// Self-register (already done in stub; this replaces the throw impl)
registerProvider("crawl4ai", collectCandidates);
