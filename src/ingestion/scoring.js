import { overlapScore, tokenize } from "./text.js";

const RISK_TERMS = new Set(["shooting", "killed", "death", "war", "terror", "abuse", "lawsuit", "fraud", "crime"]);

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function scoreCluster(persona, queryConfig, cluster, recentTopics = []) {
  const text = `${cluster.topic} ${cluster.summary}`;
  const queryScore = overlapScore(text, queryConfig.query) * 100;
  const nicheScore = overlapScore(text, persona.niche) * 70;
  const relevanceScore = clamp(Math.max(queryScore, nicheScore) + (queryConfig.weight || 1) * 6);

  const ageHours = Math.max(0, (Date.now() - new Date(cluster.publishedAt).getTime()) / 36e5);
  const freshnessScore = clamp(100 - ageHours * 4);

  const appearedRecently = recentTopics.some((topic) => overlapScore(topic, cluster.topic) > 0.55);
  const noveltyScore = appearedRecently ? 38 : 82;

  const velocityScore = clamp(35 + cluster.sourceCount * 18 + Math.min(cluster.candidates.length, 5) * 6);

  const tokens = tokenize(text);
  const riskyHits = tokens.filter((token) => RISK_TERMS.has(token)).length;
  const riskScore = clamp(12 + riskyHits * 18);

  const priorityScore = clamp(
    relevanceScore * 0.36 +
    noveltyScore * 0.18 +
    freshnessScore * 0.2 +
    velocityScore * 0.2 -
    riskScore * 0.12
  );

  return {
    relevanceScore,
    noveltyScore,
    freshnessScore,
    velocityScore,
    riskScore,
    priorityScore
  };
}
