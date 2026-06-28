import { registerProvider } from "./registry.js";

const X_API_BASE = "https://api.twitter.com/2";

function getBearerToken() {
  return process.env.X_BEARER_TOKEN || null;
}

async function xFetch(path, options = {}) {
  const token = getBearerToken();
  if (!token) {
    const err = new Error("X_BEARER_TOKEN not configured");
    err.retrievalStatus = "no_credentials";
    throw err;
  }
  const url = `${X_API_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    },
    signal: options.signal || null
  });
  if (res.status === 429) {
    const err = new Error("X API rate limit exceeded");
    err.retrievalStatus = "rate_limited";
    err.status = 429;
    throw err;
  }
  if (res.status === 401) {
    const err = new Error("X API authentication failed — invalid or expired bearer token");
    err.retrievalStatus = "auth_failed";
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`X API error ${res.status}: ${text}`);
    err.retrievalStatus = "api_error";
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function extractHandle(query) {
  if (!query) return null;
  const h = String(query).trim().replace(/^@+/, "");
  return h || null;
}

async function lookupUser(handle) {
  const data = await xFetch(`/users/by/username/${encodeURIComponent(handle)}?user.fields=id,name,username`);
  return data?.data || null;
}

async function getUserTweets(userId, maxResults = 10) {
  const data = await xFetch(`/users/${encodeURIComponent(userId)}/tweets?max_results=${maxResults}&tweet.fields=created_at,public_metrics,text&expansions=referenced_tweets.id`);
  return data?.data || [];
}

async function getUserMentions(userId, maxResults = 10) {
  const data = await xFetch(`/users/${encodeURIComponent(userId)}/mentions?max_results=${maxResults}&tweet.fields=created_at,public_metrics,text`);
  return data?.data || [];
}

export async function collectCandidates(persona, queryConfig, options = {}) {
  const handle = extractHandle(queryConfig.query);
  if (!handle) return [];

  try {
    const user = await lookupUser(handle);
    if (!user) return [];

    const sourceType = queryConfig.sourceType || "entity";
    const candidates = [];

    if (sourceType === "entity_mentions") {
      const mentions = await getUserMentions(user.id, 5);
      for (const tweet of mentions) {
        const tweetId = tweet.id;
        const createdAt = tweet.created_at || new Date().toISOString();
        candidates.push({
          topic: tweet.text?.slice(0, 200) || `Mention of @${handle}`,
          source: "x.com",
          url: `https://x.com/${encodeURIComponent(user.username)}/status/${tweetId}`,
          title: tweet.text?.slice(0, 100) || `Mention of @${handle}`,
          summary: tweet.text || "",
          publishedAt: createdAt,
          provider: "x",
          rawData: {
            personaId: persona.id,
            queryId: queryConfig.id,
            query: queryConfig.query,
            weight: queryConfig.weight || 1,
            entityName: queryConfig.entityName || null,
            entityId: queryConfig.entityId || null,
            sourceType: "entity_mentions",
            xUserId: user.id,
            xUsername: user.username,
            xHandle: `@${user.username}`,
            tweetId,
            retrievalStatus: "live"
          }
        });
      }
    }

    // Recent posts for both entity and entity_mentions source types
    const tweets = await getUserTweets(user.id, sourceType === "entity_mentions" ? 5 : 10);
    for (const tweet of tweets) {
      const tweetId = tweet.id;
      const createdAt = tweet.created_at || new Date().toISOString();
      candidates.push({
        topic: tweet.text?.slice(0, 200) || `Post by @${handle}`,
        source: "x.com",
        url: `https://x.com/${encodeURIComponent(user.username)}/status/${tweetId}`,
        title: tweet.text?.slice(0, 100) || `Post by @${handle}`,
        summary: tweet.text || "",
        publishedAt: createdAt,
        provider: "x",
        rawData: {
          personaId: persona.id,
          queryId: queryConfig.id,
          query: queryConfig.query,
          weight: queryConfig.weight || 1,
          entityName: queryConfig.entityName || null,
          entityId: queryConfig.entityId || null,
          sourceType: "entity",
          xUserId: user.id,
          xUsername: user.username,
          xHandle: `@${user.username}`,
          tweetId,
          retrievalStatus: "live",
          publicMetrics: tweet.public_metrics || {}
        }
      });
    }

    return candidates;
  } catch (err) {
    if (options.ignoreProviderErrors) {
      return [];
    }
    throw err;
  }
}

registerProvider("x", collectCandidates);
