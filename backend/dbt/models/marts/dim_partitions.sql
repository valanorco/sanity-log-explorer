with base as (
  select * from {{ ref('fct_logs') }}
)

select distinct
  file_id,
  cast(partition_date as varchar) as partition_date,
  partition_domain,
  partition_request,
  partition_endpoint
from base
