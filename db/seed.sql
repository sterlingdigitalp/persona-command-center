INSERT INTO personas (id, name, handle, niche, voice_tone, platform_status)
VALUES
  ('the-wonkette', 'The Wonkette', '@TheWonkette', 'Sharp political commentary, institutions, courts, campaigns, and policy process.', 'Clever, informed, dry, and punchy without becoming reckless.', 'active'),
  ('policy-pete', 'PolicyPete', '@PolicyPete', 'Plain-English policy explainers, budget tradeoffs, regulation, and civic systems.', 'Measured, explanatory, practical, and credible.', 'active'),
  ('maga-memester', 'MAGA Memester', '@MAGAMemester', 'Right-coded meme culture, conservative media moments, and populist internet humor.', 'Satirical, fast, meme-native, and careful around claims.', 'active'),
  ('progressive-pat', 'ProgressivePat', '@ProgressivePat', 'Progressive organizing, labor, climate, healthcare, and social justice policy.', 'Earnest, energized, values-led, and action-oriented.', 'active')
ON CONFLICT(id) DO NOTHING;

INSERT INTO persona_queries (id, persona_id, query, source_type, provider, weight)
VALUES
  ('q-wonkette-courts', 'the-wonkette', 'Supreme Court ethics Congress campaign finance', 'public_feed', 'news', 3),
  ('q-wonkette-campaigns', 'the-wonkette', '2026 midterms polling legal challenges', 'public_feed', 'rss', 2),
  ('q-wonkette-institutions', 'the-wonkette', 'DOJ oversight election law watchdog', 'public_feed', 'news', 2),
  ('q-pete-climate', 'policy-pete', 'climate policy implementation budget', 'public_feed', 'news', 3),
  ('q-pete-education', 'policy-pete', 'education policy student loans schools', 'public_feed', 'news', 3),
  ('q-pete-health', 'policy-pete', 'healthcare costs Medicaid Medicare policy', 'public_feed', 'rss', 2),
  ('q-maga-media', 'maga-memester', 'conservative media viral clip campaign rally', 'public_feed', 'news', 3),
  ('q-maga-border', 'maga-memester', 'border policy conservative influencers', 'public_feed', 'news', 2),
  ('q-maga-culture', 'maga-memester', 'culture war brands backlash media narrative', 'public_feed', 'rss', 2),
  ('q-pat-labor', 'progressive-pat', 'labor unions strike worker protections', 'public_feed', 'news', 3),
  ('q-pat-housing', 'progressive-pat', 'housing affordability rent control tenants', 'public_feed', 'news', 3),
  ('q-pat-climate', 'progressive-pat', 'climate policy clean energy jobs', 'public_feed', 'rss', 2)
ON CONFLICT(id) DO NOTHING;

INSERT INTO platform_accounts (id, persona_id, platform, handle, status, adapter_notes)
VALUES
  ('pa-wonkette-x', 'the-wonkette', 'x', '@TheWonkette', 'configured', 'Future X API publishing adapter connects here.'),
  ('pa-pete-x', 'policy-pete', 'x', '@PolicyPete', 'configured', 'Future X API publishing adapter connects here.'),
  ('pa-maga-x', 'maga-memester', 'x', '@MAGAMemester', 'configured', 'Future X API publishing adapter connects here.'),
  ('pa-pat-x', 'progressive-pat', 'x', '@ProgressivePat', 'configured', 'Future X API publishing adapter connects here.')
ON CONFLICT(id) DO NOTHING;

INSERT INTO hermes_settings (key, value)
VALUES
  ('morning_digest_enabled', 'true'),
  ('velocity_scan_enabled', 'true'),
  ('midday_brief_enabled', 'true'),
  ('evening_scan_enabled', 'true'),
  ('simulation_mode_enabled', 'true'),
  ('archive_after_days', '7')
ON CONFLICT(key) DO NOTHING;
