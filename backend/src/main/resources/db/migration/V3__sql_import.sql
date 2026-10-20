ALTER TABLE warehouse ADD COLUMN import_credential_reference varchar(256);

CREATE TABLE sql_import_plan (
    plan_id varchar(100) PRIMARY KEY,
    actor varchar(255) NOT NULL,
    warehouse_id varchar(100) NOT NULL REFERENCES warehouse(id),
    digest varchar(64) NOT NULL,
    document jsonb NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sql_import_plan_expiry ON sql_import_plan(expires_at);

CREATE TABLE sql_import_run (
    run_id varchar(100) PRIMARY KEY,
    actor varchar(255) NOT NULL,
    warehouse_id varchar(100) NOT NULL REFERENCES warehouse(id),
    idempotency_key varchar(100) NOT NULL,
    request_digest varchar(64) NOT NULL,
    document jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(actor, idempotency_key)
);

CREATE INDEX sql_import_run_created ON sql_import_run(created_at DESC, run_id);
