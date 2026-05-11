#!/usr/bin/env python3
# /// script
# requires-python = ">=3.14"
# dependencies = ["psycopg[binary]>=3.2", "pyodbc>=5.2"]
# ///
"""Fixture generator for SELECT 100万行 benchmark (issue #546).

Creates `perf_million_rows` table on the target database and bulk-inserts
1,000,000 rows of 10-column synthetic data. Re-running drops and recreates.

PostgreSQL uses a single `INSERT ... FROM generate_series` statement (fastest).
SQL Server uses CTE-based row multiplication. Both keep schema identical so
the benchmark SELECT is portable across drivers.

Usage:
    uv run scripts/perf/setup_million_row_fixture.py postgres \\
        --conn "postgresql://postgres:postgres@localhost:5432/postgres"

    uv run scripts/perf/setup_million_row_fixture.py mssql \\
        --conn "Driver={ODBC Driver 18 for SQL Server};Server=localhost,1433;..."

The schema mirrors a realistic OLTP table: integer id, varchar name, text
description, integer value, timestamp created_at, plus 5 padding columns to
reach 10 total. SELECT * scans the full 100万行 and is the workload measured
in tests/perf/integration/test_select_million_rows_bench.cpp.
"""

from __future__ import annotations

import argparse
import sys
import time
from typing import Protocol

ROW_COUNT = 1_000_000

# TABLE_NAME is a module-level compile-time constant with no external input,
# so f-string interpolation into DDL/DML below is safe. The CLAUDE.md rule
# against string-concat SQL targets user-derived values; we keep f-strings
# here to keep statements readable and centralize the identifier.
TABLE_NAME = "perf_million_rows"


class FixtureLoader(Protocol):
    """Database-specific fixture loader."""

    def drop_and_create(self) -> None: ...
    def bulk_insert(self) -> None: ...
    def row_count(self) -> int: ...
    def close(self) -> None: ...


class PostgresLoader:
    def __init__(self, conn_str: str) -> None:
        import psycopg

        self._conn = psycopg.connect(conn_str, autocommit=True)

    def drop_and_create(self) -> None:
        with self._conn.cursor() as cur:
            cur.execute(f"DROP TABLE IF EXISTS {TABLE_NAME}")
            cur.execute(
                f"""
                CREATE TABLE {TABLE_NAME} (
                    id            INTEGER PRIMARY KEY,
                    name          VARCHAR(64) NOT NULL,
                    description   TEXT NOT NULL,
                    value         INTEGER NOT NULL,
                    created_at    TIMESTAMP NOT NULL,
                    pad1          VARCHAR(32) NOT NULL,
                    pad2          VARCHAR(32) NOT NULL,
                    pad3          INTEGER NOT NULL,
                    pad4          INTEGER NOT NULL,
                    pad5          VARCHAR(16) NOT NULL
                )
                """
            )

    def bulk_insert(self) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                f"""
                INSERT INTO {TABLE_NAME}
                SELECT
                    g,
                    'name_' || g,
                    'desc_row_' || g || '_with_padding_text',
                    (g * 7) % 1000,
                    TIMESTAMP '2020-01-01 00:00:00' + (g || ' seconds')::INTERVAL,
                    'pad1_' || (g % 100),
                    'pad2_' || (g % 100),
                    g % 500,
                    g % 250,
                    'p5_' || (g % 50)
                FROM generate_series(1, {ROW_COUNT}) AS g
                """
            )

    def row_count(self) -> int:
        with self._conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) FROM {TABLE_NAME}")
            row = cur.fetchone()
            return int(row[0]) if row else 0

    def close(self) -> None:
        self._conn.close()


class MssqlLoader:
    """SQL Server loader. Uses recursive CTE chaining for bulk insert.

    `generate_series` exists from SQL Server 2022 but ODBC Driver 18 is the
    portable floor — fall back to a chained CROSS JOIN to multiply rows.
    """

    def __init__(self, conn_str: str) -> None:
        import pyodbc

        self._conn = pyodbc.connect(conn_str, autocommit=False)

    def drop_and_create(self) -> None:
        with self._conn.cursor() as cur:
            cur.execute(f"IF OBJECT_ID('{TABLE_NAME}', 'U') IS NOT NULL DROP TABLE {TABLE_NAME}")
            cur.execute(
                f"""
                CREATE TABLE {TABLE_NAME} (
                    id            INT PRIMARY KEY,
                    name          VARCHAR(64) NOT NULL,
                    description   VARCHAR(256) NOT NULL,
                    value         INT NOT NULL,
                    created_at    DATETIME2 NOT NULL,
                    pad1          VARCHAR(32) NOT NULL,
                    pad2          VARCHAR(32) NOT NULL,
                    pad3          INT NOT NULL,
                    pad4          INT NOT NULL,
                    pad5          VARCHAR(16) NOT NULL
                )
                """
            )
            self._conn.commit()

    def bulk_insert(self) -> None:
        # 7-deep CROSS JOIN over a 10-row seed -> 10^7 candidates; trim to ROW_COUNT.
        # 6-deep would yield exactly 10^6 = ROW_COUNT, leaving no headroom for future
        # increases — picking 7 means any ROW_COUNT up to 10^7 still works without
        # silent row shortage. Single round-trip is far faster than driver-side row
        # binding for 100万行.
        with self._conn.cursor() as cur:
            cur.execute(
                f"""
                ;WITH digits AS (
                    SELECT 0 AS d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL
                    SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL
                    SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9
                ),
                nums AS (
                    SELECT TOP ({ROW_COUNT})
                        ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS g
                    FROM digits d1, digits d2, digits d3, digits d4, digits d5, digits d6, digits d7
                )
                INSERT INTO {TABLE_NAME}
                SELECT
                    g,
                    'name_' + CAST(g AS VARCHAR(20)),
                    'desc_row_' + CAST(g AS VARCHAR(20)) + '_with_padding_text',
                    (g * 7) % 1000,
                    DATEADD(SECOND, g, '2020-01-01'),
                    'pad1_' + CAST(g % 100 AS VARCHAR(10)),
                    'pad2_' + CAST(g % 100 AS VARCHAR(10)),
                    g % 500,
                    g % 250,
                    'p5_' + CAST(g % 50 AS VARCHAR(10))
                FROM nums
                """
            )
            self._conn.commit()

    def row_count(self) -> int:
        with self._conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) FROM {TABLE_NAME}")
            row = cur.fetchone()
            return int(row[0]) if row else 0

    def close(self) -> None:
        self._conn.close()


def make_loader(kind: str, conn_str: str) -> FixtureLoader:
    if kind == "postgres":
        return PostgresLoader(conn_str)
    if kind == "mssql":
        return MssqlLoader(conn_str)
    raise SystemExit(f"unknown db kind: {kind}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("kind", choices=["postgres", "mssql"], help="target database")
    parser.add_argument("--conn", required=True, help="connection string")
    args = parser.parse_args()

    print(f"[fixture] target={args.kind} rows={ROW_COUNT:,}")
    loader = make_loader(args.kind, args.conn)
    try:
        t0 = time.monotonic()
        loader.drop_and_create()
        print(f"[fixture] schema ready ({time.monotonic() - t0:.2f}s)")

        t1 = time.monotonic()
        loader.bulk_insert()
        print(f"[fixture] insert done ({time.monotonic() - t1:.2f}s)")

        actual = loader.row_count()
        print(f"[fixture] row_count={actual:,}")
        if actual != ROW_COUNT:
            print(f"[fixture] ERROR: expected {ROW_COUNT}, got {actual}", file=sys.stderr)
            return 1
    finally:
        loader.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
