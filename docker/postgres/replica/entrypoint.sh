#!/bin/sh
set -eu

PRIMARY_HOST="${PRIMARY_HOST:-postgres-primary}"
PRIMARY_PORT="${PRIMARY_PORT:-5432}"
REPLICATION_USER="${REPLICATION_USER:-replicator}"
REPLICATION_PASSWORD="${REPLICATION_PASSWORD:-replicator}"
PGDATA="${PGDATA:-/var/lib/postgresql/data}"

echo "Waiting for primary at ${PRIMARY_HOST}:${PRIMARY_PORT}..."
until pg_isready -h "$PRIMARY_HOST" -p "$PRIMARY_PORT" -U "$POSTGRES_USER"; do
  sleep 2
done

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "Initializing replica from primary..."
  rm -rf "$PGDATA"/*
  PGPASSWORD="$REPLICATION_PASSWORD" pg_basebackup \
    -h "$PRIMARY_HOST" \
    -p "$PRIMARY_PORT" \
    -U "$REPLICATION_USER" \
    -D "$PGDATA" \
    -Fp \
    -Xs \
    -P \
    -R
fi

echo "Starting replica PostgreSQL..."
exec docker-entrypoint.sh postgres -c config_file=/etc/postgresql/postgresql.conf
