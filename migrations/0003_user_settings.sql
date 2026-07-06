-- Migration number: 0003 	 per-user AI settings (Anthropic key stored encrypted)
CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY,
  model TEXT,
  -- AES-256-GCM ciphertext + IV of the Anthropic API key, base64-encoded.
  -- The plaintext key is never stored and never returned to the client; the
  -- worker decrypts it only in-memory to proxy Anthropic requests.
  key_ciphertext TEXT,
  key_iv TEXT,
  updated_at INTEGER NOT NULL
);
