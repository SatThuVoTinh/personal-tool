# Function / Subagent / Skill Namespace Mapping

This directory records cross-repository compatibility expectations only. The ZAS
repository remains authoritative for executable team/subagent definitions; the
Knowledge Platform remains authoritative for persisted skill-namespace identity.

For every active ZAS leaf function, integration validation must prove exactly one
mapping:

```text
function_id ↔ subagent_id ↔ namespace_id
```

The current ZAS architecture baseline contains 32 leaf functions. They are
mirrored in `ZAS_NAMESPACE_MAP.md` and under
`platforms/knowledge-platform/stores/agent-skill-store/namespaces/`. Any later
ZAS leaf-function addition/removal/split/merge requires an explicit mapping
update rather than silently creating team-wide shared memory.
