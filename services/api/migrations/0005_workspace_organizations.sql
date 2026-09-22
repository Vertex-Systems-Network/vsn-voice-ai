BEGIN;

CREATE TABLE workspace_organizations (
  organization_id text PRIMARY KEY,
  display_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_organizations_organization_id
    CHECK (
      char_length(organization_id) BETWEEN 1 AND 128
      AND btrim(organization_id) = organization_id
    ),
  CONSTRAINT workspace_organizations_display_name
    CHECK (
      char_length(display_name) <= 100
      AND btrim(display_name) = display_name
      AND display_name !~ '[[:cntrl:]]'
    )
);

COMMIT;
