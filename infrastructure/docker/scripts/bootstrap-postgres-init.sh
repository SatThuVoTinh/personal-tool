#!/bin/sh
# F-INFRA-002 (owner option C, 2026-11-01): the PostgreSQL image executes
# everything mounted in /docker-entrypoint-initdb.d while it initializes an
# empty data volume. Running the idempotent role bootstrap there gives a fresh
# volume its module logins before any module container starts, without relying
# on start.ps1 having run the one-shot postgres-bootstrap helper first.
# Existing volumes still use that helper on every start.
#
# The image entrypoint *sources* a non-executable *.sh init file and runs an
# executable one as a child, so this wrapper must behave correctly in both
# modes. It never relies on the mount preserving an executable bit, never
# `exec`s (that would replace the image entrypoint when sourced), and never
# sources the bootstrap itself (its EXIT trap would replace the entrypoint's
# temporary-server cleanup). A failed bootstrap aborts the first boot instead
# of leaving a reachable cluster with no module roles.
/bin/sh /usr/local/bin/bootstrap-postgres.sh || {
  status=$?
  printf 'first-boot role bootstrap failed (exit %s)\n' "$status" >&2
  exit "$status"
}