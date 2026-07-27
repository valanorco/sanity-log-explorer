from __future__ import annotations

import logging
import subprocess

from fastapi import APIRouter, HTTPException

from backend.config import DBT_PROFILES_DIR, DBT_PROJECT_DIR
from backend.db.connector import get_connection
from backend.schemas import TransformResponse

router = APIRouter(prefix="/transform", tags=["transform"])
logger = logging.getLogger(__name__)


@router.post("/{file_id}", response_model=TransformResponse)
def run_transform(file_id: str) -> TransformResponse:
    with get_connection() as conn:
        exists = conn.execute(
            "SELECT COUNT(*) FROM ingestion_jobs WHERE file_id = ?",
            [file_id],
        ).fetchone()[0]
        if exists == 0:
            raise HTTPException(status_code=404, detail="file_id not found")

        conn.execute(
            "UPDATE ingestion_jobs SET status = ?, updated_at = now() WHERE file_id = ?",
            ["transforming", file_id],
        )

    result = subprocess.run(
        [
            "dbt",
            "run",
            "--project-dir",
            DBT_PROJECT_DIR,
            "--profiles-dir",
            DBT_PROFILES_DIR,
        ],
        capture_output=True,
        text=True,
    )

    status = "ready" if result.returncode == 0 else "failed"
    with get_connection() as conn:
        conn.execute(
            """
            UPDATE ingestion_jobs
            SET status = ?, updated_at = now(), transformed_at = CASE WHEN ? = 'ready' THEN now() ELSE transformed_at END
            WHERE file_id = ?
            """,
            [status, status, file_id],
        )

    if result.returncode != 0:
        logger.error(
            "dbt transform failed for file_id=%s stdout_tail=%s stderr_tail=%s",
            file_id,
            result.stdout[-4000:],
            result.stderr[-4000:],
        )
        raise HTTPException(
            status_code=500,
            detail={
                "status": status,
                "message": "Transform failed. Check backend logs for details.",
            },
        )

    if result.stderr.strip():
        logger.warning("dbt transform completed with stderr output for file_id=%s stderr_tail=%s", file_id, result.stderr[-4000:])

    return TransformResponse(
        file_id=file_id,
        status=status,
        message="Transform completed successfully.",
    )
