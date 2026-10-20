// M12/T9 F-011 - the Discord channel plugin path was PINNED by a hardcoded
// install content-hash.
//
// The Discord channel is an INSTALLED PLUGIN PACKAGE, and the directory npm
// installs it into carries the install's content hash. One reinstall or
// upgrade changes that directory name, so the hardcoded relative silently
// repointed the patch roots, the transaction snapshot's channel relatives and
// all three operator commands at a directory that no longer exists - and the
// failure reads as NATIVE_SOURCE_DRIFT on a supported runtime version.
//
// These lanes prove:
//   1. the channel root is RESOLVED from the installed plugin's own manifest,
//      and it FOLLOWS a reinstall;
//   2. a relative PINNED to an install content-hash is REFUSED with a named
//      code;
//   3. an install that cannot be resolved - none, or more than one - is a
//      named refusal, never a silent fallback to the pinned path.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertNativeDiscordChannelRelative,
  NATIVE_DISCORD_CHANNEL_AMBIGUOUS,
  NATIVE_DISCORD_CHANNEL_PIN_REFUSED,
  NATIVE_DISCORD_CHANNEL_RELATIVE,
  NATIVE_DISCORD_CHANNEL_UNRESOLVED,
  nativeDiscordChannelRoot,
  nativePatchedDiscordChannelRelatives,
  resolveNativeDiscordChannelRelative,
} from "../integrations/openclaw/topology/lib/native-patch.mjs";

/** A state root with an installed `@openclaw/discord` package. */
function stateRootWith(projectName, { manifest = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "f011-state-"));
  const packageRoot = path.join(
    root,
    "npm",
    "projects",
    projectName,
    "node_modules",
    "@openclaw",
    "discord",
  );
  mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
  if (manifest)
    writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({ name: "@openclaw/discord", version: "1.0.0" }),
    );
  return { root, packageRoot };
}

test("F-011: the channel root is resolved from the installed plugin", () => {
  const { root } = stateRootWith("openclaw-discord-abc123");
  try {
    assert.equal(
      resolveNativeDiscordChannelRelative(root),
      "npm/projects/openclaw-discord-abc123/node_modules/@openclaw/discord",
      "the root must follow the INSTALLED project",
    );
    assert.equal(
      nativeDiscordChannelRoot(root),
      path.join(
        root,
        "npm",
        "projects",
        "openclaw-discord-abc123",
        "node_modules",
        "@openclaw",
        "discord",
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-011: a reinstall that changes the install directory is followed, not missed", () => {
  const first = stateRootWith("openclaw-discord-c0892df945");
  const second = stateRootWith("openclaw-discord-99aa00ff");
  try {
    assert.equal(
      resolveNativeDiscordChannelRelative(first.root),
      "npm/projects/openclaw-discord-c0892df945/node_modules/@openclaw/discord",
    );
    assert.equal(
      resolveNativeDiscordChannelRelative(second.root),
      "npm/projects/openclaw-discord-99aa00ff/node_modules/@openclaw/discord",
      "the new install must be the one the tooling addresses",
    );
    // The snapshot relatives follow the install too.
    assert.ok(
      nativePatchedDiscordChannelRelatives(
        resolveNativeDiscordChannelRelative(second.root),
      ).every((relative) =>
        relative.startsWith("npm/projects/openclaw-discord-99aa00ff/"),
      ),
      "the channel relatives must name the installed project",
    );
  } finally {
    rmSync(first.root, { recursive: true, force: true });
    rmSync(second.root, { recursive: true, force: true });
  }
});

test("F-011: a relative PINNED to an install content-hash is refused", () => {
  const { root } = stateRootWith("openclaw-discord-99aa00ff");
  try {
    // The legacy constant names the install that WAS there.
    assert.throws(
      () =>
        assertNativeDiscordChannelRelative(
          root,
          NATIVE_DISCORD_CHANNEL_RELATIVE,
        ),
      (error) => {
        assert.equal(
          error.message.startsWith(NATIVE_DISCORD_CHANNEL_PIN_REFUSED),
          true,
        );
        return true;
      },
      "a pinned relative must be refused with the named code",
    );
    // The INSTALLED relative is accepted.
    assert.equal(
      assertNativeDiscordChannelRelative(
        root,
        resolveNativeDiscordChannelRelative(root),
      ),
      "npm/projects/openclaw-discord-99aa00ff/node_modules/@openclaw/discord",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-011: an install that cannot be resolved is a named refusal", () => {
  const empty = mkdtempSync(path.join(os.tmpdir(), "f011-empty-"));
  try {
    assert.throws(
      () => resolveNativeDiscordChannelRelative(empty),
      (error) => {
        assert.equal(error.message, NATIVE_DISCORD_CHANNEL_UNRESOLVED);
        return true;
      },
    );
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
  const first = stateRootWith("openclaw-discord-aaa");
  const second = stateRootWith("openclaw-discord-bbb");
  try {
    // Two installs of the same package in ONE state root cannot be resolved to
    // one root: that is a named refusal, not a guess.
    const merged = mkdtempSync(path.join(os.tmpdir(), "f011-merged-"));
    try {
      for (const source of [first, second]) {
        const target = path.join(
          merged,
          "npm",
          "projects",
          path.basename(source.packageRoot.split("node_modules")[0]),
          "node_modules",
          "@openclaw",
          "discord",
        );
        mkdirSync(path.join(target, "dist"), { recursive: true });
        writeFileSync(
          path.join(target, "package.json"),
          JSON.stringify({ name: "@openclaw/discord" }),
        );
      }
      assert.throws(
        () => resolveNativeDiscordChannelRelative(merged),
        (error) => {
          assert.equal(error.message, NATIVE_DISCORD_CHANNEL_AMBIGUOUS);
          return true;
        },
        "two installs must be a named refusal",
      );
    } finally {
      rmSync(merged, { recursive: true, force: true });
    }
  } finally {
    rmSync(first.root, { recursive: true, force: true });
    rmSync(second.root, { recursive: true, force: true });
  }
});
