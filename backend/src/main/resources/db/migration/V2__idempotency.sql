CREATE TABLE ingestion_request (
 request_key varchar(100) NOT NULL,
 actor varchar(255) NOT NULL,
 signature varchar(500) NOT NULL,
 run_id varchar(100) NOT NULL,
 PRIMARY KEY(actor,request_key)
);
