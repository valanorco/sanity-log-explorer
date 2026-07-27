CREATE TABLE IF NOT EXISTS raw_logs (
  event_id VARCHAR,
  file_id VARCHAR,
  timestamp TIMESTAMP,
  request_url VARCHAR,
  request_method VARCHAR,
  request_label VARCHAR,
  request_size_bytes BIGINT,
  response_size_bytes BIGINT,
  response_status INTEGER,
  response_time_ms DOUBLE,
  ip_address VARCHAR,
  partition_date DATE,
  partition_domain VARCHAR,
  partition_request VARCHAR,
  partition_endpoint VARCHAR,
  ingest_error VARCHAR,
  _ingested_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  file_id VARCHAR PRIMARY KEY,
  filename VARCHAR,
  status VARCHAR,
  rows_read BIGINT DEFAULT 0,
  rows_loaded BIGINT DEFAULT 0,
  rows_rejected BIGINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  transformed_at TIMESTAMP
);

ALTER TABLE raw_logs ADD COLUMN IF NOT EXISTS request_size_bytes BIGINT;
ALTER TABLE raw_logs ADD COLUMN IF NOT EXISTS response_size_bytes BIGINT;
ALTER TABLE raw_logs ADD COLUMN IF NOT EXISTS ip_address VARCHAR;
