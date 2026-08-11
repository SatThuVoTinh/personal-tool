# Platform Boundaries

| Area                | Owns                                                                                   | Does not own                                                                              |
| ------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Infrastructure      | Docker, networking, databases, MinIO, backups, observability, Nginx, GPU runtime       | Domain workflows, knowledge indexing, L&SC transformations, UI behavior                   |
| Knowledge Platform  | Vault connectors, document processing, `knowledge-ai`, indexing, retrieval, citations  | Agent orchestration, L&SC data analysis, forecasting, optimization                        |
| AI Platform         | Request handling, models, agents, tools, safety, context, session, RAG routing         | Document chunking/embedding, vector source ownership, L&SC data transformations           |
| LSC Data Plant      | Data lifecycle, `data-ai`, semantic layer, data products, model training and inference | Obsidian indexing, general-purpose agent orchestration                                    |
| Automation Platform | n8n, triggers, webhooks, integrations, notifications                                   | Business/domain logic duplicated from another platform                                    |
| Applications        | User-facing interfaces and platform API consumption                                    | Source-of-truth data, pipeline logic, embedding or model-training logic                   |
| Shared              | Neutral libraries, schemas, utilities, prompts, telemetry clients                      | Runtime service ownership or domain-specific execution                                    |
| Experiments         | Isolated evaluation of candidate approaches                                            | Production indexes, governed data layers, production model registry, production workflows |

`infrastructure/observability/` is the only monitoring configuration location. Platform code may emit telemetry through `shared/telemetry/`, but it must not define an independent monitoring stack.
