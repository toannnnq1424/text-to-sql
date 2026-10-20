ALTER TABLE audit_event
ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb;
