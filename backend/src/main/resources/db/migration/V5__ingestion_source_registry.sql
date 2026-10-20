CREATE TABLE ingestion_source (
    source_id varchar(100) PRIMARY KEY,
    warehouse_id varchar(100) NOT NULL REFERENCES warehouse(id),
    dataset_id varchar(100) NOT NULL REFERENCES dataset(id),
    source_warehouse_id varchar(100) NOT NULL REFERENCES warehouse(id),
    source_dataset_id varchar(100) NOT NULL REFERENCES dataset(id),
    status varchar(16) NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
    document jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ingestion_source_target_idx
    ON ingestion_source (warehouse_id, dataset_id, updated_at DESC);

CREATE INDEX ingestion_source_source_idx
    ON ingestion_source (source_warehouse_id, source_dataset_id);
