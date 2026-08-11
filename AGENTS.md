**# AGENTS.md — Personal Tool**

**## 1. Project Identity**

Personal Tool is a **\*\*local-first personal AI, knowledge, automation, and Logistics & Supply Chain data system\*\***.

It is designed for a single user and integrates four primary functional domains:

\`\`\`text
Personal Tool
│
├── Automation Platform
├── AI Platform
├── Logistics & Supply Chain Data Plant
└── Knowledge Platform
\`\`\`

Infrastructure is a shared runtime foundation underneath these domains.

The system is not intended to be a multi-user SaaS platform.

**---**

**# 2. Primary Objectives**

Personal Tool should provide an integrated environment for:

1\. Managing structured personal knowledge through Obsidian.
2\. Retrieving knowledge through RAG.
3\. Running specialized AI agents.
4\. Managing AI models and AI execution.
5\. Automating repetitive and scheduled workflows.
6\. Collecting Logistics & Supply Chain data.
7\. Validating, cleaning, anonymizing, transforming, and governing data.
8\. Producing reliable Logistics & Supply Chain data products.
9\. Building forecasting and optimization models.
10\. Training forecasting and optimization models using historical data products.
11\. Using trained models for future prediction and operational optimization.
12\. Connecting knowledge, data, AI, and automation without unnecessarily coupling their implementations.

The architecture must remain modular, inspectable, reproducible, and maintainable.

\---

\# 3. High-Level Architecture

The four primary branches of Personal Tool are:

\`\`\`text
                              PERSONAL TOOL
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
        ▼                           ▼                           ▼
 AUTOMATION PLATFORM           AI PLATFORM          LOGISTICS & SUPPLY
                                                      CHAIN DATA PLANT
        │                           │                           │
        │                           │                           │
       n8n                    AI Orchestrator             Data Lifecycle
        │                           │                           │
        │                    ┌──────┼──────┐                    │
        │                    ▼      ▼      ▼                    │
        │                  Models Agents Tools                  │
        │                           │                           │
        │                           │                           │
        │                           ▼                           │
        │                         RAG                           │
        │                           │                           │
        └───────────────────────────┼───────────────────────────┤
                                    │                           │
                                    │                           │
                                    ▼                           ▼
                            KNOWLEDGE PLATFORM          Data Products
                                    │                           │
                                 Obsidian               ┌───────┼────────┐
                                    │                   ▼       ▼        ▼
                            Knowledge Retrieval      Dashboard RAG  ML/AI
                                    │                              │
                                    │                         ┌────┴─────┐
                                    │                         ▼          ▼
                                    │                    Forecast   Optimization
                                    │                       │          │
                                    │                       └────┬─────┘
                                    │                            │
                                    │                       Trained Models
                                    │                            │
                                    └────────────────────────────┘
\`\`\`

The architecture above is logical architecture.

It does \*\*not\*\* imply that every logical component must become a separate Docker container or microservice.

\---

\# 4. Shared Infrastructure

Infrastructure is the runtime foundation for the four functional domains.

Current infrastructure:

\`\`\`text
Infrastructure
│
├── Docker / Docker Compose
│
├── Nginx
│
├── PostgreSQL
│   └── pgvector
│
├── Redis
│
├── MinIO
│
├── Ollama
│
├── Python Runtime
│
├── n8n
│
├── Prometheus
│
├── Grafana
│
└── Dozzle
\`\`\`

\## 4.1 Docker / Docker Compose

Docker Compose is the primary local deployment and service-orchestration mechanism.

Do not introduce Kubernetes unless there is a demonstrated requirement.

\---

\## 4.2 PostgreSQL

PostgreSQL is the primary structured database.

Potential logical data domains include:

\* application state
\* knowledge metadata
\* document chunks
\* embeddings
\* vector indexes
\* structured Data Plant metadata
\* AI execution state
\* model metadata
\* automation state
\* system configuration

PostgreSQL is a primary source of truth for structured application/system data.

\---

\## 4.3 pgvector

pgvector provides vector storage and similarity search inside PostgreSQL.

Primary use cases include:

\* Obsidian embeddings
\* semantic retrieval
\* RAG
\* vector-based knowledge search
\* potentially feature/embedding representations where appropriate

\---

\## 4.4 Redis

Redis is auxiliary infrastructure.

Use Redis for:

\* caching
\* queues
\* transient state
\* rate limiting
\* temporary coordination

Redis must not become the primary source of truth.

\---

\## 4.5 MinIO

MinIO is the object-storage layer.

\*\*Object storage\*\* means storage organized around objects/files rather than relational rows.

MinIO is suitable for:

\* raw datasets
\* Data Landing
\* Bronze/Silver/Gold file-based datasets where appropriate
\* PDFs
\* large data files
\* model artifacts
\* generated files
\* pipeline artifacts
\* backups or intermediate objects where appropriate

MinIO should be treated as the object-storage component of the Data Plant rather than forcing large binary datasets into PostgreSQL.

\---

\## 4.6 Ollama

Ollama provides local LLM inference.

The AI models run primarily on the laptop's local hardware.

Current hardware constraint:

\`\`\`text
RAM: 24 GB
GPU VRAM: 6 GB
\`\`\`

The architecture must therefore be designed around \*\*resource-constrained local AI inference\*\*.

Models must not be assumed to have unlimited GPU memory.

Where appropriate:

\* use quantized models
\* select models according to VRAM requirements
\* avoid unnecessarily large models
\* control concurrent model execution
\* monitor RAM and VRAM usage
\* prefer CPU/RAM execution for workloads where GPU VRAM is insufficient

The laptop GPU is the primary AI acceleration resource.

Cloud GPU is not assumed to be permanently available.

\---

\## 4.7 Python Runtime

Python is a first-class runtime inside Docker.

It is primarily used for:

\* data processing
\* ETL
\* data validation
\* statistical analysis
\* machine learning
\* forecasting
\* optimization
\* model training
\* feature engineering
\* AI/data utilities

Python workloads should be isolated from the core application where appropriate.

Python is the primary analytical and ML runtime for the Data Plant.

\---

\## 4.8 n8n

n8n is the execution engine of the Automation Platform.

It should not be treated merely as infrastructure.

Its logical ownership belongs to:

\`\`\`text
Automation Platform
        │
        └── n8n
\`\`\`

\---

\## 4.9 Prometheus

Prometheus provides metrics collection.

\*\*Metrics\*\* are numerical measurements of system behavior over time.

Potential metrics:

\* CPU usage
\* RAM usage
\* GPU-related application metrics where available
\* container health
\* request counts
\* latency
\* pipeline execution metrics
\* AI execution metrics
\* automation metrics
\* model inference metrics

\---

\## 4.10 Grafana

Grafana provides dashboards for Prometheus and other supported metrics sources.

Potential dashboards:

\* infrastructure health
\* Docker resource usage
\* Data Plant pipeline health
\* AI workload metrics
\* automation execution
\* model performance
\* system resource utilization

\---

\## 4.11 Dozzle

Dozzle provides container log inspection.

It complements Prometheus/Grafana:

\`\`\`text
Dozzle
→ logs

Prometheus
→ metrics

Grafana
→ metric visualization
\`\`\`

\---

\# 5. Knowledge Platform

The Knowledge Platform manages the user's human-authored knowledge and its AI-retrievable representation.

Obsidian is the central human-facing knowledge system.

The Obsidian Vault has a deliberately structured organization.

\---

\# 6. Obsidian Vault Structure

The conceptual structure is:

\`\`\`text
Obsidian Vault
│
├── 01. Knowledge
├── 02. Books
├── 03. Papers
├── 04. Images
├── 05. Videos
├── 06. AI
├── 07. Projects
├── 08. Notes
├── 09. Templates
└── 99. Archives
\`\`\`

The numbered folders are intentional.

Do not arbitrarily rename or reorganize them without considering their role in indexing and retrieval.

\---

\# 7. 01. Knowledge

\`01. Knowledge\` contains human-authored Markdown knowledge notes.

It contains only \`.md\` knowledge notes.

The main subject folders are:

\`\`\`text
01\. Knowledge
│
├── AI
├── Data
├── Cloud
├── Machine Learning
├── Logistics
├── Supply Chain
├── Material Science
├── Agricultural Science
├── Economic
├── Natural Science
├── Social Science
├── English
└── Chinese
\`\`\`

These are the canonical knowledge domains.

Knowledge notes should contain actual concepts, explanations, insights, reasoning, references, and structured understanding.

This folder is a primary source for:

\* embedding
\* semantic search
\* RAG
\* AI reasoning
\* knowledge retrieval

\---

\# 8. Knowledge Tags

`01. Knowledge` uses **native Obsidian `#tags` as the lightweight classification mechanism**.

Knowledge notes do **not** require YAML frontmatter merely for indexing, embedding, or RAG.

The intended authoring workflow is:

```text
Write knowledge naturally
        ↓
Add #tags where useful
        ↓
Knowledge ingestion parses the tags automatically
        ↓
Tags become retrieval metadata
```

Example:

```text
# Safety Stock

Safety stock is inventory held to protect against uncertainty
in demand and lead time.

#supplychain #inventory #forecasting
```

There is no requirement to add a separate metadata block such as:

```text
---
tags:
  - supplychain
  - inventory
---
```

or a manually written `TAGS` section.

The goal is to keep Obsidian optimized for **human knowledge authoring**, not metadata administration.

## 8.1 Tag Rules

Tags should normally:

- begin with `#`
- be lowercase
- use the canonical vocabulary where one exists
- be placed naturally in the note
- be parsed automatically by the Knowledge ingestion pipeline

Examples:

```text
#ai
#data
#machinelearning
#supplychain
#logistics
#materialscience
#agriculturalscience
#naturalscience
#socialscience
```

The canonical tag vocabulary should remain aligned with the canonical knowledge-domain taxonomy.

Additional subtopic tags are allowed when they provide useful retrieval or classification signals.

For example:

```text
#supplychain #inventory #safetystock
```

Do not create arbitrary synonyms for an existing canonical tag unless there is a documented reason.

## 8.2 Tags vs Embedding Content

Tags are **metadata**, not a replacement for knowledge content.

The Knowledge ingestion pipeline should conceptually separate:

```text
Markdown content
    ↓
Embedding input

#tags
    ↓
Structured retrieval metadata
```

The semantic content of the note remains the primary source for embeddings.

Tags may also be included in the embedding input when technically useful, but the system must not depend on tags to convey information that should exist in the actual note content.

The resulting knowledge record may therefore contain:

```text
content
embedding
tags
source_path
title
```

The exact database schema may evolve independently.

## 8.3 Knowledge Authoring Principle

**Obsidian is the source of truth for human-authored knowledge.**

The author should not have to change writing behavior merely to satisfy the embedding system.

Therefore:

```text
Human
→ writes Markdown
→ adds lightweight #tags

Knowledge Platform
→ parses Markdown
→ extracts tags
→ chunks content
→ generates embeddings
→ stores retrieval metadata
```

The indexing system must adapt to the Obsidian authoring model, rather than forcing every note to contain AI-specific metadata.

---

\
# 9. 02. Books

\`02. Books\` contains books in PDF format.

The books cover the same broad subject domains as the Knowledge structure.

The folder hierarchy mirrors the subject taxonomy.

Example:

\`\`\`text
02\. Books
│
├── AI
├── Data
├── Cloud
├── Machine Learning
├── Logistics
├── Supply Chain
├── Material Science
├── Agricultural Science
├── Economic
├── Natural Science
├── Social Science
├── English
└── Chinese
\`\`\`

Books are source/reference material.

The PDFs themselves are not equivalent to human-authored Knowledge notes.

Where necessary, relevant book content may be indexed for retrieval.

\---

\# 10. 03. Papers

\`03. Papers\` contains research papers in PDF format.

The subject taxonomy mirrors the Knowledge taxonomy.

Papers are used as deeper research sources.

They may support:

\* research
\* literature review
\* RAG
\* scientific reasoning
\* model development
\* Data Plant methodology

Research papers should retain their source metadata where practical.

\---

\# 11. 04. Images

\`04. Images\` stores image files such as:

\* PNG
\* JPG/JPEG

Images are organized by the same general subject domains where useful.

Images are reference assets.

They should not automatically become text embeddings merely because they exist.

Multimodal indexing should be introduced only if there is a demonstrated use case.

\---

\# 12. 05. Videos

\`05. Videos\` contains video links rather than necessarily storing large video files locally.

The subject organization mirrors the knowledge taxonomy.

Example:

\`\`\`text
05\. Videos
├── AI
├── Data
├── Cloud
├── Machine Learning
├── Logistics
...
\`\`\`

The purpose is to maintain a structured reference library.

\---

\# 13. 06. AI

\`06. AI\` stores configuration and knowledge required by specialized AI agents.

Structure:

\`\`\`text
06\. AI
│
├── Skills
├── Personas
├── SOP
├── Prompts
├── Memories
├── Workflows
├── Context Packs
├── Tools
├── Evaluation
└── Ontology
\`\`\`

These directories are \*\*AI operational knowledge/configuration\*\*, not general human knowledge.

\---

\# 14. AI Skills

Skills describe reusable capabilities an agent can perform.

Examples:

\`\`\`text
SQL Analysis
Power BI Analysis
Supply Chain Forecasting
Research Literature Review
Data Cleaning
Python Data Analysis
\`\`\`

A skill should describe:

\* purpose
\* inputs
\* procedure
\* constraints
\* expected output
\* failure conditions

Skills should be reusable by multiple agents where appropriate.

\---

\# 15. Personas

Personas define how a specialized AI agent should behave.

A persona may define:

\* role
\* expertise
\* priorities
\* communication behavior
\* decision boundaries
\* domain assumptions

Persona should not contain executable business logic that belongs in Skills or Tools.

\---

\# 16. SOP

SOP means \*\*Standard Operating Procedure\*\*.

An SOP defines a repeatable procedure.

Example:

\`\`\`text
Supply Chain Forecast Review SOP
1\. Validate dataset
2\. Inspect missing values
3\. Check seasonality
4\. Compare forecasting models
5\. Evaluate error metrics
6\. Report model performance
\`\`\`

SOPs are procedural documents.

They differ from Skills:

\`\`\`text
Skill
→ what the agent is capable of doing

SOP
→ how a specific process should be performed
\`\`\`

\---

\# 17. Prompts

Prompts contain reusable instructions for specific AI tasks.

Examples:

\* research prompt
\* SQL analysis prompt
\* forecasting review prompt
\* data-quality review prompt
\* literature synthesis prompt

Prompts should not duplicate information that is better represented as Skills, SOPs, or domain Knowledge.

\---

\# 18. Memories

Memories contain persistent information required by agents across executions.

Examples:

\* stable task preferences
\* previous decisions
\* project-specific context
\* recurring workflow state

Memories must not become an uncontrolled dumping ground.

Information that is general knowledge belongs in \`Knowledge\`.

Information that defines agent behavior belongs in \`Personas\`, \`Skills\`, or \`SOP\`.

\---

\# 19. Workflows

Workflows describe agent execution flows.

Example:

\`\`\`text
User Request
   ↓
Research
   ↓
Retrieve Knowledge
   ↓
Analyze
   ↓
Validate
   ↓
Generate Result
   ↓
Evaluate
\`\`\`

Workflows describe orchestration logic at the AI-agent level.

They are distinct from n8n workflows.

\`\`\`text
AI Workflow
→ controls agent reasoning/execution

n8n Workflow
→ controls external/system automation
\`\`\`

\---

\# 20. Context Packs

A \*\*Context Pack\*\* is a deliberately selected bundle of information supplied to an AI agent for a particular task.

It is useful when an agent needs a stable, bounded context rather than retrieving the entire knowledge base.

For example:

\`\`\`text
Forecasting Context Pack
├── Forecasting SOP
├── Relevant metric definitions
├── Dataset schema
├── Business constraints
├── Model evaluation rules
└── Relevant domain knowledge
\`\`\`

Context Packs can reduce irrelevant retrieval and make agent execution more reproducible.

However, Context Packs are \*\*not mandatory at the beginning\*\*.

They should be introduced only when:

\* agents repeatedly need the same combination of context
\* RAG retrieves too much irrelevant information
\* reproducibility becomes important
\* task-specific context needs explicit versioning

Therefore:

\`\`\`text
Context Packs
→ useful advanced capability
→ not a mandatory first implementation
\`\`\`

\---

\# 21. Evaluation

\*\*Evaluation\*\* means systematically measuring whether an AI agent, model, RAG pipeline, or workflow performs correctly.

An Evaluation definition may specify:

\* test input
\* expected behavior
\* expected output characteristics
\* scoring criteria
\* quality threshold
\* failure cases

Example:

\`\`\`text
Question:
"What is the definition of safety stock?"

Evaluation:
\- retrieves correct source
\- does not invent formula
\- cites relevant knowledge
\- gives correct explanation
\`\`\`

Evaluation becomes particularly important when changing:

\* models
\* prompts
\* RAG strategies
\* Skills
\* agent workflows

However, a full evaluation framework is \*\*not required immediately\*\*.

It becomes important once the number of agents and AI workflows grows enough that manual checking becomes unreliable.

Recommended status:

\`\`\`text
Evaluation
→ useful
→ should exist conceptually
→ implementation can be gradual
\`\`\`

\---

\# 22. Ontology

An \*\*ontology\*\* is a formal representation of entities, concepts, relationships, and meanings within a domain.

For Logistics & Supply Chain, an ontology might define:

\`\`\`text
Supplier
   │
   ├── supplies
   ▼
Product
   │
   ├── stored in
   ▼
Warehouse
   │
   ├── ships
   ▼
Shipment
   │
   ├── delivered to
   ▼
Customer
\`\`\`

It could also define relationships such as:

\`\`\`text
Product
→ Supplier
→ Warehouse
→ Inventory
→ Shipment
→ Demand
→ Order
\`\`\`

Ontology can improve:

\* semantic retrieval
\* entity resolution
\* reasoning
\* relationship-aware RAG
\* data integration
\* knowledge graphs
\* AI understanding of domain structure

However, a formal ontology is \*\*not required for the initial Personal Tool\*\*.

For the current stage:

\`\`\`text
Ontology
→ conceptually valuable
→ especially valuable for Logistics & Supply Chain
→ not an immediate implementation requirement
\`\`\`

Do not build a complex ontology merely for architectural completeness.

Start with consistent schemas, metadata, tags, and semantic definitions.

Introduce formal ontology only when the system demonstrates a real need for relationship-aware reasoning.

\---

\# 23. Recommended Status of Advanced AI Structures

The \`06. AI\` structure should therefore be interpreted as:

\| Component     | Purpose                     |    Priority |
\| ------------- | --------------------------- | ----------: |
\| Skills        | Reusable capabilities       |        High |
\| Personas      | Agent behavior/role         |        High |
\| SOP           | Repeatable procedures       |        High |
\| Prompts       | Reusable instructions       |        High |
\| Memories      | Persistent agent context    |        High |
\| Workflows     | Agent execution logic       |        High |
\| Context Packs | Curated task context        |      Medium |
\| Evaluation    | Measure AI quality          | Medium–High |
\| Ontology      | Formal domain relationships |       Later |

Do not implement all three advanced components merely because folders exist.

\---

\# 24. 07. Projects

\`07. Projects\` stores personal project information.

Possible contents:

\* project goals
\* plans
\* progress
\* milestones
\* decisions
\* research
\* implementation notes
\* project documentation

Projects are separate from general Knowledge because they represent active work and state.

\---

\# 25. 08. Notes

\`08. Notes\` contains personal notes.

These notes are intentionally excluded from the normal embedding/RAG pipeline.

This prevents private or temporary notes from accidentally becoming AI-retrievable knowledge.

The default rule is:

\`\`\`text
08\. Notes
→ NOT embedded
→ NOT included in RAG
\`\`\`

If a specific note is later promoted into Knowledge, it may be manually moved or copied into the appropriate Knowledge location.

\---

\# 26. 09. Templates

\`09. Templates\` contains reusable templates.

Examples:

\* reports
\* orders
\* analysis documents
\* automation procedures
\* project documents
\* structured outputs

Templates do not need to be fully embedded as normal knowledge.

Instead, the AI should know:

1\. that the template exists
2\. what the template is for
3\. where it is located
4\. when it should be used

The retrieval system should therefore index \*\*template metadata\*\*, rather than necessarily embedding the full template content.

Example metadata:

\`\`\`text
Template:
Supply Chain Report

Purpose:
Generate a standardized supply-chain analysis report.

Location:
09\. Templates/Reports/...

Usage:
Use when the user requests a supply-chain report.
\`\`\`

When needed, the actual template file can then be loaded.

\---

\# 27. 99. Archives

\`99. Archives\` contains historical or deprecated material.

Archived content should not normally participate in active RAG.

Archive is primarily for preservation.

The default behavior is:

\`\`\`text
99\. Archives
→ preserved
→ excluded from active retrieval
\`\`\`

Archived information may be explicitly retrieved when requested.

\---

\# 28. Knowledge Retrieval Policy

The default RAG/indexing policy should be:

\`\`\`text
01\. Knowledge
→ EMBED + RAG

02\. Books
→ OPTIONAL EMBED + RAG

03\. Papers
→ OPTIONAL EMBED + RAG

04\. Images
→ NOT automatically embedded

05\. Videos
→ INDEX METADATA / LINKS

06\. AI
→ SPECIALIZED AI CONFIGURATION
→ NOT general knowledge RAG

07\. Projects
→ CONTEXT-DEPENDENT

08\. Notes
→ NO RAG

09\. Templates
→ INDEX TEMPLATE METADATA
→ LOAD ACTUAL TEMPLATE WHEN NEEDED

99\. Archives
→ NO ACTIVE RAG
\`\`\`

This policy prevents the RAG system from indiscriminately embedding the entire Obsidian Vault.

For `01. Knowledge`, the indexing pipeline should automatically extract native Obsidian `#tags` and store them as structured metadata. YAML frontmatter is not required for ordinary Knowledge notes.


\---

\# 29. AI Platform and Knowledge Platform Relationship

The Knowledge Platform provides knowledge.

The AI Platform consumes knowledge.

\`\`\`text
Knowledge Platform
        │
        ├── Obsidian
        ├── Indexing
        ├── Embeddings
        └── Retrieval
                 │
                 ▼
            RAG Router
                 │
                 ▼
          AI Orchestrator
                 │
                 ▼
              Agent
\`\`\`

The AI Platform should not directly manipulate arbitrary Obsidian files unless explicitly permitted through a tool.

\---

\# 30. Automation Platform

The Automation Platform manages repeatable workflows and system integrations.

Primary engine:

\`\`\`text
Automation Platform
        │
        └── n8n
\`\`\`

Responsibilities:

\* schedules
\* webhooks
\* API integrations
\* ingestion triggers
\* data pipeline triggers
\* notifications
\* recurring jobs
\* file workflows
\* AI-triggered workflows
\* system integration

n8n should orchestrate workflows.

Domain logic should remain in the appropriate application, Data Plant, or AI component rather than being duplicated inside n8n.

\---

\# 31. AI Platform

The AI Platform provides general AI capabilities.

\`\`\`text
AI Platform
│
├── AI Orchestrator
├── Model Router
├── Agent Router
├── Tool Router
├── RAG Router
├── Safety & Policy
└── Model Management
\`\`\`

\## AI Orchestrator

Coordinates AI execution.

\## Model Router

Selects the appropriate model.

\## Agent Router

Selects the appropriate specialized agent.

\## Tool Router

Controls available tools.

\## RAG Router

Controls retrieval source and strategy.

\## Safety & Policy

Controls permissions and dangerous/destructive operations.

\## Model Management

Tracks:

\* available models
\* model versions
\* model capabilities
\* resource requirements
\* context limits
\* evaluation results

\---

\# 32. Local AI Hardware Constraint

AI execution must be designed around:

\`\`\`text
Laptop RAM: 24 GB
Laptop GPU VRAM: 6 GB
\`\`\`

The laptop GPU is the primary acceleration resource for local AI models.

The architecture must account for limited VRAM.

Do not assume that every model can run simultaneously.

Model selection should consider:

\* parameter count
\* quantization
\* context length
\* VRAM requirements
\* RAM requirements
\* inference latency
\* concurrent workloads

The system should prefer resource-efficient models when the task does not require a larger model.

\---

\# 33. Logistics & Supply Chain Data Plant

The Data Plant owns the lifecycle of Logistics & Supply Chain data.

Core flow:

\`\`\`text
Data Ingestion
      ↓
Data Landing
      ↓
Data Validation
      │
      ├── INVALID → Quarantine
      │                  ↓
      │             AI Remediation
      │                  ↓
      │             Re-validation
      │
      └── VALID
             ↓
      Data Anonymization
             ↓
          Bronze
             ↓
       Data Pipeline
             ↓
          Silver
             ↓
         AI Engine
             │
             ├── INVALID → Quarantine
             │
             └── VALID
                    ↓
                   Gold
                    ↓
             Semantic Layer
                    ↓
                 Products
\`\`\`

\---

\# 34. Data Plant Products

Products are not merely final outputs for dashboards.

They serve \*\*four major functions\*\*:

\`\`\`text
                         GOLD
                           │
                           ▼
                    SEMANTIC LAYER
                           │
                           ▼
                        PRODUCTS
                           │
          ┌────────────────┼─────────────────┐
          │                │                 │
          ▼                ▼                 ▼
      Analytics           RAG          ML / AI Data
          │                                  │
          ▼                         ┌────────┴─────────┐
      Dashboard                    ▼                  ▼
                              Forecasting         Optimization
                                  │                  │
                                  ▼                  ▼
                             Training Data      Training Data
                                  │                  │
                                  ▼                  ▼
                            Trained Models      Trained Models
                                  │                  │
                                  └────────┬─────────┘
                                           ▼
                                  Future Inference
                                           │
                           ┌───────────────┴───────────────┐
                           ▼                               ▼
                     Forecasting                    Optimization
                           │                               │
                           ▼                               ▼
                    Future demand                  Better routing
                    Future lead time               Better inventory
                    Future volume                  Better allocation
                    etc.                            etc.
\`\`\`

Products therefore support both:

\### Direct consumption

\* dashboards
\* RAG
\* analysis
\* reporting

\### Model development

\* training datasets
\* validation datasets
\* test datasets
\* features
\* historical observations
\* optimization parameters

\### Model inference

Trained models use new data to:

\* forecast future demand
\* forecast lead times
\* forecast inventory requirements
\* predict transportation conditions
\* optimize routes
\* optimize inventory
\* optimize allocation
\* optimize capacity
\* support supply planning

The Data Plant therefore supports a complete loop:

\`\`\`text
Historical Data
      ↓
Data Plant
      ↓
Gold / Products
      ↓
Training Data
      ↓
Model Training
      ↓
Trained Model
      ↓
Prediction / Optimization
      ↓
New Operational Data
      ↓
Data Plant
      ↓
Continuous Improvement
\`\`\`

This creates a \*\*closed-loop data → model → decision → new data architecture\*\*.

\---

\# 35. Forecasting Models

Forecasting models are trained using governed historical datasets produced by the Data Plant.

Potential targets:

\* demand
\* lead time
\* inventory
\* shipment volume
\* delivery time
\* capacity
\* other time-dependent supply-chain variables

The system should retain:

\* training dataset version
\* feature definition
\* model version
\* hyperparameters
\* evaluation metrics
\* training timestamp
\* data lineage

A model must be associated with the data version used to train it.

\---

\# 36. Optimization Models

Optimization models use governed data and business constraints.

Potential applications:

\* transportation routing
\* vehicle allocation
\* inventory optimization
\* warehouse allocation
\* supply allocation
\* capacity planning
\* production planning
\* network optimization

Optimization models may use forecasting outputs as inputs.

Example:

\`\`\`text
Demand Forecast
      +
Inventory State
      +
Transportation Cost
      +
Vehicle Capacity
      +
Service Constraints
      ↓
Optimization Model
      ↓
Recommended Decision
\`\`\`

\---

\# 37. Model Training vs Inference

The architecture must distinguish:

\### Training

Learning model parameters from historical data.

\`\`\`text
Gold / Products
      ↓
Training Dataset
      ↓
Python ML Runtime
      ↓
Training
      ↓
Model Artifact
\`\`\`

\### Inference

Using an already-trained model to produce a prediction or recommendation.

\`\`\`text
New Data
   ↓
Features
   ↓
Trained Model
   ↓
Prediction / Optimization Result
\`\`\`

Training and inference are separate workflows even when they use the same model.

\---

\# 38. Data Governance

Governance applies across the complete Data Plant.

It includes:

\`\`\`text
Metadata
Lineage
Configuration
Testing
Documentation
\`\`\`

Governance is cross-cutting.

It is not a sequential pipeline stage.

\---

\# 39. Metadata

Metadata describes:

\* datasets
\* schemas
\* sources
\* transformations
\* versions
\* quality
\* ownership
\* model relationships
\* product relationships

\---

\# 40. Lineage

Lineage tracks:

\`\`\`text
Source
 ↓
Landing
 ↓
Bronze
 ↓
Silver
 ↓
Gold
 ↓
Product
 ↓
Training Dataset
 ↓
Model
 ↓
Prediction / Optimization
\`\`\`

This allows the system to answer:

\* Which source produced this model?
\* Which data produced this prediction?
\* Which transformation produced this feature?
\* Which model generated this recommendation?

\---

\# 41. Configuration

Configuration defines:

\* source settings
\* schemas
\* validation rules
\* transformation rules
\* anonymization rules
\* pipeline settings
\* AI review thresholds
\* model settings
\* workflow settings

Secrets must not be committed to Git.

\---

\# 42. Testing

Testing applies to:

\* application code
\* data ingestion
\* schemas
\* validation
\* transformations
\* pipelines
\* model training
\* model evaluation
\* AI behavior
\* integrations

A pipeline completing successfully does not imply that the data is correct.

\---

\# 43. Documentation

Important components must be documented.

Documentation should describe:

\* purpose
\* inputs
\* outputs
\* schemas
\* transformations
\* assumptions
\* dependencies
\* limitations
\* ownership
\* lineage

\---

\# 44. Security Rules

Never:

\* commit secrets
\* expose \`.env\` values
\* print API keys
\* expose database passwords
\* expose private tokens
\* give unrestricted AI filesystem access
\* give unrestricted AI database write access

Environment files may be inspected for variable names and structure, but secret values must remain redacted.

Example:

\`\`\`text
DATABASE\_HOST=postgres
DATABASE\_PORT=5432
DATABASE\_USER=...
DATABASE\_PASSWORD=[REDACTED]
\`\`\`

\---

\# 45. Development Rules for Codex

Before modifying the repository:

1. Read this `AGENTS.md`.
2. Read `PLAN.md` when it exists.
3. Inspect the repository structure.
4. Inspect relevant source files.
5. Inspect Docker Compose configuration.
6. Inspect database schemas and migrations.
7. Inspect environment variable names without exposing secret values.
8. Determine what is already implemented.
9. Determine what is planned but missing.
10. Identify dependencies and side effects.
11. Make the smallest appropriate change.

Classify architecture/components as:

\`\`\`text
IMPLEMENTED
PARTIALLY IMPLEMENTED
PLANNED
MISSING
INCONSISTENT
DEPRECATED
\`\`\`

Never assume that an architecture component exists merely because it is described in this document.

\---

# 46. Development Plan — PLAN.md

`PLAN.md` is the **source of truth for project progress and development sequencing**.

`AGENTS.md` defines how Codex should work. `PLAN.md` defines what the project is currently trying to accomplish, what has been completed, and what should happen next.

The files have different responsibilities:

```text
AGENTS.md
→ development rules
→ architectural constraints
→ coding/validation behavior

PLAN.md
→ milestones
→ current state
→ active task
→ next action
→ blockers
→ Definition of Done
```

Codex must not treat the architecture described in `AGENTS.md` as evidence that an implementation already exists.
## Plan Scope

`PLAN.md` defines:
- what to build
- why it is being built
- implementation order
- acceptance criteria
- current progress

It must not become the source of truth for:
- detailed API schemas
- database schemas
- Docker configuration
- implementation-specific code structure
- low-level architecture decisions

Those belong to the relevant source files and documentation.

## Evidence Rule

Every `IMPLEMENTED` item must be supported by observable repository evidence.

Evidence may include:
- source/configuration files
- passing automated tests
- successful Docker/service health checks
- reproducible commands
- validated API behavior
- validated data-pipeline output

A directory existing by itself is not implementation evidence.

## Active Task Rule

Only the current Active Task is considered in scope unless the owner explicitly changes the scope.

Codex must not:
- implement future milestones proactively
- refactor unrelated components
- introduce infrastructure for future milestones
- mark future tasks as complete based on partial prerequisites

If a prerequisite is discovered, record it in `PLAN.md` before expanding scope.

## Dependency Rule

A milestone may begin only when its declared dependencies are either:
1. `COMPLETE`, or
2. explicitly approved as parallel work by the owner.

A milestone must not silently depend on undocumented infrastructure or services.

## 46.1 PLAN.md as Progress Source of Truth

When `PLAN.md` exists:

1. Read it before starting development work.
2. Identify the current milestone.
3. Identify the current active task.
4. Work primarily within that task's defined scope.
5. Inspect the repository before assuming the task is incomplete.
6. Update `PLAN.md` after completing, blocking, or materially changing the task.
7. Keep milestone and task status consistent with the actual repository state.

Recommended status vocabulary:

```text
NOT STARTED
IN PROGRESS
BLOCKED
COMPLETE
DEFERRED
CANCELLED
```

Do not mark a task `COMPLETE` merely because code was written. The task must satisfy its Definition of Done and relevant validation requirements.

## 46.2 Current Focus

`PLAN.md` should contain an explicit current focus, for example:

```md
## Current Focus

Milestone: M1 — Development Foundation
Status: IN PROGRESS

Task: Implement real CI

Scope:
- lint
- unit tests
- integration tests
- secret scan

Next Action:
Replace placeholder CI jobs with the actual checks.

Blockers:
- None
```

Codex should use the current focus to avoid unnecessary scope expansion.

Do not jump from the active task to a later milestone merely because the later architecture is already described.

## 46.3 Updating PLAN.md

After meaningful implementation work, update `PLAN.md` when any of the following occurs:

- a task is completed
- a task becomes blocked
- a task is deferred or cancelled
- the implementation materially changes the planned approach
- a new dependency or prerequisite is discovered
- the Definition of Done changes
- the current active task changes

Updates must describe **actual project state**, not intentions.

Prefer:

```text
[x] PostgreSQL + pgvector
[ ] Redis
[ ] MinIO
```

over vague statements such as:

```text
Database infrastructure mostly done.
```

If a task is partially implemented, state what is actually implemented and what remains.

## 46.4 Scope Discipline

`PLAN.md` is a sequencing document, not permission to implement the entire architecture at once.

Codex should:

- complete the smallest coherent unit of work
- avoid implementing future milestones prematurely
- avoid creating infrastructure solely because it appears in the target architecture
- avoid adding services, databases, frameworks, or abstractions without a concrete requirement
- preserve working increments after each meaningful change

The existence of a planned milestone does not make it part of the current task.

## 46.5 Architecture Changes vs Plan Changes

If implementation reveals that an architectural decision is inadequate:

1. Stop and understand the affected boundary.
2. Explain the problem.
3. Identify the smallest viable architectural change.
4. Update the relevant architecture documentation.
5. Update `PLAN.md` if the development sequence, scope, dependency, or Definition of Done changes.
6. Validate the resulting implementation.

Do not silently rewrite the roadmap to make an unexpected implementation appear planned.

## 46.6 Relationship to Other Documentation

Use the repository documentation hierarchy as follows:

```text
AGENTS.md
→ rules and constraints for AI-assisted development

PLAN.md
→ current development state and sequencing

README.md
→ project purpose, setup, and user-facing operation

CHANGELOG.md
→ historical record of completed changes/releases
```

Do not duplicate the full roadmap into `README.md` or `AGENTS.md`.

Do not use `PLAN.md` as a substitute for architecture documentation.

Do not use `CHANGELOG.md` as a task tracker.

## 46.7 Completion Discipline

A milestone is complete only when its required Definition of Done is satisfied.

Before marking a milestone complete, Codex should verify:

- implementation exists
- relevant tests pass
- integration boundaries work where applicable
- configuration is valid
- no secrets are exposed
- relevant Docker services are healthy
- documented limitations are recorded
- the next milestone/task is explicitly identified

If validation cannot be performed, do not claim completion. Record the limitation or blocker in `PLAN.md`.

---

\# 47. Change Management

Do not silently change architectural decisions.

When a change affects architecture:

1\. Explain the problem.
2\. Identify the current component responsible.
3\. Explain why the current architecture is insufficient.
4\. Propose the smallest appropriate change.
5\. Identify affected components.
6\. Implement only after the architecture is understood.
7\. Validate the result.

Avoid introducing new databases, services, frameworks, or infrastructure without a concrete requirement.

\---

\# 48. Validation After Changes

After implementation:

1\. Run relevant tests.
2\. Validate Docker configuration.
3\. Validate affected services.
4\. Validate database migrations/schema.
5\. Validate data-pipeline behavior where applicable.
6\. Validate AI behavior where applicable.
7\. Check resource usage where relevant.
8\. Confirm no secrets were exposed.
9\. Report exactly what changed.
10\. Report unresolved assumptions or limitations.

Never claim that a component works without validating it.

\---

\# 49. Architectural Boundaries

The four primary functional domains have explicit ownership:

\`\`\`text
Automation Platform
→ repeatable workflows, schedules, integrations

AI Platform
→ models, agents, orchestration, retrieval, tool control

Logistics & Supply Chain Data Plant
→ L&SC data lifecycle, quality, transformation, products, ML data

Knowledge Platform
→ Obsidian knowledge, indexing, embeddings, retrieval
\`\`\`

Infrastructure provides runtime capabilities to all domains.

A component may communicate with another domain without taking ownership of that domain's responsibilities.

\---

\# 50. Final Conceptual Architecture

\`\`\`text
                              PERSONAL TOOL
                                   │
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
          ▼                        ▼                        ▼
 AUTOMATION PLATFORM          AI PLATFORM          KNOWLEDGE PLATFORM
          │                        │                        │
         n8n                AI Orchestrator             Obsidian
                                   │                        │
                     ┌─────────────┼─────────────┐          │
                     ▼             ▼             ▼          │
                  Models         Agents        Tools        │
                                   │                        │
                                   ▼                        ▼
                                 RAG ◄────────────── Knowledge
                                   │                  Retrieval
                                   │
                                   │
          ┌────────────────────────┴─────────────────────────────┐
          │                                                      │
          ▼                                                      ▼
 LOGISTICS & SUPPLY CHAIN DATA PLANT                     AI / ML PRODUCTS
          │                                                      │
          ▼                                                      │
 Data Ingestion                                                │
          ↓                                                     │
 Data Landing                                                  │
          ↓                                                     │
 Data Validation ──→ Quarantine ──→ AI Remediation             │
          ↓                                                     │
 Data Anonymization                                            │
          ↓                                                     │
 Bronze                                                        │
          ↓                                                     │
 Data Pipeline                                                 │
          ↓                                                     │
 Silver                                                        │
          ↓                                                     │
 AI Engine ──────────────→ Quarantine                          │
          ↓                                                     │
 Gold ─────────────────────────────────────────────────────────┤
          ↓                                                     │
 Semantic Layer                                                │
          ↓                                                     │
 Products ────────────────┬───────────────┬────────────────────┘
                          │               │
                       Dashboard        RAG
                          │
                          └───────┬───────────────┐
                                  ▼               ▼
                            Forecasting      Optimization
                                  │               │
                                  ▼               ▼
                            Training Data    Training Data
                                  │               │
                                  ▼               ▼
                             ML Training      Optimization Training
                                  │               │
                                  ▼               ▼
                           Trained Models     Trained Models
                                  │               │
                                  └───────┬───────┘
                                          ▼
                                  Future Inference
                                          │
                             ┌────────────┴────────────┐
                             ▼                         ▼
                         Forecasting              Optimization


                        SHARED INFRASTRUCTURE
 ┌────────────────────────────────────────────────────────────────────┐
 │ Docker Compose │ Nginx │ PostgreSQL │ pgvector │ Redis │ MinIO     │
 │ Ollama │ Python Runtime │ Prometheus │ Grafana │ Dozzle │ n8n      │
 └────────────────────────────────────────────────────────────────────┘

                         LOCAL AI HARDWARE
                              │
                     ┌────────┴────────┐
                     │                 │
                  24 GB RAM        6 GB VRAM
                     │                 │
                     └───────┬─────────┘
                             ▼
                     Local GPU-accelerated
                         AI inference
\`\`\`

\---

\# 51. Non-Goals

Personal Tool is currently not intended to become:

\* a multi-user SaaS platform
\* an enterprise data platform
\* a cloud-native distributed data platform
\* a Kubernetes deployment
\* a Kafka-based streaming platform
\* a generic public data warehouse
\* a replacement for Obsidian
\* a replacement for n8n
\* an unrestricted autonomous AI system

The architecture should evolve only when concrete requirements justify additional complexity.