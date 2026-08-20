# Cline subagent policy

Use native subagents for **read-only reconnaissance**, not implementation.

Use them only when parallel research materially reduces main-context pollution or
resolves an evidence gap. Small obvious tasks should not spawn subagents.

For authorized execution, prefer at most three focused research questions:

1. implementation/ownership/dependency map;
2. tests/validation/baseline map;
3. material risk map when security, persistence, schema, infrastructure,
   resources, compatibility, or ownership boundaries are relevant.

Every subagent inherits the parent's current authorized scope but gains no new
authority. Tell it to return verified evidence, paths/symbols/commands,
uncertainties, and blockers without redesigning or expanding scope.

Main Cline must verify decisive subagent claims against repository sources before
editing. Subagent reports are leads, not authority.
