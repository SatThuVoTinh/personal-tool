# AI Boundaries

## Knowledge AI

`platforms/knowledge-platform/knowledge-ai/` processes documents for Knowledge RAG. Its responsibilities are chunking, embeddings, document understanding, and reranking. It does not perform L&SC data-quality analysis, forecasting, or optimization.

## Data AI

`platforms/lsc-data-plant/data-ai/` analyzes governed L&SC data. Its responsibilities are profiling, quality assessment, anomaly detection, deduplication, business-rule evaluation, remediation, recommendation, and approval. It does not embed or index Obsidian knowledge.

## AI Platform

`platforms/ai-platform/` coordinates requests, agents, models, tools, context, and sessions. Its RAG router chooses Knowledge RAG, LSC Data Product RAG, or both according to a request. It has no ownership of either RAG source's data lifecycle.
