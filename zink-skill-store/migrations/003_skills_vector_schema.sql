-- apps/knowledge/migrations/003_skills_vector_schema.sql
-- Derived Skill Store vector index schema
-- Strictly idempotent, non-destructive to existing knowledge.* schema

CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS skills;

CREATE TABLE IF NOT EXISTS skills.catalog_index (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace text[] NOT NULL,
  capability text NOT NULL,
  version text NOT NULL,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  embedding_input_sha256 text NOT NULL CHECK (embedding_input_sha256 ~ '^[a-f0-9]{64}$'),
  domain text NOT NULL,
  primary_topic text NOT NULL,
  subtopic text,
  secondary_topics text[] NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('ACTIVE')),
  sync_status text NOT NULL CHECK (sync_status IN ('PENDING', 'READY', 'FAILED')),
  synced_at timestamptz NOT NULL DEFAULT now(),
  failure_reason text,
  UNIQUE (namespace, capability, version)
);

CREATE TABLE IF NOT EXISTS skills.segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id uuid NOT NULL REFERENCES skills.catalog_index(id) ON DELETE CASCADE,
  segment_ordinal integer NOT NULL,
  heading_path text[] NOT NULL DEFAULT '{}',
  content text NOT NULL,
  embedding vector(1024) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (skill_id, segment_ordinal)
);

CREATE INDEX IF NOT EXISTS skills_segments_embedding_hnsw_idx
  ON skills.segments USING hnsw (embedding vector_cosine_ops);
