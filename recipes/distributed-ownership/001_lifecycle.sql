CREATE TABLE IF NOT EXISTS agent_lifecycle_leases (
  lease_key text PRIMARY KEY,
  owner_id text NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_lifecycle_leases_expires_at_idx
  ON agent_lifecycle_leases (expires_at);

CREATE TABLE IF NOT EXISTS agent_lifecycle_cleanup (
  sandbox_name text PRIMARY KEY,
  lifecycle_key text NOT NULL,
  agent_id text NOT NULL,
  invocation_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  state text NOT NULL CHECK (state IN ('pending', 'deleted')),
  last_error text
);

CREATE INDEX IF NOT EXISTS agent_lifecycle_cleanup_pending_idx
  ON agent_lifecycle_cleanup (created_at)
  WHERE state = 'pending';
