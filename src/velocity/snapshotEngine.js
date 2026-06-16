import { querySql, sqlString } from "../db.js";

export function mapSnapshot(row) {
  return {
    id: row.id,
    signalId: row.signal_id,
    ingestionRunId: row.ingestion_run_id,
    timestamp: row.captured_at,
    capturedAt: row.captured_at,
    sourceCount: Number(row.source_count || 1),
    priorityScore: Number(row.priority_score || 0),
    freshnessScore: Number(row.freshness_score || 0),
    relevanceScore: Number(row.relevance_score || 0),
    velocityScore: Number(row.velocity_score || 0),
    riskScore: Number(row.risk_score || 0),
    clusterId: row.cluster_id
  };
}

export async function getSignalSnapshots(signalId, limit = 6) {
  const rows = await querySql(`
    SELECT *
    FROM signal_snapshots
    WHERE signal_id = ${sqlString(signalId)}
    ORDER BY captured_at DESC
    LIMIT ${Math.max(2, Math.min(20, Number(limit || 6)))};
  `);
  return rows.map(mapSnapshot).reverse();
}

export async function getSignalsWithRecentSnapshots(limit = 100) {
  return querySql(`
    SELECT s.*
    FROM signals s
    WHERE s.status != 'archived'
      AND EXISTS (
        SELECT 1
        FROM signal_snapshots ss
        WHERE ss.signal_id = s.id
      )
    ORDER BY s.last_seen_at DESC
    LIMIT ${Math.max(1, Math.min(250, Number(limit || 100)))};
  `);
}
