#!/bin/sh
set -eu

: "${N8N_POSTGRES_PASSWORD:?N8N_POSTGRES_PASSWORD is required}"
: "${KNOWLEDGE_DB_PASSWORD:?KNOWLEDGE_DB_PASSWORD is required for knowledge_app}"
: "${SKILL_DB_PASSWORD:?SKILL_DB_PASSWORD is required for skill_app}"

if [ "$KNOWLEDGE_DB_PASSWORD" = "unconfigured" ]; then
  printf '%s\n' 'KNOWLEDGE_DB_PASSWORD is unconfigured' >&2
  exit 1
fi
if [ "$SKILL_DB_PASSWORD" = "unconfigured" ]; then
  printf '%s\n' 'SKILL_DB_PASSWORD is unconfigured' >&2
  exit 1
fi

until pg_isready --dbname=postgres >/dev/null 2>&1; do
  sleep 1
done

# F-264 (R7-D13-01): role passwords must not travel in psql's argv, because
# every process in the container can read /proc/<pid>/cmdline while the call
# runs. Values are written to private 0600 files and read back by psql through
# its own `\set` command substitution. The environment copies are dropped once
# the files hold the values.
umask 077
secretDirectory="$(mktemp -d)"
n8nSecretFile="$secretDirectory/n8n-role-password"
knowledgeSecretFile="$secretDirectory/knowledge-role-password"
skillSecretFile="$secretDirectory/skill-role-password"
printf '%s' "$N8N_POSTGRES_PASSWORD" > "$n8nSecretFile"
printf '%s' "$KNOWLEDGE_DB_PASSWORD" > "$knowledgeSecretFile"
printf '%s' "$SKILL_DB_PASSWORD" > "$skillSecretFile"
chmod 600 "$n8nSecretFile" "$knowledgeSecretFile" "$skillSecretFile"
unset N8N_POSTGRES_PASSWORD KNOWLEDGE_DB_PASSWORD SKILL_DB_PASSWORD
trap 'rm -f "$n8nSecretFile" "$knowledgeSecretFile" "$skillSecretFile"; rmdir "$secretDirectory"' 0

{
  cat <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'n8n') THEN
    CREATE ROLE n8n LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'knowledge_app') THEN
    CREATE ROLE knowledge_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skill_app') THEN
    CREATE ROLE skill_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;
SQL
  printf '\\set n8n_password `cat %s`\n' "$n8nSecretFile"
  printf '\\set knowledge_password `cat %s`\n' "$knowledgeSecretFile"
  printf '\\set skill_password `cat %s`\n' "$skillSecretFile"
  cat <<'SQL'
ALTER ROLE n8n LOGIN PASSWORD :'n8n_password';
ALTER ROLE knowledge_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'knowledge_password';
ALTER ROLE skill_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'skill_password';

SELECT format('CREATE DATABASE %I OWNER %I', 'n8n', 'n8n')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'n8n')
\gexec

GRANT CONNECT ON DATABASE postgres TO knowledge_app;
GRANT CONNECT ON DATABASE postgres TO skill_app;
REVOKE CONNECT ON DATABASE n8n FROM PUBLIC;
GRANT CONNECT ON DATABASE n8n TO n8n;

CREATE SCHEMA IF NOT EXISTS knowledge AUTHORIZATION knowledge_app;
CREATE SCHEMA IF NOT EXISTS skills AUTHORIZATION skill_app;
ALTER SCHEMA knowledge OWNER TO knowledge_app;
ALTER SCHEMA skills OWNER TO skill_app;

-- This catalog loop includes knowledge.pdf_content_builds,
-- knowledge.schema_migrations, and skills.catalog_index when present.
DO $$
DECLARE
  object_row record;
BEGIN
  FOR object_row IN
    SELECT namespace.nspname, relation.relname
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname IN ('knowledge', 'skills')
      AND relation.relkind IN ('r', 'p')
    ORDER BY namespace.nspname, relation.relname
  LOOP
    IF object_row.nspname = 'knowledge' THEN
      EXECUTE format('ALTER TABLE %I.%I OWNER TO knowledge_app', object_row.nspname, object_row.relname);
    ELSE
      EXECUTE format('ALTER TABLE %I.%I OWNER TO skill_app', object_row.nspname, object_row.relname);
    END IF;
  END LOOP;

  FOR object_row IN
    SELECT namespace.nspname, relation.relname
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname IN ('knowledge', 'skills')
      AND relation.relkind = 'S'
    ORDER BY namespace.nspname, relation.relname
  LOOP
    IF object_row.nspname = 'knowledge' THEN
      EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO knowledge_app', object_row.nspname, object_row.relname);
    ELSE
      EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO skill_app', object_row.nspname, object_row.relname);
    END IF;
  END LOOP;
END
$$;
SQL
} | psql --set=ON_ERROR_STOP=1
