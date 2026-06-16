PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS personas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  handle TEXT NOT NULL,
  niche TEXT NOT NULL,
  voice_tone TEXT NOT NULL,
  platform_status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS persona_queries (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL,
  query TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'x_recent_search',
  provider TEXT NOT NULL DEFAULT 'news',
  weight INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id TEXT PRIMARY KEY,
  run_type TEXT NOT NULL DEFAULT 'mock',
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  signals_created INTEGER NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 0,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  cluster_count INTEGER NOT NULL DEFAULT 0,
  signal_count INTEGER NOT NULL DEFAULT 0,
  generated_by TEXT,
  provider TEXT,
  model TEXT,
  endpoint TEXT,
  job_name TEXT,
  validation_id TEXT,
  notes TEXT,
  error_message TEXT,
  summary TEXT
);

CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  source TEXT NOT NULL,
  query TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  velocity_score INTEGER NOT NULL,
  relevance_score INTEGER NOT NULL,
  novelty_score INTEGER NOT NULL,
  freshness_score INTEGER NOT NULL DEFAULT 0,
  risk_score INTEGER NOT NULL,
  priority_score INTEGER NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 1,
  cluster_id TEXT,
  generated_by TEXT,
  source_provider TEXT,
  hermes_run_type TEXT,
  hermes_provider TEXT,
  hermes_model TEXT,
  hermes_endpoint TEXT,
  hermes_job_name TEXT,
  validation_id TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  reviewed_at TEXT,
  dismissed_at TEXT,
  used_at TEXT,
  suggested_angle TEXT NOT NULL,
  evidence_urls TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS signal_snapshots (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL,
  ingestion_run_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  velocity_score INTEGER NOT NULL,
  relevance_score INTEGER NOT NULL,
  novelty_score INTEGER NOT NULL,
  freshness_score INTEGER NOT NULL DEFAULT 0,
  priority_score INTEGER NOT NULL DEFAULT 0,
  risk_score INTEGER NOT NULL,
  source_count INTEGER NOT NULL DEFAULT 1,
  cluster_id TEXT,
  raw_payload TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (signal_id) REFERENCES signals(id) ON DELETE CASCADE,
  FOREIGN KEY (ingestion_run_id) REFERENCES ingestion_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS velocity_alerts (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  alert_level TEXT NOT NULL,
  acceleration_score INTEGER NOT NULL,
  explanation TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acknowledged INTEGER NOT NULL DEFAULT 0,
  acknowledged_at TEXT,
  FOREIGN KEY (signal_id) REFERENCES signals(id) ON DELETE CASCADE,
  FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL,
  body TEXT NOT NULL,
  original_body TEXT,
  edited_body TEXT,
  platform TEXT NOT NULL DEFAULT 'x',
  media_refs TEXT NOT NULL DEFAULT '[]',
  hashtags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'needs_review',
  source_signal_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scheduled_posts (
  id TEXT PRIMARY KEY,
  draft_id TEXT,
  persona_id TEXT,
  platform TEXT NOT NULL DEFAULT 'x',
  body TEXT NOT NULL,
  media_refs TEXT NOT NULL DEFAULT '[]',
  hashtags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'scheduled',
  scheduled_at TEXT NOT NULL,
  source_signal_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (draft_id) REFERENCES drafts(id) ON DELETE SET NULL,
  FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS platform_accounts (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  handle TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'configured',
  adapter_notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL DEFAULT 'system',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hermes_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_persona_queries_persona ON persona_queries(persona_id);
CREATE INDEX IF NOT EXISTS idx_signals_persona_seen ON signals(persona_id, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_snapshots_run ON signal_snapshots(ingestion_run_id);
CREATE INDEX IF NOT EXISTS idx_velocity_alerts_signal ON velocity_alerts(signal_id, created_at);
CREATE INDEX IF NOT EXISTS idx_velocity_alerts_level ON velocity_alerts(alert_level, created_at);
CREATE INDEX IF NOT EXISTS idx_drafts_persona ON drafts(persona_id);
CREATE INDEX IF NOT EXISTS idx_schedule_status ON scheduled_posts(status, scheduled_at);
