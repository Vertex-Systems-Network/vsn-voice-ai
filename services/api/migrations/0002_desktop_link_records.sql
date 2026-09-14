BEGIN;

CREATE TABLE desktop_link_records (
  record_id text PRIMARY KEY,
  token_digest text NOT NULL,
  subject_id text NOT NULL,
  organization_id text NOT NULL,
  device_id text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL,
  consumed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT desktop_link_records_record_id_length
    CHECK (char_length(record_id) BETWEEN 1 AND 128),
  CONSTRAINT desktop_link_records_token_digest_sha256
    CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT desktop_link_records_subject_id_length
    CHECK (char_length(subject_id) BETWEEN 1 AND 128),
  CONSTRAINT desktop_link_records_organization_id_length
    CHECK (char_length(organization_id) BETWEEN 1 AND 128),
  CONSTRAINT desktop_link_records_device_id_length
    CHECK (char_length(device_id) BETWEEN 1 AND 256),
  CONSTRAINT desktop_link_records_expiry_order
    CHECK (expires_at > issued_at),
  CONSTRAINT desktop_link_records_status
    CHECK (status IN ('issued', 'consumed', 'revoked', 'expired')),
  CONSTRAINT desktop_link_records_consumed_state
    CHECK (
      (status = 'consumed' AND consumed_at IS NOT NULL)
      OR (status <> 'consumed' AND consumed_at IS NULL)
    )
);

CREATE INDEX desktop_link_records_subject_org_status_idx
  ON desktop_link_records (subject_id, organization_id, status);

CREATE INDEX desktop_link_records_expiry_idx
  ON desktop_link_records (expires_at)
  WHERE status = 'issued';

COMMIT;
