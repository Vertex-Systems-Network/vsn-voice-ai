BEGIN;

CREATE TABLE workspace_profiles (
  organization_id text NOT NULL,
  subject_id text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  job_title text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, subject_id),
  CONSTRAINT workspace_profiles_organization_id_length
    CHECK (
      char_length(organization_id) BETWEEN 1 AND 128
      AND btrim(organization_id) = organization_id
    ),
  CONSTRAINT workspace_profiles_subject_id_length
    CHECK (
      char_length(subject_id) BETWEEN 1 AND 128
      AND btrim(subject_id) = subject_id
    ),
  CONSTRAINT workspace_profiles_display_name
    CHECK (
      char_length(display_name) <= 80
      AND btrim(display_name) = display_name
      AND display_name !~ '[[:cntrl:]]'
    ),
  CONSTRAINT workspace_profiles_job_title
    CHECK (
      char_length(job_title) <= 120
      AND btrim(job_title) = job_title
      AND job_title !~ '[[:cntrl:]]'
    )
);

COMMIT;
