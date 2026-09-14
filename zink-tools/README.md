# Zink Tools

Zink Tools provides governed callable tool interfaces and adapter contracts for
Excel, Power BI, SQL, Python, n8n and decision-science capabilities. It is a thin
governed boundary, not an orchestrator, workflow-state store, Knowledgebase,
Skill Store, model runtime or generic platform.

## 1. Five Governed Callable Interfaces

| Tool ID | Specialist | Execution Mode | Schema | Semantic Contract |
| --- | --- | --- | --- | --- |
| `zink_excel` | `excel` | `contract_interface` | [`zink-excel.schema.json`](contracts/tools/zink-excel.schema.json) | [`excel/contract.md`](excel/contract.md) |
| `zink_power_bi` | `power-bi` | `contract_interface` | [`zink-power-bi.schema.json`](contracts/tools/zink-power-bi.schema.json) | [`power-bi/contract.md`](power-bi/contract.md) |
| `zink_sql` | `sql` | `contract_interface` | [`zink-sql.schema.json`](contracts/tools/zink-sql.schema.json) | [`sql/contract.md`](sql/contract.md) |
| `zink_python` | `python` | `contract_interface` | [`zink-python.schema.json`](contracts/tools/zink-python.schema.json) | [`python/contract.md`](python/contract.md) |
| `zink_n8n` | `o2`, `python` | `governed_adapter` | [`zink-n8n.schema.json`](contracts/tools/zink-n8n.schema.json) | [`n8n/contract.md`](n8n/contract.md) |

## 2. Four Deferred Schema-Only Capabilities

These decision-science problem formulations are strictly non-callable specifications
under M7/T3. They are governed directly by their closed JSON schemas:

- **`zink_forecast`**: Time-series forecasting problem formulation schema ([`zink-forecast.schema.json`](contracts/tools/zink-forecast.schema.json)). Stacks: `intelligence`, `decision`.
- **`zink_optimization`**: Mathematical programming and optimization problem formulation schema ([`zink-optimization.schema.json`](contracts/tools/zink-optimization.schema.json)). Stacks: `decision`.
- **`zink_operations_research`**: Network flow and operations research modeling schema ([`zink-operations-research.schema.json`](contracts/tools/zink-operations-research.schema.json)). Stacks: `decision`.
- **`zink_simulation`**: Stochastic Monte Carlo and discrete event simulation formulation schema ([`zink-simulation.schema.json`](contracts/tools/zink-simulation.schema.json)). Stacks: `decision`.

## 3. Envelopes & Safety Utilities

- **Invocation Envelope**: [`contracts/tool-call.schema.json`](contracts/tool-call.schema.json)
- **Result Envelope**: [`contracts/tool-result.schema.json`](contracts/tool-result.schema.json)
- **Path Safety**: [`common/path-safety.mjs`](common/path-safety.mjs)
- **SQL Validator**: [`sql/validator.mjs`](sql/validator.mjs)
- **n8n Webhook Trigger**: [`n8n/trigger.mjs`](n8n/trigger.mjs)
