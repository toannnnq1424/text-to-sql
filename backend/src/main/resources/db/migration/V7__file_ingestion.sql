CREATE TABLE file_upload (
    id varchar(100) PRIMARY KEY,
    actor varchar(255) NOT NULL,
    document jsonb NOT NULL,
    digest varchar(64) NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX file_upload_expiry ON file_upload(expires_at);
CREATE TABLE file_ingestion_plan (
    id varchar(100) PRIMARY KEY,
    upload_id varchar(100) NOT NULL REFERENCES file_upload(id),
    actor varchar(255) NOT NULL,
    warehouse_id varchar(100) NOT NULL REFERENCES warehouse(id),
    document jsonb NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE file_ingestion_run (
    id varchar(100) PRIMARY KEY,
    upload_id varchar(100) NOT NULL REFERENCES file_upload(id),
    plan_id varchar(100) NOT NULL UNIQUE REFERENCES file_ingestion_plan(id),
    actor varchar(255) NOT NULL,
    warehouse_id varchar(100) NOT NULL REFERENCES warehouse(id),
    target_schema varchar(128) NOT NULL,
    target_table varchar(128) NOT NULL,
    idempotency_key varchar(100) NOT NULL,
    request_digest varchar(64) NOT NULL,
    document jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(actor,idempotency_key),
    UNIQUE(warehouse_id,target_schema,target_table)
);
CREATE INDEX file_ingestion_history ON file_ingestion_run(created_at DESC,id);
