import { overlapScore } from "../ingestion/text.js";

function selectionScore(signal) {
  return Number(signal.priorityScore || 0) + Number(signal.chiefOfStaffRank || 0) - Number(signal.riskScore || 0) * 0.35;
}

function isNearDuplicate(signal, selected) {
  return selected.some((item) => overlapScore(item.topic, signal.topic) >= 0.58);
}

function summarize(persona, selectedSignals) {
  if (!selectedSignals.length) return `${persona.name}: no provider-backed signals cleared the morning threshold.`;
  const top = selectedSignals[0];
  const count = selectedSignals.length;
  return `${persona.name}: ${count} morning ${count === 1 ? "signal" : "signals"} selected, led by "${top.topic}".`;
}

export function selectMorningDigestSignals(personas, signalsByPersona, maxSignalsPerPersona = 3) {
  const maxSignals = Math.max(1, Math.min(6, Number(maxSignalsPerPersona || 3)));

  return personas.map((persona) => {
    const candidates = [...(signalsByPersona.get(persona.id) || [])]
      .sort((a, b) => selectionScore(b) - selectionScore(a));
    const selectedSignals = [];

    for (const signal of candidates) {
      if (selectedSignals.length >= maxSignals) break;
      if (Number(signal.riskScore || 0) >= 75) continue;
      if (isNearDuplicate(signal, selectedSignals)) continue;
      selectedSignals.push(signal);
    }

    return {
      personaId: persona.id,
      summary: summarize(persona, selectedSignals),
      selectedSignals
    };
  });
}
