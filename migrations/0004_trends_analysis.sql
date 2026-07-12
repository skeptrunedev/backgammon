-- Migration number: 0004 	 per-user cached AI trends analysis (server-side, not the browser)
CREATE TABLE trends_analysis (
  user_id TEXT PRIMARY KEY,
  -- Signature of the analysis input (hash of the trends prompt). Lets the client
  -- tell when the stored analysis is stale relative to the player's newer games.
  sig TEXT NOT NULL,
  text TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
