"""Shared connection pool for Postgres.

Every module that needs a DB connection should call ``get_pool(settings)``
instead of ``psycopg.connect()``.  The pool is created once and reused for the
lifetime of the process.  It automatically:

* health-checks connections before handing them out (catches stale SSL sockets),
* recycles idle connections that Supabase may have closed, and
* caps the number of open connections to avoid exhausting Cloud Run memory.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from psycopg_pool import ConnectionPool

if TYPE_CHECKING:
    from nipp.config import Settings

logger = logging.getLogger(__name__)

_pool: ConnectionPool | None = None


def _check_connection(conn) -> None:
    """Lightweight health check -- runs a no-op query before handing out."""
    conn.execute("SELECT 1")


def get_pool(settings: "Settings") -> ConnectionPool:
    """Return (and lazily create) the shared connection pool."""
    global _pool
    if _pool is not None:
        return _pool

    if not settings.database_url:
        raise RuntimeError("NIPP_DATABASE_URL is required to create the DB pool.")

    _pool = ConnectionPool(
        conninfo=settings.database_url,
        min_size=1,
        max_size=5,
        # Check connections before handing them out.  Catches stale SSL sockets
        # that Cloud Run left open after an idle period.
        check=_check_connection,
        # Re-open connections that have been idle for more than 5 minutes.
        max_idle=300,
        # Time a caller will wait for a connection before raising.
        timeout=10,
        open=True,
    )
    logger.info("Created shared DB pool (min=1, max=5)")
    return _pool
