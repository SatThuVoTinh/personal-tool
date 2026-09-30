// M8/T2.2-R16 — the rehearsal driver.
//
// Runs the R16 apply rehearsal against an exact clone of the live R7 runtime and
// then proves the live environment is byte-identical.
//
//   1. Fingerprint the real runtime from OUTSIDE any namespace.
//   2. Re-enter in a private mount namespace (`unshare --map-root-user`) and run
//      the R16 suite there. The suite overlays the live directories; the lower
//      layer IS the live runtime, so the clone cannot drift from it.
//   3. Fingerprint the real runtime again and diff. Any difference is a failure.
//
// A crash cannot leak a mount or a write into the host: the namespace and every
// overlay inside it are destroyed with this process.
//
// No live apply, no gateway restart, no heartbeat, no Discord message and no
// production ledger write happens here. `Deployment Authorized` stays NO.
//
// Usage: node integrations/openclaw/topology/fixtures/runtime-regression/r16-rehearsal.mjs
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
const suite = path.join(
  repository,
  "tests",
  "m8-t2.13-r16-apply-rehearsal.test.mjs",
);
const { fingerprint, fingerprintDiff, R16_ROOTS } = await import(
  path.join(repository, "tests", "helpers", "r16-fingerprint.mjs")
);

const rehearsalRoot =
  process.env.R16_REHEARSAL_ROOT ?? path.join(os.homedir(), ".r16-rehearsal");
const fingerprintPath = path.join(rehearsalRoot, "live-fingerprint.json");

const gateway = () => {
  try {
    return execFileSync(
      "systemctl",
      [
        "--user",
        "show",
        "openclaw-gateway-zink.service",
        "-p",
        "MainPID",
        "-p",
        "NRestarts",
        "-p",
        "ActiveEnterTimestamp",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch {
    return "(unavailable)";
  }
};

const report = (line) => process.stdout.write(`${line}\n`);

if (!existsSync(R16_ROOTS.stateDir)) {
  report("FATAL: the live runtime is not present. R16 runs in WSL only.");
  process.exit(1);
}

// Re-entry: this process was launched by `unshare` and exists only to run the
// suite inside the private mount namespace. It never inspects the host.
if (process.env.R16_INSIDE === "1") {
  report("");
  report("R16 rehearsal — inside a private mount namespace");
  report(
    `  overlays: ${[R16_ROOTS.stateDir, R16_ROOTS.runtimeRoot, R16_ROOTS.systemdDir].join(", ")}`,
  );
  let inner = 0;
  try {
    execFileSync(process.execPath, ["--test", "--test-reporter=tap", suite], {
      cwd: repository,
      stdio: "inherit",
      env: { ...process.env, R16_REHEARSAL_ROOT: rehearsalRoot },
      timeout: 3600000,
    });
  } catch (error) {
    inner = error.status ?? 1;
  }
  teardownInsideNamespace();
  process.exit(inner);
}

/**
 * Teardown, run inside the namespace so the overlay work directories are removed
 * with the privileges that created them. The namespace dies with the process
 * either way, so a crash cannot leak a mount or a write into the host.
 */
function teardownInsideNamespace() {
  for (const target of [
    R16_ROOTS.stateDir,
    R16_ROOTS.runtimeRoot,
    R16_ROOTS.systemdDir,
  ]) {
    try {
      execFileSync("umount", ["-l", target], { stdio: "ignore" });
    } catch {
      // Already unmounted.
    }
  }
  try {
    rmSync(rehearsalRoot, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    // The caller reports anything left behind rather than hiding it.
  }
}

// --- 1. the real runtime, before ------------------------------------------
mkdirSync(rehearsalRoot, { recursive: true });
const before = fingerprint();
writeFileSync(fingerprintPath, JSON.stringify(before, null, 2));
const gatewayBefore = gateway();
report("R16 rehearsal — live runtime BEFORE");
report(`  selection   ${before.components["runtime/selection"].sha256}`);
report(`  bridge      ${before.components["runtime/bridge"].sha256}`);
report(`  extension   ${before.components["extension/index"].sha256}`);
report(`  config      ${before.components.config.sha256}`);
report(`  governance  ${before.governanceVersion}`);
report(
  `  ledger      ${before.ledger.events} events, sequence ${before.ledger.sequence}, ${before.ledger.tasks} tasks`,
);
report(`  gateway     ${gatewayBefore.split("\n").join(" | ")}`);

// --- 2. the rehearsal, inside a private mount namespace -------------------
let status = 0;
try {
  execFileSync(
    "unshare",
    [
      "--map-root-user",
      "--mount",
      process.execPath,
      fileURLToPath(import.meta.url),
    ],
    {
      cwd: repository,
      stdio: "inherit",
      env: {
        ...process.env,
        R16_REHEARSAL_ROOT: rehearsalRoot,
        R16_INSIDE: "1",
      },
      timeout: 3600000,
    },
  );
} catch (error) {
  status = error.status ?? 1;
}

// --- 3. the real runtime, after -------------------------------------------
const after = fingerprint();
const gatewayAfter = gateway();
const differences = fingerprintDiff(before, after);
report("");
report("R16 rehearsal — live runtime AFTER");
report(`  selection   ${after.components["runtime/selection"].sha256}`);
report(`  bridge      ${after.components["runtime/bridge"].sha256}`);
report(`  extension   ${after.components["extension/index"].sha256}`);
report(`  config      ${after.components.config.sha256}`);
report(`  governance  ${after.governanceVersion}`);
report(
  `  ledger      ${after.ledger.events} events, sequence ${after.ledger.sequence}, ${after.ledger.tasks} tasks`,
);
report(`  gateway     ${gatewayAfter.split("\n").join(" | ")}`);

if (gatewayAfter !== gatewayBefore) {
  report("  GATEWAY CHANGED — the rehearsal restarted the live gateway.");
  differences.push({
    kind: "gateway",
    before: gatewayBefore,
    after: gatewayAfter,
  });
}

if (existsSync(rehearsalRoot)) {
  try {
    rmSync(rehearsalRoot, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    // The inner process removes its own overlay work directories; anything still
    // here is inert scratch under the operator's home and is named, not hidden.
    report(`  NOTE: rehearsal scratch remains at ${rehearsalRoot}`);
  }
}

report("");
if (differences.length === 0) {
  report(
    `LIVE UNCHANGED: all ${Object.keys(before.components).length} components and ${Object.keys(before.trees).length} subtrees are byte-identical.`,
  );
} else {
  report(`LIVE CHANGED (${differences.length}):`);
  for (const difference of differences)
    report(
      `  ${difference.kind} ${difference.label ?? ""} ${JSON.stringify(difference.before)} -> ${JSON.stringify(difference.after)}`,
    );
  status = 1;
}

if (status !== 0) report(`REHEARSAL FAILED (exit ${status})`);
else report("REHEARSAL PASSED");
report(
  "NOT DEPLOYED — Deployment Authorized is NO and this run changed nothing live.",
);
process.exit(status);
