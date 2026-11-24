"""Small helpers around PyMySQL.

Every request opens its own connection, runs its queries inside one transaction
and closes the connection again. That keeps the code simple and is plenty fast
for a single clinic.
"""
import time
from contextlib import contextmanager

import pymysql
import pymysql.cursors

from config import Config

# MySQL error codes that mean "try the transaction again"
DEADLOCK = 1213
LOCK_WAIT_TIMEOUT = 1205


def get_connection(with_database=True):
    return pymysql.connect(
        host=Config.DB_HOST,
        port=Config.DB_PORT,
        user=Config.DB_USER,
        password=Config.DB_PASSWORD,
        database=Config.DB_NAME if with_database else None,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
    )


@contextmanager
def db_cursor(commit=False):
    """Yield a cursor. Commits at the end if commit=True, rolls back on any error."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            yield cur
        if commit:
            conn.commit()
        else:
            conn.rollback()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def run_transaction(fn, retries=3):
    """Run fn(cursor) inside a transaction and commit it.

    If MySQL reports a deadlock or lock timeout (possible when many people book
    at the same moment) the whole transaction is retried a few times.
    """
    for attempt in range(retries):
        try:
            with db_cursor(commit=True) as cur:
                return fn(cur)
        except pymysql.err.OperationalError as exc:
            code = exc.args[0] if exc.args else None
            if code in (DEADLOCK, LOCK_WAIT_TIMEOUT) and attempt < retries - 1:
                time.sleep(0.05 * (attempt + 1))
                continue
            raise
