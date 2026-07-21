ALTER TABLE invitations
  ADD COLUMN issued_by text NOT NULL DEFAULT 'system'
    CHECK (char_length(issued_by) BETWEEN 1 AND 80);

ALTER TABLE auth_credentials
  ADD COLUMN label text NOT NULL DEFAULT 'Primary Passkey'
    CHECK (char_length(label) BETWEEN 1 AND 64);

ALTER TABLE auth_challenges
  DROP CONSTRAINT auth_challenges_kind_check;

ALTER TABLE auth_challenges
  ADD COLUMN scope text,
  ADD CONSTRAINT auth_challenges_kind_check
    CHECK (kind IN (
      'registration',
      'authentication',
      'credential_addition',
      'security_confirmation'
    )),
  ADD CONSTRAINT auth_challenges_scope_check
    CHECK (
      (kind = 'security_confirmation' AND scope IN (
        'credential_add',
        'credential_revoke',
        'account_delete'
      )) OR
      (kind <> 'security_confirmation' AND scope IS NULL)
    );

CREATE TABLE security_confirmations (
  id uuid PRIMARY KEY,
  token_hash bytea NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN (
    'credential_add',
    'credential_revoke',
    'account_delete'
  )),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX security_confirmations_user_expiry_idx
  ON security_confirmations (user_id, expires_at);
