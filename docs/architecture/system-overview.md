# Personal Tool — System Overview

## Purpose

Personal Tool is a local-first system for personal knowledge, AI, automation, and Logistics & Supply Chain (L&SC) data. The repository structure keeps ownership explicit and prevents platform logic from being mixed with shared infrastructure.

## Architecture rules

- `infrastructure/` owns runtime capabilities, networking, storage, backup, logging, and monitoring.
- `platforms/knowledge-platform/` owns the document-oriented Knowledge RAG pipeline.
- `platforms/lsc-data-plant/` owns the governed L&SC data lifecycle and LSC Data Product RAG.
- `platforms/ai-platform/` owns model, agent, tool, and request orchestration; it routes RAG requests but does not create either RAG index.
- `platforms/automation-platform/` owns workflow orchestration and integrations, not domain logic.
- `experiments/` is isolated from production implementation until an experiment passes its promotion review.
- Physical datasets, vector data, model artifacts, secrets, logs, and backups are not repository source files.

## Canonical directory tree

```text
personal-tool/
├── AGENTS.md
├── README.md
├── CHANGELOG.md
├── LICENSE
├── Makefile
├── .editorconfig
├── .gitattributes
├── .gitignore
├── .env.example
├── .github/workflows/{ci.yml,tests.yml,security.yml}
├── applications/
│   ├── ai-chat/
│   ├── admin-dashboard/
│   ├── lsc-dashboard/
│   └── document-manager/
├── infrastructure/
│   ├── docker/{compose,env,scripts,volumes}/
│   ├── databases/
│   │   ├── postgres/{init,migrations/{shared,knowledge,ai,automation,lsc},backups}/
│   │   ├── redis/
│   │   └── minio/{buckets/{knowledge,lsc-landing,lsc-quarantine,lsc-bronze,lsc-silver,lsc-gold,model-artifacts,pipeline-artifacts},lifecycle}/
│   ├── nginx/{conf.d,snippets,certificates}/
│   ├── observability/
│   │   ├── prometheus/rules/
│   │   ├── grafana/{provisioning/{dashboards,datasources},dashboards}/
│   │   ├── exporters/{node,postgres,redis,minio,containers,gpu}/
│   │   ├── dozzle/
│   │   └── alerts/
│   ├── networking/
│   ├── gpu/
│   └── deployment/
├── platforms/
│   ├── knowledge-platform/
│   │   ├── connectors/{obsidian,books,papers,videos,templates}/
│   │   ├── processing/{parsers,cleaners,normalizers,metadata-extraction}/
│   │   ├── knowledge-ai/{chunking,embeddings,document-understanding,reranking}/
│   │   ├── indexing/{vector-store,metadata-store,index-runs}/
│   │   ├── retrieval/{search,filters,citations,source-policy}/
│   │   ├── services/{knowledge-indexer,knowledge-api}/
│   │   └── {policies,configs,schemas,tests,docs}/
│   ├── ai-platform/
│   │   ├── request-gateway/{authentication,authorization,validation,middleware,responses}/
│   │   ├── orchestrator/{planner,execution,workflows,context,memory,prompts,sessions}/
│   │   ├── model-management/{model-router,model-registry,resource-policy,ollama}/
│   │   ├── agent-management/{agents,skills,personas,evaluations}/
│   │   ├── tool-management/{tool-router,tool-registry,permissions}/
│   │   ├── rag-router/{knowledge-platform,lsc-data-products}/
│   │   ├── integrations/automation-platform/
│   │   ├── services/ai-api/
│   │   └── {configs,schemas,tests,docs}/
│   ├── lsc-data-plant/
│   │   ├── ingestion/{connectors,source-contracts,ingestion-runs}/
│   │   ├── landing/
│   │   ├── validation/{schema-validation,data-quality-rules,validation-runs}/
│   │   ├── quarantine/
│   │   ├── anonymization/
│   │   ├── bronze/
│   │   ├── pipelines/{bronze-to-silver,silver-to-gold,pipeline-runs}/
│   │   ├── silver/
│   │   ├── data-ai/{profiling,quality-assessment,anomaly-detection,deduplication,business-rules,remediation,recommendations,approval}/
│   │   ├── gold/
│   │   ├── semantic-layer/{metrics,dimensions,entities,semantic-models}/
│   │   ├── products/
│   │   │   ├── {analytics,dashboards,feature-store,training-data,forecasting,optimization,api}/
│   │   │   └── rag/{datasets,semantic-context,retrieval-views,metadata}/
│   │   ├── modeling/{features,training,evaluation,model-registry,inference}/
│   │   ├── governance/{catalog,metadata,lineage,configuration,documentation}/
│   │   ├── services/{pipeline-runner,data-api,model-runner}/
│   │   └── {configs,schemas,tests,docs}/
│   └── automation-platform/
│       ├── n8n/{workflows,credentials-templates,custom-nodes}/
│       ├── triggers/{schedules,webhooks,events}/
│       ├── integrations/{ai-platform,knowledge-platform,lsc-data-plant,external}/
│       ├── {crawlers,notifications,workflow-templates,services,configs,schemas,tests,docs}/
├── experiments/{rag,forecasting,optimization,data-quality,agents}/
├── shared/
│   ├── libraries/{python,types}/
│   ├── schemas/{common,knowledge,ai,lsc,automation}/
│   └── {prompts,templates,constants,utilities,telemetry,assets}/
├── configs/{external-resources,model-profiles,system-defaults}/
├── docs/
│   ├── architecture/{system-overview.md,platform-boundaries.md,data-flow.md,knowledge-flow.md,ai-boundaries.md,adr}/
│   ├── runbooks/
│   ├── roadmap/
│   └── glossary/
├── tests/{integration,e2e,smoke,fixtures,helpers}/
├── scripts/{bootstrap,development,maintenance,verification}/
├── backups/.gitkeep
├── logs/.gitkeep
└── temp/.gitkeep
```

## RAG separation

Knowledge RAG and LSC Data Product RAG are separate systems. Knowledge RAG retrieves from human-authored Obsidian knowledge and permitted reference sources. LSC Data Product RAG retrieves governed, domain-specific L&SC data context produced from Gold data and the semantic layer. The AI Platform RAG router selects a source; it does not own source ingestion, embedding, or data-product creation.

## Experiment promotion

Experiments are not production services. An experiment may be promoted only after its data scope, evaluation method, acceptance criteria, operational cost, and target platform ownership are approved.
