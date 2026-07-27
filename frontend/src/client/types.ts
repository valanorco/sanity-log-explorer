export type Metric = 'count' | 'avg_response_time' | 'p95_response_time' | 'error_rate';

export interface IngestResponse {
  file_id: string;
  filename: string;
  status: string;
  rows_read: number;
  rows_loaded: number;
  rows_rejected: number;
}

export interface ImportSession {
  file_id: string;
  filename: string;
  status: string;
  rows_read: number;
  rows_loaded: number;
  rows_rejected: number;
  created_at: string;
  updated_at: string;
  transformed_at: string | null;
}

export interface ImportSessionListResponse {
  sessions: ImportSession[];
}

export interface ClearDataResponse {
  status: string;
  message: string;
  deleted_upload_files: number;
  deleted_staging_files: number;
}

export interface PartitionFilter {
  dates: string[];
  domains: string[];
  requests: string[];
  endpoints: string[];
}

export interface QueryRequest {
  file_id: string;
  metric?: Metric;
  group_by?: Array<'date' | 'domain' | 'request' | 'endpoint'>;
  partition_filter: PartitionFilter;
  limit: number;
}

export interface QueryResponse {
  data: Array<Record<string, string | number | null>>;
  metadata: Record<string, unknown>;
}

export interface SchemaResponse {
  file_id: string;
  dates: string[];
  domains: string[];
  requests: string[];
  endpoints: string[];
  row_count: number;
  status: string;
}
