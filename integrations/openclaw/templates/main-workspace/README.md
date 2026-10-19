# main-workspace template

This directory is a **placeholder**, not the workspace template.

The workspace template an operator would expect to edit here is implemented in
code, in `integrations/openclaw/lib/policy.mjs`:

- `assertWorkspaceMatchesTemplate(workspacePath, expectedInstructions, ...)`
  compares a deployed agent workspace against the expected instruction set;
- `agentInstructions(agentId)` produces that expected set.

Nothing in the repository reads a file from this directory, so editing a file
placed here changes nothing at runtime. `M12/T9 F-118`/`F-018` closed that
ambiguity: the tracked `README.md` now names where the template actually
lives, and `tests/m7-t2-openclaw.test.mjs` gates it.

To change the workspace template, change `policy.mjs` (or the agent
instructions it renders), not this directory.
