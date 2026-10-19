# Five-Stack Operating Model

The five stacks are functional processing layers, not repository modules or
permanent agent processes. Stable protocol IDs are `infrastructure`,
`data_plant`, `semantic`, `intelligence`, and `decision`.

> **This table is derived, not remembered.** The Coordinator and
> Executor / support columns are re-derived from the two enforced policy
> tables, `AGENT_STACK_POLICY`
> (`integrations/openclaw/lib/authority.mjs`) and `AGENT_SPAWN_POLICY`
> (`integrations/openclaw/lib/policy.mjs`), by
> `tests/m12-t2.2-a2-stack-registry.test.mjs` (M12/T9 F-118). A row that
> names a coordinator which cannot spawn the specialists it lists, or a
> specialist that is not admitted on that stack, fails that gate. The table
> used to be written by hand from a retired roster and had drifted into the
> inverse of the enforced spawn tree, so an operator reading it dispatched
> ETL work to a coordinator the guard denies.

| Stack          | Coordinator | Executor / support                                  | Responsibility                                                                                                |
| -------------- | ----------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Infrastructure | Main, O1    | none admitted, no specialist holds `infrastructure` | External runtime, storage, compute, network and monitoring; T2 grants no infrastructure execution capability. |
| Data Plant     | O1          | Excel, SQL, Python                                  | Extract, clean, validate, transform and publish governed datasets.                                            |
| Semantic       | O2          | Power BI                                            | KPI, metric, schema meaning, business rules and constraints.                                                  |
| Intelligence   | O2          | Power BI, Python                                    | Statistics, forecast, ML, risk, OR, optimization and simulation.                                              |
| Decision       | Main, O2    | Power BI, Python                                    | Final evidence synthesis, assumptions, constraints, trade-offs and owner-facing decision response.            |

Main is the only authority that changes execution between coordinators or
functional stacks. O1 and O2 return a transition request to Main instead of
invoking one another. The execution graph is a DAG and downstream work starts
only after declared dependencies are accepted.

`agent != stack`: a specialist may support multiple stacks, but it cannot
delegate, expand scope or claim workflow-level Decision completion. Direct
depth-0 sessions are independent single-stack workflows; missing prerequisites
remain BLOCKED and require a new Main workflow rather than a hidden A2A edge.

**What a row's executor list is, and is not.** It is the specialists the row's
coordinator dispatches ONTO that stack: O1 dispatches `excel`, `sql` and
`python`, O2 dispatches `power-bi` and `python`. A specialist admitted on a
stack its row does not list (Excel and SQL are admitted on `semantic` and
`decision`; Python is admitted on `data_plant` and `decision`) is dispatched
by its own coordinator, so a row is not the whole specialist population of a
stack.

**Still open for M12/T3 (not decided here).** A brief node whose `stack_id` is
`decision` must be `main`-owned (`integrations/openclaw/topology/lib/guard.mjs`),
while `AGENT_SPAWN_POLICY` lets `main` name only `o1` and `o2`, so the
decision-stack node is currently unreachable. That contradiction is the
owner's open item and this table does not resolve it: the `Decision` row names
Main as the node owner and O2 as the coordinator that dispatches the stack's
specialists.
