# ZAS Integration Namespace Map

This architecture map mirrors the leaf functions in the current generated Zink Agents System tree. Each row is one functional subagent boundary and one Agent Skill Store namespace.

| ZAS leaf function | Skill namespace | ZAS definition |
| --- | --- | --- |
| `automation/integrations` | `automation/integrations` | `agents/teams/automation/integrations/agent.yaml` |
| `automation/operations` | `automation/operations` | `agents/teams/automation/operations/agent.yaml` |
| `automation/triggers` | `automation/triggers` | `agents/teams/automation/triggers/agent.yaml` |
| `automation/workflow` | `automation/workflow` | `agents/teams/automation/workflow/agent.yaml` |
| `business/financial-analysis` | `business/financial-analysis` | `agents/teams/business/financial-analysis/agent.yaml` |
| `business/market-analysis` | `business/market-analysis` | `agents/teams/business/market-analysis/agent.yaml` |
| `business/operations-analysis` | `business/operations-analysis` | `agents/teams/business/operations-analysis/agent.yaml` |
| `business/performance` | `business/performance` | `agents/teams/business/performance/agent.yaml` |
| `data/analysis` | `data/analysis` | `agents/teams/data/analysis/agent.yaml` |
| `data/ingestion` | `data/ingestion` | `agents/teams/data/ingestion/agent.yaml` |
| `data/reporting/excel` | `data/reporting/excel` | `agents/teams/data/reporting/excel/agent.yaml` |
| `data/reporting/power-bi` | `data/reporting/power-bi` | `agents/teams/data/reporting/power-bi/agent.yaml` |
| `data/transformation` | `data/transformation` | `agents/teams/data/transformation/agent.yaml` |
| `data/validation` | `data/validation` | `agents/teams/data/validation/agent.yaml` |
| `lscm/demand-planning` | `lscm/demand-planning` | `agents/teams/lscm/demand-planning/agent.yaml` |
| `lscm/inventory` | `lscm/inventory` | `agents/teams/lscm/inventory/agent.yaml` |
| `lscm/logistics-operations` | `lscm/logistics-operations` | `agents/teams/lscm/logistics-operations/agent.yaml` |
| `lscm/optimization` | `lscm/optimization` | `agents/teams/lscm/optimization/agent.yaml` |
| `lscm/procurement` | `lscm/procurement` | `agents/teams/lscm/procurement/agent.yaml` |
| `lscm/production-planning` | `lscm/production-planning` | `agents/teams/lscm/production-planning/agent.yaml` |
| `lscm/supplier-management` | `lscm/supplier-management` | `agents/teams/lscm/supplier-management/agent.yaml` |
| `lscm/supply-planning` | `lscm/supply-planning` | `agents/teams/lscm/supply-planning/agent.yaml` |
| `lscm/transportation` | `lscm/transportation` | `agents/teams/lscm/transportation/agent.yaml` |
| `lscm/warehouse` | `lscm/warehouse` | `agents/teams/lscm/warehouse/agent.yaml` |
| `research/evidence-review` | `research/evidence-review` | `agents/teams/research/evidence-review/agent.yaml` |
| `research/research-planning` | `research/research-planning` | `agents/teams/research/research-planning/agent.yaml` |
| `research/synthesis` | `research/synthesis` | `agents/teams/research/synthesis/agent.yaml` |
| `research/validation` | `research/validation` | `agents/teams/research/validation/agent.yaml` |
| `system/configuration` | `system/configuration` | `agents/teams/system/configuration/agent.yaml` |
| `system/diagnostics` | `system/diagnostics` | `agents/teams/system/diagnostics/agent.yaml` |
| `system/maintenance` | `system/maintenance` | `agents/teams/system/maintenance/agent.yaml` |
| `system/monitoring` | `system/monitoring` | `agents/teams/system/monitoring/agent.yaml` |

Total active architecture mappings in this baseline: **32**.

The `subagent_id` persistent identifier is frozen when the executable integration contract is approved. Until then, the leaf path is the architecture identity and must not be silently merged or split.
