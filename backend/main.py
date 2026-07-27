from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.db.connector import init_db
from backend.routers import health, ingest, query, schema, transform


app = FastAPI(title="Sanity Log Explorer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


app.include_router(health.router)
app.include_router(ingest.router)
app.include_router(transform.router)
app.include_router(schema.router)
app.include_router(query.router)
