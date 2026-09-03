# Zink Skill Store

Zink Skill Store is the peer module that owns governed reusable skills, their
provenance and lifecycle, scoped retrieval, and owner-built Excel/Power BI
templates.

M5/T1-R2 reserves ownership and directory boundaries only. It does not implement
a Skill Store runtime, database, API, OpenClaw adapter, evaluation pipeline, or
automatic promotion. Research/candidate output becomes `ACTIVE` only after
explicit owner confirmation.

Skill identity is `capability + namespace + version`. Work and research remain
task metadata rather than separate stores. Knowledgebase indexes and Skill Store
state remain logically isolated even when infrastructure is reused.
