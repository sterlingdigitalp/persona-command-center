// =============================================================================
// server.js PATCH — two function replacements
//
// Replace the existing `runHermesProviderMorningDigest` and `runIngestion`
// functions in src/server.js with these versions.
// Everything else in server.js is unchanged.
// =============================================================================

// -----------------------------------------------------------------------------
// REPLACE: runHermesProviderMorningDigest
// Change: recentTopics loading parallelized across personas with Promise.all
// -----------------------------------------------------------------------------

async function runHermesProviderMorningDigest(payload = {}) {
  const allPersonas = await getPersonas();
  const personas = allPersonas.filter((p) => p.platformStatus === "active");
  const skippedPersonaIds = allPersonas
    .filter((p) => p.platformStatus !== "active")
    .map((p) => p.id);

  // KEY CHANGE: load recent topics for all active personas concurrently
  // instead of awaiting each DB query one at a time.
  const recentTopicsByPersona = new Map(
    await Promise.all(
      personas.map(async (persona) => [
        persona.id,
        (await getSignalsForPersona(persona.id))
          .slice(0, 20)
          .map((s) => s.topic),
      ])
    )
  );

  const result = await runProviderBackedMorningDigest({
    personas,
    recentTopicsByPersona,
    importPayload: importHermesPayload,
    options: payload,
  });

  result.skippedPersonaIds = skippedPersonaIds;
  result.skippedPersonaCount = skippedPersonaIds.length;

  await execSql(`
    UPDATE ingestion_runs
    SET source_count    = ${Number(result.sourceCount || 0)},
        candidate_count = ${Number(result.candidateCount || 0)},
        cluster_count   = ${Number(result.clusterCount || 0)},
        signal_count    = ${Number(result.signalCount || 0)},
        notes           = ${sqlString(
          `Provider-backed Hermes morning digest: ${result.signalCount} signals from ${result.candidateCount} candidates`
        )},
        summary         = ${sqlJson({
          version: "provider-backed-morning-digest-v1",
          providerNames: result.providerNames,
          staleFilteredCount: result.staleFilteredCount,
          mockFilteredCount: result.mockFilteredCount,
          missingDateFilteredCount: result.missingDateFilteredCount,
          freshCandidateCount: result.freshCandidateCount,
          dedupedCount: result.dedupedCount,
          skippedPersonaIds: result.skippedPersonaIds,
          skippedPersonaCount: result.skippedPersonaCount,
          topSignalsByPersona: result.topSignalsByPersona,
          attribution: result.attribution,
        })}
    WHERE id = ${sqlString(result.runId)};
  `);

  await audit(
    "hermes.provider_morning_digest.completed",
    "ingestion_run",
    result.runId,
    {
      providerNames: result.providerNames,
      candidateCount: result.candidateCount,
      signalCount: result.signalCount,
      skippedPersonaCount: result.skippedPersonaCount,
    }
  );

  return result;
}

// -----------------------------------------------------------------------------
// REPLACE: runIngestion
// Changes:
//   1. recentTopics + buildSignalsForPersona run concurrently across personas
//   2. signal writes (INSERT + snapshot) batched per persona with Promise.allSettled
//   3. ingestion_runs row updated once at the end, not per-signal
// -----------------------------------------------------------------------------

async function runIngestion(payload = {}) {
  const now = new Date().toISOString();
  const runId = newId("run");
  const runType = payload.runType || (payload.useMockProviders ? "mock" : "manual");

  await execSql(`
    INSERT INTO ingestion_runs (
      id, run_type, status, started_at, signals_created,
      source_count, candidate_count, cluster_count, signal_count, notes, summary
    )
    VALUES (
      ${sqlString(runId)}, ${sqlString(runType)}, 'running', ${sqlString(now)}, 0,
      0, 0, 0, 0,
      ${sqlString(
        payload.useMockProviders
          ? "Phase 3 deterministic provider ingestion started"
          : "Phase 3 public RSS/news ingestion started"
      )},
      'Ingestion started'
    );
  `);

  const personas = await getPersonas();
  const createdSignals = [];
  let candidateCount = 0;
  let clusterCount = 0;
  const sourceSet = new Set();

  try {
    // KEY CHANGE: load recent topics + run buildSignalsForPersona for all
    // personas concurrently instead of one at a time.
    const personaResults = await Promise.allSettled(
      personas.map(async (persona) => {
        const recentTopics = (await getSignalsForPersona(persona.id))
          .slice(0, 20)
          .map((s) => s.topic);

        const result = await buildSignalsForPersona(persona, recentTopics, {
          forceMock: Boolean(payload.useMockProviders),
          ignoreProviderErrors: true,
          maxSignalsPerPersona: payload.maxSignalsPerPersona || 6,
        });

        return { persona, result };
      })
    );

    for (const settled of personaResults) {
      if (settled.status === "rejected") {
        console.error("[runIngestion] persona failed:", settled.reason?.message || settled.reason);
        continue;
      }

      const { result } = settled.value;
      candidateCount += result.candidates.length;
      clusterCount += result.clusters.length;
      for (const c of result.candidates) sourceSet.add(c.source);

      // Write signals for this persona concurrently.
      const signalWrites = await Promise.allSettled(
        result.signals.map(async (signal) => {
          const signalId = newId("sig");
          const snapshotId = newId("snap");

          await execSql(`
            INSERT INTO signals (
              id, persona_id, topic, source, query,
              first_seen_at, last_seen_at,
              velocity_score, relevance_score, novelty_score,
              freshness_score, risk_score, priority_score,
              source_count, cluster_id, generated_by, status,
              suggested_angle, evidence_urls
            )
            VALUES (
              ${sqlString(signalId)},
              ${sqlString(signal.personaId)},
              ${sqlString(signal.topic)},
              ${sqlString(signal.source)},
              ${sqlString(signal.query)},
              ${sqlString(signal.firstSeenAt)},
              ${sqlString(signal.lastSeenAt)},
              ${signal.velocityScore || 0},
              ${signal.relevanceScore || 0},
              ${signal.noveltyScore || 0},
              ${signal.freshnessScore || 0},
              ${signal.riskScore || 0},
              ${signal.priorityScore || 0},
              ${signal.sourceCount || 1},
              ${sqlString(signal.clusterId)},
              'pipeline',
              'new',
              ${sqlString(signal.suggestedAngle)},
              ${sqlJson(signal.evidenceUrls || [])}
            );
          `);

          await execSql(`
            INSERT INTO signal_snapshots (
              id, signal_id, ingestion_run_id, captured_at,
              velocity_score, relevance_score, novelty_score,
              freshness_score, priority_score, risk_score,
              source_count, cluster_id
            )
            VALUES (
              ${sqlString(snapshotId)},
              ${sqlString(signalId)},
              ${sqlString(runId)},
              ${sqlString(signal.lastSeenAt)},
              ${signal.velocityScore || 0},
              ${signal.relevanceScore || 0},
              ${signal.noveltyScore || 0},
              ${signal.freshnessScore || 0},
              ${signal.priorityScore || 0},
              ${signal.riskScore || 0},
              ${signal.sourceCount || 1},
              ${sqlString(signal.clusterId)}
            );
          `);

          return { ...signal, id: signalId, status: "new" };
        })
      );

      for (const sw of signalWrites) {
        if (sw.status === "fulfilled") {
          createdSignals.push(sw.value);
        } else {
          console.error("[runIngestion] signal write failed:", sw.reason?.message || sw.reason);
        }
      }
    }

    await execSql(`
      UPDATE ingestion_runs
      SET status          = 'completed',
          completed_at    = ${sqlString(new Date().toISOString())},
          signals_created = ${createdSignals.length},
          source_count    = ${sourceSet.size},
          candidate_count = ${candidateCount},
          cluster_count   = ${clusterCount},
          signal_count    = ${createdSignals.length},
          notes           = ${sqlString(
            `${createdSignals.length} signals from ${candidateCount} candidates`
          )},
          summary         = ${sqlJson({
            signalCount: createdSignals.length,
            candidateCount,
            clusterCount,
            sourceCount: sourceSet.size,
          })}
      WHERE id = ${sqlString(runId)};
    `);

    return {
      runId,
      signalCount: createdSignals.length,
      candidateCount,
      clusterCount,
      sourceCount: sourceSet.size,
      signals: createdSignals,
    };
  } catch (error) {
    await execSql(`
      UPDATE ingestion_runs
      SET status        = 'failed',
          completed_at  = ${sqlString(new Date().toISOString())},
          error_message = ${sqlString(error.message)}
      WHERE id = ${sqlString(runId)};
    `);
    throw error;
  }
}
