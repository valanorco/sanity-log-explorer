from __future__ import annotations

from pathlib import Path
import shutil
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile

from backend.config import STAGING_DIR, UPLOAD_DIR
from backend.db.connector import get_connection
from backend.processing.ingestion import parse_ndjson_chunks, write_staging_parquet
from backend.schemas import ClearDataResponse, ImportSession, ImportSessionListResponse, IngestResponse

router = APIRouter(prefix="/ingest", tags=["ingest"])


def _clear_directory(path: Path) -> int:
    if not path.exists():
        return 0

    deleted = 0
    for entry in path.iterdir():
        if entry.is_file() or entry.is_symlink():
            entry.unlink(missing_ok=True)
            deleted += 1
            continue

        if entry.is_dir():
            shutil.rmtree(entry, ignore_errors=True)
            deleted += 1

    return deleted


@router.get("/sessions", response_model=ImportSessionListResponse)
def list_sessions(limit: int = 100) -> ImportSessionListResponse:
    safe_limit = max(1, min(limit, 500))

    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT
              file_id,
              filename,
              status,
              rows_read,
              rows_loaded,
              rows_rejected,
              created_at,
              updated_at,
              transformed_at
            FROM ingestion_jobs
            ORDER BY created_at DESC
            LIMIT ?
            """,
            [safe_limit],
        ).fetchall()

    sessions = [
        ImportSession(
            file_id=str(row[0]),
            filename=str(row[1]),
            status=str(row[2]),
            rows_read=int(row[3] or 0),
            rows_loaded=int(row[4] or 0),
            rows_rejected=int(row[5] or 0),
            created_at=row[6].isoformat() if row[6] is not None else "",
            updated_at=row[7].isoformat() if row[7] is not None else "",
            transformed_at=row[8].isoformat() if row[8] is not None else None,
        )
        for row in rows
    ]

    return ImportSessionListResponse(sessions=sessions)


@router.delete("/data", response_model=ClearDataResponse)
def clear_data() -> ClearDataResponse:
    upload_dir = Path(UPLOAD_DIR)
    staging_dir = Path(STAGING_DIR)

    deleted_upload_files = _clear_directory(upload_dir)
    deleted_staging_files = _clear_directory(staging_dir)

    with get_connection() as conn:
        conn.execute("DELETE FROM raw_logs")
        conn.execute("DELETE FROM ingestion_jobs")

        # Best-effort cleanup of dbt-built tables/views if they exist and are writable.
        for table_name in ["fct_logs", "stg_logs", "int_logs_enriched", "dim_partitions"]:
            try:
                exists = conn.execute(
                    "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = ?",
                    [table_name],
                ).fetchone()[0]
                if exists:
                    conn.execute(f"DELETE FROM {table_name}")
            except Exception:
                continue

    return ClearDataResponse(
        status="cleared",
        message="All sessions, uploads, staging files, and log data were deleted.",
        deleted_upload_files=deleted_upload_files,
        deleted_staging_files=deleted_staging_files,
    )


@router.post("", response_model=IngestResponse)
async def ingest(file: UploadFile = File(...)) -> IngestResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="filename is required")

    file_id = uuid4().hex[:12]
    upload_name = f"{file_id}_{file.filename}"
    upload_path = Path(UPLOAD_DIR) / upload_name
    upload_path.parent.mkdir(parents=True, exist_ok=True)

    with upload_path.open("wb") as output:
        output.write(await file.read())

    rows_read = 0
    rows_loaded = 0
    rows_rejected = 0

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO ingestion_jobs (file_id, filename, status)
            VALUES (?, ?, ?)
            """,
            [file_id, file.filename, "parsing"],
        )

        for idx, (chunk_df, chunk_rejected) in enumerate(parse_ndjson_chunks(str(upload_path))):
            rows_read += len(chunk_df) + chunk_rejected
            rows_loaded += len(chunk_df)
            rows_rejected += chunk_rejected

            parquet_path = write_staging_parquet(chunk_df, file_id, idx)
            conn.execute(
                f"""
                                INSERT INTO raw_logs (
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
                                    ingest_error,
                                    _ingested_at
                                )
                SELECT
                  event_id,
                  '{file_id}' AS file_id,
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
                  ingest_error,
                  now() AS _ingested_at
                FROM read_parquet('{parquet_path}')
                """
            )

        conn.execute(
            """
            UPDATE ingestion_jobs
            SET status = ?, rows_read = ?, rows_loaded = ?, rows_rejected = ?, updated_at = now()
            WHERE file_id = ?
            """,
            ["transform_pending", rows_read, rows_loaded, rows_rejected, file_id],
        )

    return IngestResponse(
        file_id=file_id,
        filename=file.filename,
        status="transform_pending",
        rows_read=rows_read,
        rows_loaded=rows_loaded,
        rows_rejected=rows_rejected,
    )
