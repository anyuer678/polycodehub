import logging
from contextlib import contextmanager
from typing import Iterator, Optional

import psycopg2
from psycopg2 import pool

from .config import settings

logger = logging.getLogger(__name__)

_db_pool: Optional[pool.ThreadedConnectionPool] = None


def init_db_pool() -> None:
    global _db_pool
    try:
        _db_pool = pool.ThreadedConnectionPool(
            minconn=settings.db_min_conn,
            maxconn=settings.db_max_conn,
            **settings.db_kwargs,
        )
        logger.info("Database connection pool initialized")
    except Exception as exc:
        logger.error(f"Failed to initialize database pool: {exc}")
        raise


def close_db_pool() -> None:
    global _db_pool
    if _db_pool is not None:
        try:
            _db_pool.closeall()
        except Exception as exc:
            logger.error(f"Failed to close database pool: {exc}")
        _db_pool = None


@contextmanager
def get_db_connection() -> Iterator[psycopg2.extensions.connection]:
    if _db_pool is None:
        raise RuntimeError("Database pool not initialized")
    conn = _db_pool.getconn()
    try:
        yield conn
    finally:
        _db_pool.putconn(conn)
