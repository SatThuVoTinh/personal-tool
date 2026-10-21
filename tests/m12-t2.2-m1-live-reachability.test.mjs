//
// SKIP-FAMILY: live-tree
//
// M12/T9 F-197 (R5-E09-03) / H3: this lane may skip, and it declares WHICH
// family it belongs to, so the skip-expectation gate can tell an explained
// skip from an unexplained one. The family-to-lane map is derived from the
// repository's own lane list; the expectation lives in
// `docs/contracts/ci-skip-expectations.json`.
// M12/T2.2-R2 M-1 — nothing may be deployed that `--preflight` refuses.
//
// `configure.mjs` accepts only `--preflight`, `--apply` and `--dry-run`; there is
// no drift override. Its rule is that every governed packaged file on the live
// host must be either the build the repository derives now or a digest its
// allowlist admits for that exact path. `AGENTS.md` §10 and the
// `configure.mjs:515-527` note for `lib/file-lock.mjs` both record what breaking
// that rule costs: "was undeployable until its outgoing digest was admitted".
//
// A read-only sweep on the WSL lane found NINE governed paths in that state,
// each produced when this programme rolled a packaged build forward without
// admitting the outgoing digest (`6b0ea0a`, `c680a28`, `c1ad4b3`, `3cb8274`).
// The Windows lane is silent on the whole class — the live tree is not mountable
// there, 48 skips — and only 3 of the 35 governed paths (`R13 P1`, `R13 P2`,
// `R7 P1`) had any reachability assertion at all, which is why nine drifted.
//
// These tests close both halves: every admitted digest must be reproducible from
// a real commit through the repository's own generator (the rule `R13 P5` states
// for the entrypoint — "admitting a digest nobody can reproduce is exactly how an
// allowlist silently rots"), and the sweep that found the nine now runs as a
// gate, skipping honestly on a platform that cannot read the live tree.
process.env.ZINK_ROUTER_HOST ||= "router.invalid";
process.env.ZINK_ROUTER_PORT ||= "1";
process.env.ZINK_ROUTER_API_KEY ||= "test-router-key-not-a-credential";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const CONFIGURE = path.join(REPO, "integrations", "openclaw", "configure.mjs");
const LIVE_DIR = "/home/hoang_vinh/.openclaw-zink/extensions/zink-governance";
const CONFIGURE_SOURCE = readFileSync(CONFIGURE, "utf8");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/**
 * Each row is (asset path, the digest the live runtime carries, the commit whose
 * packaged build produces exactly those bytes). The digests are what M-1 admits;
 * they are NEVER asserted as a photograph of the live tree, because a deployment
 * changes that tree and `R7 P1` already records how such an equality rotted.
 */
const ADMITTED_LIVE_BUILDS = Object.freeze([
  {
    rel: "lib/guard.mjs",
    digest: "263d72c426e4c29c13f1749e94ce6cadcf0340b59bcbf91bd982763c8c5d3a26",
    commit: "6b0ea0a",
  },
  {
    rel: "lib/ledger.mjs",
    digest: "c984cda8e0ab40fbd2d130e035607ee49d848319afe77df3508bc08e307f1e18",
    commit: "6b0ea0a",
  },
  {
    rel: "lib/decision-ledger.mjs",
    digest: "1d9518ca6150474e21510fae48c9a19d580b0a254304998982071da5b631f343",
    commit: "6b0ea0a",
  },
  {
    rel: "lib/workflow.mjs",
    digest: "2009e9fe06b6cc01b95bcb1db3c8ff1b0a69e220123166f21a863178e0623695",
    commit: "c680a28",
  },
  {
    rel: "lib/policy.mjs",
    digest: "d621c85f37bef11c0767843c4c1b25d38c9d55d66cee2be75d7630e4c604c8fb",
    commit: "c680a28",
  },
  {
    rel: "lib/discord-formatter.mjs",
    digest: "26ecc883993485bc1e4b9fd5e3e16dc852d8f0858cbf0b5f37029515527e5d94",
    commit: "c680a28",
  },
  {
    rel: "lib/discord-native-send.mjs",
    digest: "4d36d8abd83084f83cf65c56da9a190bec3fde5d481ea939665a13a522e8f457",
    commit: "c1ad4b3",
  },
  {
    rel: "lib/authority.mjs",
    digest: "c38e1a6b7934bd01afd262dca0402fbb6936086a03b10731b91952db4003f36b",
    commit: "c1ad4b3",
  },
  {
    rel: "lib/queue-manager.mjs",
    digest: "a5580bb67a7ace7edfdaf2595b7245a3be3a6959333ae6cbeaf76d080f49fb37",
    commit: "3cb8274",
  },
]);

async function buildAt(commit) {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "m1-gen-"));
  try {
    const archive = spawnSync(
      "git",
      ["archive", commit, "--", "integrations/openclaw"],
      { cwd: REPO, maxBuffer: 256 * 1024 * 1024 },
    );
    assert.equal(archive.status, 0, `git archive ${commit} must succeed`);
    const tar = spawnSync("tar", ["-x", "-C", scratch], {
      input: archive.stdout,
      maxBuffer: 256 * 1024 * 1024,
    });
    assert.equal(tar.status, 0, `extracting ${commit} must succeed`);
    const { governancePluginFiles } = await import(
      pathToFileURL(
        path.join(scratch, "integrations", "openclaw", "lib", "policy.mjs"),
      ).href
    );
    return await governancePluginFiles();
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const currentBuild = async () =>
  (
    await import(
      pathToFileURL(
        path.join(REPO, "integrations", "openclaw", "lib", "policy.mjs"),
      ).href
    )
  ).governancePluginFiles();

function assetTable() {
  const start = CONFIGURE_SOURCE.indexOf(
    "const ALLOWED_GOVERNANCE_ASSET_SHA256",
  );
  assert.notEqual(start, -1, "the asset allowlist table must exist");
  const end = CONFIGURE_SOURCE.indexOf("\n});", start);
  assert.notEqual(end, -1, "the asset allowlist table must be terminated");
  return CONFIGURE_SOURCE.slice(start, end);
}

function listedAssetDigests(rel) {
  const table = assetTable();
  const key = table.indexOf(`"${rel}": Object.freeze([`);
  if (key === -1) return [];
  const block = table.slice(key, table.indexOf("]),", key));
  return [...block.matchAll(/[0-9a-f]{64}/gu)].map((match) => match[0]);
}

/** The entrypoint is admitted by two per-mode lists, not the asset table. */
function listedEntrypointDigests() {
  const digests = new Set();
  for (const gate of CONFIGURE_SOURCE.matchAll(
    /output\.governancePluginEntrypointPath,\n\s*pluginFiles\.entrypoint,/gu,
  )) {
    const block = CONFIGURE_SOURCE.slice(
      gate.index,
      CONFIGURE_SOURCE.indexOf("  );", gate.index),
    );
    for (const match of block.matchAll(/[0-9a-f]{64}/gu)) digests.add(match[0]);
  }
  return [...digests];
}

/** Every path the asset allowlist in configure.mjs names. */
function allowlistedAssetPaths() {
  const table = assetTable();
  return [...table.matchAll(/^\s*"([^"]+)":\s*Object\.freeze\(\[/gmu)].map(
    (match) => match[1],
  );
}

/**
 * F-148: the governed paths that cannot be read live from THIS platform, with
 * the reason. A governed path is either READ live (and therefore asserted by
 * the M1 4 sweep) or covered by a declaration here. A path that is neither is
 * UNASSERTED, and the count of unasserted paths must be zero.
 *
 * The sweep's own coverage assertion tolerates one unread path
 * (`read >= governed.length - 1`), so a governed path the deployed tree does
 * not carry at all was invisible to every lane: no drift verdict, no
 * declaration, nothing. The declaration below is a property of the PLATFORM,
 * not of any single path, so it is recorded once.
 */
const LIVE_REACHABILITY_DECLARATIONS = Object.freeze([
  Object.freeze({
    environment: "live-tree-not-mountable",
    reason:
      "the deployed extension tree (/home/hoang_vinh/.openclaw-zink/extensions/zink-governance) is not mountable from this platform, so no governed path is live-reachable here; the WSL lane is the gate that reads it",
    covers: (mountable) => !mountable,
  }),
]);

test("M1 1: every digest M-1 admits is reproduced from its commit by the real generator", async () => {
  const byCommit = new Map();
  for (const { commit } of ADMITTED_LIVE_BUILDS) {
    if (!byCommit.has(commit)) byCommit.set(commit, await buildAt(commit));
  }
  for (const { rel, digest, commit } of ADMITTED_LIVE_BUILDS) {
    const built = byCommit.get(commit);
    assert.equal(
      sha256(built.assets[rel]),
      digest,
      `${rel} must hash to the admitted digest when commit ${commit} is packaged`,
    );
  }
  assert.equal(
    byCommit.size,
    4,
    "the nine admitted builds come from exactly four producing commits",
  );
});

test("M1 2: configure.mjs admits each of them at its own path", () => {
  for (const { rel, digest } of ADMITTED_LIVE_BUILDS) {
    assert.ok(
      listedAssetDigests(rel).includes(digest),
      `${rel} must list ${digest.slice(0, 12)}… as an admitted predecessor`,
    );
  }
});

test("M1 3: admitting a predecessor never means admitting the current build", async () => {
  const current = await currentBuild();
  for (const { rel } of ADMITTED_LIVE_BUILDS) {
    const now = sha256(current.assets[rel]);
    assert.equal(
      CONFIGURE_SOURCE.includes(now),
      false,
      `${rel} is admitted as its outgoing build; the CURRENT build must stay accepted by content comparison only`,
    );
    assert.notEqual(
      now,
      ADMITTED_LIVE_BUILDS.find((row) => row.rel === rel).digest,
      `${rel} must actually have moved since the build the live runtime carries`,
    );
  }
});

test("M1 4: every governed path the live runtime carries is current or admitted", async (t) => {
  const current = await currentBuild();
  const governed = [
    ["index.mjs", sha256(current.entrypoint), listedEntrypointDigests()],
    ...Object.entries(current.assets).map(([rel, body]) => [
      rel,
      sha256(body),
      listedAssetDigests(rel),
    ]),
  ];
  const unreachable = [];
  let read = 0;
  for (const [rel, now, admitted] of governed) {
    let live;
    try {
      live = sha256(
        readFileSync(path.join(LIVE_DIR, ...rel.split("/")), "utf8"),
      );
    } catch {
      continue; // This platform cannot mount the live tree.
    }
    read += 1;
    if (live === now) continue;
    if (!admitted.includes(live)) {
      unreachable.push(
        `${rel} live=${live.slice(0, 12)}… current=${now.slice(0, 12)}…`,
      );
    }
  }
  if (read === 0) {
    return t.skip(
      "the live extension tree is not mountable from this platform; the WSL lane is the gate",
    );
  }
  // A sweep that silently read one file would pass. The point of M-1 is coverage,
  // so the sweep asserts its own coverage before its verdict.
  assert.ok(
    read >= governed.length - 1,
    `the sweep must read every governed path (read=${read} of ${governed.length})`,
  );
  assert.deepEqual(
    unreachable,
    [],
    `these governed paths are neither the current build nor an admitted predecessor, so --preflight refuses the deployed extension:\n  ${unreachable.join("\n  ")}`,
  );
});

test("M1 5: every governed path is asserted live or declared not-live-reachable", async () => {
  // F-148: only three of the thirty-five governed paths carried any
  // live-reachability assertion (R13 P1, R13 P2, R7 P1), so every other
  // packaged asset could drift forward indefinitely with no gate noticing.
  // This case proves the COVERAGE of the governed-path set on every platform:
  // each path is read live (and therefore asserted by the sweep above) or it
  // is covered by a declared reason, and the count of unasserted paths is
  // zero. It never skips: the coverage property is decidable everywhere, and
  // only the drift verdict needs the live tree.
  const current = await currentBuild();
  const governed = ["index.mjs", ...Object.keys(current.assets)];
  // M12/T9: the packaged set grew from 34 assets to 45 - the band shipped the
  // Skill Store runtime modules (`zink-skill-store/src/*`) and the Zink Tools
  // runtime modules (`zink-tools/*`) as PACKAGED assets, so the governed-path
  // set is the entrypoint plus 46 assets = 47 paths (the Skill Store's
  // public door joined the packaged set in M12/T9 F-156, and the Skill Store's
  // own migration runner in M12/T9 F-094 / H5). The denominator is restated,
  // not dropped: it is still the number a reader has to reconcile with the
  // packaged build, and a path added or removed without this being restated
  // fails here.
  assert.equal(
    governed.length,
    47,
    `the governed-path set is the entrypoint plus the packaged assets, saw ${governed.length}`,
  );

  // A path the allowlist admits a predecessor for must be a governed path:
  // otherwise the admitted digest would be accepted by `--preflight` while no
  // sweep ever examines it.
  const allowlisted = allowlistedAssetPaths();
  for (const rel of allowlisted) {
    assert.ok(
      governed.includes(rel),
      `configure.mjs admits a predecessor for ${rel}, which is not a governed path of the current build, so no live-reachability assertion ever examines it`,
    );
  }

  const mountable = existsSync(LIVE_DIR);
  const unasserted = [];
  for (const rel of governed) {
    try {
      readFileSync(path.join(LIVE_DIR, ...rel.split("/")), "utf8");
      continue; // Read live: the sweep asserts this path.
    } catch {
      // Not readable from this platform.
    }
    const declaration = LIVE_REACHABILITY_DECLARATIONS.find((entry) =>
      entry.covers(mountable),
    );
    if (declaration) continue; // Declared not-live-reachable, with the reason.
    unasserted.push(rel);
  }
  assert.equal(
    unasserted.length,
    0,
    `these governed paths carry no live-reachability assertion and are not declared not-live-reachable, so they can drift with no gate noticing: ${unasserted.join(", ")}`,
  );
});
