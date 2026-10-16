# Five-Stack Operating Model

The five stacks are functional processing layers, not repository modules or
permanent agent processes. Stable protocol IDs are `infrastructure`,
`data_plant`, `semantic`, `intelligence`, and `decision`.

> **Caveat — this table is not the runtime.** `integrations/openclaw/lib/authority.mjs:581-582`
> binds `o1` to `infrastructure` + `data_plant` and `o2` to `semantic` +
> `intelligence` + `decision`, so the Coordinator column is inverted for the Data
> Plant, Semantic and Intelligence rows. Rewriting this table is owned by
> `M12/T3` (the owner assigned the file there); the line above exists only so a
> reader does not take the table for the enforced topology while that task is
> pending.

| Stack          | Coordinator | Executor / support                                         | Responsibility                                                                                                |
| -------------- | ----------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Infrastructure | Main        | O2 designated support/future executor                      | External runtime, storage, compute, network and monitoring; T2 grants no infrastructure execution capability. |
| Data Plant     | O2          | Excel, SQL, Python                                         | Extract, clean, validate, transform and publish governed datasets.                                            |
| Semantic       | O1          | Power BI, SQL, Excel, Python                               | KPI, metric, schema meaning, business rules and constraints.                                                  |
| Intelligence   | O1          | Python primary; Excel/Power BI when needed                 | Statistics, forecast, ML, risk, OR, optimization and simulation.                                              |
| Decision       | Main        | O1/O2 support; specialist evidence through its coordinator | Final evidence synthesis, assumptions, constraints, trade-offs and owner-facing decision response.            |

Main is the only authority that changes execution between coordinators or
functional stacks. O1 and O2 return a transition request to Main instead of
invoking one another. The execution graph is a DAG and downstream work starts
only after declared dependencies are accepted.

`agent != stack`: a specialist may support multiple stacks, but it cannot
delegate, expand scope or claim workflow-level Decision completion. Direct
depth-0 sessions are independent single-stack workflows; missing prerequisites
remain BLOCKED and require a new Main workflow rather than a hidden A2A edge.
