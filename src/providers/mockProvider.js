import { registerProvider } from "./registry.js";

const MOCK_ITEMS = {
  "the-wonkette": [
    "Court ethics watchdog report draws new scrutiny",
    "Campaign finance ruling creates procedural chaos",
    "Congressional oversight fight exposes insider hypocrisy"
  ],
  "policy-pete": [
    "Student loan rule changes create implementation questions",
    "Climate grant deadline raises budget tradeoffs",
    "Education funding formula faces state rollout issues"
  ],
  "maga-memester": [
    "Cable panel clip fuels a media narrative fight",
    "Border hearing moment becomes institutional criticism",
    "Campaign surrogate quote triggers elite disconnect jokes"
  ],
  "progressive-pat": [
    "Union contract vote highlights labor impact",
    "Rent control proposal returns to city agenda",
    "Healthcare affordability push targets power structures"
  ]
};

export const MOCK_HOSTS = new Set([
  "mock-public-news.example",
  "mock-rss-feed.example",
  "example.test",
  "hermes.local"
]);

export function isMockSource(candidate) {
  if (!candidate) return false;
  if (candidate.provider === "mock" || candidate.rawData?.mock === true) return true;
  const values = [
    candidate?.source,
    candidate?.url,
    candidate?.rawData?.source,
    candidate?.rawData?.url
  ].filter(Boolean);
  return values.some((value) => {
    try {
      const host = new URL(value).hostname.toLowerCase();
      return [...MOCK_HOSTS].some((mockHost) => host === mockHost || host.includes(mockHost));
    } catch {
      const s = String(value || "").toLowerCase();
      return [...MOCK_HOSTS].some((mockHost) => s.includes(mockHost));
    }
  });
}

export async function collectCandidates(persona, queryConfig) {
  const now = new Date();
  const items = MOCK_ITEMS[persona.id] || [`${persona.name} policy development`];
  return items.map((title, index) => ({
    topic: title,
    source: index % 2 === 0 ? "mock-public-news.example" : "mock-rss-feed.example",
    url: `https://example.test/${persona.id}/${encodeURIComponent(title.toLowerCase().replaceAll(" ", "-"))}`,
    title,
    summary: `${title} connected to ${queryConfig.query}. This deterministic item stands in for a public feed result during tests.`,
    publishedAt: new Date(now.getTime() - index * 45 * 60 * 1000).toISOString(),
    provider: queryConfig.provider || "mock",
    rawData: {
      personaId: persona.id,
      queryId: queryConfig.id,
      query: queryConfig.query,
      weight: queryConfig.weight || 1,
      mock: true
    }
  }));
}

// Legacy alias
export { collectCandidates as collectMockCandidates };

// Self-register
registerProvider("mock", collectCandidates);
