from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.db.connector import get_connection
from backend.schemas import SchemaResponse

router = APIRouter(prefix="/schema", tags=["schema"])


def _distinct_values(conn, file_id: str, col: str) -> list[str]:
    query = f"SELECT DISTINCT {col} AS v FROM fct_logs WHERE file_id = ? AND {col} IS NOT NULL ORDER BY 1"
    rows = conn.execute(query, [file_id]).fetchall()
    return [str(r[0]) for r in rows]


@router.get("/{file_id}", response_model=SchemaResponse)
def get_schema(file_id: str) -> SchemaResponse:
    with get_connection() as conn:
        job = conn.execute(
            "SELECT status FROM ingestion_jobs WHERE file_id = ?",
            [file_id],
        ).fetchone()
        if not job:
            raise HTTPException(status_code=404, detail="file_id not found")

        status = str(job[0])
        if status != "ready":
            return SchemaResponse(
                file_id=file_id,
                dates=[],
                domains=[],
                requests=[],
                endpoints=[],
                row_count=0,
                status=status,
            )

        row_count = conn.execute("SELECT COUNT(*) FROM fct_logs WHERE file_id = ?", [file_id]).fetchone()[0]

        return SchemaResponse(
            file_id=file_id,
            dates=_distinct_values(conn, file_id, "partition_date"),
            domains=_distinct_values(conn, file_id, "partition_domain"),
            requests=_distinct_values(conn, file_id, "partition_request"),
            endpoints=_distinct_values(conn, file_id, "partition_endpoint"),
            row_count=int(row_count),
            status=status,
        )
