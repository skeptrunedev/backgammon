-- Migration number: 0002 	 per-user match storage
CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  match_length INTEGER,
  my_score INTEGER,
  opp_score INTEGER,
  winner TEXT,
  decision_count INTEGER,
  updated_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX idx_matches_user ON matches(user_id, started_at DESC);
