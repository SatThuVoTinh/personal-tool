# Knowledgebase Stores

This path belongs to the current accepted **Zink Knowledgebase** runtime.

`research-knowledge-store/` contains Knowledgebase persistence derived from approved human/reference sources and retrieved with provenance/citations.

**Zink Skill Store is not owned by this directory.** Its canonical peer-module path is `zink-skill-store/`. The former nested `agent-skill-store/` path is obsolete and must not receive new content.

Knowledgebase and Skill Store may reuse PostgreSQL/pgvector, object storage, embedding or API infrastructure, but they remain isolated by ownership, persistence namespace, publication state, provenance, access policy and retrieval path.

`.agents/skills/` is unrelated: it is the repository coding-agent harness, not runtime learned-skill memory.
