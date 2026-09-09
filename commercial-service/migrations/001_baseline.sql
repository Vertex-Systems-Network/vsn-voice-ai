CREATE TABLE IF NOT EXISTS marketplace_deliveries (
  delivery_id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  action TEXT,
  github_account_id BIGINT,
  payload_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  attempts INTEGER NOT NULL DEFAULT 0,
  processing_started_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  result TEXT,
  error TEXT
);
ALTER TABLE marketplace_deliveries ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE marketplace_deliveries ADD COLUMN IF NOT EXISTS attempts INTEGER;
ALTER TABLE marketplace_deliveries ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;
UPDATE marketplace_deliveries SET status=CASE WHEN result='error' THEN 'error' WHEN processed_at IS NOT NULL THEN 'completed' ELSE 'received' END WHERE status IS NULL;
UPDATE marketplace_deliveries SET attempts=1 WHERE attempts IS NULL;
ALTER TABLE marketplace_deliveries ALTER COLUMN status SET DEFAULT 'received';
ALTER TABLE marketplace_deliveries ALTER COLUMN status SET NOT NULL;
ALTER TABLE marketplace_deliveries ALTER COLUMN attempts SET DEFAULT 0;
ALTER TABLE marketplace_deliveries ALTER COLUMN attempts SET NOT NULL;

CREATE TABLE IF NOT EXISTS entitlements (
  github_account_id BIGINT PRIMARY KEY,
  github_login TEXT NOT NULL,
  github_account_type TEXT NOT NULL,
  license_id UUID NOT NULL,
  plan_id TEXT NOT NULL,
  marketplace_plan_id BIGINT,
  seats INTEGER,
  state TEXT NOT NULL,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  billing_cycle TEXT,
  issued_at TIMESTAMPTZ NOT NULL,
  not_before TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  billing_updated_at TIMESTAMPTZ,
  signed_envelope JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS provisioning_requests (
  idempotency_key TEXT PRIMARY KEY,
  github_account_id BIGINT NOT NULL,
  target_github_user_id BIGINT,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
ALTER TABLE provisioning_requests ADD COLUMN IF NOT EXISTS target_github_user_id BIGINT;

CREATE TABLE IF NOT EXISTS organization_seat_assignments (
  github_account_id BIGINT NOT NULL,
  github_user_id BIGINT NOT NULL,
  github_login TEXT NOT NULL,
  status TEXT NOT NULL,
  assigned_by_user_id BIGINT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (github_account_id, github_user_id)
);
CREATE INDEX IF NOT EXISTS organization_seats_active_idx
  ON organization_seat_assignments(github_account_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS template_access_grants (
  source_account_id BIGINT NOT NULL,
  github_user_id BIGINT NOT NULL,
  github_login TEXT NOT NULL,
  status TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_account_id, github_user_id)
);
CREATE INDEX IF NOT EXISTS template_access_grants_user_idx
  ON template_access_grants(github_user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS access_reconciliation_jobs (
  github_user_id BIGINT PRIMARY KEY,
  github_login TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS access_reconciliation_pending_idx
  ON access_reconciliation_jobs(status, available_at);

CREATE TABLE IF NOT EXISTS rate_limit_windows (
  scope TEXT NOT NULL,
  subject TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope, subject, window_start)
);
CREATE INDEX IF NOT EXISTS rate_limit_windows_cleanup_idx ON rate_limit_windows(updated_at);

CREATE TABLE IF NOT EXISTS commercial_audit_log (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  github_account_id BIGINT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS commercial_audit_account_idx ON commercial_audit_log(github_account_id, created_at DESC);
