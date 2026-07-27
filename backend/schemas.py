from typing import Any, Literal
from pydantic import BaseModel, Field


class IngestResponse(BaseModel):
    file_id: str
    filename: str
    status: str
    rows_read: int
    rows_loaded: int
    rows_rejected: int


class ImportSession(BaseModel):
    file_id: str
    filename: str
    status: str
    rows_read: int
    rows_loaded: int
    rows_rejected: int
    created_at: str
    updated_at: str
    transformed_at: str | None = None


class ImportSessionListResponse(BaseModel):
    sessions: list[ImportSession]


class ClearDataResponse(BaseModel):
    status: str
    message: str
    deleted_upload_files: int
    deleted_staging_files: int


class TransformResponse(BaseModel):
    file_id: str
    status: str
    message: str


class PartitionFilter(BaseModel):
    dates: list[str] = Field(default_factory=list)
    domains: list[str] = Field(default_factory=list)
    requests: list[str] = Field(default_factory=list)
    endpoints: list[str] = Field(default_factory=list)


class QueryRequest(BaseModel):
    file_id: str
    metric: Literal["count", "avg_response_time", "p95_response_time", "error_rate"] = "count"
    group_by: list[Literal["date", "domain", "request", "endpoint"]] = Field(default_factory=lambda: ["date"])
    partition_filter: PartitionFilter = Field(default_factory=PartitionFilter)
    limit: int = 500


class QueryResponse(BaseModel):
    data: list[dict[str, Any]]
    metadata: dict[str, Any]


class SchemaResponse(BaseModel):
    file_id: str
    dates: list[str]
    domains: list[str]
    requests: list[str]
    endpoints: list[str]
    row_count: int
    status: str
