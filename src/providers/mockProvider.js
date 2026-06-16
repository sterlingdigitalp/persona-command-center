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

export async function collectMockCandidates(persona, queryConfig) {
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
