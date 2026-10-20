#!/bin/sh
set -eu

: "${N8N_POSTGRES_PASSWORD:?N8N_POSTGRES_PASSWORD is required}"

until pg_isready --dbname=postgres >/dev/null 2>&1; do
  sleep 1
done

# F-264 (R7-D13-01): the role password must not travel in psql's argv, because
# every process in the container can read /proc/<pid>/cmdline while the call
# runs. The value is written to a private 0600 file and read back by the
# client itself, through psql's own `\set` command substitution, so the file
# is the only place the secret exists. The environment copy compose.core.yml
# delivers is dropped as soon as the file holds the value.
umask 077
secretDirectory="$(mktemp -d)"
secretFile="$secretDirectory/n8n-role-password"
printf '%s' "$N8N_POSTGRES_PASSWORD" > "$secretFile"
chmod 600 "$secretFile"
unset N8N_POSTGRES_PASSWORD
trap 'rm -f "$secretFile"; rmdir "$secretDirectory"' 0

{
  cat <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'n8n') THEN
    CREATE ROLE n8n LOGIN;
  END IF;
END
$$;
SQL
  printf '\\set n8n_password `cat %s`\n' "$secretFile"
  cat <<'SQL'
ALTER ROLE n8n LOGIN PASSWORD :'n8n_password';

SELECT format('CREATE DATABASE %I OWNER %I', 'n8n', 'n8n')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'n8n')
\gexec
SQL
} | psql --set=ON_ERROR_STOP=1
