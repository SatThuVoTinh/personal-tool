# Five-Stack Operating Model

The five stacks are functional processing layers, not repository modules or
permanent agent processes. Stable protocol IDs are `infrastructure`,
`data_plant`, `semantic`, `intelligence`, and `decision`.

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
