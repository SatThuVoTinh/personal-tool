# Research Knowledge Store

This directory belongs to **Zink Knowledgebase** and stores/publishes knowledge derived from approved reference and research sources.

It is a peer of the separately owned `zink-skill-store/`; it does **not** contain agent skills.

The subdirectories preserve the existing Knowledgebase governance scaffold:

- `namespaces/` — logical knowledge partitions.
- `policies/` — publication/access/source policies.
- `provenance/` — source and derivation provenance.
- `publication/` — publication lifecycle state.

Runtime implementation may reuse shared PostgreSQL/pgvector, object storage, embedding, or API infrastructure, but Knowledgebase persistence and retrieval remain logically isolated from Zink Skill Store.
