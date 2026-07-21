CREATE TABLE users (
  id uuid PRIMARY KEY,
  webauthn_user_id bytea NOT NULL UNIQUE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 64),
  status text NOT NULL CHECK (status IN ('pending', 'active', 'disabled', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE invitations (
  id uuid PRIMARY KEY,
  code_hash bytea NOT NULL UNIQUE,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE registration_intents (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_challenges (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('registration', 'authentication')),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  flow_token_hash bytea NOT NULL UNIQUE,
  challenge_hash bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_credentials (
  credential_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key bytea NOT NULL,
  counter bigint NOT NULL DEFAULT 0 CHECK (counter >= 0),
  transports text[] NOT NULL DEFAULT '{}',
  device_type text NOT NULL CHECK (device_type IN ('singleDevice', 'multiDevice')),
  backed_up boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX auth_credentials_user_active_idx
  ON auth_credentials (user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY,
  token_hash bytea NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assurance text NOT NULL CHECK (assurance = 'passkey'),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (idle_expires_at <= absolute_expires_at)
);

CREATE INDEX auth_sessions_user_active_idx
  ON auth_sessions (user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE consent_records (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL,
  text_version text NOT NULL,
  region text NOT NULL,
  granted_at timestamptz NOT NULL,
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  subject_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  result text NOT NULL CHECK (result IN ('success', 'failure')),
  reason text,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_subject_time_idx
  ON audit_events (subject_user_id, created_at DESC);

CREATE INDEX auth_challenges_expiry_idx ON auth_challenges (expires_at);
CREATE INDEX registration_intents_expiry_idx ON registration_intents (expires_at);
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions (absolute_expires_at);
