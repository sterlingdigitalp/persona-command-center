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
  ('q-pete-budget', 'policy-pete', 'federal budget reconciliation tax credits', 'public_feed', 'news', 1),
  ('q-pete-education', 'policy-pete', 'education policy student loans schools', 'public_feed', 'news', 3),
  ('q-pete-health', 'policy-pete', 'healthcare costs Medicaid Medicare policy', 'public_feed', 'rss', 2),
  ('q-maga-media', 'maga-memester', 'conservative media viral clip campaign rally', 'public_feed', 'news', 3),
  ('q-maga-border', 'maga-memester', 'border policy conservative influencers', 'public_feed', 'news', 2),
  ('q-maga-culture', 'maga-memester', 'culture war brands backlash media narrative', 'public_feed', 'rss', 2),
  ('q-pat-labor', 'progressive-pat', 'labor unions strike worker protections', 'public_feed', 'news', 3),
  ('q-pat-housing', 'progressive-pat', 'housing affordability rent control tenants', 'public_feed', 'news', 3),
  ('q-pat-climate', 'progressive-pat', 'climate policy clean energy jobs', 'public_feed', 'rss', 2),
  ('q-pat-crawl-demo', 'progressive-pat', 'https://en.wikipedia.org/wiki/Climate_change', 'web_crawl', 'crawl4ai', 1)
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

INSERT INTO persona_interests (id, persona_id, label, weight)
VALUES
  ('int-wonk-politics', 'the-wonkette', 'Politics', 5),
  ('int-wonk-law', 'the-wonkette', 'Law & Courts', 4),
  ('int-wonk-campaigns', 'the-wonkette', 'Campaign Finance', 3),
  ('int-pete-budget', 'policy-pete', 'Budget & Tax', 5),
  ('int-pete-education', 'policy-pete', 'Education', 4),
  ('int-pete-health', 'policy-pete', 'Healthcare', 3),
  ('int-maga-media', 'maga-memester', 'Media & Culture', 5),
  ('int-maga-border', 'maga-memester', 'Border Policy', 4),
  ('int-maga-tech', 'maga-memester', 'Tech & Free Speech', 3),
  ('int-pat-labor', 'progressive-pat', 'Labor & Workers', 5),
  ('int-pat-climate', 'progressive-pat', 'Climate & Energy', 4),
  ('int-pat-housing', 'progressive-pat', 'Housing Justice', 3)
ON CONFLICT(id) DO NOTHING;

INSERT INTO tracked_entities (id, name, type, primary_x_handle, aliases_json, github_urls_json, website_urls_json, rss_urls_json, keywords_json, notes)
VALUES (
  'ent-karpathy',
  'Andrej Karpathy',
  'person',
  '@karpathy',
  '["Andrej Karpathy", "karpathy"]',
  '["https://github.com/karpathy"]',
  '["https://karpathy.ai", "https://karpathy.github.io"]',
  '[]',
  '["microgpt", "nanochat", "autoresearch", "llm-council", "ai", "deep learning"]',
  'AI researcher and educator. Former Director of AI at Tesla, co-founder of OpenAI.'
) ON CONFLICT(id) DO NOTHING;

INSERT INTO persona_entity_subscriptions (id, persona_id, entity_id, priority, monitor_x, monitor_mentions, monitor_rss, monitor_crawl4ai, monitor_searchagent)
VALUES ('sub-karpathy-pat', 'progressive-pat', 'ent-karpathy', 5, 1, 1, 1, 1, 1)
ON CONFLICT(id) DO NOTHING;

INSERT INTO persona_crawl_targets (id, persona_id, label, url, notes, frequency)
VALUES
  ('ct-karpathy-blog', 'progressive-pat', 'Karpathy Blog', 'https://karpathy.github.io', 'AI research blog', 'daily'),
  ('ct-openai-news', 'progressive-pat', 'OpenAI News', 'https://openai.com/news', 'Official OpenAI announcements', 'daily'),
  ('ct-anthropic-news', 'progressive-pat', 'Anthropic News', 'https://anthropic.com/news', 'Official Anthropic announcements', 'daily')
ON CONFLICT(id) DO NOTHING;

-- Production Watch List seed — 40 tracked entities (10 per persona)
INSERT INTO tracked_entities (id, name, type, primary_x_handle, aliases_json, keywords_json)
VALUES
  -- Persona 1 — Sterling Digital (policy-pete): Tech Founders / AI Business / Growth
  ('ent-paul-graham', 'Paul Graham', 'person', '@paulg', '["Paul Graham", "paulg"]', '["startup", "yc", "silicon valley", "founder"]'),
  ('ent-naval', 'Naval Ravikant', 'person', '@naval', '["Naval Ravikant", "naval"]', '["startup", "philosophy", "wealth", "angel"]'),
  ('ent-garry-tan', 'Garry Tan', 'person', '@garrytan', '["Garry Tan", "garrytan"]', '["yc", "startup", "design", "venture"]'),
  ('ent-greg-isenberg', 'Greg Isenberg', 'person', '@gregisenberg', '["Greg Isenberg", "gregisenberg"]', '["community", "product", "growth", "startup"]'),
  ('ent-shaan-puri', 'Shaan Puri', 'person', '@ShaanVP', '["Shaan Puri", "ShaanVP"]', '["startup", "business", "mfj", "trends"]'),
  ('ent-sam-parr', 'Sam Parr', 'person', '@theSamParr', '["Sam Parr", "theSamParr"]', '["media", "newsletter", "startup", "business"]'),
  ('ent-lenny-rachitsky', 'Lenny Rachitsky', 'person', '@lennysan', '["Lenny Rachitsky", "lennysan"]', '["product", "growth", "saas", "pm"]'),
  ('ent-nikita-bier', 'Nikita Bier', 'person', '@nikitabier', '["Nikita Bier", "nikitabier"]', '["consumer", "startup", "growth", "product"]'),
  ('ent-jason-lemkin', 'Jason Lemkin', 'person', '@jasonlk', '["Jason Lemkin", "jasonlk"]', '["saas", "startup", "sales", "fundraising"]'),
  ('ent-pieter-levels', 'Pieter Levels', 'person', '@levelsio', '["Pieter Levels", "levelsio"]', '["indie", "solo founder", "ai", "startup"]'),
  -- Persona 2 — Scott Decoded (maga-memester): AI / Coding / Frontier Models
  ('ent-sam-altman', 'Sam Altman', 'person', '@sama', '["Sam Altman", "sama"]', '["ai", "openai", "startup", "tech"]'),
  ('ent-yann-lecun', 'Yann LeCun', 'person', '@ylecun', '["Yann LeCun", "ylecun"]', '["ai", "deep learning", "meta", "research"]'),
  ('ent-francois-chollet', 'François Chollet', 'person', '@fchollet', '["Francois Chollet", "fchollet"]', '["ai", "keras", "deep learning", "agi"]'),
  ('ent-andrew-ng', 'Andrew Ng', 'person', '@AndrewYNg', '["Andrew Ng", "AndrewYNg"]', '["ai", "deep learning", "education", "ml"]'),
  ('ent-demis-hassabis', 'Demis Hassabis', 'person', '@demishassabis', '["Demis Hassabis", "demishassabis"]', '["ai", "deepmind", "google", "agi"]'),
  ('ent-jim-fan', 'Jim Fan', 'person', '@DrJimFan', '["Jim Fan", "DrJimFan"]', '["ai", "robotics", "nvidia", "research"]'),
  ('ent-simon-willison', 'Simon Willison', 'person', '@simonw', '["Simon Willison", "simonw"]', '["python", "llm", "datasette", "open source"]'),
  ('ent-shawn-wang', 'Shawn Wang', 'person', '@swyx', '["Shawn Wang", "swyx"]', '["ai", "startup", "coding", "devtools"]'),
  ('ent-riley-goodside', 'Riley Goodside', 'person', '@goodside', '["Riley Goodside", "goodside"]', '["ai", "prompt engineering", "llm", "scale"]'),
  -- Persona 3 — Peptide Tracker (the-wonkette): Longevity / Peptides / Healthspan
  ('ent-bryan-johnson', 'Bryan Johnson', 'person', '@bryan_johnson', '["Bryan Johnson", "bryan_johnson"]', '["longevity", "blueprint", "biohacking", "health"]'),
  ('ent-peter-attia', 'Peter Attia', 'person', '@PeterAttiaMD', '["Peter Attia", "PeterAttiaMD"]', '["longevity", "healthspan", "medicine", "exercise"]'),
  ('ent-andrew-huberman', 'Andrew Huberman', 'person', '@hubermanlab', '["Andrew Huberman", "hubermanlab"]', '["neuroscience", "health", "science", "biology"]'),
  ('ent-rhonda-patrick', 'Rhonda Patrick', 'person', '@foundmyfitness', '["Rhonda Patrick", "foundmyfitness"]', '["longevity", "nutrition", "science", "health"]'),
  ('ent-david-sinclair', 'David Sinclair', 'person', '@davidasinclair', '["David Sinclair", "davidasinclair"]', '["longevity", "genetics", "aging", "research"]'),
  ('ent-matt-kaeberlein', 'Matt Kaeberlein', 'person', '@MKaeberlein', '["Matt Kaeberlein", "MKaeberlein"]', '["longevity", "aging", "research", "rapamycin"]'),
  ('ent-siim-land', 'Siim Land', 'person', '@siimland', '["Siim Land", "siimland"]', '["longevity", "health", "nutrition", "biohacking"]'),
  ('ent-peter-diamandis', 'Peter Diamandis', 'person', '@PeterDiamandis', '["Peter Diamandis", "PeterDiamandis"]', '["longevity", "innovation", "xpize", "health"]'),
  ('ent-eric-topol', 'Eric Topol', 'person', '@EricTopol', '["Eric Topol", "EricTopol"]', '["medicine", "ai", "health", "research"]'),
  ('ent-brad-stanfield', 'Brad Stanfield', 'person', '@BradStanfield', '["Brad Stanfield", "BradStanfield"]', '["longevity", "supplements", "health", "science"]'),
  -- Persona 4 — Chris (progressive-pat): Finance / Investing / Markets
  ('ent-josh-wolfe', 'Josh Wolfe', 'person', '@wolfejosh', '["Josh Wolfe", "wolfejosh"]', '["venture", "deep tech", "investing", "science"]'),
  ('ent-morgan-housel', 'Morgan Housel', 'person', '@morganhousel', '["Morgan Housel", "morganhousel"]', '["investing", "psychology", "money", "behavior"]'),
  ('ent-patrick-oshaughnessy', 'Patrick O''Shaughnessy', 'person', '@patrick_oshag', '["Patrick OShaughnessy", "patrick_oshag"]', '["investing", "podcast", "venture", "finance"]'),
  ('ent-matt-levine', 'Matt Levine', 'person', '@matt_levine', '["Matt Levine", "matt_levine"]', '["finance", "wall street", "m&a", "securities"]'),
  ('ent-packy-mccormick', 'Packy McCormick', 'person', '@packyM', '["Packy McCormick", "packyM"]', '["startup", "investing", "tech", "business"]'),
  ('ent-ben-thompson', 'Ben Thompson', 'person', '@benthompson', '["Ben Thompson", "benthompson"]', '["tech", "strategy", "platforms", "business"]'),
  ('ent-bill-gurley', 'Bill Gurley', 'person', '@bgurley', '["Bill Gurley", "bgurley"]', '["venture", "investing", "marketplaces", "benchmark"]'),
  ('ent-aswath-damodaran', 'Aswath Damodaran', 'person', '@AswathDamodaran', '["Aswath Damodaran", "AswathDamodaran"]', '["valuation", "finance", "investing", "corporate finance"]'),
  ('ent-charlie-bilello', 'Charlie Bilello', 'person', '@charliebilello', '["Charlie Bilello", "charliebilello"]', '["markets", "investing", "etf", "macro"]'),
  ('ent-barry-ritholtz', 'Barry Ritholtz', 'person', '@ritholtz', '["Barry Ritholtz", "ritholtz"]', '["investing", "markets", "finance", "podcast"]')
ON CONFLICT(id) DO NOTHING;

-- Production Watch List subscriptions — 40 entries (10 per persona)
INSERT INTO persona_entity_subscriptions (id, persona_id, entity_id, priority, monitor_x, monitor_mentions, monitor_rss, monitor_crawl4ai, monitor_searchagent)
VALUES
  -- Sterling Digital — Tech Founders
  ('sub-sterling-paul-graham', 'policy-pete', 'ent-paul-graham', 5, 1, 1, 1, 1, 1),
  ('sub-sterling-naval', 'policy-pete', 'ent-naval', 5, 1, 1, 1, 1, 1),
  ('sub-sterling-garry-tan', 'policy-pete', 'ent-garry-tan', 5, 1, 1, 1, 1, 1),
  ('sub-sterling-greg-isenberg', 'policy-pete', 'ent-greg-isenberg', 5, 1, 1, 1, 1, 1),
  ('sub-sterling-shaan-puri', 'policy-pete', 'ent-shaan-puri', 5, 1, 1, 1, 1, 1),
  ('sub-sterling-sam-parr', 'policy-pete', 'ent-sam-parr', 5, 1, 1, 1, 1, 1),
  ('sub-sterling-lenny-rachitsky', 'policy-pete', 'ent-lenny-rachitsky', 5, 1, 1, 1, 1, 1),
  ('sub-sterling-nikita-bier', 'policy-pete', 'ent-nikita-bier', 5, 1, 1, 1, 1, 1),
  ('sub-sterling-jason-lemkin', 'policy-pete', 'ent-jason-lemkin', 5, 1, 1, 1, 1, 1),
  ('sub-sterling-pieter-levels', 'policy-pete', 'ent-pieter-levels', 5, 1, 1, 1, 1, 1),
  -- Scott Decoded — AI / Coding
  ('sub-scott-karpathy', 'maga-memester', 'ent-karpathy', 5, 1, 1, 1, 1, 1),
  ('sub-scott-sam-altman', 'maga-memester', 'ent-sam-altman', 5, 1, 1, 1, 1, 1),
  ('sub-scott-yann-lecun', 'maga-memester', 'ent-yann-lecun', 5, 1, 1, 1, 1, 1),
  ('sub-scott-francois-chollet', 'maga-memester', 'ent-francois-chollet', 5, 1, 1, 1, 1, 1),
  ('sub-scott-andrew-ng', 'maga-memester', 'ent-andrew-ng', 5, 1, 1, 1, 1, 1),
  ('sub-scott-demis-hassabis', 'maga-memester', 'ent-demis-hassabis', 5, 1, 1, 1, 1, 1),
  ('sub-scott-jim-fan', 'maga-memester', 'ent-jim-fan', 5, 1, 1, 1, 1, 1),
  ('sub-scott-simon-willison', 'maga-memester', 'ent-simon-willison', 5, 1, 1, 1, 1, 1),
  ('sub-scott-shawn-wang', 'maga-memester', 'ent-shawn-wang', 5, 1, 1, 1, 1, 1),
  ('sub-scott-riley-goodside', 'maga-memester', 'ent-riley-goodside', 5, 1, 1, 1, 1, 1),
  -- Peptide Tracker — Longevity / Healthspan
  ('sub-peptide-bryan-johnson', 'the-wonkette', 'ent-bryan-johnson', 5, 1, 1, 1, 1, 1),
  ('sub-peptide-peter-attia', 'the-wonkette', 'ent-peter-attia', 5, 1, 1, 1, 1, 1),
  ('sub-peptide-andrew-huberman', 'the-wonkette', 'ent-andrew-huberman', 5, 1, 1, 1, 1, 1),
  ('sub-peptide-rhonda-patrick', 'the-wonkette', 'ent-rhonda-patrick', 5, 1, 1, 1, 1, 1),
  ('sub-peptide-david-sinclair', 'the-wonkette', 'ent-david-sinclair', 5, 1, 1, 1, 1, 1),
  ('sub-peptide-matt-kaeberlein', 'the-wonkette', 'ent-matt-kaeberlein', 5, 1, 1, 1, 1, 1),
  ('sub-peptide-siim-land', 'the-wonkette', 'ent-siim-land', 5, 1, 1, 1, 1, 1),
  ('sub-peptide-peter-diamandis', 'the-wonkette', 'ent-peter-diamandis', 5, 1, 1, 1, 1, 1),
  ('sub-peptide-eric-topol', 'the-wonkette', 'ent-eric-topol', 5, 1, 1, 1, 1, 1),
  ('sub-peptide-brad-stanfield', 'the-wonkette', 'ent-brad-stanfield', 5, 1, 1, 1, 1, 1),
  -- Chris — Finance / Investing
  ('sub-chris-josh-wolfe', 'progressive-pat', 'ent-josh-wolfe', 5, 1, 1, 1, 1, 1),
  ('sub-chris-morgan-housel', 'progressive-pat', 'ent-morgan-housel', 5, 1, 1, 1, 1, 1),
  ('sub-chris-patrick-oshaughnessy', 'progressive-pat', 'ent-patrick-oshaughnessy', 5, 1, 1, 1, 1, 1),
  ('sub-chris-matt-levine', 'progressive-pat', 'ent-matt-levine', 5, 1, 1, 1, 1, 1),
  ('sub-chris-packy-mccormick', 'progressive-pat', 'ent-packy-mccormick', 5, 1, 1, 1, 1, 1),
  ('sub-chris-ben-thompson', 'progressive-pat', 'ent-ben-thompson', 5, 1, 1, 1, 1, 1),
  ('sub-chris-bill-gurley', 'progressive-pat', 'ent-bill-gurley', 5, 1, 1, 1, 1, 1),
  ('sub-chris-aswath-damodaran', 'progressive-pat', 'ent-aswath-damodaran', 5, 1, 1, 1, 1, 1),
  ('sub-chris-charlie-bilello', 'progressive-pat', 'ent-charlie-bilello', 5, 1, 1, 1, 1, 1),
  ('sub-chris-barry-ritholtz', 'progressive-pat', 'ent-barry-ritholtz', 5, 1, 1, 1, 1, 1)
ON CONFLICT(id) DO NOTHING;
