CREATE TABLE knowledge.pdf_content_builds (
  id uuid PRIMARY KEY,
  content_identity_digest text NOT NULL CHECK (content_identity_digest ~ '^[a-f0-9]{64}$'),
  pdf_digest text NOT NULL CHECK (pdf_digest ~ '^[a-f0-9]{64}$'),
  sidecar_digest text NOT NULL CHECK (sidecar_digest ~ '^[a-f0-9]{64}$'),
  processing_identity_digest text NOT NULL CHECK (processing_identity_digest ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('BUILDING', 'READY', 'FAILED', 'CANCELLED')),
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  finished_at timestamptz,
  UNIQUE (id, status),
  CHECK (
    (status = 'BUILDING' AND ready_at IS NULL AND finished_at IS NULL)
    OR (status = 'READY' AND ready_at IS NOT NULL AND finished_at IS NOT NULL)
    OR (status IN ('FAILED', 'CANCELLED') AND ready_at IS NULL AND finished_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX knowledge_pdf_content_builds_one_building_idx
  ON knowledge.pdf_content_builds (content_identity_digest)
  WHERE status IN ('BUILDING', 'READY');

CREATE UNIQUE INDEX knowledge_pdf_content_builds_one_ready_idx
  ON knowledge.pdf_content_builds (content_identity_digest)
  WHERE status = 'READY';

CREATE TABLE knowledge.pdf_content_batches (
  id uuid PRIMARY KEY,
  build_id uuid NOT NULL REFERENCES knowledge.pdf_content_builds(id) ON DELETE CASCADE,
  page_start integer NOT NULL CHECK (page_start > 0),
  page_end integer NOT NULL CHECK (page_end >= page_start),
  status text NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (id, build_id),
  UNIQUE (build_id, page_start, page_end),
  CHECK (
    (status = 'PENDING' AND started_at IS NULL AND finished_at IS NULL)
    OR (status = 'RUNNING' AND started_at IS NOT NULL AND finished_at IS NULL)
    OR (status IN ('SUCCEEDED', 'FAILED') AND started_at IS NOT NULL AND finished_at IS NOT NULL)
  )
);

CREATE TABLE knowledge.pdf_content_segments (
  id uuid PRIMARY KEY,
  build_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  segment_type text NOT NULL CHECK (segment_type IN ('PDF_PASSAGE', 'PDF_TABLE', 'PDF_FIGURE_TEXT')),
  content text NOT NULL,
  page_start integer NOT NULL CHECK (page_start > 0),
  page_end integer NOT NULL CHECK (page_end >= page_start),
  bbox double precision[],
  provenance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (build_id, batch_id, ordinal),
  FOREIGN KEY (batch_id, build_id)
    REFERENCES knowledge.pdf_content_batches(id, build_id) ON DELETE CASCADE,
  CHECK (
    bbox IS NULL OR (
      cardinality(bbox) = 4
      AND bbox[1] >= 0 AND bbox[1] < bbox[3] AND bbox[3] <= 1
      AND bbox[2] >= 0 AND bbox[2] < bbox[4] AND bbox[4] <= 1
    )
  )
);

CREATE TABLE knowledge.pdf_source_details (
  index_id uuid NOT NULL,
  source_id uuid NOT NULL,
  build_id uuid NOT NULL,
  build_status text NOT NULL DEFAULT 'READY' CHECK (build_status = 'READY'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (index_id, source_id),
  FOREIGN KEY (source_id, index_id)
    REFERENCES knowledge.sources(id, index_id) ON DELETE CASCADE,
  FOREIGN KEY (build_id, build_status)
    REFERENCES knowledge.pdf_content_builds(id, status) ON DELETE RESTRICT
);

CREATE TABLE knowledge.index_run_source_counts (
  index_run_id uuid NOT NULL REFERENCES knowledge.index_runs(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('MARKDOWN', 'PDF')),
  discovered_count integer NOT NULL DEFAULT 0 CHECK (discovered_count >= 0),
  indexed_count integer NOT NULL DEFAULT 0 CHECK (indexed_count >= 0),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  PRIMARY KEY (index_run_id, source_type)
);
