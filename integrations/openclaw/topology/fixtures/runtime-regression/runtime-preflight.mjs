import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// Redacted read-only preflight. No config/auth/identity-key contents are read.
// F-219: the machine-specific state root is NOT a literal (see
// operator-token-probe.mjs): the caller names it, or the probe refuses to
// run. A read-only preflight that silently inspects one operator's machine
// says nothing about any other.
const state = process.env.ZINK_PROBE_STATE_DIR ?? process.argv[2] ?? null;
if (!state) {
  process.stderr.write("RUNTIME_PREFLIGHT_STATE_DIR_NOT_NAMED\n");
  process.exit(2);
}
const root = path.join(state, "operator", "m7-t2", "ledger");
try {
  const snapshotPath = path.join(root, "snapshot.json");
  const report = { ledger_present: existsSync(snapshotPath) };
  if (report.ledger_present) {
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    const events = readFileSync(path.join(root, "events.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
    report.ledger = {
      r11: snapshot.governance_version === "m7-t2-r11",
      r12: snapshot.governance_version === "m7-t2-r12",
      sequence: Number.isSafeInteger(snapshot.sequence)
        ? snapshot.sequence
        : null,
      tasks: Object.keys(snapshot.tasks ?? {}).length,
      event_count: events.length,
      workflow_events: events.filter(
        (event) =>
          typeof event.type === "string" && event.type.startsWith("WORKFLOW_"),
      ).length,
    };
  }
  const entry = path.join(state, "extensions", "zink-governance", "index.mjs");
  report.plugin_sha256 = existsSync(entry)
    ? createHash("sha256").update(readFileSync(entry)).digest("hex")
    : null;
  report.installed_mutation = false;
  process.stdout.write(`${JSON.stringify(report)}\n`);
} catch {
  process.stderr.write("RUNTIME_PREFLIGHT_UNAVAILABLE\n");
  process.exitCode = 1;
}
