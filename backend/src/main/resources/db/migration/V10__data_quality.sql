CREATE TABLE data_quality_rules (
  dataset_id varchar(100) PRIMARY KEY REFERENCES dataset(id),
  revision bigint NOT NULL CHECK (revision >= 0),
  rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quality_run_dataset_created ON operation_run ((document->>'datasetId'), created_at DESC)
  WHERE kind='DATA_QUALITY';
