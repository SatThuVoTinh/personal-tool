#!/bin/sh
set -eu

: "${N8N_POSTGRES_PASSWORD:?N8N_POSTGRES_PASSWORD is required}"

until pg_isready --dbname=postgres >/dev/null 2>&1; do
  sleep 1
done

psql --set=ON_ERROR_STOP=1 --set=n8n_password="$N8N_POSTGRES_PASSWORD" <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'n8n') THEN
    CREATE ROLE n8n LOGIN;
  END IF;
END
$$;

ALTER ROLE n8n LOGIN PASSWORD :'n8n_password';

SELECT format('CREATE DATABASE %I OWNER %I', 'n8n', 'n8n')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'n8n')
\gexec
SQL
