export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  SMTP_HOST: string;
  SMTP_PORT: string;
  SMTP_USER: string;
  SMTP_PASSWORD: string;
  // Base64 AES-256 key (32 bytes) used to encrypt users' Anthropic API keys at
  // rest. Set via `wrangler secret put SETTINGS_KEY`; kept in .dev.vars locally.
  SETTINGS_KEY: string;
}
