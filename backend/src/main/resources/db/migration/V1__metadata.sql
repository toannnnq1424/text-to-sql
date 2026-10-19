CREATE TABLE warehouse (
 id varchar(100) PRIMARY KEY,
 document jsonb NOT NULL,
 credential_reference varchar(256) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE dataset (
 id varchar(100) PRIMARY KEY,
 warehouse_id varchar(100) NOT NULL REFERENCES warehouse(id),
 document jsonb NOT NULL,
 semantic_model jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE query_history (
 id varchar(100) PRIMARY KEY,
 warehouse_id varchar(100) NOT NULL REFERENCES warehouse(id),
 dataset_id varchar(100) NOT NULL REFERENCES dataset(id),
 document jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX query_history_created ON query_history(created_at DESC,id);
CREATE TABLE saved_result (id varchar(100) PRIMARY KEY,query_id varchar(100) NOT NULL REFERENCES query_history(id),owner varchar(255) NOT NULL,document jsonb NOT NULL);
CREATE TABLE operation_run (id varchar(100) PRIMARY KEY,kind varchar(30) NOT NULL,document jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE platform_settings (id integer PRIMARY KEY CHECK (id=1),document jsonb NOT NULL);
INSERT INTO platform_settings VALUES (1,'{"locale":"vi","timezone":"Asia/Ho_Chi_Minh","defaultQueryMode":"AUTO","limits":{"maxRows":1000,"maxBytes":5242880,"statementTimeoutMs":15000,"queryDeadlineMs":60000},"availableModes":["AUTO","API"],"providerConfigured":false,"modelDisplayName":null}');
CREATE TABLE audit_event (id bigserial PRIMARY KEY,actor varchar(255) NOT NULL,action varchar(80) NOT NULL,resource_id varchar(100),correlation_id varchar(100) NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE resource_access (subject varchar(255) NOT NULL,warehouse_id varchar(100) NOT NULL REFERENCES warehouse(id),PRIMARY KEY(subject,warehouse_id));
