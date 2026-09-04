-- Offline-first personal training progress, merged by client-side item timestamps.
CREATE TABLE training_state (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
