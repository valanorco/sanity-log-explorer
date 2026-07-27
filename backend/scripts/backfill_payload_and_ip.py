from __future__ import annotations

import json
from datetime import datetime
from hashlib import md5
from pathlib import Path
from typing import Any

import duckdb


DB_PATH = Path("/home/aleksbasara/projects/sanity-log-explorer/data/duckdb.db")
UPLOAD_DIR = Path("/home/aleksbasara/projects/sanity-log-explorer/data/uploads")


def _first_value(payload: dict[str, Any], keys: list[str], default: Any = None) -> Any:
    for key in keys:
        if key in payload and payload[key] is not None:
            return payload[key]
    return default


def _nested_value(payload: dict[str, Any], path: str) -> Any:
    current: Any = payload
    for key in path.split("."):
        if not isinstance(current, dict) or key not in current:
            return None
        current = current[key]
    return current


def _first_nested_value(payload: dict[str, Any], paths: list[str], default: Any = None) -> Any:
    for path in paths:
        value = _nested_value(payload, path)
        if value is not None:
            return value
    return default


def _to_timestamp(raw_value: Any) -> datetime | None:
    if raw_value is None:
        return None
    if isinstance(raw_value, datetime):
        return raw_value
    if isinstance(raw_value, (int, float)):
        return datetime.fromtimestamp(raw_value)
    if isinstance(raw_value, str):
        try:
            return datetime.fromisoformat(raw_value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _event_id_from_payload(payload: dict[str, Any]) -> str:
    timestamp = _to_timestamp(_first_value(payload, ["timestamp", "@timestamp", "time"]))

    request_url = _first_value(payload, ["request_url", "url", "path"], None)
    if request_url is None:
        request_url = _first_nested_value(payload, ["body.url", "attributes.http.url"], "")

    request_method = _first_value(payload, ["request_method", "method", "http_method"], None)
    if request_method is None:
        request_method = _first_nested_value(payload, ["body.method", "attributes.http.method"], "UNKNOWN")

    response_status = _first_value(payload, ["response_status", "status", "status_code"], None)
    if response_status is None:
        response_status = _first_nested_value(payload, ["body.status", "attributes.http.status_code"], None)

    response_time = _first_value(payload, ["response_time_ms", "latency_ms", "duration_ms"], None)
    if response_time is None:
        response_time = _first_nested_value(payload, ["body.duration", "attributes.http.duration_ms"], None)

    event_hash_source = (
        f"{timestamp}|{request_url}|{str(request_method).upper() if request_method else 'UNKNOWN'}|"
        f"{int(response_status) if response_status is not None else None}|"
        f"{float(response_time) if response_time is not None else None}"
    )
    return md5(event_hash_source.encode("utf-8")).hexdigest()


def _extract_request_size(payload: dict[str, Any]) -> int | None:
    request_size = _first_value(payload, ["request_size", "requestSize"], None)
    if request_size is None:
        request_size = _first_nested_value(
            payload,
            ["body.requestSize", "attributes.http.request_size", "attributes.http.requestSize"],
            None,
        )
    return int(request_size) if request_size is not None else None


def _extract_response_size(payload: dict[str, Any]) -> int | None:
    response_size = _first_value(payload, ["response_size", "responseSize"], None)
    if response_size is None:
        response_size = _first_nested_value(
            payload,
            ["body.responseSize", "attributes.http.response_size", "attributes.http.responseSize"],
            None,
        )
    return int(response_size) if response_size is not None else None


def _extract_ip(payload: dict[str, Any]) -> str | None:
    ip_address = _first_value(payload, ["ip", "ip_address", "remote_ip", "client_ip"], None)
    if ip_address is None:
        ip_address = _first_nested_value(
            payload,
            [
                "body.ip",
                "attributes.network.client.ip",
                "attributes.http.client_ip",
                "attributes.client.ip",
            ],
            None,
        )
    return str(ip_address) if ip_address is not None else None


def main() -> None:
    if not DB_PATH.exists():
        raise SystemExit(f"DuckDB file not found: {DB_PATH}")

    conn = duckdb.connect(str(DB_PATH))
    files = conn.execute(
        """
        SELECT file_id, filename
        FROM ingestion_jobs
        WHERE file_id IN (
          SELECT DISTINCT file_id
          FROM raw_logs
          WHERE request_size_bytes IS NULL
             OR response_size_bytes IS NULL
             OR ip_address IS NULL
        )
        ORDER BY updated_at DESC
        """
    ).fetchall()

    if not files:
        print("No files need backfill.")
        return

    for file_id, filename in files:
        upload_path = UPLOAD_DIR / f"{file_id}_{filename}"
        if not upload_path.exists():
            print(f"Skipping {file_id}: missing upload file {upload_path}")
            continue

        updates: list[tuple[int | None, int | None, str | None, str, str]] = []
        with upload_path.open("r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    continue

                updates.append(
                    (
                        _extract_request_size(payload),
                        _extract_response_size(payload),
                        _extract_ip(payload),
                        file_id,
                        _event_id_from_payload(payload),
                    )
                )

        conn.executemany(
            """
            UPDATE raw_logs
            SET
              request_size_bytes = COALESCE(request_size_bytes, ?),
              response_size_bytes = COALESCE(response_size_bytes, ?),
              ip_address = COALESCE(ip_address, ?)
            WHERE file_id = ? AND event_id = ?
            """,
            updates,
        )

        counts = conn.execute(
            """
            SELECT
              COUNT(request_size_bytes) AS req_count,
              COUNT(response_size_bytes) AS res_count,
              COUNT(ip_address) AS ip_count
            FROM raw_logs
            WHERE file_id = ?
            """,
            [file_id],
        ).fetchone()

        print(f"{file_id}: request_size={counts[0]}, response_size={counts[1]}, ip={counts[2]}")

    print("Backfill complete.")


if __name__ == "__main__":
    main()