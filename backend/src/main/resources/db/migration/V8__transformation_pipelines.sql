CREATE TABLE transformation_pipeline (
  id VARCHAR(100) PRIMARY KEY,
  source_warehouse_id VARCHAR(100) NOT NULL REFERENCES warehouse(id),
  target_warehouse_id VARCHAR(100) NOT NULL REFERENCES warehouse(id),
  document JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE transformation_request (
  actor VARCHAR(255) NOT NULL,
  pipeline_id VARCHAR(100) NOT NULL REFERENCES transformation_pipeline(id),
  request_key VARCHAR(200) NOT NULL,
  signature VARCHAR(64) NOT NULL,
  run_id VARCHAR(100) NOT NULL REFERENCES operation_run(id),
  PRIMARY KEY(actor, pipeline_id, request_key)
);
CREATE TABLE transformation_target_claim (
  warehouse_id VARCHAR(100) NOT NULL REFERENCES warehouse(id),
  target_schema VARCHAR(63) NOT NULL,
  target_table VARCHAR(63) NOT NULL,
  run_id VARCHAR(100) NOT NULL REFERENCES operation_run(id),
  PRIMARY KEY(warehouse_id,target_schema,target_table)
);
CREATE INDEX transformation_pipeline_updated ON transformation_pipeline(updated_at DESC);
