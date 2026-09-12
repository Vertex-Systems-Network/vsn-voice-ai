BEGIN;

CREATE TABLE organization_memberships (
  membership_id text PRIMARY KEY,
  subject_id text NOT NULL,
  organization_id text NOT NULL,
  status text NOT NULL,
  roles text[] NOT NULL,
  permissions text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_memberships_membership_id_length
    CHECK (char_length(membership_id) BETWEEN 1 AND 128),
  CONSTRAINT organization_memberships_subject_id_length
    CHECK (char_length(subject_id) BETWEEN 1 AND 128),
  CONSTRAINT organization_memberships_organization_id_length
    CHECK (char_length(organization_id) BETWEEN 1 AND 128),
  CONSTRAINT organization_memberships_status
    CHECK (status IN ('active', 'invited', 'suspended')),
  CONSTRAINT organization_memberships_roles_count
    CHECK (cardinality(roles) BETWEEN 1 AND 32),
  CONSTRAINT organization_memberships_permissions_count
    CHECK (cardinality(permissions) BETWEEN 0 AND 256),
  CONSTRAINT organization_memberships_roles_no_nulls
    CHECK (array_position(roles, NULL) IS NULL),
  CONSTRAINT organization_memberships_permissions_no_nulls
    CHECK (array_position(permissions, NULL) IS NULL),
  CONSTRAINT organization_memberships_subject_org_unique
    UNIQUE (organization_id, subject_id)
);

COMMIT;
