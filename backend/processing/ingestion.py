from __future__ import annotations

from datetime import datetime
from hashlib import md5
import json
from pathlib import Path
from typing import Any, Generator

import pandas as pd

from backend.config import MAX_ROWS_PER_CHUNK, STAGING_DIR
from backend.processing.partitioner import extract_domain, extract_endpoint, normalize_request_label


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
            normalized = raw_value.replace("Z", "+00:00")
            return datetime.fromisoformat(normalized)
        except ValueError:
            return None
    return None


def parse_ndjson_chunks(file_path: str, chunk_size: int = MAX_ROWS_PER_CHUNK) -> Generator[tuple[pd.DataFrame, int], None, None]:
    rows: list[dict[str, Any]] = []
    rejected = 0

    with open(file_path, "r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue

            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                rejected += 1
                continue

            timestamp = _to_timestamp(_first_value(payload, ["timestamp", "@timestamp", "time"]))
            request_url = _first_value(payload, ["request_url", "url", "path"], None)
            if request_url is None:
                request_url = _first_nested_value(payload, ["body.url", "attributes.http.url"], "")

            request_method = _first_value(payload, ["request_method", "method", "http_method"], None)
            if request_method is None:
                request_method = _first_nested_value(payload, ["body.method", "attributes.http.method"], "UNKNOWN")

            request_label = _first_value(payload, ["request", "request_name", "route"], None)
            if request_label is None:
                request_label = _first_nested_value(
                    payload,
                    ["attributes.sanity.endpoint", "attributes.sanity.type", "body.path"],
                    None,
                )

            response_status = _first_value(payload, ["response_status", "status", "status_code"], None)
            if response_status is None:
                response_status = _first_nested_value(payload, ["body.status", "attributes.http.status_code"], None)

            request_size = _first_value(payload, ["request_size", "requestSize"], None)
            if request_size is None:
                request_size = _first_nested_value(
                    payload,
                    ["body.requestSize", "attributes.http.request_size", "attributes.http.requestSize"],
                    None,
                )

            response_size = _first_value(payload, ["response_size", "responseSize"], None)
            if response_size is None:
                response_size = _first_nested_value(
                    payload,
                    ["body.responseSize", "attributes.http.response_size", "attributes.http.responseSize"],
                    None,
                )

            response_time = _first_value(payload, ["response_time_ms", "latency_ms", "duration_ms"], None)
            if response_time is None:
                response_time = _first_nested_value(payload, ["body.duration", "attributes.http.duration_ms"], None)

            ip_address = _first_value(payload, ["ip", "ip_address", "remote_ip", "remoteIp", "client_ip"], None)
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

            partition_domain = extract_domain(request_url)
            partition_endpoint = extract_endpoint(request_url)
            partition_request = normalize_request_label(str(request_method), request_label)
            partition_date = timestamp.date() if timestamp else None

            event_hash_source = f"{timestamp}|{request_url}|{request_method}|{response_status}|{response_time}"
            event_id = md5(event_hash_source.encode("utf-8")).hexdigest()

            rows.append(
                {
                    "event_id": event_id,
                    "timestamp": timestamp,
                    "request_url": request_url,
                    "request_method": str(request_method).upper() if request_method else "UNKNOWN",
                    "request_label": partition_request,
                    "request_size_bytes": int(request_size) if request_size is not None else None,
                    "response_size_bytes": int(response_size) if response_size is not None else None,
                    "response_status": int(response_status) if response_status is not None else None,
                    "response_time_ms": float(response_time) if response_time is not None else None,
                    "ip_address": str(ip_address) if ip_address is not None else None,
                    "partition_date": partition_date,
                    "partition_domain": partition_domain,
                    "partition_request": partition_request,
                    "partition_endpoint": partition_endpoint,
                    "ingest_error": None,
                }
            )

            if len(rows) >= chunk_size:
                yield pd.DataFrame(rows), rejected
                rows = []
                rejected = 0

    if rows:
        yield pd.DataFrame(rows), rejected


def write_staging_parquet(df: pd.DataFrame, file_id: str, chunk_number: int) -> str:
    Path(STAGING_DIR).mkdir(parents=True, exist_ok=True)
    parquet_path = str(Path(STAGING_DIR) / f"{file_id}_chunk_{chunk_number}.parquet")
    df.to_parquet(parquet_path, index=False)
    return parquet_path
