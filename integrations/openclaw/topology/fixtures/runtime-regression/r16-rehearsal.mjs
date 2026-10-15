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
// Usage:
//   node integrations/openclaw/topology/fixtures/runtime-regression/r16-rehearsal.mjs
//     — REPORT only. Resolves and validates the scratch root, states what a run
//       would delete and which privileges it would take, and mutates nothing.
//   node …/r16-rehearsal.mjs --rehearsal-root <absolute-path> --run --confirm=R16_REHEARSAL_RUN
//     — the rehearsal itself. `--rehearsal-root` may instead come from
//       R16_REHEARSAL_ROOT; either way it must be absolute and cannot be the
//       filesystem root or the home directory, because the scratch tree is
//       removed with `recursive: true, force: true`.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
const suite = path.join(
  repository,
  "tests",
  "m8-t2.13-r16-apply-rehearsal.test.mjs",
);
const { fingerprint, fingerprintDiff, R16_ROOTS } = await import(
  // A bare absolute path is not a module specifier on Windows; the ESM loader
  // rejects a `c:` scheme. The gate below has to run on every host, so the
  // sibling helper is loaded the way the rest of the repository loads it.
  pathToFileURL(
    path.join(repository, "tests", "helpers", "r16-fingerprint.mjs"),
  ).href
);

const CONFIRM_VALUE = "R16_REHEARSAL_RUN";
const DEFAULT_REHEARSAL_ROOT = path.join(os.homedir(), ".r16-rehearsal");

function parseArguments(argv) {
  const options = { rehearsalRoot: null, run: false, confirm: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--rehearsal-root") {
      options.rehearsalRoot = argv[++index];
    } else if (argument === "--run") {
      options.run = true;
    } else if (argument.startsWith("--confirm=")) {
      options.confirm = argument.slice("--confirm=".length);
    } else {
      throw new Error(`Unknown argument ${argument}`);
    }
  }
  return options;
}

/**
 * The scratch root is deleted with `recursive: true, force: true`, so the shape of
 * the value is the entire safety story. An unset value falls back to the documented
 * tree; anything the operator supplies — flag or environment — must resolve to an
 * absolute path that is neither the filesystem root nor the home directory. A
 * relative value would have resolved against whatever working directory npm
 * happened to use, which is how a scratch path becomes `..`.
 */
function resolveRehearsalRoot(options) {
  const supplied = options.rehearsalRoot ?? process.env.R16_REHEARSAL_ROOT;
  const root =
    supplied === undefined || supplied === null
      ? DEFAULT_REHEARSAL_ROOT
      : supplied;
  if (typeof root !== "string" || root.length === 0) {
    throw new Error("R16 rehearsal root must be a non-empty path");
  }
  // Tested on the value as supplied: `.` and `..` both resolve to absolute paths,
  // and against npm's working directory `..` is the parent of the repository.
  if (!path.isAbsolute(root)) {
    throw new Error(`R16 rehearsal root must be absolute, got ${root}`);
  }
  const resolved = path.resolve(root);
  if (
    resolved === path.parse(resolved).root ||
    resolved === path.resolve(os.homedir())
  ) {
    throw new Error(`refusing to treat ${resolved} as a rehearsal root`);
  }
  return resolved;
}

/**
 * The rehearsal may only run inside WSL, and a path is not evidence about the host.
 * A POSIX absolute path resolves against the current drive on Windows, and
 * `C:\home\hoang_vinh\.openclaw-zink` exists there since 2026-09-29 (`R6-I01-03`), so
 * the single `existsSync` refusal below answered "this is the live host" while running
 * on Windows. Ask the kernel first, then the filesystem, and name which one refused.
 */
function hostIsWsl() {
  if (process.platform !== "linux") return false;
  let version;
  try {
    version = readFileSync("/proc/version", "utf8").toLowerCase();
  } catch {
    version = "";
  }
  return /microsoft|wsl/u.test(version) || Boolean(process.env.WSL_DISTRO_NAME);
}

const options = parseArguments(process.argv.slice(2));
const rehearsalRoot = resolveRehearsalRoot(options);
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

// The gate that belongs in front of a recursive delete. The namespace child is
// exempt: this file re-launches itself as `unshare … node <this file>` with no
// argv at all, so demanding a confirmation there would make the rehearsal
// unrunnable rather than safer — its authority is the parent that confirmed.
if (process.env.R16_INSIDE !== "1") {
  const rootExists = existsSync(rehearsalRoot);
  let rootEntries = null;
  if (rootExists) {
    try {
      rootEntries = readdirSync(rehearsalRoot).length;
    } catch {
      // Unreadable stays unknown rather than being reported as empty.
    }
  }
  if (!options.run) {
    process.stdout.write(
      `${JSON.stringify({
        mode: "REPORT",
        action: "NONE",
        rehearsal_root: rehearsalRoot,
        root_exists: rootExists,
        root_entries: rootEntries,
        host_is_wsl: hostIsWsl(),
        live_runtime_present: existsSync(R16_ROOTS.stateDir),
        deletes_on_run: rehearsalRoot,
        requires: `--run --confirm=${CONFIRM_VALUE}`,
      })}\n`,
    );
    process.exit(0);
  }
  if (options.confirm !== CONFIRM_VALUE) {
    process.stdout.write(
      `${JSON.stringify({
        mode: "REFUSED",
        action: "NONE",
        reason: "CONFIRMATION_REQUIRED",
        requires: `--confirm=${CONFIRM_VALUE}`,
      })}\n`,
    );
    process.exit(1);
  }
}

if (!hostIsWsl()) {
  report(
    `FATAL: this host is not WSL (platform ${process.platform}). R16 runs in WSL only.`,
  );
  process.exit(1);
}

if (!existsSync(R16_ROOTS.stateDir)) {
  report(
    `FATAL: the live runtime is not present at ${R16_ROOTS.stateDir} on this WSL host.`,
  );
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
  // R16: a rehearsal that could not run must say WHY. A bare non-zero exit made
  // "the namespace is unavailable on this kernel", "the suite file is missing"
  // and "the suite genuinely failed" indistinguishable to an operator — and a
  // rehearsal that never ran is indistinguishable from a passing one.
  if (error.code === "ENOENT")
    report(
      "REHEARSAL COULD NOT START: 'unshare' is not available on this host.",
    );
  else if (error.stderr && String(error.stderr).trim())
    report(
      `REHEARSAL COULD NOT START: ${String(error.stderr)
        .trim()
        .split("\n")
        .slice(0, 6)
        .join("\n  ")}`,
    );
  else
    report(
      `REHEARSAL COULD NOT START: exit ${status} with no diagnostic output.`,
    );
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
