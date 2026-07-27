from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException

from backend.db.connector import get_connection
from backend.schemas import QueryRequest, QueryResponse

router = APIRouter(prefix="/query", tags=["query"])


def _in_clause(values: list[str], col: str, where: list[str], params: list[str]) -> None:
    if values:
        where.append(f"{col} IN ({','.join(['?' for _ in values])})")
        params.extend(values)


HTTP_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "CONNECT"}


def _request_clause(values: list[str], where: list[str], params: list[str]) -> None:
    if not values:
        return

    method_values = [value for value in values if value.upper() in HTTP_METHODS]
    request_values = [value for value in values if value.upper() not in HTTP_METHODS]
    clauses: list[str] = []

    if request_values:
        clauses.append(f"partition_request IN ({','.join(['?' for _ in request_values])})")
        params.extend(request_values)

    if method_values:
        clauses.append(f"request_method IN ({','.join(['?' for _ in method_values])})")
        params.extend(method_values)

    if clauses:
        where.append(f"({' OR '.join(clauses)})")


@router.post("", response_model=QueryResponse)
def query_logs(payload: QueryRequest) -> QueryResponse:
    with get_connection() as conn:
        job = conn.execute(
            "SELECT status FROM ingestion_jobs WHERE file_id = ?",
            [payload.file_id],
        ).fetchone()
        if not job:
            raise HTTPException(status_code=404, detail="file_id not found")
        if str(job[0]) != "ready":
            raise HTTPException(status_code=409, detail="file is not transformed yet")

        where_clauses = ["file_id = ?"]
        params: list[str] = [payload.file_id]

        _in_clause(payload.partition_filter.dates, "CAST(partition_date AS VARCHAR)", where_clauses, params)
        _in_clause(payload.partition_filter.domains, "partition_domain", where_clauses, params)
        _request_clause(payload.partition_filter.requests, where_clauses, params)
        _in_clause(payload.partition_filter.endpoints, "partition_endpoint", where_clauses, params)

        fct_columns = {str(row[0]) for row in conn.execute("DESCRIBE fct_logs").fetchall()}
        has_payload_size_columns = {
            "request_size_bytes",
            "response_size_bytes",
        }.issubset(fct_columns)
        has_ip_address_column = "ip_address" in fct_columns

        request_size_expr = "request_size_bytes" if has_payload_size_columns else "NULL"
        response_size_expr = "response_size_bytes" if has_payload_size_columns else "NULL"
        ip_address_expr = "ip_address" if has_ip_address_column else "NULL"

        query = f"""
          SELECT
            event_id,
            timestamp,
            partition_date,
            partition_domain,
            partition_request,
            partition_endpoint,
            request_method,
            request_label,
            response_status,
            response_time_ms,
            {request_size_expr} AS request_size_bytes,
                        {response_size_expr} AS response_size_bytes,
            {ip_address_expr} AS ip_address
          FROM fct_logs
          WHERE {' AND '.join(where_clauses)}
          ORDER BY timestamp DESC
          LIMIT {payload.limit}
        """

        start = time.perf_counter()
        rows = conn.execute(query, params).fetchall()
        elapsed_ms = round((time.perf_counter() - start) * 1000, 2)

        columns = [
            "event_id",
            "timestamp",
            "partition_date",
            "partition_domain",
            "partition_request",
            "partition_endpoint",
            "request_method",
            "request_label",
            "response_status",
            "response_time_ms",
            "request_size_bytes",
            "response_size_bytes",
            "ip_address",
        ]
        data = [dict(zip(columns, row, strict=True)) for row in rows]

        return QueryResponse(
            data=data,
            metadata={
                "query_time_ms": elapsed_ms,
                "rows_returned": len(data),
                "mode": "rows",
            },
        )
