select
  event_id,
  file_id,
  timestamp,
  request_url,
  request_method,
  request_label,
  request_size_bytes,
  response_size_bytes,
  response_status,
  response_time_ms,
  ip_address,
  partition_date,
  partition_domain,
  partition_request,
  partition_endpoint,
  _ingested_at
from {{ source('raw', 'raw_logs') }}
where ingest_error is null
