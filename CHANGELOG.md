# Changelog
# CHANGELOG

All notable, validated changes to Personal Tool are documented here.

`CHANGELOG.md` records completed work only. It is not a roadmap, task list, development status, or architecture proposal.

## [Unreleased]

No completed changes recorded yet.

---

## Changelog Rules

### Completed Changes Only

An entry may be added only after the corresponding task reaches its Definition of Done in `PLAN.md`.

Do not record:

* planned work;
* work in progress;
* blocked work;
* placeholders;
* empty directories;
* unverified code;
* speculative architecture;
* future milestones.

### Categories

Use the following categories:

* `Added` — new validated functionality.
* `Changed` — validated changes to existing functionality.
* `Fixed` — validated bug fixes.
* `Security` — validated security improvements or fixes.

### Source of Truth

`PLAN.md` is the authoritative source for:

* current progress;
* Active Task;
* milestone status;
* component status;
* dependencies;
* completion evidence.

`CHANGELOG.md` is only the historical record of changes that have already been completed and validated.

Do not use this file to determine what should be implemented next.

### Evidence

Every changelog entry must correspond to verified repository state.

A file, directory, configuration declaration, placeholder, or documentation entry does not by itself prove that functionality is implemented.

Validation evidence is maintained in `PLAN.md`.

### Update Timing

When a task reaches Definition of Done:

1. update `PLAN.md`;
2. record the completion evidence;
3. add the corresponding changelog entry;
4. keep these changes in the same change set whenever practical.

Do not add a changelog entry before validation is complete.


This file records material architectural changes rather than individual commits.

## Unreleased

### Changed

- Replaced the initial partial scaffold with the approved Personal Tool architecture.
- Centralized observability under `infrastructure/observability/`.
- Separated document-oriented Knowledge RAG from L&SC Data Product RAG.
- Added cross-platform tests, experimental workspaces, and CI workflow placeholders.
