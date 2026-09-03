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

OpenClaw owns orchestration, `work | research` classification, specialist
routing, sandbox/execution permissions and tool invocation policy.

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
