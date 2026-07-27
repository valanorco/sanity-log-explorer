from contextlib import contextmanager
from pathlib import Path
import duckdb

from backend.config import DUCKDB_PATH


def init_db() -> None:
    Path(DUCKDB_PATH).parent.mkdir(parents=True, exist_ok=True)
    schema_path = Path(__file__).with_name("schema.sql")
    sql = schema_path.read_text(encoding="utf-8")
    with duckdb.connect(DUCKDB_PATH) as conn:
        conn.execute(sql)


@contextmanager
def get_connection():
    conn = duckdb.connect(DUCKDB_PATH)
    try:
        yield conn
    finally:
        conn.close()
