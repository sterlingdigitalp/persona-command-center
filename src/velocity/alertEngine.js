import {
  execSql,
  newId,
  querySql,
  sqlJson,
  sqlString
} from "../db.js";
import { calculateAcceleration } from "./accelerationEngine.js";
import { getSignalSnapshots, getSignalsWithRecentSnapshots } from "./snapshotEngine.js";

function mapAlert(row) {
  return {
    id: row.id,
    signalId: row.signal_id,
    personaId: row.persona_id,
    alertLevel: row.alert_level,
    accelerationScore: Number(row.acceleration_score || 0),
    explanation: row.explanation,
    recommendedAction: row.recommended_action,
    createdAt: row.created_at,
    acknowledged: Boolean(row.acknowledged),
    acknowledgedAt: row.acknowledged_at,
    topic: row.topic,
    personaName: row.persona_name,
    priorityScore: Number(row.priority_score || 0)
  };
}

async function latestAlertForSignal(signalId) {
  const rows = await querySql(`
    SELECT *
    FROM velocity_alerts
    WHERE signal_id = ${sqlString(signalId)}
    ORDER BY created_at DESC
    LIMIT 1;
  `);
  return rows.length ? mapAlert(rows[0]) : null;
}

async function createAlert(signal, acceleration) {
  if (!acceleration.alertLevel) return null;
  const latest = await latestAlertForSignal(signal.id);
  if (latest && latest.alertLevel === acceleration.alertLevel && latest.accelerationScore >= acceleration.accelerationScore) {
    return null;
  }
  const alertId = newId("alert");
  await execSql(`
    INSERT INTO velocity_alerts (
      id, signal_id, persona_id, alert_level, acceleration_score,
      explanation, recommended_action, created_at
    )
    VALUES (
      ${sqlString(alertId)}, ${sqlString(signal.id)}, ${sqlString(signal.persona_id)},
      ${sqlString(acceleration.alertLevel)}, ${acceleration.accelerationScore},
      ${sqlString(acceleration.explanation)}, ${sqlString(acceleration.recommendedAction)},
      CURRENT_TIMESTAMP
    );

    INSERT INTO audit_log (id, actor, action, entity_type, entity_id, metadata)
    VALUES (
      ${sqlString(newId("audit"))}, 'system', 'velocity_alert.created',
      'velocity_alert', ${sqlString(alertId)}, ${sqlJson({
        signalId: signal.id,
        personaId: signal.persona_id,
        alertLevel: acceleration.alertLevel,
        accelerationScore: acceleration.accelerationScore
      })}
    );
  `);
  return alertId;
}

export async function generateVelocityAlerts({ signalIds = null, limit = 100 } = {}) {
  const signals = Array.isArray(signalIds) && signalIds.length
    ? await querySql(`SELECT * FROM signals WHERE id IN (${signalIds.map(sqlString).join(",")});`)
    : await getSignalsWithRecentSnapshots(limit);
  let snapshotsEvaluated = 0;
  const createdAlertIds = [];
  const evaluations = [];

  for (const signal of signals) {
    const snapshots = await getSignalSnapshots(signal.id, 6);
    if (snapshots.length < 2) {
      evaluations.push({ signalId: signal.id, accelerationScore: 0, alertLevel: null });
      continue;
    }
    snapshotsEvaluated += snapshots.length;
    const acceleration = calculateAcceleration(snapshots);
    evaluations.push({ signalId: signal.id, ...acceleration });
    const alertId = await createAlert(signal, acceleration);
    if (alertId) createdAlertIds.push(alertId);
  }

  return {
    generatedAt: new Date().toISOString(),
    snapshotsEvaluated,
    alertsGenerated: createdAlertIds.length,
    createdAlertIds,
    evaluations
  };
}

export async function getVelocityAlerts(filters = {}) {
  const clauses = ["1 = 1"];
  if (filters.level) clauses.push(`va.alert_level = ${sqlString(filters.level)}`);
  if (filters.personaId) clauses.push(`va.persona_id = ${sqlString(filters.personaId)}`);
  const rows = await querySql(`
    SELECT va.*, s.topic, s.priority_score, p.name AS persona_name
    FROM velocity_alerts va
    JOIN signals s ON s.id = va.signal_id
    JOIN personas p ON p.id = va.persona_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY va.acceleration_score DESC, va.created_at DESC
    LIMIT 100;
  `);
  return rows.map(mapAlert);
}

export async function getLatestVelocitySummary() {
  const alerts = await getVelocityAlerts({});
  const recentSnapshots = await querySql(`
    SELECT COUNT(*) AS count
    FROM signal_snapshots
    WHERE datetime(captured_at) >= datetime('now', '-24 hour');
  `);
  const topAlerts = alerts.slice(0, 5);
  return {
    generatedAt: new Date().toISOString(),
    snapshotsEvaluated: Number(recentSnapshots[0]?.count || 0),
    alertsGenerated: alerts.length,
    watchCount: alerts.filter((alert) => alert.alertLevel === "watch").length,
    risingCount: alerts.filter((alert) => alert.alertLevel === "rising").length,
    viralCount: alerts.filter((alert) => alert.alertLevel === "viral_window").length,
    topAlerts
  };
}
