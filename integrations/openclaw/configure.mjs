#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import {
  createRuntimeBackup,
  runtimeBackupPath,
} from "./topology/lib/runtime-backup.mjs";
import { assertStateRootFileModes } from "./topology/lib/state-root-modes.mjs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  assertDirectoryOrMissing,
  assertInsideHome,
  assertNoRepositoryOverlap,
  assertNoSymlinkComponents,
  assertRegularOrMissing,
  assertWorkspaceMatchesTemplate,
  buildAuthOrderPlan,
  buildConfig,
  buildSecretsPlan,
  defaultStateDirectory,
  defaultSystemdUserDirectory,
  agentInstructions,
  governancePluginFiles,
  GOVERNANCE_PLUGIN_ID,
  ensurePrivateDirectory,
  geminiStreamHotfixContents,
  materializeWorkspace,
  parseIdentifiers,
  passResolverContents,
  renderDeployedSystemdDropIn,
  renderLegacySystemdDropInR16,
  renderSystemdDropIn,
  stableJson,
  validateConfig,
  writePrivateRegularFile,
} from "./lib/policy.mjs";
import {
  ledgerPaths,
  inspectLedgerUpgrade,
  upgradeEmptyLegacyLedger,
} from "./topology/lib/ledger.mjs";
import { canonicalJson } from "./topology/lib/canonical.mjs";
import {
  assertBuilderApplyAvailable,
  markBuilderApplyConsumed,
} from "./topology/lib/transaction-snapshot.mjs";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
// M12/T9 F-202: the systemd drop-in DIRECTORY is the unit the ceiling is
// enforced against, not the one file this builder renders.
//
// systemd reads every `*.conf` fragment in `<unit>.service.d/` in lexical
// order, and a later fragment wins every single-valued assignment. A sibling
// `20-override.conf` therefore raises `MemoryMax=` above the 768M ceiling
// this drop-in sets, or removes it, or injects an `ExecStart=` - while every
// gate that only compared `10-zink.conf` still printed PASS.
const SYSTEMD_DROP_IN_DIRECTORY = "openclaw-gateway-zink.service.d";
const SYSTEMD_DROP_IN_NAME = "10-zink.conf";
// M12/T9 F-203: the governed state root of the live WSL host.
//
// The builder refuses any state directory other than this one's own
// `~/.openclaw-zink`, so on the live host the inspected tree IS this path. A
// host that cannot reach it - a Windows preflight against the NTFS copy, a CI
// runner - has inspected a tree that is not the governed one, and its verdict
// is NOT RUN rather than PASS.
// The governed state tree is the operator's, named by the environment — the
// same way the operator commands read it (F-219). A machine-specific literal
// in a runtime source is a path the repository publishes, and F-022 refused
// exactly that. The default is the live host's path, so an operator who names
// nothing still gets the host's own tree.
const GOVERNED_STATE_TREE =
  process.env.ZINK_OPERATOR_STATE_DIR ??
  process.env.ZINK_STATE_DIR ??
  "/home/hoang_vinh/.openclaw-zink";
const LEGACY_GEMINI_STREAM_HOTFIX_R18_SHA256 =
  "41bfeedf2835db4a50573a0f61325bc438ac805a90fef03ce3bc29b8c303f133";
// M12/T9 F-382: the hotfix the live host carries. The deployed extension is the
// build at `0b55dfa4` (measured on the live host on 2026-10-22), and its
// hotfix is the repository's own template as of `7b5edc51` — the commit that
// last changed it before that build. Without this entry --preflight refuses
// the file with `Gemini stream hotfix utility`, so the apply cannot reach the
// extension it is supposed to replace.
//
// Provenance: `git show 7b5edc51:integrations/openclaw/templates/
// openclaw-gemini-stream-hotfix.mjs` reproduces the deployed bytes. An
// admission only permits OVERWRITING the file with the current build's own
// bytes; the old content is not trusted, and an unrecognised digest still
// fails closed.
const ADMITTED_GEMINI_STREAM_HOTFIX_SHA256 = Object.freeze([
  LEGACY_GEMINI_STREAM_HOTFIX_R18_SHA256,
  "812cadc62eedbfc718366046e97c4f1f2a50642174769a611006dde1dc5746e9",
]);
// M10/T2-R9: the outgoing generated plans and resolver, byte-proven against the
// live state directory on 2026-10-06 immediately before the provider swap. The
// plans enumerated the 21 google auth-profile key targets and the per-agent
// google auth order, and the resolver allowlisted the 21 GEMINI_API_KEY_NN pass
// ids. Each is admitted so the converge-on-apply path stays reachable; any
// other previous content still fails closed.
//
// These digests are recorded from the live bytes, never hand-authored: a
// hand-written plan would drift from the generator and be rejected here, which
// is exactly the failure mode the content comparison exists to prevent.
const PREVIOUS_AUTH_SECRET_PLAN_SHA256 =
  "393b465d3bd2b8dd78d18662be7391e81d542e363c9be1c91580cd2913c8f2ea";
const PREVIOUS_AUTH_ORDER_PLAN_SHA256 =
  "bdee1964f39e8c703988b3fb3a9fd690ef70cb7f6657cfb0479f734af932f221";
// M12/T9 F-382: the two auth plans the live host carries. They carry the same
// content as the current build's plans — no target, no agent — but the writer
// that put them there pretty-printed them, and the current build writes them
// compactly, so the bytes differ and the preflight refused them.
//
// Provenance: the plans are the policy's OWN generators, pretty-printed the
// way the deployed writer wrote them (`JSON.stringify(plan, null, 2) + "\n"`),
// and the rebuilt bytes match the host's byte for byte.
const ADMITTED_AUTH_SECRET_PLAN_SHA256 = Object.freeze([
  PREVIOUS_AUTH_SECRET_PLAN_SHA256,
  "5e830e89b3edabef460eea674bb6e48564703f5073cc1cf5bb38b7604ef46af3",
]);
const ADMITTED_AUTH_ORDER_PLAN_SHA256 = Object.freeze([
  PREVIOUS_AUTH_ORDER_PLAN_SHA256,
  "ed4e152be17a5147ecbf0a3c6d3f87383a4b497d2527e332ebaf0f5adf38b45d",
]);
// The resolver digests of previous builds that the current build may overwrite.
//
// The first entry is the 29-id build (the Gemini pool plus the Discord and
// gateway ids). The second is the narrower 8-id resolver (`ddf1a079…`) that a
// diagnostic `configure.mjs --apply` wrote to the live state by bypassing the
// transaction wrapper.
//
// M12/T9 F-381: the note that stood here said the 8-id resolver "is no longer
// on disk, and admitting a resolver artifact that nothing needs would widen
// the allowlist for no reachable transition". Measured on the live host on
// 2026-10-22, READ-ONLY, that premise is DEAD: the file IS on the host
// (`~/.openclaw-zink/bin/openclaw-pass-resolver`), and the preflight refuses
// it with `Password-store resolver`, so the apply cannot reach the extension
// it is supposed to replace. The transition is reachable, and the entry only
// permits OVERWRITING the file with the current build's own bytes: the old
// content is not trusted, and an unrecognised digest still fails closed.
//
// The digest is derived, not transcribed: the deployed bytes are the
// repository's own template with the eight ids it carries — the seven Discord
// bot tokens and the gateway token — and
// `tests/agent-owner-F-381-resolver-admission.test.mjs` rebuilds them from the
// policy's canonical tables and compares.
const PREVIOUS_PASS_RESOLVER_SHA256 = Object.freeze([
  "46cf5df77462a0e6b16a004278617115597801a7032aa186b8db54d2fef49e48",
  "ddf1a079e136795cd6323d76d362c2a35fe938d967b867d3efe49052cc862ad7",
]);
const LEGACY_GOVERNANCE_ENTRYPOINT_R11_SHA256 =
  "c71cf9d6fe9965eaa0ff789d611a55ee0ea2fc98d8023b3c7526495aaa60f559";
const STARTING_GOVERNANCE_ENTRYPOINT_SHA256 =
  "26bb3b447bdc039925fa568ae89beb1969319ce8b6c86236eb715c2c6224ebf0";
const INTERMEDIATE_GOVERNANCE_ENTRYPOINT_SHA256 =
  "a384e509ebac2c47f4a50e758b2bb697e87cc50721367ae20948d11d4f24b06b";
const LEGACY_GOVERNANCE_MANIFEST_R11_SHA256 = Object.freeze([
  "02c805e7909b9ca35711cc5888bc889fe9c9a566f09f580ba614682682ce41ca",
  // The manifest of the superseded WSL deployment recognized on 2026-09-30
  // under the same owner authorization as the asset list.
  "5026959d41a76c531f37caa6297b3b0b010ee17cedd7bdd3806447600c98a18d",
]);
// M12/T9 F-380: the DEPLOYED build's plugin manifest. The deployed extension is
// the build at `0b55dfa4` (measured on the live host on 2026-10-22), and its
// manifest is the file as of `01489aa9` — the commit that last changed it
// before that build. The current build's manifest adds two config-schema
// properties (`discordGuildId`, `skillApprovalDecisionRef`), so the deployed
// bytes were neither the current bytes nor the legacy R11 manifest, and the
// manifest check had NO admission list at all: it refused the extension the
// apply was supposed to replace.
//
// Provenance: `git show 01489aa9:integrations/openclaw/plugins/zink-governance/
// openclaw.plugin.json` reproduces the deployed bytes. The manifest is read
// verbatim (packaging does not rewrite it), so the digest is the file's own.
// The current build's manifest is deliberately NOT listed: it is the current
// build and is accepted by content comparison.
const ALLOWED_GOVERNANCE_MANIFEST_SHA256 = Object.freeze([
  "8be6690cc9036ae32dce13b17282f1cf8c3d817509ca9e4ac40924bed7d4a634",
]);
// Digests of prior audited plugin builds that the current build may overwrite.
//
// The 2026-09-30 group is the plugin tree that was live on the WSL gateway
// before the R5 deployment. Unlike every other entry here, its provenance is
// NOT established: regenerating the assets at `01489aa` (the commit before R4)
// reproduces only 7 of its 29 files, and the deployed `openclaw.json` beside it
// matches no commit either, so the whole deployment came from an uncommitted
// build. It is listed because the owner explicitly authorized recognizing it as
// a superseded predecessor on 2026-09-30, not because it was audited here.
//
// These entries only ever permit OVERWRITING the listed file with the current
// build's own bytes. They do not make the old content trusted, and an
// unrecognised digest still fails closed.
const ALLOWED_GOVERNANCE_ASSET_SHA256 = Object.freeze({
  // M12/T2-R3: Deployment A put this asset on the live WSL runtime, so the
  // digest the host now carries is `e0a755bb...` -- measured by the operator
  // apply post-check on 2026-10-13 and reproduced byte-for-byte by
  // `git show b6d04e8:integrations/openclaw/lib/discord-forum-tags.mjs` (23,825
  // bytes; packaging does not rewrite this module's imports). This revision
  // changes the file, so without this entry --preflight refuses the deployed
  // extension and --apply becomes unreachable. The digest this build produces is
  // deliberately NOT listed: it is the current build and is accepted by content
  // comparison.
  "lib/discord-forum-tags.mjs": Object.freeze([
    "e0a755bb9c6add431c9306fd8bc2895318a868c3c6b8e84326d94fb95526fff5",
    // M12/T9 F-379: the DEPLOYED build's bytes for this asset, as of
    // `0b55dfa` — the commit that last changed it before the deployed build
    // (`0b55dfa`, measured on the live host on 2026-10-22). The admission list did
    // not name them, so --preflight refused the deployed extension. Provenance:
    // `git show 0b55dfa:integrations/openclaw/lib/discord-forum-tags.mjs` reproduces the deployed bytes. The digest this build produces is deliberately NOT listed: it is
    // the current build and is accepted by content comparison.
    "18fbb0774c18d013f599f562810932cfb80c4071c0614376d16f46c30fc256b3",
  ]),
  // M12/T1-R1: this asset had no predecessor entry before now, because every
  // earlier revision was also the current build. M12/T1 changes it, so the digest
  // the live WSL runtime carries is admitted (measured read-only) and the digest
  // this build produces is deliberately NOT listed -- it is the current build and
  // is accepted by content comparison.
  "lib/discord-formatter.mjs": Object.freeze([
    "3b39b1063e7842208a55151c776db2747cdc4a91bb2cf56b8d7102746f20479f",
    // M12/T2.2-R2 M-1: the build the live runtime carries, reproduced by packaging
    // commit c680a28. See the lib/guard.mjs entry for why nine paths drifted.
    "26ecc883993485bc1e4b9fd5e3e16dc852d8f0858cbf0b5f37029515527e5d94",
  ]),
  // M12/T1-R1: this asset had no predecessor entry before now, because every
  // earlier revision was also the current build. M12/T1 changes it, so the digest
  // the live WSL runtime carries is admitted (measured read-only) and the digest
  // this build produces is deliberately NOT listed -- it is the current build and
  // is accepted by content comparison.
  "lib/discord-native-send.mjs": Object.freeze([
    "3a69f5d33b5d30087f8b7cb96738031988e68b24212e9d262491b2515e550e1d",
    // M12/T2.2-R2 M-1: the build the live runtime carries, reproduced by packaging
    // commit c1ad4b3. See the lib/guard.mjs entry for why nine paths drifted.
    "4d36d8abd83084f83cf65c56da9a190bec3fde5d481ea939665a13a522e8f457",
  ]),

  // M12/T9 F-379: this asset had no predecessor entry before now, because every
  // earlier revision was also the current build. The deployed build's bytes are
  // admitted so --preflight accepts the extension that is installed today.
  "lib/discord-result-preview.mjs": Object.freeze([
    // M12/T9 F-379: the DEPLOYED build's bytes for this asset, as of
    // `c1ad4b3` — the commit that last changed it before the deployed build
    // (`0b55dfa`, measured on the live host on 2026-10-22). The admission list did
    // not name them, so --preflight refused the deployed extension. Provenance:
    // `git show c1ad4b3:integrations/openclaw/lib/discord-result-preview.mjs` reproduces the deployed bytes. The digest this build produces is deliberately NOT listed: it is
    // the current build and is accepted by content comparison.

    "9970139525c5a288b43f89fb8f7fb8875f53b3555fa6ebeed1b7c3b8f2c149ee",
  ]),
  "contracts/agent-result-payload.schema.json": Object.freeze([
    "48bcbf6b64daae63a3d7a917ac8f17790ba1468b4ed78182df5d1de59cd34717",
    // M12/T9 F-252: the contract now carries its own `x-zink-contract-version`,
    // so its bytes differ from the proven live build (ea84a5a). The outgoing
    // digest is admitted so the deployed tree stays upgradable; the new digest
    // is deliberately NOT listed: it is the current build and is accepted by
    // content comparison.
    "29e3a454293b2e1e9849509b5506ff34158601c72d1ad6932cc66c2c96dee350",
  ]),
  "contracts/approval-request.schema.json": Object.freeze([
    "a4866a323a17e7e4e0243afb4f771e2d3db2116034a7bd6a615501b0ae3d2e54",
    // M10/T2-R3: the outgoing hygiene-build asset (41c62e7), byte-proven as
    // the packaged build at that commit (live tree 34/34 match). Admitted so
    // the next authorized deployment is reachable from the live runtime. The
    // new digest is deliberately NOT listed: it is the current build and is
    // accepted by content comparison.
    "29eb3ed9992171481d30d1bb9f64f97e06ceed53bcf185da77817886458ab007",
    // M12/T1-R1: the outgoing asset the live WSL runtime carries, measured
    // read-only before this entry was added. Without it --preflight refuses the
    // upgrade, which is exactly the M11/T1-R2 blocker. The digest this build
    // produces is deliberately NOT listed: it is the current build and is
    // accepted by content comparison.
    "9523f8e9d4d7eadde744db355f1fb23bae9dfb6726936fd9533c80f0aed5f66b",
    // M12/T9 F-379: the DEPLOYED build's bytes for this asset, as of
    // `c1ad4b3` — the commit that last changed it before the deployed build
    // (`0b55dfa`, measured on the live host on 2026-10-22). The admission list did
    // not name them, so --preflight refused the deployed extension. Provenance:
    // `git show c1ad4b3:integrations/openclaw/topology/contracts/approval-request.schema.json` reproduces the deployed bytes. The digest this build produces is deliberately NOT listed: it is
    // the current build and is accepted by content comparison.
    "6f750df83ddec2a7398f42753b60b61c539b3f29011ce5a4d09e6538d62de81d",
  ]),
  "contracts/delegation-envelope.schema.json": Object.freeze([
    "cc5023418300cd616b9ced2bff752c2903a07ef2a3e2e0e29c16968e7e90af97",
    // M12/T1-R1: the outgoing asset the live WSL runtime carries, measured
    // read-only before this entry was added. Without it --preflight refuses the
    // upgrade, which is exactly the M11/T1-R2 blocker. The digest this build
    // produces is deliberately NOT listed: it is the current build and is
    // accepted by content comparison.
    "cc5d1b11608e43a32db502c24b742563919bb81b9b0655f6e8b32e4dea8e0179",
    // M12/T9 F-371: the outgoing build of this asset, before the
    // delegation id changed its form (the same digest, now rendered as a
    // version-4 UUID) and before the guard resolved the delegation's tool
    // scope from the canonical policy. Without this entry --preflight refuses
    // the deployed extension. The digest this build produces is deliberately
    // NOT listed: it is the current build and is accepted by content
    // comparison.
    "36a4dd470dfa095c77c16cc1046bc12b6008257d88d79df693f9c3b4bd59b227",
    // M12/T9 F-379: the DEPLOYED build's bytes for this asset, as of
    // `c1ad4b3` — the commit that last changed it before the deployed build
    // (`0b55dfa`, measured on the live host on 2026-10-22). The admission list did
    // not name them, so --preflight refused the deployed extension. Provenance:
    // `git show c1ad4b3:integrations/openclaw/topology/contracts/delegation-envelope.schema.json` reproduces the deployed bytes. The digest this build produces is deliberately NOT listed: it is
    // the current build and is accepted by content comparison.
    "4f2777f49b2ef6956d6cb89cd12838d05b0a1dd89a1e671ad5db37d22ef8d836",
  ]),
  "contracts/delegation-proposal.schema.json": Object.freeze([
    "efd4371cacf396dc618cc84c8663a114f06b034c13737937b48aa0b895b2d6e0",
    // M12/T9 F-252: the outgoing digest of the proven live build (ea84a5a).
    // See the agent-result-payload entry for why.
    "72eec9f8935c2c4da67c5460c0fba15f268f2928235a04e5bdd00af83c1f8a38",
  ]),
  "contracts/execution-brief.schema.json": Object.freeze([
    "514001e3edfd31a128b82f2c3944761214fd5d2ef7439d8033d914180410f5e4",
    // M12/T1-R1: the outgoing asset the live WSL runtime carries, measured
    // read-only before this entry was added. Without it --preflight refuses the
    // upgrade, which is exactly the M11/T1-R2 blocker. The digest this build
    // produces is deliberately NOT listed: it is the current build and is
    // accepted by content comparison.
    "2edaf5209a2462fa347309ad4cb9858af5b1ae4a286f6f002e2e71c7a1a3975e",
    // M12/T9 F-379: the DEPLOYED build's bytes for this asset, as of
    // `c1ad4b3` — the commit that last changed it before the deployed build
    // (`0b55dfa`, measured on the live host on 2026-10-22). The admission list did
    // not name them, so --preflight refused the deployed extension. Provenance:
    // `git show c1ad4b3:integrations/openclaw/topology/contracts/execution-brief.schema.json` reproduces the deployed bytes. The digest this build produces is deliberately NOT listed: it is
    // the current build and is accepted by content comparison.
    "455b4014c8e6fa65416770cc2a45d0f85e63f81a0ccb0c67d6099be87c953303",
  ]),
  "contracts/governance-manifest.schema.json": Object.freeze([
    "f980bfd5474c8d057be92fee136779490ba93ed944295e4d173c54d7082e24c5",
    // M12/T9 F-252: the outgoing digest of the proven live build (ea84a5a).
    // See the agent-result-payload entry for why.
    "cc0878e7fb476eace236e1aa66f081faff44e45d349ae677998a170fc4732884",
  ]),
  "contracts/governed-reference.schema.json": Object.freeze([
    "e3eabb880bd46b4fccdb7b7b3767ad4be42a6d8ec4894c72959cfbf8a572c02e",
    // M12/T1-R1: the outgoing asset the live WSL runtime carries, measured
    // read-only before this entry was added. Without it --preflight refuses the
    // upgrade, which is exactly the M11/T1-R2 blocker. The digest this build
    // produces is deliberately NOT listed: it is the current build and is
    // accepted by content comparison.
    "4717f7e2edc5b7164513ae70a26c4c6cb04e6b010ead135a731d3bd36f197a0c",
    // M12/T9 F-379: the DEPLOYED build's bytes for this asset, as of
    // `c1ad4b3` — the commit that last changed it before the deployed build
    // (`0b55dfa`, measured on the live host on 2026-10-22). The admission list did
    // not name them, so --preflight refused the deployed extension. Provenance:
    // `git show c1ad4b3:integrations/openclaw/topology/contracts/governed-reference.schema.json` reproduces the deployed bytes. The digest this build produces is deliberately NOT listed: it is
    // the current build and is accepted by content comparison.
    "edf80f07c5555ce367f3138f085b846e713a6626f181e8d15041e8e9e87a608d",
  ]),
  "contracts/incident.schema.json": Object.freeze([
    "9d70678804bfc3059f3a2218babda4f4c1b55486bde5c6da5ef8c4f114fcc242",
    // M12/T1-R1: the outgoing asset the live WSL runtime carries, measured
    // read-only before this entry was added. Without it --preflight refuses the
    // upgrade, which is exactly the M11/T1-R2 blocker. The digest this build
    // produces is deliberately NOT listed: it is the current build and is
    // accepted by content comparison.
    "351ba083c5ed1ed102ba9ea2b47fa1a873c7e4ccc1e5e834ecc9d1e42b95cf4c",
    // M12/T9 F-379: the DEPLOYED build's bytes for this asset, as of
    // `c1ad4b3` — the commit that last changed it before the deployed build
    // (`0b55dfa`, measured on the live host on 2026-10-22). The admission list did
    // not name them, so --preflight refused the deployed extension. Provenance:
    // `git show c1ad4b3:integrations/openclaw/topology/contracts/incident.schema.json` reproduces the deployed bytes. The digest this build produces is deliberately NOT listed: it is
    // the current build and is accepted by content comparison.
    "dc115b4a54af81c1cb726c2764892d809903c13e35e0f04ca3daf2d3f7599c47",
  ]),
  "contracts/ledger-event.schema.json": Object.freeze([
    "e636b2452916ad8d1391a90844c0eaa3bc1c84e4aef8ede1361e3cee70143f15",
    // The accepted V16 build (9713872), established by packaging that commit.
    // Listed only so the R6 WORKFLOW_APPROVAL_REQUESTED contract can replace it.
    "12ac1bbf2f034e2d3f9ba98d1916c69eddb0e0035b618f1293f2e61f85f0c228",
    // M10/T2-R3: the outgoing hygiene-build asset (41c62e7), proven as in the
    // R3 header above (live tree 34/34 match). Same admission semantics.
    "6acc2539cf1ca1e8393f6950937bb6aafb6312c9d9262774d748b57fb58ff974",
    // M10/T2-R12: the outgoing build currently deployed, byte-verified at this
    // exact path. This revision declares the OPTIONAL `task_code` on the
    // WORKFLOW_OPENED payload, so without this entry --preflight refuses the
    // deployed extension.
    "818fd3afbb5638f6dd4cd30c4d33640f50b9c2b7b5e44b1a4212e4ae4e792005",
    // M12/T1-R1: the outgoing asset the live WSL runtime carries, measured
    // read-only before this entry was added. Without it --preflight refuses the
    // upgrade, which is exactly the M11/T1-R2 blocker. The digest this build
    // produces is deliberately NOT listed: it is the current build and is
    // accepted by content comparison.
    "9620e91773ef86c829fcff0dc264c38d7b2983f2456f62f8d6c787cb1ba5b13f",
    // M12/T9 F-371: the outgoing build of this asset, before the
    // delegation id changed its form (the same digest, now rendered as a
    // version-4 UUID) and before the guard resolved the delegation's tool
    // scope from the canonical policy. Without this entry --preflight refuses
    // the deployed extension. The digest this build produces is deliberately
    // NOT listed: it is the current build and is accepted by content
    // comparison.
    "044392c5b70f102762eb397c314503c2357fc68ab8df1414d7d39f40c0f33120",
    // M12/T9 F-379: the DEPLOYED build's bytes for this asset, as of
    // `c680a28` — the commit that last changed it before the deployed build
    // (`0b55dfa`, measured on the live host on 2026-10-22). The admission list did
    // not name them, so --preflight refused the deployed extension. Provenance:
    // `git show c680a28:integrations/openclaw/topology/contracts/ledger-event.schema.json` reproduces the deployed bytes. The digest this build produces is deliberately NOT listed: it is
    // the current build and is accepted by content comparison.
    "cc4ec33374aca06e577693646e526a926fc00c4e30c9da17748f06aa69667b55",
  ]),
  "contracts/ledger-snapshot.schema.json": Object.freeze([
    "3cde5162ae845a9b7066a623a9c4c8896f1fc6b77f2b5983ad506a9dfcbc0151",
    "01138d85c148c06c4cfc7d6cdfd844db70a2c5b9990e21cf92810fd8ee2b50c5",
    // M10/T2-R3: the outgoing hygiene-build asset (41c62e7), proven as in the
    // R3 header above (live tree 34/34 match). Same admission semantics.
    "a8c3d7aabeaae962a2ee7738d42739d0941104f61da572ef5cd5db54f6ccd5fb",
    // M10/T2-R12: the outgoing build currently deployed, byte-verified at this
    // exact path. This revision declares the OPTIONAL `task_code` on the task
    // object, so without this entry --preflight refuses the deployed extension.
    "71fa5bcae3b50c1b6f00a97c46519b29e78c2c2fa21f16faf32607a6a6548b64",
    // M12/T1-R1: the outgoing asset the live WSL runtime carries, measured
    // read-only before this entry was added. Without it --preflight refuses the
    // upgrade, which is exactly the M11/T1-R2 blocker. The digest this build
    // produces is deliberately NOT listed: it is the current build and is
    // accepted by content comparison.
    "1c0872bab446af4b31237eb8244f4b5bb6140b9828f261e66f3b38f37526299f",
    // M12/T9 F-371: the outgoing build of this asset, before the
    // delegation id changed its form (the same digest, now rendered as a
    // version-4 UUID) and before the guard resolved the delegation's tool
    // scope from the canonical policy. Without this entry --preflight refuses
    // the deployed extension. The digest this build produces is deliberately
    // NOT listed: it is the current build and is accepted by content
    // comparison.
    "d46089816a38c500fa95458ab4304977776bff9ff23b3820eef37448b5e50b4e",
    // M12/T9 F-379: the DEPLOYED build's bytes for this asset, as of
    // `c680a28` — the commit that last changed it before the deployed build
    // (`0b55dfa`, measured on the live host on 2026-10-22). The admission list did
    // not name them, so --preflight refused the deployed extension. Provenance:
    // `git show c680a28:integrations/openclaw/topology/contracts/ledger-snapshot.schema.json` reproduces the deployed bytes. The digest this build produces is deliberately NOT listed: it is
    // the current build and is accepted by content comparison.
    "ecc54480920d04757a4345f91a05acbcf77213d8a032f3521677418836b19cc1",
  ]),
  "contracts/result.schema.json": Object.freeze([
    "9440dfb87b3daf358b11dc7b59b62586c68786235d99d717daf9783b9a6e4540",
    // M12/T1-R1: the outgoing asset the live WSL runtime carries, measured
    // read-only before this entry was added. Without it --preflight refuses the
    // upgrade, which is exactly the M11/T1-R2 blocker. The digest this build
    // produces is deliberately NOT listed: it is the current build and is
    // accepted by content comparison.
    "b1ebc7279504d42f262002aea10dc50f265510bbf2c90b21dcba26ea9d8f807a",
    // M12/T9 F-379: the DEPLOYED build's bytes for this asset, as of
    // `c1ad4b3` — the commit that last changed it before the deployed build
    // (`0b55dfa`, measured on the live host on 2026-10-22). The admission list did
    // not name them, so --preflight refused the deployed extension. Provenance:
    // `git show c1ad4b3:integrations/openclaw/topology/contracts/result.schema.json` reproduces the deployed bytes. The digest this build produces is deliberately NOT listed: it is
    // the current build and is accepted by content comparison.
    "f6a12e827c5c537323e00f7283ea816f516cac9412e2a45c61f610a8d3eafe73",
  ]),
  "contracts/trusted-result-envelope.schema.json": Object.freeze([
    "5d40c23152bba749826797eb0271c47a20f3aab910bcad2852428618ad9f0ec9",
    // M12/T1-R1: the outgoing asset the live WSL runtime carries, measured
    // read-only before this entry was added. Without it --preflight refuses the
    // upgrade, which is exactly the M11/T1-R2 blocker. The digest this build
    // produces is deliberately NOT listed: it is the current build and is
    // accepted by content comparison.
    "09cabcb1a1f7805eaea0bdf42a7fd0504c6efdd22b18e99959523e9e3cb17eb5",
    // M12/T9 F-371: the outgoing build of this asset, before the
    // delegation id changed its form (the same digest, now rendered as a
    // version-4 UUID) and before the guard resolved the delegation's tool
    // scope from the canonical policy. Without this entry --preflight refuses
    // the deployed extension. The digest this build produces is deliberately
    // NOT listed: it is the current build and is accepted by content
    // comparison.
    "4d8a7403452031f38b84dd5d7033b997b30d74fd4a253adb2124484b86021846",
    // M12/T9 F-379: the DEPLOYED build's bytes for this asset, as of
    // `c1ad4b3` — the commit that last changed it before the deployed build
    // (`0b55dfa`, measured on the live host on 2026-10-22). The admission list did
    // not name them, so --preflight refused the deployed extension. Provenance:
    // `git show c1ad4b3:integrations/openclaw/topology/contracts/trusted-result-envelope.schema.json` reproduces the deployed bytes. The digest this build produces is deliberately NOT listed: it is
    // the current build and is accepted by content comparison.
    "c136bbf764f3c7e681a93e1a2be4fc8e8ad2d3722930cd722ae935cd90d1a0e6",
  ]),
  "governance-manifests.json": Object.freeze([
    "5026959d41a76c531f37caa6297b3b0b010ee17cedd7bdd3806447600c98a18d",
    // M10/T2-R3: the outgoing hygiene-build asset (41c62e7), proven as in the
    // R3 header above (live tree 34/34 match). Same admission semantics.
    "e27647b9742b56052188a8bbf746ab6c5eeaaeb67344216c11859167ee78946f",
    // M10/T2-R12: the outgoing manifests currently deployed, byte-proven
    // against the live runtime. This revision changes the per-agent
    // governance_hash (owner-ordered communication section in Common Core),
    // so without this entry --preflight refuses the deployed extension. The
    // new digest is deliberately NOT listed: it is the current build,
    // accepted by content comparison.
    "ab1d2f8ecd91a3e72226d15495f641e701ef5c0a9e3b6d3a59db48b91256decd",
    // M12/T1-R1: the asset the live WSL runtime carries (measured read-only).
    // This task edits only a byte-budget comment in authority.mjs, and regenerates
    // governance-manifests.json because its governance_hash covers policy.mjs. Both
    // must stay admitted or --preflight refuses the upgrade.
    "9c465c36afd4ea8a33dcb7d82fad486cb44e48af6791d75842cd8acdda7be6e7",
    // M12/T9 F-379: the DEPLOYED build's bytes for this asset, as of
    // `0b55dfa` — the commit that last changed it before the deployed build
    // (`0b55dfa`, measured on the live host on 2026-10-22). The admission list did
    // not name them, so --preflight refused the deployed extension. Provenance:
    // the build at `0b55dfa` generates these manifests, and its own bytes reproduce the deployed file. The digest this build produces is deliberately NOT listed: it is
    // the current build and is accepted by content comparison.
    "28fa9603bde16aa655050df03f8697decf95f97a89ca24be95c50a61abd336b9",
  ]),
  "lib/artifact-validator.mjs": Object.freeze([
    // M10/T2-R17: the outgoing build currently deployed, byte-proven by
    // `sha256sum` of the installed file. This revision adds the parent-directory
    // fsync after `renameSync`, closing a durability gap against the guarantee
    // `ledger.mjs` and `queue-manager.mjs` already implement (M7-066): fsyncing
    // the file does not make the rename itself durable, so a published artifact
    // could revert on a crash. Without this entry --preflight refuses the
    // deployed extension. The new digest is deliberately NOT listed: it is the
    // current build, accepted by content comparison.
    "86234954a8d7469a621f5a1dcc18ec2252520e907ae6766cfd84d6eb48bbb978",
    "0b35496fdebe5e204bfc4395057e9a54e5635060a1af1fe47146dd391ebeac79",
    // M12/T9: the proven live build's artifact validator (commit ea84a5a,
    // re-derived through the real packaging generator). M12/T9 F-258 changed
    // the excel branch, so the deployed tree's bytes become a predecessor.
    // Without this entry --preflight refuses the deployed extension. The new
    // digest is deliberately NOT listed: it is the current build, accepted by
    // content comparison.
    "5da6478dc2cab265b4107cf2327e563e5ccf1aeab978dfda9892ba30bd122567",
  ]),
  "lib/authority.mjs": Object.freeze([
    // M10/T2-R14: the outgoing R12/R13 build currently deployed, byte-proven by
    // `sha256sum` of the installed file. This revision drops the impossible
    // `auth` requirement from the release-compatibility validator: R9 removed
    // auth.profiles/order/cooldowns on purpose and `validateConfig` rejects
    // unexpected top-level keys, so no config this repository produces could
    // ever satisfy it. Without this entry --preflight refuses the deployed
    // extension. The new digest is deliberately NOT listed: it is the current
    // build, accepted by content comparison.
    "8243a0385a51fc0f63d918cbb5d2a4998af92fa0c409a890b96ba06fb7670f27",
    "1e6eb2659f3d671ec62e6c57f28088bfcfffef3d637ec0f898d8ef18fc426b13",
    // Owner-identity hygiene follow-up: the outgoing R19 build currently
    // deployed, byte-verified against the live runtime at this exact path.
    // This revision changes this file (the owner alias is now resolved from
    // configuration), so without this entry --preflight refuses the deployed
    // R19 extension and the deployment is unreachable. The new digest is
    // deliberately NOT listed: it is the current build and is already accepted
    // by content comparison.
    "50a0b47860cb4cce29fc4f4d40d7c57813035324bc2e490a6f184754212e3e82",
    // M10/T2-R3: the outgoing hygiene-build asset (41c62e7), proven as in the
    // R3 header above (live tree 34/34 match). Same admission semantics.
    "bb2f53280712d94ee799f116d3c28a6d199e6648ad558ea0cce18bd6210eddd0",
    // M10/T2-R7: the outgoing R2-tree asset (origin commit 2ef4bd6), proven
    // by packaging that commit through governancePluginFiles() before
    // admission (see R7 P1: byte-identical to the live R3 file). R4/R5
    // changed this file (conversational classifiers) without admitting the
    // outgoing digest, so without this entry --preflight refuses the
    // deployed extension. The new digest is deliberately NOT listed: it is
    // the current build and is already accepted by content comparison.
    "aa12540f60da6bcdf809123f0d75c632c6b8a128a88e4395f38785b663f13e17",
    // M10/T2-R12: the outgoing R9-C authority build currently deployed,
    // byte-verified at this exact path. This revision changes this file so
    // buildComponentCustomId emits the host `occomp:cid=` wire envelope; without
    // this entry --preflight refuses the deployed extension. The new digest is
    // deliberately NOT listed: it is the current build, accepted by content
    // comparison.
    "42b0cba8567c1e52376d41d9329394b70c94e45a503af37733dcf76721d536c6",
    // M12/T1-R1: the asset the live WSL runtime carries (measured read-only).
    // This task edits only a byte-budget comment in authority.mjs, and regenerates
    // governance-manifests.json because its governance_hash covers policy.mjs. Both
    // must stay admitted or --preflight refuses the upgrade.
    "71eee819e9a9ce5d3cc927352ae392c9a57e625fa4618273c7cef9a04c383eb8",
    // M12/T2.2-R2 M-1: the build the live runtime ACTUALLY carries, reproduced by
    // packaging commit c1ad4b3 (M1 1). 61638d8 replaced it with `25484e41…` and
    // admitted nothing, which is what turned R7 P1 red on the WSL lane. The current
    // build stays accepted by content comparison and is deliberately NOT listed.
    "c38e1a6b7934bd01afd262dca0402fbb6936086a03b10731b91952db4003f36b",
  ]),
  "lib/canonical.mjs": Object.freeze([
    // M10/T2-R13: the outgoing build currently deployed, byte-verified at this
    // exact path. This revision aligns TASK_CODE_PATTERN with the 21-symbol
    // TASK_CODE_ALPHABET and both ledger schemas (review finding R12-REVIEW-01,
    // committed in 7d92211 but not yet deployed). Without this entry
    // --preflight refuses the deployed extension.
    "f5bc7ffac03818f3864255896c9732a1111e8736735391fc7daf0e7985737912",
    "c6c0515ab3b1ade07d94d8b5969cd425456db2b5fff56847ba7ef0030989b203",
    // M10/T2-R12: the outgoing build currently deployed, byte-verified at this
    // exact path. This revision adds the owner-facing task-code generator, so
    // without this entry --preflight refuses the deployed extension. The new
    // digest is deliberately NOT listed: it is the current build, accepted by
    // content comparison.
    "868de6b9675d54920b93694ac1614d8fabfcb3868c86f755a74e53b2f14af777",
    // M12/T1-R1: the outgoing asset the live WSL runtime carries, measured
    // read-only before this entry was added. Without it --preflight refuses the
    // upgrade, which is exactly the M11/T1-R2 blocker. The digest this build
    // produces is deliberately NOT listed: it is the current build and is
    // accepted by content comparison.
    "63adeee5c5ced229aa4a5c98df1c506987f5058fa538f9d27b105b11133d6f65",
    // M12/T9 F-371: the outgoing build of this asset, before the
    // delegation id changed its form (the same digest, now rendered as a
    // version-4 UUID) and before the guard resolved the delegation's tool
    // scope from the canonical policy. Without this entry --preflight refuses
    // the deployed extension. The digest this build produces is deliberately
    // NOT listed: it is the current build and is accepted by content
    // comparison.
    "917f44bd8f7462277ca68e53983ceaddf6422bb8bc623d82b9c1a14a00990f59",
    // M12/T9 F-379: the DEPLOYED build's bytes for this asset, as of
    // `c1ad4b3` — the commit that last changed it before the deployed build
    // (`0b55dfa`, measured on the live host on 2026-10-22). The admission list did
    // not name them, so --preflight refused the deployed extension. Provenance:
    // `git show c1ad4b3:integrations/openclaw/topology/lib/canonical.mjs` reproduces the deployed bytes. The digest this build produces is deliberately NOT listed: it is
    // the current build and is accepted by content comparison.
    "5437225523b9d83ce79d095a5f4145e1ef5d1773b6e61be6bcac31652f77668c",
  ]),
  "lib/decision-ledger.mjs": Object.freeze([
    // M10/T2-R17: the outgoing build currently deployed, byte-proven by
    // `sha256sum` of the installed file. This revision adds the parent-directory
    // fsync after `renameSync` for the same reason as `artifact-validator.mjs`.
    // It matters most here: this ledger sits on the "classification -> OWNER
    // CONFIRMS -> DecisionLedger persists" path, so losing the rename could drop
    // the owner's most recent confirmed decision. Without this entry
    // --preflight refuses the deployed extension.
    "60ff817f952f20927ab9ad5cd28d57946b27d2ca0ce8aed9bcf713d3d094b427",
    "cec8776c771d4cf521a664fa7dd62aa5e14b54cc05389b30be51bc03b4c51a6e",
    // M10/T2-R3: the outgoing hygiene-build asset (41c62e7), proven as in the
    // R3 header above (live tree 34/34 match). Same admission semantics.
    "9b5f2f94c33430a30ae5da96b118a558229503bf195e8168701cfb1d748b782e",
    // M11/T3 Phase 2: the build the live WSL runtime carries — byte-equal to
    // `HEAD` at the start of this task and one of the 31 assets PLAN.md §3
    // recorded as matching the current build. This revision takes `save()`'s
    // whole-file read-modify-write under the shared `<basename>.lock`, so
    // without this entry --preflight refuses the deployed extension and the
    // next authorized deployment becomes unreachable (the M11/T1-R2 defect).
    // The new digest is deliberately NOT listed: it is the current build,
    // accepted by content comparison.
    "5e97d9caf644768ce40d253324ff6ca8730cce230d2d82dcff6e47a085718642",
    // M12/T2.2-R2 M-1: the build the live runtime carries, reproduced by packaging
    // commit 6b0ea0a. See the lib/guard.mjs entry for why nine paths drifted.
    "1d9518ca6150474e21510fae48c9a19d580b0a254304998982071da5b631f343",
  ]),
  "lib/policy.mjs": Object.freeze([
    // M10/T2-R14: the R13 build currently deployed (the one that carries the
    // router `timeoutSeconds` ceiling), byte-proven by `sha256sum` of the
    // installed file. This revision replaces the truthiness capability lookup
    // with an own-property test, so inherited keys such as `constructor` and
    // `toString` no longer authorize a capability. Without this entry
    // --preflight refuses the deployed extension. The new digest is deliberately
    // NOT listed: it is the current build, accepted by content comparison.
    "7b38ee20178f9493e1d0761a5e678ec8da90ee45d4d74036b44400f99b13ed1c",
    // M10/T2-R13 (owner decision 2026-10-09): the outgoing build currently
    // deployed, byte-verified at this exact path before the attempt-ceiling
    // change. This revision adds `timeoutSeconds` to the router provider, so
    // without this entry --preflight refuses the deployed extension and the fix
    // is unreachable. The new digest is deliberately NOT listed: it is the
    // current build, accepted by content comparison.
    "62bda451a299344f4df30e19ab6a47402e5c7d30d3d568eadf541b785dece2d0",
    "0584ca5fd8698ef986a7a41f31d1b735997bc1f7fb879f91a1df90ad191603e5",
    // M10/T2-R12: the outgoing governed-model build currently deployed,
    // byte-verified at this exact path. This revision replaces the governed set
    // with the owner's ordered five-model direct chain and drops the `execute`
    // combo, so without this entry --preflight refuses the deployed extension.
    // The new digest is deliberately NOT listed: it is the current build,
    // accepted by content comparison.
    "f542cb81d80a9e6082cf9fc42ecfa22834f0a1621bd98327fcbc731426c3f0ee",
    // The accepted R5 build (652ac0c), whose provenance IS established: this
    // digest was reproduced by packaging the same file at that commit. Listed
    // only so the V15 contracts-lookup fix can replace it. Contrast the
    // 2026-09-30 group above, whose provenance is explicitly NOT established.
    "d2f3e7203f327041a5678234d8fd302f20e06c7b7b2fbf8b1c079317858e4d2a",
    // The accepted V15 build (9a6702f), established the same way, listed only so
    // the V16 self-safe rewrite mechanism can replace it. Same classification as
    // the entry above; the semantics of this table are unchanged.
    "5bbcbdbf39cdee8f568f48ce613450ea203f04ca39ee360f213456e4977e74f8",
    // Owner-identity hygiene follow-up: the outgoing R19 build currently
    // deployed, byte-verified against the live runtime at this exact path.
    // This revision changes this file (the built plugin config now carries the
    // validated Discord surface ids), so without this entry --preflight refuses
    // the deployed R19 extension and the deployment is unreachable. The new
    // digest is deliberately NOT listed: it is the current build and is already
    // accepted by content comparison.
    "5a1d991977b6b5bb3c510f9e193f21b8300766ef6271a6316acb9a77ed4b6776",
    // M10/T2-R3: the outgoing hygiene-build asset (41c62e7), proven as in the
    // R3 header above (live tree 34/34 match). Same admission semantics.
    "e29812bcae3d791252ea6d567d77ceb4c7a1e43692fdf920317251369d2a2891",
    // M10/T2-R9: the outgoing provider build currently deployed, byte-proven
    // against the live runtime at this exact path on 2026-10-06. This revision
    // changes this file (the 21 google auth profiles, the per-agent auth order,
    // MODEL_ALLOWLIST, PLUGIN_ALLOWLIST and the secret refs are all replaced by
    // the single router provider), so without this entry --preflight refuses the
    // deployed extension and the deployment is unreachable. The new digest is
    // deliberately NOT listed: it is the current build, accepted by content
    // comparison. This entry permits OVERWRITING this file with the current
    // build's bytes; it does not make the old content trusted.
    "1b39cadd6b8ea5213e2f664ea8045089d7bd04e74876b8535d2b026aed39a39f",
    // M10/T2-R9: an intermediate build this deployment wrote, recorded from the
    // live bytes. It declared `models.providers.router.models` as an object; the
    // installed runtime validates that field as an ARRAY and refused to start,
    // so the gateway was down and the corrected build could not be reached
    // without this admission. It is listed ONLY so the corrected array-shaped
    // build can replace it. Its config shape is invalid and is not trusted: the
    // runtime itself rejected it.
    "7886a026fbcc2fa4dce376ad1ca798125d8ee3689f71590075f1c626f2131e8f",
    // M10/T2-R9: the array-shaped `models` build, recorded from the live bytes.
    // This is the build the gateway actually runs today; the next change swaps
    // the primary model to the router's `execute` combo and therefore produces a
    // different digest again. Listed ONLY so the successor build can replace it.
    "8fc8dd8526406cb488ae83f7ae22cc3b6d46e4284703bba00d289e45df655ceb",
    // M10/T2-R9: the `execute`-primary build, recorded from the live bytes
    // (apply #3). Listed ONLY so the single-model successor can replace it.
    "3331835d16a63b20100fc0296fc386a2a9e769b17a2bce2dcf4d84a66775105f",
    // M10/T2-R9: the single-`execute` build with the array-shaped models block,
    // recorded from the live bytes. Listed ONLY so the maxTokens successor can
    // replace it.
    "874c4490de94f04e93623f90b9b457135f7544d2144a783be081ed80c8f00919",
    // M10/T2-R12: the maxTokens single-`execute` build, recorded from the live
    // bytes. It was written by a diagnostic direct apply and never admitted;
    // without this entry --preflight refuses the deployed extension. Listed
    // ONLY so the failover successor can replace it.
    "60ddd5dd7c7d2d8e2e78d94cd556d4524db06bbff7453d6619e696a2b68f2178",
    // M10/T2-R12 failover restoration: the requestTimeoutMs build. It was
    // deployed and then REJECTED by the installed runtime's strict entry
    // schema (`Unrecognized key: "requestTimeoutMs"`, gateway refused to
    // start, recovery by removal). Listed ONLY so the corrected successor can
    // replace it; its config shape is invalid and is not trusted.
    "d28a9bbc529e5c5186d998363024be999c7a62c6d250adcbce21c6cba67b2818",
    // M10/T2-R12: the failover build (execute + 3.6-flash, no requestTimeoutMs)
    // currently deployed, recorded from the live bytes. This revision adds the
    // owner-ordered communication section (anh/em, diacritics, agentId
    // emphasis for all agents), so without this entry --preflight refuses the
    // deployed extension. Listed ONLY so the successor can replace it.
    "b0290495e6fb7446f568a90df1c556d1e2b6318265b0b42377936bb1bdc08965",
    // M12/T1-R1: the outgoing asset the live WSL runtime carries, measured
    // read-only before this entry was added. Without it --preflight refuses the
    // upgrade, which is exactly the M11/T1-R2 blocker. The digest this build
    // produces is deliberately NOT listed: it is the current build and is
    // accepted by content comparison.
    "0a1b05edb81c64e3d79debef618185b3a2cfe0b0439fc8729ab927ce0e5fa9c0",
    // M12/T2.2-R2 M-1: the build the live runtime carries, reproduced by packaging
    // commit c680a28. See the lib/guard.mjs entry for why nine paths drifted.
    "d621c85f37bef11c0767843c4c1b25d38c9d55d66cee2be75d7630e4c604c8fb",
  ]),
  "lib/quota-telemetry.mjs": Object.freeze([
    // M10/T2-R9: the live asset before the single-model change, recorded from
    // its bytes. This file had never changed, so it had no predecessor entry.
    // R9 reduces the governed model set to one entry, which makes the resolver's
    // fallback branches unreachable in production and adds
    // NO_FALLBACK_AVAILABLE; without this entry --preflight would refuse the
    // deployed extension and the apply would be unreachable. Listed ONLY so the
    // successor can replace it; the current build is accepted by content
    // comparison.
    "6ece2af4b3469183f803a46c0551c90b1b44e27adfc3ef8d0c95af8df7eb6d16",
    // M12/T9: the proven live build's quota telemetry (commit ea84a5a,
    // re-derived through the real packaging generator). M12/T9 F-130 moved the
    // module's comments and the one canonical owner validator, so the deployed
    // tree's bytes become a predecessor. Without this entry --preflight refuses
    // the deployed extension. The new digest is deliberately NOT listed: it is
    // the current build, accepted by content comparison.
    "2eb3af1d5f275f8c9cd156ac70d2ee3713f1ba0aae7fea5f6e1c63ee3c86005f",
  ]),
  "lib/queue-manager.mjs": Object.freeze([
    "a8021088a4e9373fcf74cf4dd31433c8606b9505eaf74c5fa922839ee716776a",
    // M10/T2-R3: the outgoing hygiene-build asset (41c62e7), proven as in the
    // R3 header above (live tree 34/34 match). Same admission semantics.
    "97fa9907c5c37c7c4e0432d0ccd9d1d1786b153197913da6a888bfb0e81ce5f2",
    // M11/T3 Phase 1: the outgoing queue build the live runtime carries
    // (`f7995d51…`, verified read-only against the WSL deployment). A4 put the
    // two unserialized mutators — `enqueueTask` and `clear` — behind the same
    // `withLock` the other nine already use, so a concurrent enqueue can no
    // longer clobber a leased claim. The queue file format is unchanged. Without
    // this entry --preflight refuses the deployed extension. The new digest is
    // deliberately NOT listed: it is the current build.
    "f7995d51d2d8f5a73fb3f7a980292236ff76fcc445cf1d769a48d35c84a8f140",
    // M12/T2.2-R2 M-1: the build the live runtime carries, reproduced by packaging
    // commit 3cb8274. See the lib/guard.mjs entry for why nine paths drifted.
    "a5580bb67a7ace7edfdaf2595b7245a3be3a6959333ae6cbeaf76d080f49fb37",
  ]),
  "lib/schema.mjs": Object.freeze([
    "869a2254975f60432c596a115acee1fc0e03893224b925c5a54334dc532d1cee",
    // M12/T2.2-R2 B-9 (owner admission §0.5-E): the build the live runtime carries, so the
    // divergence B-9 introduces in the packaged `lib/schema.mjs` stays upgradable. Re-derived
    // from `ea84a5a` through `governancePluginFiles()` — the construction R2 P1 uses — not
    // transcribed. The new digest is the current build and is deliberately not listed.
    "b3222229b760c0456b0c9a8f947971450d065c22f33af59c62a443f0e2d409b4",
    // M12/T9 F-371: the outgoing build of this asset, before the
    // delegation id changed its form (the same digest, now rendered as a
    // version-4 UUID) and before the guard resolved the delegation's tool
    // scope from the canonical policy. Without this entry --preflight refuses
    // the deployed extension. The digest this build produces is deliberately
    // NOT listed: it is the current build and is accepted by content
    // comparison.
    "3d8bd7331005c71f71ff394d0e0e319b6ffe93ad0de57708792f61f3373e7e6d",
  ]),
  "lib/excel-writer.mjs": Object.freeze([
    // M10/T2-R19: the FIRST predecessor entry for this asset (it had none,
    // because until now every revision was also the current build). This
    // revision adds sandbox path containment — `../` in a model-supplied
    // `file_path` previously resolved out of the agent sandbox and wrote three
    // files there while the tool reported success — and fixes the spreadsheet
    // column reference, which used a modulo instead of a base-26 conversion and
    // therefore emitted a duplicate `A1` cell from column 27 onward.
    "c3079ba3d29af1ba864b7a2561533b44d82f6afc247ec6e6caf663bab4db6551",
    // M12/T1-R1: the outgoing asset the live WSL runtime carries, measured
    // read-only before this entry was added. Without it --preflight refuses the
    // upgrade, which is exactly the M11/T1-R2 blocker. The digest this build
    // produces is deliberately NOT listed: it is the current build and is
    // accepted by content comparison.
    "5681f6438b3a9adc50f4d6ffbb0ad405d1ff1c8d12463b6f28295ad2cf3bca53",
    // M12/T9 F-379: the DEPLOYED build's bytes for this asset, as of
    // `c1ad4b3` — the commit that last changed it before the deployed build
    // (`0b55dfa`, measured on the live host on 2026-10-22). The admission list did
    // not name them, so --preflight refused the deployed extension. Provenance:
    // `git show c1ad4b3:integrations/openclaw/lib/excel-writer.mjs` reproduces the deployed bytes. The digest this build produces is deliberately NOT listed: it is
    // the current build and is accepted by content comparison.
    "c1755901e5ce03ae8fa50d9b5d81ea53b1bb29d1918e648df410ca0f00e660f1",
  ]),
  "lib/coordinator-pickup.mjs": Object.freeze([
    // M10/T2-R19: the FIRST predecessor entry for this asset. This revision
    // makes the coordinator message honour its own 4096-BYTE ceiling (it was
    // truncating by characters, measured at 286% of the ceiling with a lone
    // surrogate on emoji) and makes a failed post-start binding write
    // attributable instead of aborting the pickup tick.
    "c00bbb6b02087c7de5bcb74b76a54638817b7c08e509a8775e8c1512bc104637",
    // M12/T9: the live build's bytes for this asset, admitted so --preflight still accepts the deployed extension. The band moved this asset, so its current build is accepted by content comparison.
    "fe367beae4913a52e437739c1f185668174c976bd377f871f6a088c4f6d3818f",
  ]),
  "lib/file-lock.mjs": Object.freeze([
    // M10/T2-R18: the FIRST predecessor entry for this asset. It had none,
    // because until now every revision of file-lock.mjs was also the current
    // build and was therefore accepted by content comparison — so a change to it
    // was undeployable until its outgoing digest was admitted. This revision
    // stops a failing release from replacing the guarded call's outcome (which in
    // the ledger reported an already-fsynced event as a rejected write), adds a
    // bounded release retry, and stops non-contention filesystem errors from
    // being relabelled FILE_LOCK_TIMEOUT without a `.code`.
    "165243b2edb0ff5a406f146343220320947ac930a91779de42f8232c28b6d2d4",
    // M11/T1-R2: the SECOND predecessor entry, and the one the LIVE runtime
    // actually carries. `--preflight` proved it read-only as
    // `Governance plugin asset drift detected: …/lib/file-lock.mjs`, and the
    // whole 33-asset scan found this to be the only gap: every other asset is
    // byte-equal to the current build and the live `index.mjs`
    // (`230f3c79…`) is already admitted. Provenance is `ea84a5a`
    // ("fix(m10/t2-r13-r25): sweep 39 defects…") re-packaged through the
    // repository's own `governancePluginFiles()` in
    // `tests/m11-t1-r2-file-lock-asset-predecessor.test.mjs`, not transcribed.
    // The intermediate `d773856` digest (`0e533f10…`) is deliberately NOT
    // listed: that build was never installed on any runtime, so admitting it
    // would widen the control for no deployment path.
    "1975c821f94afe25147debe5ca538f83c3c0e2e3be10bfcacca80c3e9bfbf37e",
    // M11/T3 Phase 2: the build the live WSL runtime carries, recorded in
    // PLAN.md §3/§4 and CHANGELOG.md as `lib/file-lock.mjs = 22d7411a…`. This
    // revision makes the async release non-spinning (`releaseAsync`), adds the
    // WSL drvfs/9p transient errnos, and clears the in-process owner token when
    // the retry budget is exhausted. Without this entry --preflight refuses the
    // deployed extension. The new digest is deliberately NOT listed: it is the
    // current build, accepted by content comparison.
    "22d7411a1a4613bc70379b405c922b560fd15cf41e81d0ff52db7231c409e6ff",
    // M12/T9 F-379: the DEPLOYED build's bytes for this asset, as of
    // `6b0ea0a` — the commit that last changed it before the deployed build
    // (`0b55dfa`, measured on the live host on 2026-10-22). The admission list did
    // not name them, so --preflight refused the deployed extension. Provenance:
    // `git show 6b0ea0a:integrations/openclaw/topology/lib/file-lock.mjs` reproduces the deployed bytes. The digest this build produces is deliberately NOT listed: it is
    // the current build and is accepted by content comparison.
    "bcd65de81c9f6df088dd9ec269cc4dd3969fd80657f9c582e34e06554e64cf7b",
  ]),
  "lib/guard.mjs": Object.freeze([
    // M10/T2-R14: the outgoing R12/R13 build currently deployed, byte-proven by
    // `sha256sum` of the installed file. This revision asserts the canonical
    // `AGENT_SPAWN_POLICY` allowlist BEFORE the irreversible
    // WORKFLOW_BRIEF_ACTIVATED write, so a brief naming an agent the caller may
    // not spawn is refused instead of committing a task that can never be
    // dispatched. Without this entry --preflight refuses the deployed
    // extension. The new digest is deliberately NOT listed: it is the current
    // build, accepted by content comparison.
    "edc0f1b48b0f2537823b62a9e0aeb27020d687e62acb8fb4ac12a36dbfba9f76",
    "3d017828de32ed2d9ecdfc7c78e1828f3b4f8a13f88a51aabdd8ddff81443029",
    "00cce929877bfab0864b16519dfa0276bb2955053d348b3e298c4121c3784100",
    "55b38c41d44dc5386f696af671ca8b4de3655e2e2f5b0a6c586560509336c0bc",
    "1c580dc09518ceffeb48ea44d760f280af03b9e3f2b11d0f7a9231638d04e9b3",
    "a6b6f452255d22bee7d3b8b860da4fddef85bafa299fcbaf519dd76cfca075e9",
    "b230651ec4fa9b5a123c10e319438918c0763f99287f5223da1a71d1aebe213a",
    "efdcea2457db29f20603fa0cf948fd8e0261f78d3ec3f863637a56befdf8f784",
    "c66587e10db3f35c8c03ff430360e1abe4bc2268613ae78d1e2bd8837dca0173",
    // M10/T2-R3: the outgoing hygiene-build asset (41c62e7), proven as in the
    // R3 header above (live tree 34/34 match). Same admission semantics.
    "9e7e284507e6d6f5e2213005d4ad89af60540ef0bb404eb0d4855bf8078cab78",
    // M10/T2-R10: the outgoing guard build currently deployed, byte-proven
    // against the live runtime at this exact path. This revision changes this
    // file by exactly one functional line (the policy-path resolution at
    // ensureDependencies: `path.resolve(_moduleDir, candidate)` instead of
    // wrapping `_moduleDir` in `pathToFileURL`), so without this entry
    // --preflight refuses the deployed extension and the apply is unreachable.
    // The new digest is deliberately NOT listed: it is the current build,
    // accepted by content comparison. This entry permits OVERWRITING this file
    // with the current build's bytes; it does not make the old content trusted.
    "0de0d0f00542193157783d298e0c2b97a7808dcae573c27235d6d341421cede5",
    // M10/T2-R12: the R10 guard build (policy-path fix), byte-proven against
    // the live runtime. This revision moves the spawn approval check after
    // params/node/topology/budget/lineage validation and fixes the legacy
    // carve-out NaN. Listed ONLY so the successor can replace it.
    "482b4938647eed44866ed494bf18f6e2417a3e41f31f3960b4629958815ff7a8",
    // M11/T3 Phase 2: the build the live WSL runtime carries. This revision
    // reads `approvals.json` and the per-task approval file under the ledger's
    // `writer.lock` — the lock `consumeApprovalAtomically` already takes — makes
    // an unparseable individual record a governed denial instead of raw parser
    // text, and documents the in-memory-only replay guard when no ledger root is
    // present. Without this entry --preflight refuses the deployed extension.
    // The new digest is deliberately NOT listed: it is the current build.
    // ASSET digest, proven through `governancePluginFiles()` — the raw file
    // hashes differently because packaging rewrites this module's imports.
    "7dd37ee9ffea60de1f30869f03f73e4182f9b31b5c459302ba68ffb5093242fd",
    // M12/T2.2-R2 M-1: the build the live runtime ACTUALLY carries, reproduced by
    // packaging commit 6b0ea0a through governancePluginFiles() (M1 1). 09aa698 and
    // 61638d8 both rolled this file without admitting their outgoing digest, so
    // nine governed paths ended up neither current nor admitted and --preflight
    // refused the deployed extension. The current build stays unlisted.
    "263d72c426e4c29c13f1749e94ce6cadcf0340b59bcbf91bd982763c8c5d3a26",
    // M12/T9 F-371: the outgoing build of this asset, before the
    // delegation id changed its form (the same digest, now rendered as a
    // version-4 UUID) and before the guard resolved the delegation's tool
    // scope from the canonical policy. Without this entry --preflight refuses
    // the deployed extension. The digest this build produces is deliberately
    // NOT listed: it is the current build and is accepted by content
    // comparison.
    "120e75a4e4e80a77bf16e55f83247bc680841bb6ecc433be3f0b6f7aa9be6933",
  ]),
  "lib/native-boundary.mjs": Object.freeze([
    "4b77356f2a843f26040a7cd3312c896469aff33cc472bc6c02fdd5c472bd1234",
    "4c3f908b84ae64155e6a32741596fc6e2b28601127b72dc33fcea20bcbcc7347",
    "25759e86e53d962bcb00a13eedd63ea028abb31c212ae2874a84bfd041509809",
    "164b17293cf4ac63089ad2ea1afe96bc24b39450bc3332820bc9f5fff654e253",
    "8dbd524a49a8b65959e74f0aaf37516a7a211759bd0a3d047dfd1e73863bd741",
    "6308a7c37745f2a8214a5ad47f9dd3fa0af00d1479ea9676d15bd3a6eb8ea29a",
    // M8/T2.2-R8: the accepted R5 build (9713872), established by packaging that
    // commit and matching the restored pre-incident extension byte-for-byte. R7
    // changed only this file, so without this entry --preflight refuses the whole
    // verified R5 extension and --apply becomes unreachable on it.
    "49352d47ac88798cc918c654875f84241a7efbb1d5a661c64b77e7efbacf3be9",
    // M8/T2.2-R13: the outgoing R7 build currently deployed, byte-proven
    // against the live runtime at this exact path on 2026-09-30
    // (extensions/zink-governance/lib/native-boundary.mjs, 13981 bytes) and
    // cross-checked against the live dist bridge. R10 is the only revision that
    // changes this file after R7, so without this entry --preflight refuses the
    // deployed R7 extension and the R10 deployment is unreachable. The R10
    // digest is deliberately NOT listed: it is the current build and is already
    // accepted by content comparison.
    "33b3feefdfd473dc0d6d09b0ae7b8e39b394fa93a1247fe117bc58757f075412",
    // M8/T2.2-R17: the outgoing R10 build currently deployed, byte-proven against
    // the live runtime at this exact path and cross-checked against the live dist
    // bridge on 2026-09-30 after the R16 deployment. R17 changes only this file,
    // so without this entry --preflight refuses the deployed R10 extension and the
    // R17 deployment is unreachable. The R17 digest is deliberately NOT listed:
    // it is the current build and is already accepted by content comparison.
    "50af7d4ae10b519340b8dc13af3e2b219041fb28991e2a777ea815b537d2c7c2",
    // M8/T2.2-R18: the outgoing R17 build currently deployed, byte-proven against
    // the live runtime at this exact path and cross-checked against the live dist
    // bridge after the R17 deployment. R18 changes only this file -- it recovers
    // the admission-time heartbeat discriminator at the run-end seam so both seams
    // classify a run with one predicate -- so without this entry --preflight
    // refuses the deployed R17 extension and the R18 deployment is unreachable.
    // The R18 digest is deliberately NOT listed: it is the current build and is
    // already accepted by content comparison.
    "4567ce268064cb7729ace6ebc122dcaa2f1a938fa6b59143e3baeddd7c3a9a14",
    // M10/T2-R6: the outgoing R18 build currently deployed (live R3 runtime),
    // byte-proven as the packaged build at commit 980b36e through the
    // repository's own governancePluginFiles() before admission (see R6 P1).
    // Every revision since R18 left this file untouched, so without this
    // entry --preflight refuses the deployed extension and the R5/R6
    // deployment is unreachable. The new digest is deliberately NOT listed:
    // it is the current build and is accepted by content comparison.
    "d88bff80aeb3d7531e5a0dceba4e7ba856d085e64a87cbb414c9f295284d81e3",
    // M10/T2-R8: the outgoing build currently deployed, byte-proven against the
    // live runtime at BOTH governed paths (dist bridge and extension lib) and
    // cross-checked against the native backup manifest on 2026-10-05. R8 changes
    // only this file -- the blocked-tool-call reason is no longer handed to the
    // host, because the host makes it model-visible -- so without this entry
    // --preflight refuses the deployed extension and the R8 deployment is
    // unreachable. The R8 digest is deliberately NOT listed: it is the current
    // build and is accepted by content comparison.
    "bccfa8616dc89fbb3764d53ad6ea11f5cfbc445bc076e4270f2678c6c1e18c3a",
    // M10/T2-R8: the outgoing build currently deployed, byte-proven at BOTH
    // governed paths (dist bridge and extension lib) and cross-checked against
    // the native backup manifest before this deployment. R8 changes this file
    // again -- it publishes the canonical preflight intake predicate and carries
    // the blocked-tool-call refusal -- so without this entry --preflight refuses
    // the deployed extension and the deployment is unreachable. The new digest
    // is deliberately NOT listed: it is the current build.
    "cc5b823086c2c205cca9d01bb84b10c1c50710163e255d9962d594971e05b068",
    // M10/T2-R12: the R10 boundary build currently deployed, byte-proven at
    // BOTH governed paths. R12 changes this file by exporting
    // resolveGovernance as a read-only test seam (no behavior change), so
    // without this entry --preflight refuses the deployed extension. The new
    // digest is deliberately NOT listed: it is the current build, accepted by
    // content comparison.
    "9e73518583006c0b9c5f8cc058e3bbd10e4749c2004aa9a4204ef226452f842a",
    // M11/T3 Phase 1: the outgoing boundary build the live runtime carries
    // (PLAN.md records the live digest as `97c7f3e1…`). A3 bound the three
    // silent governance seams — gateNativeAnnounce, finishNativeRun and
    // sanitizeNativePrompt — with message-only diagnostics and a preserved
    // cause, leaving every host-visible code and verdict byte-identical. Without
    // this entry --preflight refuses the deployed extension. The new digest is
    // deliberately NOT listed: it is the current build.
    "97c7f3e15d2845474ded9bbe908893bbeca6c655a7cecf37b816490693e8d52c",
    // M12/T2.2-R2 B-16/J-1: the outgoing boundary build the live runtime carries,
    // byte-proven by `sha256sum` of the installed asset at this exact path on the
    // WSL host (5966d446258259407ccd4a349b1d6df75dccc2a75c651a149caa92d4fa8393d0)
    // and re-derived in-test from commit 3cb8274, the revision that produced it.
    // B-16 changes only this file -- it names the guard's reason in the diagnostic
    // channel, leaving every host-visible code, verdict and return shape
    // byte-identical -- so without this entry --preflight refuses the deployed
    // extension and the B-16 build is unreachable. The B-16 digest is deliberately
    // NOT listed: it is the current build and is accepted by content comparison.
    "5966d446258259407ccd4a349b1d6df75dccc2a75c651a149caa92d4fa8393d0",
    // M12/T9 F-371: the outgoing build of this asset, before the
    // delegation id changed its form (the same digest, now rendered as a
    // version-4 UUID) and before the guard resolved the delegation's tool
    // scope from the canonical policy. Without this entry --preflight refuses
    // the deployed extension. The digest this build produces is deliberately
    // NOT listed: it is the current build and is accepted by content
    // comparison.
  ]),
  "lib/runtime.mjs": Object.freeze([
    // M10/T2-R15: the outgoing build currently deployed, byte-proven by
    // `sha256sum` of the installed file. This revision publishes the shared
    // `truncateUtf8` byte-budgeted truncation so the guard stops emitting result
    // payloads its own contract rejects. Without this entry --preflight refuses
    // the deployed extension. The new digest is deliberately NOT listed: it is
    // the current build, accepted by content comparison.
    "744e5234465d9c860c4103ec5df60f1d2fa705c54a6ce1d3cba206eaf9d9bb35",
    "6a522c73efacf8b593d63ee55e18b5d02c3675340e0593142a5c2fea8dc6e24a",
    // M12/T2.2-R2 B-8 (owner admission §0.5-E): the build the live runtime carries, so the
    // divergence B-8 introduces in the packaged `lib/runtime.mjs` stays upgradable. Re-derived
    // from `ea84a5a` through this repository's own `governancePluginFiles()` — the same
    // construction R2 P1 uses — not transcribed from a host file. The new digest is
    // deliberately NOT listed: it is the current build, accepted by content comparison.
    "aac887187f9f6074d340d6dd43868b082ff10b95a0bb126ce3331245c51c4915",
    // M12/T9 F-371: the outgoing build of this asset, before the
    // delegation id changed its form (the same digest, now rendered as a
    // version-4 UUID) and before the guard resolved the delegation's tool
    // scope from the canonical policy. Without this entry --preflight refuses
    // the deployed extension. The digest this build produces is deliberately
    // NOT listed: it is the current build and is accepted by content
    // comparison.
    "416460a78866315151ff7c70a85cbcc5c26189acf3d6ccbf52d13ab0750d2456",
  ]),
  "lib/ledger.mjs": Object.freeze([
    "d7f406e9dfa8f45d117f555bed18d2bf4c63ed966c3dd0588d221a54b9e87255",
    "50efeec64203240014b93479900a51251efbf0f286cc170feb93facf5a954148",
    // M11/T3 Phase 2: the build the live WSL runtime carries. This revision makes
    // `ensureLedger` create `events.jsonl` and `snapshot.json` together or refuse
    // with `EXECUTION_STATE_UNKNOWN` (a silently rebuilt half-pair resumed
    // governance at sequence 0), and keeps the replay fault attached as `cause`
    // plus one content-free diagnostic line. Without this entry --preflight
    // refuses the deployed extension. The new digest is deliberately NOT listed:
    // it is the current build, accepted by content comparison. ASSET digest,
    // proven through `governancePluginFiles()` — the raw file hashes differently
    // because packaging rewrites this module's imports.
    "818d7cb0d61466bda1d81a451119a2e0099b730a2f8a74593d5dd3af92aa6c99",
    // M12/T2.2-R2 M-1: the build the live runtime carries, reproduced by packaging
    // commit 6b0ea0a. See the lib/guard.mjs entry for why nine paths drifted.
    "c984cda8e0ab40fbd2d130e035607ee49d848319afe77df3508bc08e307f1e18",
  ]),
  "lib/workflow.mjs": Object.freeze([
    "14bb6a5575b3f25e7d04aafb28eb1e95b0b5b2a21b15b6b5dec787aaaf94f907",
    // M10/T2-R12: the outgoing build currently deployed, byte-verified at this
    // exact path. This revision accepts an optional task_code on WORKFLOW_OPENED
    // (a THIRD exactKeys argument — a required key would reject every existing
    // event), so without this entry --preflight refuses the deployed extension.
    "898e61920a37f2ce1fe7c937a94239df252f916d31135448bd279b1c4a7ff008",
    "19dc0eb40b216fbc898afd8dfc66f5c6aae4da15d1d2a6e5923753e13fcb09f0",
    "ff2ca8d3abbef43081756d68b553e23f036bbed302f6ffdf0075c045f8f1f5e2",
    // The accepted V16 build (9713872), established by packaging that commit.
    "1a1913e3d3d0923dec0089812242ccd1f7221ea535ad4d85b554dce1587e9407",
    // M10/T2-R3: the outgoing hygiene-build asset (41c62e7), proven as in the
    // R3 header above (live tree 34/34 match). Same admission semantics.
    "e78d81bf55d144e36edff7327c5a1d8ef0ed6b4f7a2dd2b1cc586ea1088389d8",
    // M12/T1-R1: the outgoing asset the live WSL runtime carries, measured
    // read-only before this entry was added. Without it --preflight refuses the
    // upgrade, which is exactly the M11/T1-R2 blocker. The digest this build
    // produces is deliberately NOT listed: it is the current build and is
    // accepted by content comparison.
    "10254373efdfa9b90aa3ff5a80326d3c1a1751b8a80d7c909dca0b39e28aa6c6",
    // M12/T2.2-R2 M-1: the build the live runtime carries, reproduced by packaging
    // commit c680a28. See the lib/guard.mjs entry for why nine paths drifted.
    "2009e9fe06b6cc01b95bcb1db3c8ff1b0a69e220123166f21a863178e0623695",
    // M12/T9 F-371: the outgoing build of this asset, before the
    // delegation id changed its form (the same digest, now rendered as a
    // version-4 UUID) and before the guard resolved the delegation's tool
    // scope from the canonical policy. Without this entry --preflight refuses
    // the deployed extension. The digest this build produces is deliberately
    // NOT listed: it is the current build and is accepted by content
    // comparison.
    "377b0bf5d6472e4158e6bc12a083c5ff2f95b1d0c1ca99059ec24135620f90ab",
  ]),
  "policy/reason-code-matrix.json": Object.freeze([
    "982896fe4fcc856728f8348058f19b69d89eabd9974bdaf4311c4afa510fc200",
    // M12/T9: the live build's bytes for this asset, admitted so --preflight still accepts the deployed extension. The band moved this asset, so its current build is accepted by content comparison.
    "4cd6544495ac5879afb81401c443999ed209f411462f94033807bba1ff446c1e",
  ]),
});

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function usage() {
  return [
    "Usage: configure.mjs --dry-run|--preflight|--apply --discord-guild-id <id>",
    "  --discord-owner-id <id> --discord-office-channel-id <id>",
    "  --discord-results-forum-id <id> --discord-approvals-forum-id <id>",
    "  --discord-incidents-forum-id <id>",
    "  [--state-dir <absolute-path>] [--systemd-user-dir <absolute-path>]",
  ].join("\n");
}

function parseArguments(argv) {
  const options = {};
  const allowed = new Set([
    "state-dir",
    "systemd-user-dir",
    "discord-guild-id",
    "discord-owner-id",
    "discord-office-channel-id",
    "discord-results-forum-id",
    "discord-approvals-forum-id",
    "discord-incidents-forum-id",
    // F-111: the transaction the apply orchestration took. The builder refuses
    // to apply without one, so a bare `--apply` cannot skip the snapshot, the
    // native patch, the byte verification and the gateway restart.
    "apply-transaction",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--dry-run", "--preflight", "--apply"].includes(argument)) {
      if (options.mode) {
        throw new Error(
          "Select exactly one of --dry-run, --preflight or --apply",
        );
      }
      options.mode = argument.slice(2);
      continue;
    }
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    const name = argument.slice(2);
    if (!allowed.has(name)) {
      throw new Error(`Unsupported argument: ${argument}`);
    }
    if (Object.hasOwn(options, name)) {
      throw new Error(`Repeated argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    options[name] = value;
    index += 1;
  }
  if (!options.mode) {
    throw new Error("Select exactly one of --dry-run, --preflight or --apply");
  }
  // F-111: the builder apply is reachable ONLY through the apply
  // orchestration, which takes the transaction snapshot first and runs the
  // native patch, the byte verification and the gateway restart after it. A
  // bare `--apply` had no such binding, so the documented deploy path could
  // bypass every one of those stages.
  if (options.mode === "apply" && !options["apply-transaction"]) {
    throw new Error(
      "APPLY_REQUIRES_TRANSACTION: --apply requires --apply-transaction <id>, the transaction the apply orchestration took",
    );
  }
  return options;
}

function existingConfigMatches(configPath, context) {
  assertRegularOrMissing(configPath);
  if (!existsSync(configPath)) {
    return false;
  }
  let actual;
  try {
    actual = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    throw new Error(`Existing config must be canonical JSON: ${configPath}`);
  }
  try {
    validateConfig(actual, context);
    return true;
  } catch (validationError) {
    const legacy = JSON.parse(JSON.stringify(buildConfig(context)));
    delete legacy.agents.defaults.subagents;
    for (const agent of legacy.agents.list) {
      delete agent.subagents;
      delete agent.tools.alsoAllow;
    }
    delete legacy.tools.subagents;
    delete legacy.tools.sessions;
    delete legacy.tools.sessions_spawn;
    legacy.plugins.allow = legacy.plugins.allow.filter(
      (pluginId) => pluginId !== GOVERNANCE_PLUGIN_ID,
    );
    legacy.plugins.load = { paths: [] };
    delete legacy.plugins.entries[GOVERNANCE_PLUGIN_ID];
    try {
      const actualFoundation = JSON.parse(JSON.stringify(actual));
      delete actualFoundation.meta;
      if (actualFoundation.channels?.discord?.streaming === undefined) {
        actualFoundation.channels.discord.streaming = { mode: "off" };
      }
      const previousR11 = JSON.parse(JSON.stringify(buildConfig(context)));
      delete previousR11.plugins.entries[GOVERNANCE_PLUGIN_ID].config
        .ownerDiscordId;
      if (canonicalJson(actualFoundation) === canonicalJson(previousR11))
        return false;
      if (canonicalJson(actualFoundation) === canonicalJson(legacy))
        return false;
    } catch {
      // fall through to the fail-closed drift error below
    }
    // Field-scoped convergence. Each migration below replaces ONLY the fields
    // it owns, and `validateConfig` then has to accept the RESULT, so a config
    // that differs in any other respect still fails closed: convergence can
    // never launder unrelated drift into an accepted config.
    const expectedConfig = buildConfig(context);
    const migrated = JSON.parse(JSON.stringify(actual));
    let converged = false;
    const discord = migrated.channels?.discord;
    if (discord && discord.streaming === undefined) {
      discord.streaming = { mode: "off" };
      converged = true;
    }
    // Frozen M8/T1 delivery default restored in R4 builder: configs that
    // predate it converge the same way streaming does.
    if (discord && discord.replyToMode === undefined) {
      discord.replyToMode = "off";
      converged = true;
    }
    // M8/T2.2-R4 regenerated the Discord mention grammar from AGENT_ALIASES
    // and the orchestrators' `alsoAllow` from the canonical tool policy,
    // replacing values that earlier builds hand-transcribed. A config written
    // by such a build differs in exactly these two fields, so regenerating them
    // from the canonical source is the same kind of convergence as the two
    // above. The aliases R4 dropped are dropped on purpose: the alias table is
    // asserted absent in tests/m7-lane-g-policy.test.mjs, so this is the R4
    // behaviour arriving late, not a new policy.
    //
    // The shape is matched field-by-field rather than as a whole-config literal
    // because the drifted config was produced by an uncommitted build and is
    // not reproducible from any commit, so there is no prior generator to
    // derive a legacy literal from.
    //
    // `alsoAllow` is converged ONLY where the policy serializes it. For the
    // specialists `buildConfig` defines it non-enumerable, so it is absent from
    // the stored config and `validateConfig` never compares it; writing an
    // enumerable `[]` there would add a key the policy does not have and turn
    // an accepted config into a drifting one.
    const liveAgents = Array.isArray(migrated.agents?.list)
      ? migrated.agents.list
      : null;
    if (liveAgents && liveAgents.length === expectedConfig.agents.list.length)
      for (const [index, agent] of liveAgents.entries()) {
        const expectedAgent = expectedConfig.agents.list[index];
        const expectedAllow = expectedAgent.tools.alsoAllow ?? [];
        // M12/T9 F-378: the two coordinators' DISPLAY names changed when the
        // retired L&SC Data Plant branding was dropped — "ETL Coordinator" and
        // "Analytics Coordinator" became the stack-neutral "Coordinator O1" and
        // "Coordinator O2" (`AGENT_DEFINITIONS` in
        // `integrations/openclaw/lib/authority.mjs` is the canonical roster, and
        // `AGENTS.md` §9 forbids the retired name for a runtime role). The
        // names are GENERATED data, exactly like the mention grammar and the
        // `alsoAllow` list below, so a config written by the previous build
        // differs in exactly this field and converges the same way: the label
        // is regenerated from the canonical roster, and the agent's identity
        // is its `id`, not its label, so nothing that routes is renamed.
        //
        // Measured on the live host (2026-10-22, READ-ONLY): the live
        // `openclaw.json` carried the two retired names and a baked-in router
        // credential, and the builder refused the deployment with
        // `Policy drift` — the credential was already converged by the
        // `models` subtree replacement below, but these two names were not, so
        // the deployment could not complete.
        if (agent.name !== expectedAgent.name) {
          agent.name = expectedAgent.name;
          converged = true;
        }
        if (
          agent.groupChat &&
          JSON.stringify(agent.groupChat.mentionPatterns) !==
            JSON.stringify(expectedAgent.groupChat.mentionPatterns)
        ) {
          agent.groupChat.mentionPatterns =
            expectedAgent.groupChat.mentionPatterns;
          converged = true;
        }
        if (
          expectedAllow.length > 0 &&
          JSON.stringify(agent.tools?.alsoAllow) !==
            JSON.stringify(expectedAllow)
        ) {
          agent.tools.alsoAllow = expectedAllow;
          converged = true;
        }
      }
    // M10/T2-R9: the governed model provider moved from the 21-profile Google
    // pool to the single shared router endpoint, and the google plugin left the
    // allowlist. A config written by the previous build therefore differs in
    // exactly these fields: `auth` (profiles/order/cooldowns) is gone,
    // `models.providers.router` is new, the agent model primary/fallbacks and
    // the model map reference the router, and `plugins.allow`/`plugins.entries`
    // no longer carry google.
    //
    // These are WHOLE-SUBTREE replacements driven by the canonical build, not
    // per-field fills, because the old and new shapes have different key sets:
    // a fill could not remove `auth.profiles` or add `models.providers`. As with
    // every other convergence here, the RESULT is re-validated, so a config that
    // differs in any other respect still fails closed and convergence can never
    // launder unrelated drift into an accepted config.
    //
    // The endpoint and credential are taken from the canonical build, which
    // resolves them from the environment. They are never copied from the
    // drifted config, so a stale baked URL cannot survive the transition.
    let modelProviderConverged = false;
    if (Object.hasOwn(actual, "auth")) {
      delete migrated.auth;
      modelProviderConverged = true;
    }
    // `models` is ABSENT on the previous build, so it must be tested for absence
    // rather than compared: canonicalJson rejects `undefined`, and a
    // whole-config comparison here would throw instead of converging.
    if (
      migrated.models === undefined ||
      canonicalJson(migrated.models) !== canonicalJson(expectedConfig.models)
    ) {
      migrated.models = JSON.parse(JSON.stringify(expectedConfig.models));
      modelProviderConverged = true;
    }
    if (
      canonicalJson(migrated.agents.defaults.model) !==
        canonicalJson(expectedConfig.agents.defaults.model) ||
      canonicalJson(migrated.agents.defaults.models) !==
        canonicalJson(expectedConfig.agents.defaults.models)
    ) {
      migrated.agents.defaults.model = JSON.parse(
        JSON.stringify(expectedConfig.agents.defaults.model),
      );
      migrated.agents.defaults.models = JSON.parse(
        JSON.stringify(expectedConfig.agents.defaults.models),
      );
      modelProviderConverged = true;
    }
    if (
      canonicalJson(migrated.plugins.allow) !==
        canonicalJson(expectedConfig.plugins.allow) ||
      canonicalJson(migrated.plugins.entries) !==
        canonicalJson(expectedConfig.plugins.entries)
    ) {
      migrated.plugins.allow = [...expectedConfig.plugins.allow];
      migrated.plugins.entries = JSON.parse(
        JSON.stringify(expectedConfig.plugins.entries),
      );
      modelProviderConverged = true;
    }
    if (modelProviderConverged) converged = true;
    // Owner-identity hygiene follow-up: the built zink-governance plugin config
    // now carries the four validated Discord surface ids, so outbound routing
    // targets resolve from configuration instead of hardcoded production
    // fallbacks. A config written by an earlier build differs in exactly these
    // four fields, so filling them from the canonical build is the same kind of
    // convergence as the cases above. Only MISSING fields are filled, in the
    // same key order the policy serializes them; a present-but-different value
    // is NOT overwritten here, so a hand-edited destination still fails closed
    // in the final validation below.
    const livePluginConfig =
      migrated.plugins?.entries?.[GOVERNANCE_PLUGIN_ID]?.config;
    const expectedPluginConfig =
      expectedConfig.plugins?.entries?.[GOVERNANCE_PLUGIN_ID]?.config;
    if (livePluginConfig && expectedPluginConfig) {
      for (const field of [
        "discordOfficeChannelId",
        "discordResultsForumId",
        "discordApprovalsForumId",
        "discordIncidentsForumId",
      ]) {
        if (
          livePluginConfig[field] === undefined &&
          typeof expectedPluginConfig[field] === "string"
        ) {
          livePluginConfig[field] = expectedPluginConfig[field];
          converged = true;
        }
      }
    }
    if (!converged) {
      throw validationError;
    }
    try {
      validateConfig(migrated, context);
    } catch {
      throw validationError;
    }
    return false;
  }
}

function requireFileMode(filePath, expectedMode, label) {
  if (process.platform === "win32") {
    return;
  }
  const actualMode = lstatSync(filePath).mode & 0o777;
  if (actualMode !== expectedMode) {
    throw new Error(
      `${label} mode drift: expected ${expectedMode.toString(8)}, got ${actualMode.toString(8)}`,
    );
  }
}

// M12/T9 F-202: the effective drop-in set is the whole directory.
//
// The refusal names every fragment that is not the rendered drop-in, so an
// operator can act on it, and it keeps the established "Systemd drop-in"
// wording the operator refusal classifier already knows.
function assertNoUnownedSystemdDropIns(dropInDirectory) {
  if (!existsSync(dropInDirectory)) return [];
  const stat = lstatSync(dropInDirectory);
  if (!stat.isDirectory()) {
    throw new Error(
      `Systemd drop-in drift detected: ${dropInDirectory} is not a directory`,
    );
  }
  const unowned = readdirSync(dropInDirectory)
    .filter((name) => name !== SYSTEMD_DROP_IN_NAME)
    .sort();
  if (unowned.length > 0) {
    throw new Error(
      `Systemd drop-in drift detected: unowned fragment(s) beside ${SYSTEMD_DROP_IN_NAME} in ${dropInDirectory}: ${unowned.join(", ")}`,
    );
  }
  return unowned;
}

// M12/T9 F-203: what this run inspected, and whether that inspection can be
// recorded as deployment evidence.
//
// `requireFileMode` returns early on win32, so on that host the whole mode
// battery is vacuous while the gate still read PASS. The record below travels
// with every PASS, so a reader can tell a governed-tree inspection from a
// copy of one.
function hostEnforcesPosixModes(platform) {
  return platform !== "win32";
}

function buildInspectionRecord(stateDir) {
  const posixModesEnforced = hostEnforcesPosixModes(process.platform);
  let governedStateTreeReachable;
  try {
    governedStateTreeReachable = lstatSync(GOVERNED_STATE_TREE).isDirectory();
  } catch {
    governedStateTreeReachable = false;
  }
  return {
    stateTree: stateDir,
    posixModesEnforced,
    governedStateTree: GOVERNED_STATE_TREE,
    governedStateTreeReachable,
    deploymentEvidence:
      posixModesEnforced && governedStateTreeReachable ? "PASS" : "NOT RUN",
  };
}

function materializeOwnedFile(
  filePath,
  contents,
  label,
  fileMode = 0o600,
  allowedPreviousContents = [],
  allowedPreviousSha256 = [],
) {
  assertRegularOrMissing(filePath);
  if (existsSync(filePath)) {
    const existingContents = readFileSync(filePath, "utf8");
    if (
      existingContents !== contents &&
      !allowedPreviousContents.includes(existingContents) &&
      !allowedPreviousSha256.includes(sha256(existingContents))
    ) {
      throw new Error(`${label} drift detected: ${filePath}`);
    }
    requireFileMode(filePath, fileMode, label);
    if (existingContents === contents) return;
  }
  writePrivateRegularFile(filePath, contents, fileMode);
}

function assertOwnedFileMatchesOrMissing(
  filePath,
  contents,
  label,
  fileMode = 0o600,
  allowedPreviousContents = [],
  allowedPreviousSha256 = [],
) {
  assertRegularOrMissing(filePath);
  if (existsSync(filePath)) {
    const existingContents = readFileSync(filePath, "utf8");
    if (
      existingContents !== contents &&
      !allowedPreviousContents.includes(existingContents) &&
      !allowedPreviousSha256.includes(sha256(existingContents))
    ) {
      throw new Error(`${label} drift detected: ${filePath}`);
    }
    requireFileMode(filePath, fileMode, label);
  }
}

function assertGovernanceManifestMatchesOrMissing(
  filePath,
  contents,
  allowedPreviousSha256 = [],
) {
  assertRegularOrMissing(filePath);
  if (!existsSync(filePath)) return;
  const existing = readFileSync(filePath, "utf8");
  let actual;
  let expected;
  try {
    actual = JSON.parse(existing);
    expected = JSON.parse(contents);
  } catch {
    throw new Error(`Governance plugin manifest drift detected: ${filePath}`);
  }
  const previous = JSON.parse(JSON.stringify(expected));
  delete previous.configSchema.properties.ownerDiscordId;
  if (
    canonicalJson(actual) !== canonicalJson(expected) &&
    canonicalJson(actual) !== canonicalJson(previous) &&
    // M12/T9 F-380: a manifest from a PREVIOUS build is recognised by its
    // digest, exactly like the plugin's assets. The bytes are never trusted:
    // an entry only permits the apply to OVERWRITE this file with the current
    // build's manifest, and an unrecognised digest still fails closed.
    !allowedPreviousSha256.includes(sha256(existing))
  ) {
    throw new Error(`Governance plugin manifest drift detected: ${filePath}`);
  }
  requireFileMode(filePath, 0o600, "Governance plugin manifest");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const stateDir = path.resolve(
    options["state-dir"] ?? defaultStateDirectory(),
  );
  const systemdUserDir = path.resolve(
    options["systemd-user-dir"] ?? defaultSystemdUserDirectory(),
  );
  if (stateDir !== path.resolve(defaultStateDirectory())) {
    throw new Error("OpenClaw state directory must be ~/.openclaw-zink");
  }
  if (systemdUserDir !== path.resolve(defaultSystemdUserDirectory())) {
    throw new Error("Systemd user directory must be ~/.config/systemd/user");
  }
  const identifiers = parseIdentifiers({
    discordGuildId: options["discord-guild-id"],
    discordOwnerId: options["discord-owner-id"],
    discordOfficeChannelId: options["discord-office-channel-id"],
    discordResultsForumId: options["discord-results-forum-id"],
    discordApprovalsForumId: options["discord-approvals-forum-id"],
    discordIncidentsForumId: options["discord-incidents-forum-id"],
  });
  assertInsideHome(stateDir, "OpenClaw state directory");
  assertInsideHome(systemdUserDir, "Systemd user directory");
  assertNoRepositoryOverlap(REPOSITORY_ROOT, stateDir);
  const config = buildConfig({ stateDir, identifiers });
  const output = {
    profile: "zink",
    stateDir,
    workspaces: Object.fromEntries(
      config.agents.list.map((agent) => [agent.id, agent.workspace]),
    ),
    agentDirs: Object.fromEntries(
      config.agents.list.map((agent) => [agent.id, agent.agentDir]),
    ),
    configPath: path.join(stateDir, "openclaw.json"),
    authPlanPath: path.join(stateDir, "zink-auth-secret-plan.json"),
    authOrderPlanPath: path.join(stateDir, "zink-auth-order-plan.json"),
    passResolverPath: path.join(stateDir, "bin", "openclaw-pass-resolver"),
    geminiStreamHotfixPath: path.join(
      stateDir,
      "bin",
      "openclaw-gemini-stream-hotfix.mjs",
    ),
    passStoreDirectory: path.join(stateDir, "secrets", "password-store"),
    gpgHomeDirectory: path.join(stateDir, "secrets", "gnupg"),
    systemdDropInDirectory: path.join(
      systemdUserDir,
      SYSTEMD_DROP_IN_DIRECTORY,
    ),
    systemdDropInPath: path.join(
      systemdUserDir,
      SYSTEMD_DROP_IN_DIRECTORY,
      SYSTEMD_DROP_IN_NAME,
    ),
    governancePluginDirectory: path.join(
      stateDir,
      "extensions",
      GOVERNANCE_PLUGIN_ID,
    ),
    governancePluginManifestPath: path.join(
      stateDir,
      "extensions",
      GOVERNANCE_PLUGIN_ID,
      "openclaw.plugin.json",
    ),
    governancePluginPackagePath: path.join(
      stateDir,
      "extensions",
      GOVERNANCE_PLUGIN_ID,
      "package.json",
    ),
    governancePluginEntrypointPath: path.join(
      stateDir,
      "extensions",
      GOVERNANCE_PLUGIN_ID,
      "index.mjs",
    ),
    ledgerDirectory: ledgerPaths(stateDir).root,
    ledgerEventsPath: ledgerPaths(stateDir).events,
    ledgerSnapshotPath: ledgerPaths(stateDir).snapshot,
    identityKeyPath: ledgerPaths(stateDir).identityKey,
    backupManifestPath: path.join(runtimeBackupPath(stateDir), "manifest.json"),
  };
  if (options.mode === "dry-run") {
    process.stdout.write(`${stableJson(output)}`);
    return;
  }

  // M12/T9 F-035: the state root is enumerated before anything is written and
  // before any of it is read as trusted state. A credential-derived file that
  // is group- or other-accessible is a leak no named-path check covers, so
  // the preflight and the apply both refuse it.
  assertStateRootFileModes(stateDir);

  for (const target of [
    stateDir,
    ...Object.values(output.workspaces),
    ...Object.values(output.agentDirs),
    output.configPath,
    output.authPlanPath,
    output.authOrderPlanPath,
    output.passResolverPath,
    output.geminiStreamHotfixPath,
    output.passStoreDirectory,
    output.gpgHomeDirectory,
    systemdUserDir,
    output.systemdDropInPath,
    output.governancePluginDirectory,
    output.governancePluginManifestPath,
    output.governancePluginPackagePath,
    output.governancePluginEntrypointPath,
    output.ledgerDirectory,
    output.ledgerEventsPath,
    output.ledgerSnapshotPath,
    output.identityKeyPath,
    output.backupManifestPath,
  ]) {
    assertNoSymlinkComponents(target);
  }

  const context = { stateDir, identifiers };
  inspectLedgerUpgrade(ledgerPaths(stateDir));
  const configPath = output.configPath;
  const configExists = existingConfigMatches(configPath, context);
  for (const [agentId, workspace] of Object.entries(output.workspaces)) {
    assertWorkspaceMatchesTemplate(
      workspace,
      agentInstructions(agentId),
      false,
      agentId,
    );
  }
  for (const agentDir of Object.values(output.agentDirs)) {
    assertDirectoryOrMissing(agentDir);
  }
  assertDirectoryOrMissing(output.passStoreDirectory);
  assertDirectoryOrMissing(output.gpgHomeDirectory);
  // M10/T2-R9: the previous auth-plan listed 21 auth-profile key targets. Those
  // profiles are retired, so the new plan has no targets. The outgoing plan is
  // admitted by content comparison so the converge-on-apply path stays reachable;
  // an arbitrary hand-edited plan still fails closed.
  assertOwnedFileMatchesOrMissing(
    output.authPlanPath,
    stableJson(buildSecretsPlan()),
    "Auth SecretRef plan",
    0o600,
    [],
    ADMITTED_AUTH_SECRET_PLAN_SHA256,
  );
  const pluginFiles = governancePluginFiles();
  for (const [relative, contents] of Object.entries(pluginFiles.assets)) {
    const target = path.join(output.governancePluginDirectory, relative);
    assertNoSymlinkComponents(target);
    assertOwnedFileMatchesOrMissing(
      target,
      contents,
      "Governance plugin asset",
      0o600,
      [],
      ALLOWED_GOVERNANCE_ASSET_SHA256[relative] ?? [],
    );
  }
  assertGovernanceManifestMatchesOrMissing(
    output.governancePluginManifestPath,
    pluginFiles.manifest,
    ALLOWED_GOVERNANCE_MANIFEST_SHA256,
  );
  assertOwnedFileMatchesOrMissing(
    output.governancePluginPackagePath,
    pluginFiles.package,
    "Governance plugin package",
  );
  assertOwnedFileMatchesOrMissing(
    output.governancePluginEntrypointPath,
    pluginFiles.entrypoint,
    "Governance plugin entrypoint",
    0o700,
    [],
    [
      LEGACY_GOVERNANCE_ENTRYPOINT_R11_SHA256,
      STARTING_GOVERNANCE_ENTRYPOINT_SHA256,
      INTERMEDIATE_GOVERNANCE_ENTRYPOINT_SHA256,
      "d5f1394e18eb2e1910c2ec7f1c92cab4e6c16b1e7ced7c7899b7d1076df85b2e",
      "f116d778cb5a8fa875ff33cb2fe6de8a42f209b984a84899cf2ab795592b13d7",
      "73bea1f506a72181528c11bd210ee6ccaf4ad69518c2ff38fdafc5da4a91be6e",
      "6ccf56a256a321597c7405f2daff3412371a3c37e5d27a410c0cf2a3db802724",
      "3c6545cc8925710ca76068ed64070a71353a794b81de74561bd168e034ec2135",
      "9402dc774e7db90616bf5cafe9afc2bf899892fb2c926abf2526f69eb29d7d7e",
      "e2a265dca6a0ea2b20b8a41004cf08b6157bfbaf503d1a5d2257dfc2504243f3",
      "694a89ae93d6685ff37562828873e7120bb07353b8d3e6e213fd5b080106bf8f",
      "af0ce312e23a0d3be9a10c3bb350b3d6b7d345b1ca7fc49ae13efd41219e5c93",
      "fdb72c9f058cb29e3ba4e3ae3a394d1f84e805a274e8614e592018d073e88015",
      "17b4be782cebc34df7a363c095865653cc8351ba50e08c1206ce4981d6c7e6d1",
      // The entrypoint of the superseded WSL deployment recognized on
      // 2026-09-30 under the same owner authorization as the asset list.
      "09f1d8e66f2b9fca35180d9e0d208f644cedf34824e4cd18bb9f229b51cec1c7",
      // The accepted R5/V15/V16 build (652ac0c lineage), established by
      // packaging that commit, listed only so the R6 emission path can replace it.
      "e77689c94ba066bd854549750044f78dcf9d97cc3de73420893851c0a800b10a",
      // M8/T2.2-R13: the outgoing R7 entrypoint currently deployed, byte-proven
      // against the live runtime at this exact path on 2026-09-30
      // (extensions/zink-governance/index.mjs, 192895 bytes). R10 is the only
      // revision that changes the entrypoint after R7, so without this entry
      // --preflight refuses the deployed R7 extension. The R10 digest is
      // deliberately NOT listed: it is the current build and is already accepted
      // by content comparison.
      "74582778e5d58ce6a26dec3514b9a73ad5f8964f892023b37221f8a85b5ff215",
      // M8/T2.2-R17: the outgoing R10 entrypoint currently deployed, byte-proven
      // against the live runtime at this exact path on 2026-09-30 after the R16
      // deployment. R17 changes the entrypoint (run-end governance parity), so
      // without this entry --preflight refuses the deployed R10 extension and the
      // R17 deployment is unreachable. The R17 digest is deliberately NOT listed:
      // it is the current build and is already accepted by content comparison.
      "e5b220b4a3b023f6d7b26561964f6204f0d004267b208cddab90adb6043b8bd7",
      // M8/T2.2-R19: the outgoing R17 entrypoint currently deployed, byte-proven
      // against the live runtime at this exact path after the R18 deployment.
      // R19 changes the entrypoint (the prompt-build liveness exemption), so
      // without this entry --preflight refuses the deployed R17 extension and the
      // R19 deployment is unreachable. The R19 digest is deliberately NOT listed:
      // it is the current build and is already accepted by content comparison.
      "d01c210b0cc13f01d6d294223ae400a30ef6407c962d5b46e2f199474f799a1d",
      // Owner-identity hygiene: the outgoing R19 entrypoint currently deployed,
      // which removed a real account identifier that was hardcoded as a fallback
      // inside two owner authorization gates. Admitted here so the next authorized
      // deployment is reachable. The new digest is deliberately NOT listed: it is
      // the current build and is accepted by content comparison.
      "bae7bdf358f35c43c5308c4b0b24a1da57b55bbc609d1ff3a7e32daf65182eca",
      // M8/T3: the outgoing hygiene entrypoint currently deployed, byte-proven
      // as the packaged build before the governed-memory learning loop changed
      // the entrypoint (durable skill proposals, fail-closed skill approval,
      // #office learning path). Admitted here so the next authorized
      // deployment is reachable. The new digest is deliberately NOT listed:
      // it is the current build and is accepted by content comparison.
      "2271b56bc7f0ed3a3446e4474c411c1a6132a4e3c1a2edfedb5e6907d8340b5d",
      // Functional-truth remediation: the outgoing M8/T3 entrypoint, byte-proven
      // as the packaged build before the approved-task path stopped executing a
      // hardcoded revenue/KPI demo, before zink_n8n was routed to the real
      // governed adapter, and before the Power BI / Python capabilities were made
      // explicitly fail-closed. Admitted here so the next authorized deployment
      // is reachable. The new digest is deliberately NOT listed: it is the current
      // build and is accepted by content comparison.
      "a3dbf945deae82c1c07b419d6f1af1724f70a336c88331d4a772dfc93420ab92",
      // M10/T2-R8: the outgoing entrypoint currently deployed (R8 ingress
      // admission build), byte-proven against the live runtime at this exact
      // path before the duplicate-ordering and preflight-seam deployment. This
      // build changed the entrypoint — the duplicate check now precedes the
      // admission signal, and the pure preflight intake predicate was added — so
      // without this entry --preflight refuses the deployed extension and the
      // deployment is unreachable. The new digest is deliberately NOT listed: it
      // is the current build and is accepted by content comparison. Listed in
      // BOTH per-mode lists so the two modes cannot diverge.
      "6a7968b7d456ff6d3f2c5b9d60c7b6046a702603b880093c33b717d9a37c13b1",
      // M10/T2-R9-A: the outgoing entrypoint currently deployed, byte-proven
      // against the live runtime at this exact path on 2026-10-06. This build
      // changes the entrypoint only by appending runId to the
      // DUPLICATE_DISCORD_EVENT denial, so without this entry --preflight
      // refuses the deployed extension and the deployment is unreachable. The
      // new digest is deliberately NOT listed: it is the current build and is
      // accepted by content comparison. Listed in BOTH per-mode lists so the two
      // modes cannot diverge.
      "f4ed9d9c54ccf486a30425b98a549cab5aebbbe8e9ee7f2d32bfc6795598c4a3",
      // M10/T2-R12: the R9-A entrypoint currently deployed, byte-proven
      // against the live runtime. R12 changes the entrypoint (first-approval
      // bootstrap + canonical node digests), so without this entry --preflight
      // refuses the deployed extension. The new digest is deliberately NOT
      // listed: it is the current build, accepted by content comparison.
      // Listed in BOTH per-mode lists so the two modes cannot diverge.
      "c2ef436327242b4fb6f4f65409c80634c4096824a372db02ecc65860cc00cdd3",
      // M10/T2-R12: the first-approval build currently deployed, byte-proven
      // against the live runtime. This revision reverts the raw-REST buttons
      // post to adapter delivery, so without this entry --preflight refuses
      // the deployed extension. Listed in BOTH per-mode lists.
      "af574dde8d4b9d2aa7dc217fd49f420bbe50bcae46ddd4d6f5e3662cd807137d",
      // M10/T2-R9-C: the R4-EXCEPTION-buttons build currently deployed,
      // byte-proven against the live runtime. This revision admits a same-run
      // model-fallback re-entry (R9-C), so without this entry --preflight
      // refuses the deployed extension. Listed in BOTH per-mode lists.
      //
      // This is the INSTALLED digest, captured by sha256sum of
      // ~/.openclaw-zink/extensions/zink-governance/index.mjs. Note the
      // builder output already uses the installed import form (`./lib/x`), so
      // sha256(governancePluginFiles().entrypoint) equals this value; only the
      // REPO SOURCE differs (`../../lib/x`) and must never be hashed here.
      "aea6bf9545f6d365b40bba4d4e976a47211b49594a963e518a8d5e7e3baebc30",
      // M10/T2-R12: the governed-model-chain build currently deployed,
      // byte-verified at this exact path. This revision mints the owner-facing
      // task code at admission, so without this entry --preflight refuses the
      // deployed extension. Listed in BOTH per-mode lists.
      "30078552487018479bf5f4c6a355d94646e45c9de6711804843d7648e06f9741",
      // Handoff-semantics remediation: the outgoing functional-truth entrypoint,
      // byte-proven as the packaged build before RELEASED_TO_COORDINATOR was
      // withdrawn (a Discord POST is not an accepted handoff), before the
      // release precondition moved ahead of the durable queue write, and before
      // the coordinator handoff was required to satisfy canonical spawn
      // topology. Admitted here so the next authorized deployment is reachable.
      // The new digest is deliberately NOT listed: it is the current build and
      // is accepted by content comparison.
      "118db9a746a0757dbea2d15c5d8d9585a298a1ca0d235a6b13a3a8513fb2bcac",
      // Duplicate-notification side-effect fix: the outgoing handoff-semantics
      // entrypoint, byte-proven as the packaged build before a duplicate approval
      // stopped re-sending a coordinator notification that had already landed,
      // and before the duplicate arm gained a status guard for non-QUEUED
      // records. Admitted here so the next authorized deployment is reachable.
      // The new digest is deliberately NOT listed: it is the current build and
      // is accepted by content comparison.
      "4bb0c1e12b4116340fb80f9cc136082200c7506fa691623bc922414f0bd92845",
      // Notification persistence truth and concurrency guard: the outgoing
      // entrypoint, byte-proven as the packaged build before a failed durable
      // record write could be reported as a persisted success, and before the
      // in-flight notification reservation closed the undelivered -> send race.
      // Admitted here so the next authorized deployment is reachable. The new
      // digest is deliberately NOT listed: it is the current build and is
      // accepted by content comparison.
      "36ed858c74dd09423d0afc74ff2fc8eb589843f163fb8ffccf8bcc912f097ce9",
      // Unified notification guard: the outgoing entrypoint, byte-proven as the
      // packaged build before the first approval was moved onto the same
      // reservation as a duplicate, closing the window where a duplicate could
      // claim the guard and send a second message while the first transport
      // call was still in flight. Admitted here so the next authorized
      // deployment is reachable. The new digest is deliberately NOT listed: it
      // is the current build and is accepted by content comparison.
      "0940eb77d5796f29d819331e92a7c00c4f9230eb1185dce3de7b524a37e2f7c2",
      // Coordinator session binding (M10/T2): the outgoing entrypoint,
      // byte-proven as the packaged build before WORKFLOW_COORDINATOR_RUN_BOUND,
      // the findSession binding arm, the bound-coordinator spawn rule, and the
      // production pickup loop were added. Admitted here so the next authorized
      // deployment is reachable. The new digest is deliberately NOT listed: it
      // is the current build and is accepted by content comparison.
      "4a957b246533ab8e55f88172daa3667ae06cda10dc1d1e8c0858a18e31895663",
      // Coordinator execution authority (M10/T2-R2): the outgoing entrypoint,
      // byte-proven as the packaged build before a coordinator run could outlive
      // its queue lease, before a superseded attempt could reserve governed work
      // onto a task a newer attempt owned, and before a coordinator run ending in
      // the QUEUED window could be misclassified into the ALL_LIVE_RUNS
      // containment sweep. Admitted here so the next authorized deployment is
      // reachable. The new digest is deliberately NOT listed: it is the current
      // build and is accepted by content comparison.
      "fa243547f04675685d06bfadd64fa11602fe071fe764a84d328414e7b53dfe89",
      // Coordinator execution authority, coverage-review revision: the outgoing
      // entrypoint, byte-proven as the packaged build before the
      // binding-over-claim-holder rule was added (a bound coordinator run was
      // still routed into generic containment when a specialist held the live
      // claim on the same queue item). Never deployed; admitted so the deployment
      // path stays reachable from either R2 build. The new digest is deliberately
      // NOT listed: it is the current build and is accepted by content
      // comparison.
      "a1c8957bbeb2845c61953cf12cf395deae4c9dbae536b486d6748c2944961460",
      // M10/T2-R3 asset-predecessor repair: the outgoing R2 entrypoint
      // currently deployed, byte-proven as the packaged build before the ten
      // hygiene-build asset predecessors were admitted. Admitted here so the
      // next authorized deployment is reachable. The new digest is deliberately
      // NOT listed: it is the current build and is accepted by content
      // comparison.
      "d1ce63868680ea5f89721ae8b42f07f6f033a840606cdc3a7cd7b6556b3ab593",
      // M10/T2-R8 observability: the outgoing R5 entrypoint currently
      // deployed, byte-proven as the packaged build at commit 4d1e64e
      // (M10/T2-R5 host-side Discord inbound metadata exposure) through
      // governancePluginFiles() before admission (see R8 P1: byte-identical
      // to the live file 0fb628e8…). R8 changes the entrypoint (ingress
      // verdict observability logging) without admitting the outgoing
      // digest, so without this entry --preflight refuses the deployed R5
      // extension and the observability deployment is unreachable. The R8
      // digest is deliberately NOT listed: it is the current build and is
      // accepted by content comparison.
      "0fb628e891a93d570715937a95fc65b82acf14964f00d5de495eeead2138e946",
      // M10/T2-R14: the outgoing R12/R13 entrypoint currently deployed,
      // byte-proven by `sha256sum` of the installed file
      // (~/.openclaw-zink/extensions/zink-governance/index.mjs). This revision
      // fixes five defects in that entrypoint: the text-approval path no longer
      // awaits a cosmetic Discord send before the governance dispatch (which
      // could durably approve a task and never run it), a failed queue
      // completion no longer publishes a public success notice, both owner gates
      // guard an unresolved owner id, the internal-run classifier receives the
      // real ledger-ownership flag, and `safeReason` is byte-budgeted. Without
      // this entry --preflight refuses the deployed extension. The new digest is
      // deliberately NOT listed: it is the current build, accepted by content
      // comparison.
      "61680010520bbe3ca57b289cf9af9fb6ea79c8f79e33e49e95d5dec6de60cef3",
      // M10/T2-R17: the R16 entrypoint, deployed and byte-proven at this exact
      // path. R17 collapses the duplicated owner-action label into one
      // `describeOwnerAction` and hardens the interactive ack/catch guards.
      // Without this entry --preflight refuses the deployed extension.
      "8e4b53847d84e6c9eb084ca98b72610ba71b6ddeb00fb01a1137d9366314a466",
      // M11/T1-R1 Phase 2: the outgoing governance entrypoint — the packaged
      // build the repository carried before this remediation, byte-proven by
      // the deployment-snapshot suites (it is the digest both
      // `R13 C2` and `R3 0b` pinned as the current build). Phase 2 moved the
      // owner approval path: `decisionRef` is now required rather than
      // defaulted, promote runs inside the canonical store writer lock, and
      // rejection requires `skillsRoot`. Without this entry --preflight refuses
      // that build, so the next authorized deployment from it would fail closed
      // with asset drift. The new digest is deliberately NOT listed: it is the
      // current build, accepted by content comparison.
      "230f3c79d0a35c2261129ddc0048ad4f0ae4fc6d86a5c49e444594a446bd2982",
      // M11/T3 Phase 1: the outgoing governance entrypoint — the packaged build
      // the live WSL runtime actually carries, recorded in PLAN.md §3/§4 and
      // CHANGELOG.md as `live index.mjs = e8f084ab…`. M11/T3 A1 replaced the
      // shell-interpreted bot-token resolver call with argv execution, and A2
      // bounded the three unbounded Discord REST calls. Without this entry
      // --preflight refuses the deployed extension, which is exactly the
      // M11/T1-R2 defect. The new digest is deliberately NOT listed: it is the
      // current build, accepted by content comparison.
      "e8f084ab5593a093a2075db8167ce6db4ea39e87141dc4a2ba4dee99fb4fccaa",
      // M12/T1-R1: the governance entrypoint the live WSL runtime carries
      // (`61e344e6…`, measured read-only before this entry). M12/T1 registers the
      // Discord components this plugin posts, fixes the approval-decision reason,
      // makes the 12-character code the task identity, and presents the plan plus an
      // expected-result image. Without this admission BOTH guards refuse the upgrade:
      // this list appears at the --preflight and the --apply call sites, and they must
      // stay identical. The new digest is deliberately NOT listed: it is the current
      // build, accepted by content comparison.
      "61e344e6754c3c03b26463c2421ebf699d8ec14f9ab0b8fe87bec1265d99f3b6",
      // M12/T2.2-R1 A-3: the entrypoint the live WSL runtime carries. Re-measured
      // read-only on 2026-10-16 (`sha256sum` of
      // `/home/hoang_vinh/.openclaw-zink/extensions/zink-governance/index.mjs`),
      // not transcribed from the plan. It became a predecessor because moving the
      // coordinator-notification queue write inside the queue lock changes
      // packaged entrypoint bytes. Without this admission BOTH guards refuse the
      // upgrade: this list appears at the --preflight and the --apply call sites,
      // and they must stay identical. The new digest is deliberately NOT listed:
      // it is the current build, accepted by content comparison.
      "513beb15c3d7624c0a928c4c1556dc44d4c4cff4f1e00980f24b298a25751c0d",
      // M12/T9 F-382: the DEPLOYED build's entrypoint. The deployed
      // extension is the build at `0b55dfa4` (measured on the live host on
      // 2026-10-22), and its entrypoint is the plugin's own `index.mjs` as of
      // `b6d04e80` — the commit that last changed it before that build —
      // packaged exactly as the builder packages it. Without this entry
      // --preflight refuses the deployed extension with `Governance plugin
      // entrypoint`, so the apply cannot reach the extension it is supposed
      // to replace. The digest this build produces is deliberately NOT listed:
      // it is the current build and is accepted by content comparison. Listed
      // in BOTH per-mode lists so the two modes cannot diverge.
      "513beb15c3d7624c0a928c4c1556dc44d4c4cff4f1e00980f24b298a25751c0d",
    ],
  );
  assertRegularOrMissing(output.identityKeyPath);
  if (existsSync(output.identityKeyPath))
    requireFileMode(output.identityKeyPath, 0o600, "Governance identity key");
  assertRegularOrMissing(output.backupManifestPath);
  if (existsSync(output.backupManifestPath))
    requireFileMode(output.backupManifestPath, 0o600, "T2 backup manifest");
  assertOwnedFileMatchesOrMissing(
    output.authOrderPlanPath,
    stableJson(buildAuthOrderPlan()),
    "Auth order plan",
    0o600,
    [],
    ADMITTED_AUTH_ORDER_PLAN_SHA256,
  );
  assertOwnedFileMatchesOrMissing(
    output.passResolverPath,
    passResolverContents(),
    "Password-store resolver",
    0o700,
    [],
    PREVIOUS_PASS_RESOLVER_SHA256,
  );
  assertOwnedFileMatchesOrMissing(
    output.geminiStreamHotfixPath,
    geminiStreamHotfixContents(),
    "Gemini stream hotfix utility",
    0o700,
    [],
    ADMITTED_GEMINI_STREAM_HOTFIX_SHA256,
  );
  assertOwnedFileMatchesOrMissing(
    output.systemdDropInPath,
    renderSystemdDropIn(stateDir),
    "Systemd drop-in",
    0o600,
    [
      renderLegacySystemdDropInR16(stateDir),
      renderDeployedSystemdDropIn(stateDir),
    ],
  );
  // M12/T9 F-202: the ceiling is enforced against the EFFECTIVE drop-in set.
  // This gate runs in preflight mode and in apply mode (it stands above the
  // mode branch), so a sibling fragment refuses both before anything is
  // installed or mutated.
  assertNoUnownedSystemdDropIns(output.systemdDropInDirectory);

  if (options.mode === "preflight") {
    // M12/T9 F-203: every PASS records the tree it inspected and whether the
    // host enforces POSIX modes, and a host that cannot reach the governed
    // tree records NOT RUN rather than a PASS that reads as deployment
    // evidence.
    const inspection = buildInspectionRecord(stateDir);
    process.stdout.write(
      `${stableJson({
        ...output,
        preflight: "PASS",
        installedMutation: false,
        deploymentEvidence: inspection.deploymentEvidence,
        inspection,
      })}`,
    );
    return;
  }
  // F-111: the apply is bound to the transaction the orchestration took, and
  // that transaction may be spent only once.
  const applyTransaction = options["apply-transaction"];
  assertBuilderApplyAvailable(stateDir, applyTransaction);
  ensurePrivateDirectory(stateDir);
  ensurePrivateDirectory(output.ledgerDirectory);
  await createRuntimeBackup({ stateDir, identifiers });
  if (!configExists) {
    writePrivateRegularFile(configPath, stableJson(config));
  }
  for (const [agentId, workspace] of Object.entries(output.workspaces)) {
    materializeWorkspace(workspace, agentInstructions(agentId), agentId);
  }
  for (const agentDir of Object.values(output.agentDirs)) {
    ensurePrivateDirectory(agentDir);
  }
  // Mirrors the preflight gate above: the outgoing plan must be admitted in
  // apply mode too, otherwise the preflight passes and the apply then refuses
  // the very same file. Same admission semantics, same recorded digest.
  materializeOwnedFile(
    output.authPlanPath,
    stableJson(buildSecretsPlan()),
    "Auth SecretRef plan",
    0o600,
    [],
    ADMITTED_AUTH_SECRET_PLAN_SHA256,
  );
  ensurePrivateDirectory(output.governancePluginDirectory);
  for (const [relative, contents] of Object.entries(pluginFiles.assets)) {
    const target = path.join(output.governancePluginDirectory, relative);
    ensurePrivateDirectory(path.dirname(target));
    materializeOwnedFile(
      target,
      contents,
      "Governance plugin asset",
      0o600,
      [],
      ALLOWED_GOVERNANCE_ASSET_SHA256[relative] ?? [],
    );
  }
  materializeOwnedFile(
    output.governancePluginManifestPath,
    pluginFiles.manifest,
    "Governance plugin manifest",
    0o600,
    [],
    [
      ...LEGACY_GOVERNANCE_MANIFEST_R11_SHA256,
      ...ALLOWED_GOVERNANCE_MANIFEST_SHA256,
    ],
  );
  materializeOwnedFile(
    output.governancePluginPackagePath,
    pluginFiles.package,
    "Governance plugin package",
  );
  materializeOwnedFile(
    output.governancePluginEntrypointPath,
    pluginFiles.entrypoint,
    "Governance plugin entrypoint",
    0o700,
    [],
    [
      LEGACY_GOVERNANCE_ENTRYPOINT_R11_SHA256,
      STARTING_GOVERNANCE_ENTRYPOINT_SHA256,
      INTERMEDIATE_GOVERNANCE_ENTRYPOINT_SHA256,
      "d5f1394e18eb2e1910c2ec7f1c92cab4e6c16b1e7ced7c7899b7d1076df85b2e",
      "f116d778cb5a8fa875ff33cb2fe6de8a42f209b984a84899cf2ab795592b13d7",
      "73bea1f506a72181528c11bd210ee6ccaf4ad69518c2ff38fdafc5da4a91be6e",
      "6ccf56a256a321597c7405f2daff3412371a3c37e5d27a410c0cf2a3db802724",
      "3c6545cc8925710ca76068ed64070a71353a794b81de74561bd168e034ec2135",
      "9402dc774e7db90616bf5cafe9afc2bf899892fb2c926abf2526f69eb29d7d7e",
      "e2a265dca6a0ea2b20b8a41004cf08b6157bfbaf503d1a5d2257dfc2504243f3",
      "694a89ae93d6685ff37562828873e7120bb07353b8d3e6e213fd5b080106bf8f",
      "af0ce312e23a0d3be9a10c3bb350b3d6b7d345b1ca7fc49ae13efd41219e5c93",
      "fdb72c9f058cb29e3ba4e3ae3a394d1f84e805a274e8614e592018d073e88015",
      "17b4be782cebc34df7a363c095865653cc8351ba50e08c1206ce4981d6c7e6d1",
      // The entrypoint of the superseded WSL deployment recognized on
      // 2026-09-30 under the same owner authorization as the asset list.
      "09f1d8e66f2b9fca35180d9e0d208f644cedf34824e4cd18bb9f229b51cec1c7",
      // The accepted R5/V15/V16 build (652ac0c lineage), established by
      // packaging that commit, listed only so the R6 emission path can replace it.
      "e77689c94ba066bd854549750044f78dcf9d97cc3de73420893851c0a800b10a",
      // M8/T2.2-R13: the outgoing R7 entrypoint currently deployed, byte-proven
      // against the live runtime at this exact path on 2026-09-30
      // (extensions/zink-governance/index.mjs, 192895 bytes). Listed here as well
      // as in the preflight gate above because that list is duplicated per mode:
      // admitting the predecessor in one mode and not the other would let
      // --preflight PASS and then --apply refuse, which is exactly the deadlock
      // R13 exists to remove. The R10 digest is deliberately NOT listed: it is
      // the current build and is already accepted by content comparison.
      "74582778e5d58ce6a26dec3514b9a73ad5f8964f892023b37221f8a85b5ff215",
      // M8/T2.2-R17: the outgoing R10 entrypoint, listed here as well as in the
      // preflight gate above for the same reason R13's entry is duplicated per
      // mode: admitting the predecessor in one mode and not the other would let
      // --preflight PASS and then --apply refuse. The R17 digest is deliberately
      // NOT listed: it is the current build and is accepted by content comparison.
      "e5b220b4a3b023f6d7b26561964f6204f0d004267b208cddab90adb6043b8bd7",
      // M8/T2.2-R19: the outgoing R17 entrypoint, listed here as well as in the
      // preflight gate above for the same reason R13's entry is duplicated per
      // mode: admitting the predecessor in one mode and not the other would let
      // --preflight PASS and then --apply refuse. The R19 digest is deliberately
      // NOT listed: it is the current build and is accepted by content comparison.
      "d01c210b0cc13f01d6d294223ae400a30ef6407c962d5b46e2f199474f799a1d",
      // Owner-identity hygiene: the outgoing R19 entrypoint currently deployed,
      // listed here as well as in the preflight gate above for the same
      // per-mode-duplication reason.
      "bae7bdf358f35c43c5308c4b0b24a1da57b55bbc609d1ff3a7e32daf65182eca",
      // M8/T3: the outgoing hygiene entrypoint, listed here as well as in the
      // preflight gate above for the same per-mode-duplication reason.
      "2271b56bc7f0ed3a3446e4474c411c1a6132a4e3c1a2edfedb5e6907d8340b5d",
      // Coordinator execution authority (M10/T2-R2): the outgoing coordinator
      // session-binding entrypoint, listed here as well as in the preflight gate
      // above for the same per-mode-duplication reason R13 documents. Admitting
      // the predecessor in one mode and not the other would let --preflight PASS
      // and then --apply refuse. The new digest is deliberately NOT listed: it is
      // the current build and is accepted by content comparison.
      "fa243547f04675685d06bfadd64fa11602fe071fe764a84d328414e7b53dfe89",
      // Coordinator execution authority, coverage-review revision: listed here
      // as well as in the preflight gate above for the same per-mode-duplication
      // reason. Never deployed.
      "a1c8957bbeb2845c61953cf12cf395deae4c9dbae536b486d6748c2944961460",
      // M10/T2-R3 asset-predecessor repair: the outgoing R2 entrypoint
      // currently deployed, listed here as well as in the preflight gate
      // above for the same per-mode-duplication reason. The new digest is
      // deliberately NOT listed: it is the current build and is accepted by
      // content comparison.
      "d1ce63868680ea5f89721ae8b42f07f6f033a840606cdc3a7cd7b6556b3ab593",
      // M10/T2-R8 observability: the outgoing R5 entrypoint, listed here as
      // well as in the preflight gate above for the same per-mode-duplication
      // reason: admitting the predecessor in one mode and not the other would
      // let --preflight PASS and then --apply refuse. The R8 digest is
      // deliberately NOT listed: it is the current build and is accepted by
      // content comparison.
      "0fb628e891a93d570715937a95fc65b82acf14964f00d5de495eeead2138e946",
      // M10/T2-R2 closure: the six entrypoint predecessors that the preflight
      // gate admits and this apply-mode list did not. Each is the packaged build
      // PRODUCED BY the commit named below, re-derived with the repository's own
      // procedure (materialize that commit's integrations/openclaw tree, call
      // governancePluginFiles(), sha256 the packaged entrypoint), so each is a
      // real historical artifact rather than a value copied from the other list:
      //   a3dbf945  2ef4bd64  feat(m8/t3) governed long-term memory learning loop
      //   118db9a7  adc1a49f  remove hardcoded demo execution / false backends
      //   4bb0c1e1  598481c9  make the approved-task handoff honest
      //   36ed858c  eed43f60  stop duplicate approval re-sending a notification
      //   0940eb77  9f52fcd6  truthful notification persistence + send race
      //   4a957b24  dc868066  unify the first/duplicate approval notification guard
      // None of these was ever the live runtime's deployed build, so admitting
      // them widens nothing live; it only makes an apply-mode run reachable from
      // the intermediate builds the preflight gate already recognizes. The
      // current-build digest is deliberately NOT listed: it is accepted by
      // content comparison.
      "a3dbf945deae82c1c07b419d6f1af1724f70a336c88331d4a772dfc93420ab92",
      // M10/T2-R8: the outgoing entrypoint currently deployed (R8 ingress
      // admission build), byte-proven against the live runtime at this exact
      // path before the duplicate-ordering and preflight-seam deployment. This
      // build changed the entrypoint — the duplicate check now precedes the
      // admission signal, and the pure preflight intake predicate was added — so
      // without this entry --preflight refuses the deployed extension and the
      // deployment is unreachable. The new digest is deliberately NOT listed: it
      // is the current build and is accepted by content comparison. Listed in
      // BOTH per-mode lists so the two modes cannot diverge.
      "6a7968b7d456ff6d3f2c5b9d60c7b6046a702603b880093c33b717d9a37c13b1",
      // M10/T2-R9-A: the outgoing entrypoint currently deployed, byte-proven
      // against the live runtime at this exact path on 2026-10-06. This build
      // changes the entrypoint only by appending runId to the
      // DUPLICATE_DISCORD_EVENT denial, so without this entry --apply refuses
      // the deployed extension and the deployment is unreachable. The new digest
      // is deliberately NOT listed: it is the current build and is accepted by
      // content comparison. Listed in BOTH per-mode lists so the two modes
      // cannot diverge.
      "f4ed9d9c54ccf486a30425b98a549cab5aebbbe8e9ee7f2d32bfc6795598c4a3",
      "118db9a746a0757dbea2d15c5d8d9585a298a1ca0d235a6b13a3a8513fb2bcac",
      "4bb0c1e12b4116340fb80f9cc136082200c7506fa691623bc922414f0bd92845",
      "36ed858c74dd09423d0afc74ff2fc8eb589843f163fb8ffccf8bcc912f097ce9",
      "0940eb77d5796f29d819331e92a7c00c4f9230eb1185dce3de7b524a37e2f7c2",
      "4a957b246533ab8e55f88172daa3667ae06cda10dc1d1e8c0858a18e31895663",
      // F-317: the R9-A entrypoint is admitted ONCE here, exactly as the
      // --preflight window above admits it. The list used to carry it twice, so
      // the two per-mode windows were not the same list and a per-window
      // comparison could not be trusted. The admitted SET is unchanged: the
      // digest is still admitted by this window.
      // M10/T2-R12: the R9-A entrypoint, mirrors the preflight-mode entry
      // verbatim so the two modes cannot diverge.
      "c2ef436327242b4fb6f4f65409c80634c4096824a372db02ecc65860cc00cdd3",
      // M10/T2-R12: the first-approval build, mirrors the preflight-mode
      // entry verbatim so the two modes cannot diverge.
      "af574dde8d4b9d2aa7dc217fd49f420bbe50bcae46ddd4d6f5e3662cd807137d",
      // M10/T2-R9-C: the R4-EXCEPTION-buttons build, mirrors the preflight-mode
      // entry verbatim so the two modes cannot diverge.
      "aea6bf9545f6d365b40bba4d4e976a47211b49594a963e518a8d5e7e3baebc30",
      // M10/T2-R12: the governed-model-chain build currently deployed,
      // byte-verified at this exact path. This revision mints the owner-facing
      // task code at admission, so without this entry --preflight refuses the
      // deployed extension. Listed in BOTH per-mode lists.
      "30078552487018479bf5f4c6a355d94646e45c9de6711804843d7648e06f9741",
      // M10/T2-R14: the outgoing R12/R13 entrypoint, mirrors the preflight-mode
      // entry verbatim so the two modes cannot diverge.
      "61680010520bbe3ca57b289cf9af9fb6ea79c8f79e33e49e95d5dec6de60cef3",
      // M10/T2-R17: the R16 entrypoint, deployed and byte-proven at this exact
      // path. R17 collapses the duplicated owner-action label into one
      // `describeOwnerAction` and hardens the interactive ack/catch guards.
      // Without this entry --preflight refuses the deployed extension.
      "8e4b53847d84e6c9eb084ca98b72610ba71b6ddeb00fb01a1137d9366314a466",
      // M11/T1-R1 Phase 2: the outgoing governance entrypoint, mirrors the
      // preflight-mode entry verbatim so the two modes cannot diverge.
      "230f3c79d0a35c2261129ddc0048ad4f0ae4fc6d86a5c49e444594a446bd2982",
      // M11/T3 Phase 1: the outgoing governance entrypoint, mirrors the
      // preflight-mode entry verbatim so the two modes cannot diverge.
      "e8f084ab5593a093a2075db8167ce6db4ea39e87141dc4a2ba4dee99fb4fccaa",
      // M12/T1-R1: the governance entrypoint the live WSL runtime carries
      // (`61e344e6…`, measured read-only before this entry). M12/T1 registers the
      // Discord components this plugin posts, fixes the approval-decision reason,
      // makes the 12-character code the task identity, and presents the plan plus an
      // expected-result image. Without this admission BOTH guards refuse the upgrade:
      // this list appears at the --preflight and the --apply call sites, and they must
      // stay identical. The new digest is deliberately NOT listed: it is the current
      // build, accepted by content comparison.
      "61e344e6754c3c03b26463c2421ebf699d8ec14f9ab0b8fe87bec1265d99f3b6",
      // M12/T2.2-R1 A-3: the entrypoint the live WSL runtime carries, listed here
      // as well as in the preflight gate above for the same per-mode-duplication
      // reason -- admitting the predecessor in one mode and not the other would
      // let --preflight PASS and then --apply refuse. Digest re-measured
      // read-only on 2026-10-16 against the deployed file, not transcribed. The
      // new digest is deliberately NOT listed: it is the current build and is
      // accepted by content comparison.
      "513beb15c3d7624c0a928c4c1556dc44d4c4cff4f1e00980f24b298a25751c0d",
      // M12/T9 F-382: the DEPLOYED build's entrypoint. The deployed
      // extension is the build at `0b55dfa4` (measured on the live host on
      // 2026-10-22), and its entrypoint is the plugin's own `index.mjs` as of
      // `b6d04e80` — the commit that last changed it before that build —
      // packaged exactly as the builder packages it. Without this entry
      // --preflight refuses the deployed extension with `Governance plugin
      // entrypoint`, so the apply cannot reach the extension it is supposed
      // to replace. The digest this build produces is deliberately NOT listed:
      // it is the current build and is accepted by content comparison. Listed
      // in BOTH per-mode lists so the two modes cannot diverge.
      "513beb15c3d7624c0a928c4c1556dc44d4c4cff4f1e00980f24b298a25751c0d",
    ],
  );
  if (!existsSync(output.identityKeyPath))
    writePrivateRegularFile(
      output.identityKeyPath,
      `${randomBytes(32).toString("hex")}\n`,
      0o600,
    );
  upgradeEmptyLegacyLedger(ledgerPaths(stateDir));
  materializeOwnedFile(
    output.authOrderPlanPath,
    stableJson(buildAuthOrderPlan()),
    "Auth order plan",
    0o600,
    [],
    ADMITTED_AUTH_ORDER_PLAN_SHA256,
  );
  ensurePrivateDirectory(path.dirname(output.passResolverPath));
  // Mirrors the preflight gate above: the outgoing resolver still allowlists the
  // 21 GEMINI_API_KEY_NN pass ids, so it must be admitted here too or the apply
  // refuses the same file the preflight accepted.
  materializeOwnedFile(
    output.passResolverPath,
    passResolverContents(),
    "Password-store resolver",
    0o700,
    [],
    PREVIOUS_PASS_RESOLVER_SHA256,
  );
  materializeOwnedFile(
    output.geminiStreamHotfixPath,
    geminiStreamHotfixContents(),
    "Gemini stream hotfix utility",
    0o700,
    [],
    ADMITTED_GEMINI_STREAM_HOTFIX_SHA256,
  );
  ensurePrivateDirectory(path.dirname(output.passStoreDirectory));
  ensurePrivateDirectory(output.passStoreDirectory);
  ensurePrivateDirectory(output.gpgHomeDirectory);
  ensurePrivateDirectory(path.dirname(output.systemdDropInPath));
  materializeOwnedFile(
    output.systemdDropInPath,
    renderSystemdDropIn(stateDir),
    "Systemd drop-in",
    0o600,
    [
      renderLegacySystemdDropInR16(stateDir),
      renderDeployedSystemdDropIn(stateDir),
    ],
  );
  // M12/T9 F-202: the apply re-checks the EFFECTIVE drop-in set after it
  // wrote its own fragment, so a sibling that appeared while the apply ran
  // cannot survive the ceremony.
  assertNoUnownedSystemdDropIns(output.systemdDropInDirectory);
  // F-111: the transaction is spent by the apply that used it, so a second
  // `--apply` against the same transaction is refused.
  markBuilderApplyConsumed(stateDir, applyTransaction);
  // M12/T9 F-203: the applied state carries the same inspection record the
  // preflight emits, so neither verdict can be read without it.
  const inspection = buildInspectionRecord(stateDir);
  process.stdout.write(
    `${stableJson({
      ...output,
      deploymentEvidence: inspection.deploymentEvidence,
      inspection,
    })}`,
  );
}

try {
  await main();
} catch (error) {
  // M12/T2-R3: the machine code is the part an operator can act on. `--apply` runs as a
  // child of `operator-apply.mjs`, whose reason classifier reads only this child's text,
  // so a refusal whose message is prose ("Ledger writer unavailable") and whose code is
  // the fixed literal `EXECUTION_STATE_UNKNOWN` collapsed into `APPLY_REJECTED` and named
  // nothing. Codes here are repository constants — never a message body, path, config or
  // identifier value — so naming one leaks nothing.
  const code = typeof error?.code === "string" ? ` [${error.code}]` : "";
  process.stderr.write(`${error.message}${code}\n${usage()}\n`);
  process.exitCode = 1;
}
