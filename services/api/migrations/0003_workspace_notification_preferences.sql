BEGIN;

CREATE TABLE workspace_notification_preferences (
  organization_id text NOT NULL,
  subject_id text NOT NULL,
  meeting_reminders boolean NOT NULL DEFAULT true,
  transcript_ready boolean NOT NULL DEFAULT true,
  action_items boolean NOT NULL DEFAULT true,
  desktop_link_events boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, subject_id),
  CONSTRAINT workspace_notification_preferences_organization_id_length
    CHECK (
      char_length(organization_id) BETWEEN 1 AND 128
      AND btrim(organization_id) = organization_id
    ),
  CONSTRAINT workspace_notification_preferences_subject_id_length
    CHECK (
      char_length(subject_id) BETWEEN 1 AND 128
      AND btrim(subject_id) = subject_id
    )
);

COMMIT;
