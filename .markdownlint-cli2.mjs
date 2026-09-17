export default {
  config: {
    default: true,
    MD013: false,
  },
  globs: ['README.md', 'CHANGELOG.md', 'docs/**/*.md', 'experiments/**/*.md'],
  ignores: [
    'AGENTS.md',
    'PLAN.md',
    'docs/contracts/execution/ACTIVE.md',
    'node_modules/**',
  ],
};
