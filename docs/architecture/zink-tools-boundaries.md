# Zink Tools Boundaries

## Principle

Zink Tools is a **small callable toolbox**, not another framework or orchestrator.

Canonical repository path: `zink-tools/`. OpenClaw integration lives separately at `integrations/openclaw/`.

```text
OpenClaw ──► Zink Tools
n8n ───────►     │
                 ├─ Excel
                 ├─ Power BI
                 ├─ SQL
                 ├─ Python
                 ├─ n8n integration
                 ├─ Forecast
                 ├─ Optimization
                 ├─ Operations Research
                 └─ Simulation
```

That diagram is a list of **capability families**, not of what the package
exports, so the two are separated here.

Callable tools — the surface OpenClaw may invoke
(`CALLABLE_TOOL_REGISTRY` in `integrations/openclaw/lib/policy.mjs`):

```text
zink_excel  zink_power_bi  zink_sql  zink_python  zink_n8n
```

The contract-backed envelope in `zink-tools/contracts/tool-call.schema.json`
and `tool-result.schema.json` covers **every registered tool**, not only these
five: the plugin's loader registers eight — the five above plus
`zink_skill_search`, `zink_knowledge_search` and `zink_skill_propose`. Both
envelopes carry a branch per registered tool, and the specialist vocabulary of
each branch is the one the canonical policy derives (the execution tools' grant
from `getAllowedSpecialists()`, the memory tools' from `canAccessMemoryTool()`).
The three memory tools are refused earlier, at the guard's capability seam, so
their envelope branches are declarative — they state what a valid call would
look like without changing a reachable behaviour.

Adapters actually exported by `zink-tools/adapters/index.mjs` (each with its
`*AdapterError` sibling; `Knowledge` and `Skill` also export their governed-query
helpers):

```text
R2  MotherDuck  BigQuery  Kaggle  Databricks  MLflow  DagsHub
HuggingFace  Streamlit  Knowledge  Skill
```

Forecast, Optimization, Operations Research and Simulation are first-class
capabilities (`AGENTS.md` §9) with no callable tool and no module today:
`zink-tools/<capability>/` holds a README and a `model-metadata/` directory, and
nothing imports them. They are exercised through `zink_python` and the external
compute adapters until a real provider difference requires a module of their own.

## Tool ownership

### Excel

Loads/populates/validates owner-built Excel templates. Canonical template assets
remain in Zink Skill Store.

### Power BI

Loads/binds/updates/validates owner-built Power BI project/templates. Canonical
template assets remain in Zink Skill Store.

### SQL

Executes bounded query work against approved data sources. Business meaning and
retention/drop rules come from semantic/domain authority, not the SQL tool.

### Python

Runs bounded cleaning, transformation, analysis, validation and model glue.

### Forecast / Optimization / OR / Simulation

Expose decision-science capability. Heavy training/compute may run on external
infrastructure; Zink should prefer the lightest direct integration that keeps
OpenClaw safely decoupled from provider details that genuinely vary.

## OpenClaw boundary

OpenClaw owns orchestration, specialist routing, sandbox/execution permissions and
tool invocation policy. The work/research task-mode classification is not implemented
today: no schema or runtime carries it, so it is recorded only as a proposal in
`work-research-routing.md` and is not a boundary this document delegates.

Baseline execution specialists are exactly:

```text
Excel Specialist
Power BI Specialist
SQL Specialist
Python Specialist
```

Intelligence specialists are task-driven/lazy rather than mandatory permanent
processes.

## n8n boundary

n8n owns triggers, schedules, connectors and deterministic workflow run state. It
does not own final reasoning or agent routing.

## Anti-overengineering rules

1. Do not build a generic data platform around existing services.
2. Do not create provider adapters until a real provider difference requires one.
3. Do not duplicate OpenClaw or n8n orchestration state.
4. Do not store template content inside tool code.
5. Do not store Knowledgebase/Skill Store state inside tool adapters.
6. Do not silently promote Research output into Work/production.
7. Secrets remain outside tracked files.
