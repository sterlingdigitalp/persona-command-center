function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function alertLevelForScore(score) {
  if (score >= 90) return "viral_window";
  if (score >= 75) return "rising";
  if (score >= 60) return "watch";
  return null;
}

export function recommendedActionForLevel(level) {
  if (level === "viral_window") return "Post immediately";
  if (level === "rising") return "Draft post";
  if (level === "watch") return "Monitor";
  return "No action";
}

export function calculateAcceleration(snapshots = []) {
  if (!Array.isArray(snapshots) || snapshots.length < 2) {
    return {
      sourceCountDelta: 0,
      priorityDelta: 0,
      velocityDelta: 0,
      accelerationScore: 0,
      alertLevel: null,
      recommendedAction: "No action",
      explanation: "Not enough snapshot history to calculate acceleration."
    };
  }

  const first = snapshots[0];
  const latest = snapshots[snapshots.length - 1];
  const sourceCountDelta = Math.max(0, Number(latest.sourceCount || 0) - Number(first.sourceCount || 0));
  const priorityDelta = Math.max(0, Number(latest.priorityScore || 0) - Number(first.priorityScore || 0));
  const velocityDelta = Math.max(0, Number(latest.velocityScore || 0) - Number(first.velocityScore || 0));
  const sourceGrowth = sourceCountDelta * 8;
  const priorityGrowth = priorityDelta * 1.8;
  const velocityGrowth = velocityDelta * 1.6;
  const accelerationScore = clamp(sourceGrowth + priorityGrowth + velocityGrowth);
  const alertLevel = alertLevelForScore(accelerationScore);
  const recommendedAction = recommendedActionForLevel(alertLevel);

  return {
    sourceCountDelta,
    priorityDelta,
    velocityDelta,
    accelerationScore,
    alertLevel,
    recommendedAction,
    explanation: `Source count increased from ${first.sourceCount} to ${latest.sourceCount}; priority changed by ${priorityDelta}; velocity changed by ${velocityDelta}.`
  };
}

export function calculateFutureXAcceleration(input = {}) {
  return {
    rssSourceCount: Number(input.rssSourceCount || 0),
    newsSourceCount: Number(input.newsSourceCount || 0),
    xPostCount15m: Number(input.xPostCount15m || 0),
    xPostCount60m: Number(input.xPostCount60m || 0),
    xUniqueAuthors: Number(input.xUniqueAuthors || 0),
    xHighFollowerAuthors: Number(input.xHighFollowerAuthors || 0),
    xEngagementRate: Number(input.xEngagementRate || 0)
  };
}
