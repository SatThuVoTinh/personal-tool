export default {
  config: {
    default: true,
    MD013: false,
  },
  globs: ["README.md", "CHANGELOG.md", "docs/**/*.md", "experiments/**/*.md"],
  ignores: [
    "AGENTS.md",
    "PLAN.md",
    "docs/contracts/execution/ACTIVE.md",
    // Verbatim archive of the superseded git-ignored ACTIVE.md backlog. Kept
    // byte-faithful on purpose, so it carries that file's original formatting.
    "docs/contracts/m7-m8-red-team-backlog.md",
    "node_modules/**",
  ],
};
