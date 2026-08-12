CREATE EXTENSION IF NOT EXISTS vector;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'knowledge_index_status'
  ) THEN
    CREATE TYPE knowledge.index_status AS ENUM ('BUILDING', 'ACTIVE', 'SUPERSEDED', 'FAILED');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'knowledge_index_run_status'
  ) THEN
    CREATE TYPE knowledge.index_run_status AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'knowledge_index_run_kind'
  ) THEN
    CREATE TYPE knowledge.index_run_kind AS ENUM ('INCREMENTAL', 'FULL_REBUILD');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS knowledge.indexes (
  id uuid PRIMARY KEY,
  status knowledge.index_status NOT NULL,
  embedding_model_name text NOT NULL,
  embedding_model_digest text NOT NULL CHECK (embedding_model_digest ~ '^[a-f0-9]{64}$'),
  embedding_dimensions integer NOT NULL CHECK (embedding_dimensions = 1024),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  superseded_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  failure_detail text,
  CHECK (
    (status <> 'FAILED') OR (failed_at IS NOT NULL AND failure_code IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_indexes_one_active_idx
  ON knowledge.indexes ((true))
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS knowledge.index_runs (
  id uuid PRIMARY KEY,
  index_id uuid NOT NULL REFERENCES knowledge.indexes(id) ON DELETE RESTRICT,
  kind knowledge.index_run_kind NOT NULL,
  status knowledge.index_run_status NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  sources_discovered integer NOT NULL DEFAULT 0 CHECK (sources_discovered >= 0),
  sources_indexed integer NOT NULL DEFAULT 0 CHECK (sources_indexed >= 0),
  sources_failed integer NOT NULL DEFAULT 0 CHECK (sources_failed >= 0),
  failure_code text,
  failure_detail text,
  CHECK (
    (status IN ('RUNNING', 'SUCCEEDED')) OR (finished_at IS NOT NULL AND failure_code IS NOT NULL)
  ),
  UNIQUE (id, index_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_index_runs_one_running_idx
  ON knowledge.index_runs ((true))
  WHERE status = 'RUNNING';

CREATE TABLE IF NOT EXISTS knowledge.sources (
  id uuid PRIMARY KEY,
  index_id uuid NOT NULL REFERENCES knowledge.indexes(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('MARKDOWN', 'PDF', 'IMAGE', 'VIDEO')),
  source_path text NOT NULL CHECK (source_path !~ '(^|/)\.\.(/|$)'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  mime_type text NOT NULL,
  title text NOT NULL,
  primary_topic text NOT NULL,
  canonical_topics text[] NOT NULL DEFAULT '{}',
  tags text[] NOT NULL DEFAULT '{}',
  indexed_by_run_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (index_id, source_path),
  UNIQUE (id, index_id),
  FOREIGN KEY (indexed_by_run_id, index_id)
    REFERENCES knowledge.index_runs(id, index_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS knowledge.source_sidecars (
  index_id uuid NOT NULL,
  source_id uuid NOT NULL,
  sidecar_path text NOT NULL CHECK (sidecar_path !~ '(^|/)\.\.(/|$)'),
  relation_type text NOT NULL CHECK (relation_type = 'EMBED'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (index_id, source_id, sidecar_path),
  FOREIGN KEY (source_id, index_id)
    REFERENCES knowledge.sources(id, index_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge.segments (
  id uuid PRIMARY KEY,
  index_id uuid NOT NULL REFERENCES knowledge.indexes(id) ON DELETE CASCADE,
  source_id uuid NOT NULL,
  segment_type text NOT NULL,
  chunk_ordinal integer NOT NULL CHECK (chunk_ordinal >= 0),
  source_path text NOT NULL CHECK (source_path !~ '(^|/)\.\.(/|$)'),
  title text NOT NULL,
  primary_topic text NOT NULL,
  canonical_topics text[] NOT NULL DEFAULT '{}',
  tags text[] NOT NULL DEFAULT '{}',
  heading_path text[] NOT NULL DEFAULT '{}',
  heading_text text NOT NULL DEFAULT '',
  text text NOT NULL,
  line_start integer,
  line_end integer,
  page_start integer,
  page_end integer,
  bbox double precision[],
  time_start_ms bigint,
  time_end_ms bigint,
  embedding vector(1024),
  search_vector tsvector NOT NULL DEFAULT ''::tsvector,
  indexed_by_run_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (line_start IS NULL AND line_end IS NULL)
    OR (line_start > 0 AND line_end >= line_start)
  ),
  CHECK (
    (page_start IS NULL AND page_end IS NULL)
    OR (page_start > 0 AND page_end >= page_start)
  ),
  CHECK (bbox IS NULL OR cardinality(bbox) = 4),
  CHECK (
    (time_start_ms IS NULL AND time_end_ms IS NULL)
    OR (time_start_ms >= 0 AND time_end_ms >= time_start_ms)
  ),
  UNIQUE (index_id, source_id, chunk_ordinal),
  FOREIGN KEY (source_id, index_id)
    REFERENCES knowledge.sources(id, index_id) ON DELETE CASCADE,
  FOREIGN KEY (indexed_by_run_id, index_id)
    REFERENCES knowledge.index_runs(id, index_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS knowledge_segments_embedding_hnsw_idx
  ON knowledge.segments USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS knowledge_segments_search_vector_idx
  ON knowledge.segments USING gin (search_vector);

CREATE INDEX IF NOT EXISTS knowledge_segments_filter_idx
  ON knowledge.segments (index_id, primary_topic, source_path);
