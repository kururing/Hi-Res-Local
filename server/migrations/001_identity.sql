CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT users_email_normalized_unique UNIQUE (email_normalized),
  CONSTRAINT users_email_length CHECK (char_length(email) BETWEEN 3 AND 254),
  CONSTRAINT users_password_hash_present CHECK (char_length(password_hash) >= 20)
);

CREATE TABLE user_profiles (
  user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT user_profiles_display_name_length CHECK (char_length(display_name) BETWEEN 1 AND 64)
);

CREATE TABLE refresh_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id UUID NOT NULL,
  parent_session_id UUID REFERENCES refresh_sessions (id) ON DELETE SET NULL,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  reuse_detected_at TIMESTAMPTZ,
  user_agent TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT refresh_sessions_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT refresh_sessions_token_hash_present CHECK (char_length(token_hash) = 64),
  CONSTRAINT refresh_sessions_user_agent_length CHECK (user_agent IS NULL OR char_length(user_agent) <= 512),
  CONSTRAINT refresh_sessions_ip_length CHECK (ip_address IS NULL OR char_length(ip_address) <= 64)
);

CREATE INDEX idx_refresh_sessions_user_id ON refresh_sessions (user_id);
CREATE INDEX idx_refresh_sessions_family_id ON refresh_sessions (family_id);
CREATE INDEX idx_refresh_sessions_expires_at ON refresh_sessions (expires_at);
