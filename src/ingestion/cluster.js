import { overlapScore, slug } from "./text.js";

export function clusterCandidates(candidates, threshold = 0.42) {
  const clusters = [];

  for (const candidate of candidates) {
    const text = candidate.title || candidate.topic;
    let match = null;
    let bestScore = 0;

    for (const cluster of clusters) {
      const score = overlapScore(text, cluster.topic);
      if (score > bestScore && score >= threshold) {
        bestScore = score;
        match = cluster;
      }
    }

    if (match) {
      match.candidates.push(candidate);
      match.sourceSet.add(candidate.source);
      match.summary = match.summary || candidate.summary;
      if (new Date(candidate.publishedAt) > new Date(match.publishedAt)) {
        match.topic = candidate.title || candidate.topic;
        match.publishedAt = candidate.publishedAt;
      }
    } else {
      clusters.push({
        id: `cluster-${slug(candidate.title || candidate.topic)}`,
        topic: candidate.title || candidate.topic,
        summary: candidate.summary || "",
        publishedAt: candidate.publishedAt,
        candidates: [candidate],
        sourceSet: new Set([candidate.source])
      });
    }
  }

  return clusters.map((cluster) => ({
    ...cluster,
    sourceCount: cluster.sourceSet.size,
    urls: cluster.candidates.map((candidate) => candidate.url).filter(Boolean)
  }));
}
