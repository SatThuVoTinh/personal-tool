/**
 * M12/T9 F-156 — the Zink Skill Store's PUBLIC DOOR.
 *
 * The Skill Store is a peer module, and the OpenClaw governance plugin used
 * to reach into its INTERNALS by relative path
 * (`zink-skill-store/src/catalog.mjs`, `zink-skill-store/src/vector-sync.mjs`).
 * That welded the plugin's behaviour to the store's private file layout: a
 * rename inside `src/` broke the plugin, and the plugin could reach any
 * internal it liked. The architecture says OpenClaw reaches the Skill Store
 * only through a governed boundary; nothing made that boundary real.
 *
 * This module IS that boundary. It publishes exactly four entry points, and
 * nothing else:
 *
 *   promoteApprovedSkill(...)      the canonical promotion
 *   retireSkill(...)               the governed DEPRECATED retirement
 *   withSkillStoreWriterLock(...)  the store-wide writer lock
 *   syncSkillsToVectorStore(...)   the derived pgvector index sync
 *
 * The internal `src/*` modules keep working for the Skill Store's own tests,
 * its own bin and its own readers: this is a DOOR, not a rewrite.
 *
 * The promotion stays governed RUNTIME code and is never a model-visible Tools
 * action: the Zink Tools `SkillAdapter` still exposes `query`/`propose` only,
 * and only an owner-confirmed governance action reaches this door.
 *
 * `promoteApprovedSkill` is the canonical promotion and it MUST run inside
 * `withSkillStoreWriterLock`: the governed approval transaction re-reads the
 * durable proposal, checks it for a rejection, promotes, and writes the
 * proposal status as ONE critical section, and a promotion outside that
 * section could overwrite a rejection another process committed while the
 * approval was in flight. The door refuses an unlocked promotion with
 * `SKILL_STORE_WRITER_LOCK_REQUIRED` instead of writing one.
 *
 * M12/T9 F-095 (R5-E04-05) / H8: `retireSkill` is the governed retirement —
 * the route the owner needs to withdraw a wrong skill without editing the
 * tree. It is a canonical write like the promotion, so it carries the SAME
 * discipline: it runs inside the store's writer lock and the door refuses an
 * unlocked retirement.
 *
 * `applySkillStoreMigrations` is the Skill Store's OWN migration runner
 * (M12/T9 F-094 / H5): the `skills.*` DDL and the runner that applies it
 * live in this module, not in the Knowledgebase's migration set.
 */
import {
  promoteApprovedSkillUnlocked,
  retireSkillUnlocked,
  withSkillStoreWriterLock,
  isSkillStoreWriterLockHeld,
} from "./src/catalog.mjs";
import { syncSkillsToVectorStore } from "./src/vector-sync.mjs";
import { applySkillStoreMigrations } from "./src/migrations.mjs";

/**
 * The canonical promotion, to be called INSIDE the store's writer lock.
 *
 * @param {object} params the promotion parameters (identity, content,
 *   provenance and the governed decision reference).
 * @returns {Promise<object>} the canonical promotion result.
 */
export async function promoteApprovedSkill(params) {
  if (!isSkillStoreWriterLockHeld(params?.skillsRoot)) {
    const error = new Error(
      "SKILL_STORE_WRITER_LOCK_REQUIRED: the canonical promotion must run inside the store's writer lock",
    );
    error.code = "SKILL_STORE_WRITER_LOCK_REQUIRED";
    throw error;
  }
  return promoteApprovedSkillUnlocked(params);
}

/**
 * The governed DEPRECATED retirement, to be called INSIDE the store's writer
 * lock.
 *
 * @param {object} params the retirement parameters (identity, the actor and
 *   the governed decision reference).
 * @returns {Promise<object>} the retirement result.
 */
export async function retireSkill(params) {
  if (!isSkillStoreWriterLockHeld(params?.skillsRoot)) {
    const error = new Error(
      "SKILL_STORE_WRITER_LOCK_REQUIRED: the governed retirement must run inside the store's writer lock",
    );
    error.code = "SKILL_STORE_WRITER_LOCK_REQUIRED";
    throw error;
  }
  return retireSkillUnlocked(params);
}

export {
  withSkillStoreWriterLock,
  syncSkillsToVectorStore,
  applySkillStoreMigrations,
};
