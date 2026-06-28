import { getHermesAttributionDefaults } from "./hermesClient.js";

const JOB_CONFIG = {
  morning_digest: {
    label: "Morning Digest",
    boost: 8,
    topics: {
      "the-wonkette": ["Court ethics pressure builds before committee hearing", "Campaign finance loophole draws renewed scrutiny"],
      "policy-pete": ["Student loan repayment rule changes hit implementation reality", "Climate grant budget deadlines create state tradeoffs"],
      "maga-memester": ["Cable news clip turns into a media narrative fight", "Border hearing moment exposes elite disconnect"],
      "progressive-pat": ["Union contract vote highlights labor impact", "Rent control proposal returns to city agenda"]
    }
  },
  velocity_scan: {
    label: "Velocity Scan",
    boost: 14,
    topics: {
      "the-wonkette": ["Oversight hearing clip accelerates across political newsletters"],
      "policy-pete": ["Education funding thread gains policy analyst attention"],
      "maga-memester": ["Campaign surrogate quote becomes meme source material"],
      "progressive-pat": ["Housing affordability petition spikes after council vote"]
    }
  },
  midday_brief: {
    label: "Midday Brief",
    boost: 10,
    topics: {
      "the-wonkette": ["Procedural fight creates fresh court reform angle"],
      "policy-pete": ["Healthcare cost estimate changes afternoon policy read"],
      "maga-memester": ["Institutional criticism frame emerges from agency story"],
      "progressive-pat": ["Labor coalition announcement creates organizing hook"]
    }
  },
  evening_scan: {
    label: "Evening Scan",
    boost: 4,
    topics: {
      "the-wonkette": ["Evening legal analysis consolidates campaign story"],
      "policy-pete": ["Budget implications settle after agency clarification"],
      "maga-memester": ["Media narrative cools into recap-ready contrast"],
      "progressive-pat": ["Power structures angle sharpens in evening coverage"]
    }
  }
};

const ANGLES = {
  "the-wonkette": "procedural absurdity",
  "policy-pete": "implementation reality",
  "maga-memester": "media narrative",
  "progressive-pat": "power structures"
};

export function buildHermesSimulationPayload(personas, runType = "morning_digest", generatedAt = new Date().toISOString(), attributionOverrides = {}) {
  const config = JOB_CONFIG[runType] || JOB_CONFIG.morning_digest;
  const attribution = getHermesAttributionDefaults({
    jobName: `persona-command-center-${runType}`,
    ...attributionOverrides
  });
  return {
    version: "2026-06-phase4",
    runType,
    provider: attribution.provider,
    model: attribution.model,
    endpoint: attribution.endpoint,
    jobName: attribution.jobName,
    generatedAt,
        personas: personas.map((persona) => {
      const topics = config.topics[persona.id] || [`${persona.name} briefing signal`];
      return {
        personaId: persona.id,
        signals: topics.map((topic, index) => {
          const base = 72 + config.boost - index * 4;
          const tracked = persona.trackedEntities?.[index % Math.max(1, (persona.trackedEntities || []).length)];
          return {
            topic,
            source: "Hermes",
            sourceProvider: "Hermes",
            query: tracked?.entity_name || (persona.queries?.[index % Math.max(1, persona.queries.length)]?.query) || persona.niche,
            firstSeenAt: generatedAt,
            lastSeenAt: generatedAt,
            velocityScore: Math.min(99, base - 6 + index * 3),
            relevanceScore: Math.min(99, base + 4),
            noveltyScore: Math.min(99, base - 2),
            freshnessScore: Math.min(99, base + 8),
            riskScore: 12 + index * 3,
            priorityScore: Math.min(99, base + 6),
            sourceCount: 2 + index,
            clusterId: `hermes-${runType}-${persona.id}-${index + 1}`,
            suggestedAngle: `${persona.name}: use ${ANGLES[persona.id] || "practical consequences"} to frame "${topic}".`,
            evidenceUrls: [`https://hermes.local/${runType}/${persona.id}/${index + 1}`],
            rawData: { simulated: true, jobLabel: config.label }
          };
        })
      };
    })
  };
}
