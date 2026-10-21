CREATE TABLE model_provider (
  id varchar(100) PRIMARY KEY,
  revision bigint NOT NULL CHECK (revision > 0),
  name varchar(120) NOT NULL,
  kind varchar(20) NOT NULL CHECK (kind IN ('ONLINE','OLLAMA')),
  base_url varchar(2048) NOT NULL,
  model varchar(200) NOT NULL,
  enabled boolean NOT NULL,
  encrypted_api_key text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE model_provider_default (
  id integer PRIMARY KEY CHECK (id=1),
  provider_id varchar(100) REFERENCES model_provider(id)
);
INSERT INTO model_provider_default(id,provider_id) VALUES(1,NULL);
