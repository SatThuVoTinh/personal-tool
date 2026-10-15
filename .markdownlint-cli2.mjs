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
    // Closed execution contracts, archived verbatim by the closeout rule in
    // docs/contracts/execution/archive/README.md. Byte-faithful for the same reason;
    // anchored to the dated filename form so the directory README stays linted.
    "docs/contracts/execution/archive/2[0-9][0-9][0-9]-*.md",
    "node_modules/**",
  ],
};
