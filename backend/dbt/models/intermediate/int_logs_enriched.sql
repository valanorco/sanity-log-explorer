select
  *,
  case
    when response_status >= 500 then 'error'
    when response_status >= 400 then 'client_error'
    when response_status >= 300 then 'redirect'
    else 'success'
  end as response_bucket,
  date_trunc('hour', timestamp) as hour_bucket
from {{ ref('stg_logs') }}
