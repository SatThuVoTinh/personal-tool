# Zink Platform Boundaries

## Knowledgebase

Knowledgebase owns read-only ingestion from the human-owned Obsidian Vault,
indexing, retrieval, provenance and citation. Other modules do not mutate its
database or index state directly.

## Skill Store

Skill Store owns governed learned-skill persistence and scoped retrieval. It does
not share research Knowledgebase indexes and does not infer ACTIVE promotion.

## Tools

Tools is a small callable boundary for Excel, Power BI, SQL, Python, n8n and
decision-science capabilities. It owns neither orchestration state nor persistent
Knowledge/Skill internals. Through it, OpenClaw agents call `zink_knowledge_search`
(the Knowledge corpus), `zink_skill_search` (ACTIVE-only retrieval) and
`zink_skill_propose` (CANDIDATE proposal); owner confirmation and canonical promotion
happen in governed runtime code, not in Tools, and cross-project effects use
approved APIs/contracts and never direct mutation of another owner's database,
vector store or object store.

## Infrastructure

Infrastructure provides runtime capability, not domain policy. Cross-project
effects use approved APIs/contracts and never direct mutation of another owner's
database, vector store or object store.
