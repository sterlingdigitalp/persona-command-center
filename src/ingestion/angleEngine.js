const ANGLES = {
  "the-wonkette": ["institutional incompetence", "procedural absurdity", "insider hypocrisy"],
  "policy-pete": ["policy consequences", "budget implications", "implementation reality"],
  "progressive-pat": ["labor impact", "housing impact", "power structures"],
  "maga-memester": ["media narrative", "elite disconnect", "institutional criticism"]
};

export function generateSuggestedAngle(persona, cluster) {
  const options = ANGLES[persona.id] || ["practical consequences", "audience impact", "what changes next"];
  const seed = cluster.topic.length + cluster.candidates.length + persona.id.length;
  const frame = options[seed % options.length];
  return `${persona.name}: frame "${cluster.topic}" around ${frame}.`;
}
