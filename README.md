# Sanity Log Explorer

[![Release Workflow](https://github.com/valanorco/sanity-log-explorer/actions/workflows/release.yml/badge.svg)](https://github.com/valanorco/sanity-log-explorer/actions/workflows/release.yml)
[![Latest Release](https://img.shields.io/github/v/release/valanorco/sanity-log-explorer)](https://github.com/valanorco/sanity-log-explorer/releases)
[![Python](https://img.shields.io/badge/python-3.12%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Node](https://img.shields.io/badge/node-22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/docker-compose-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)

Sanity Log Explorer is a local-first tool for analyzing large NDJSON API logs.

Built with:
1. FastAPI
2. DuckDB
3. dbt
4. Astro + React + Vega-Lite

Project by Valanor: [https://valanor.co](https://valanor.co)

## Features

1. Upload and ingest large NDJSON log files
2. Transform ingested data with dbt
3. Filter and query by date, domain, request, and endpoint
4. Table view with sorting and pagination
5. Anomaly detection (IQR, EWMA, CUSUM)
6. Traffic chart showing request count and response size
7. Session history and full data reset

## Repository layout

1. `backend/`: FastAPI API, ingestion logic, dbt project
2. `frontend/`: Astro/React app
3. `data/`: local runtime data (`duckdb.db`, uploads, staging)
4. `.github/workflows/`: CI and release workflows

## Quick start

1. Create local env file:

```bash
cp .env.example .env
```

2. Start the stack:

```bash
docker compose up -d --build
```

3. Open:
1. Frontend: http://localhost:4321
2. Backend health: http://localhost:8000/health

## Usage

1. Upload an NDJSON file
2. Run transform for the uploaded file
3. Apply filters and run query
4. Analyze anomalies and adjust controls/presets

## Supported log fields

The parser accepts common aliases.

1. Timestamp: `timestamp`, `@timestamp`, `time`
2. URL: `request_url`, `url`, `path`
3. Method: `request_method`, `method`, `http_method`
4. Request label: `request`, `request_name`, `route`
5. Status: `response_status`, `status`, `status_code`
6. Latency: `response_time_ms`, `latency_ms`, `duration_ms`
7. Request size: `request_size`, `requestSize`
8. Response size: `response_size`, `responseSize`
9. IP: `ip`, `ip_address`, `remote_ip`, `remoteIp`, `client_ip`

Example:

```json
{"timestamp":"2026-07-26T12:00:00Z","request_url":"https://api.example.com/v1/items","request_method":"GET","request":"GET /v1/items","response_status":200,"response_time_ms":82.4,"response_size":2048}
```

## API

1. `POST /ingest`
2. `GET /ingest/sessions`
3. `DELETE /ingest/data`
4. `POST /transform/{file_id}`
5. `GET /schema/{file_id}`
6. `POST /query`
7. `GET /health`

## Quality and release

1. Commit message lint: [commitlint workflow](.github/workflows/commitlint.yml)
2. Semantic release automation: [release workflow](.github/workflows/release.yml)
3. Engineering standards: [PROJECT_STANDARDS.md](PROJECT_STANDARDS.md)

## Dependency audit

Run backend audit:

```bash
make audit-backend
```

## Troubleshooting

### UI unavailable

1. Check container status: `docker compose ps`
2. Check frontend logs: `docker compose logs frontend`
3. Confirm port `4321` is free on host
4. Open backend health URL and verify it responds: `http://localhost:8000/health`

### Upload or ingest fails

1. Verify backend is reachable: `curl http://localhost:8000/health`
2. Check backend logs for ingest errors: `docker compose logs backend`
3. Confirm file is NDJSON/JSONL with one JSON object per line
4. Run clear data in the UI and retry upload

### Transform failure

1. Confirm backend health endpoint responds
2. Check dbt/transform output in backend logs: `docker compose logs backend`
3. Re-run Transform for the same session from the UI
4. If needed, clear data and ingest again

### Query returns no rows

1. Ensure transform completed with status `ready`
2. Reset filters and run query again
3. Verify selected session is the expected file/session
4. Use schema endpoint to verify dimensions exist for that file: `GET /schema/{file_id}`

### Chart/anomaly output looks wrong

1. Run Query again before Analyze
2. Verify anomaly controls/preset are not overly strict
3. Increase query coverage by keeping filters broad first, then narrow down
4. Re-run Analyze after changing controls

### Clear data does not reset everything

1. Use the UI Clear Data button and confirm deletion
2. Verify sessions endpoint returns empty or reduced list: `GET /ingest/sessions`
3. Check `data/uploads` and `data/staging` folders are cleared except `.gitkeep`

### Port conflicts

1. Change ports in `.env` (`FRONTEND_PORT`, `BACKEND_PORT`) and restart
2. Restart stack: `docker compose down && docker compose up -d --build`

### Release workflow did not create a release

1. Ensure commit messages follow Conventional Commits
2. Check Actions tab for `Release` workflow status
3. Verify branch is `main` (or PR targets `main`)

## License

MIT
