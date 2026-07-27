from pathlib import Path
import os


DUCKDB_PATH = os.getenv("DUCKDB_PATH", "/data/duckdb.db")
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/data/uploads")
STAGING_DIR = os.getenv("STAGING_DIR", "/data/staging")
DBT_PROJECT_DIR = os.getenv("DBT_PROJECT_DIR", "/app/backend/dbt")
DBT_PROFILES_DIR = os.getenv("DBT_PROFILES_DIR", "/app/backend/dbt")
MAX_ROWS_PER_CHUNK = int(os.getenv("MAX_ROWS_PER_CHUNK", "50000"))

Path(UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
Path(STAGING_DIR).mkdir(parents=True, exist_ok=True)
Path(Path(DUCKDB_PATH).parent).mkdir(parents=True, exist_ok=True)
