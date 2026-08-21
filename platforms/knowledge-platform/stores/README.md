# Knowledge Stores

Zink Knowledgebase exposes two governed logical knowledge stores from the same
Knowledge Platform. They may reuse the same PostgreSQL/pgvector and object-storage
infrastructure, but they must remain isolated by store identity, persistence
namespace, publication state, provenance, access policy, and retrieval path.

- `research-knowledge-store/` — derived from approved human/reference sources,
  primarily the read-only Obsidian Vault. It is read-oriented for Zink Agents
  System research agents and, later, Zink Q&A.
- `agent-skill-store/` — stores learned functional skills produced by Zink Agents
  System. It is partitioned one-to-one by function/subagent namespace.

The directories here define domain ownership and contracts. They do not imply a
second database server, a second embedding service, or a second generic RAG
platform.

`.agents/skills/` is unrelated: it is the repository coding-agent harness, not
runtime learned skill memory.
