# Phase 6 Recheck Report — OpenClaw setup, preflight, rollback, templates

**Date**: 2026-10-29  
**Finding to verify**: F-OC-008  
**Scope**: `integrations/openclaw/configure.mjs`, `integrations/openclaw/verify.mjs`, `integrations/openclaw/templates/**/*`

## Finding F-OC-008 — post-rename directory-fsync failure leaves untracked hotfix artifact mixture

**Claimed fix state**: Candidate for recheck  

### Code Inspected: `integrations/openclaw/templates/openclaw-gemini-stream-hotfix.mjs`

#### Evidence of vulnerability still present

**Line 290-315: `writeAtomically` function**

```javascript
function writeAtomically(filePath, contents, fileMode) {
  const temporaryPath = `${filePath}.zink-hotfix-${process.pid}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporaryPath, "wx", fileMode);
    writeFileSync(descriptor, contents, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporaryPath, fileMode);
    renameSync(temporaryPath, filePath);           // Line 300 - destination now patched
    syncDirectory(path.dirname(filePath));         // Line 301 - if this fails:
  } catch (error) {                                // filePath already renamed, but catch doesn't restore it
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch {}
    }
    try { unlinkSync(temporaryPath); } catch {}   // Only unlinks TEMP (which may not exist after rename)
    throw error;                                  // Destination left in corrupted state
  }
}
```

---

**Lines 416-446: `writeTransaction` function**

```javascript
function writeTransaction(records, desiredState) {
  const planned = records.map((record) => ({
    ...record,
    desired: desiredContents(record, desiredState),
  }));
  const changed = [];                              // Transaction log starts empty
  try {
    for (const record of planned) {
      if (record.desired === record.contents) continue;
      writeAtomically(record.filePath, record.desired, record.fileMode);
      changed.push(record);                        // Line 426: only logged AFTER writeAtomically succeeds
    }
  } catch (error) {
    // Rollback at line 430 only iterates what's already in `changed`
    // Any artifact that failed after rename is never logged, so rollback can't undo it
    let rollbackError;
    for (const record of [...changed].reverse()) {
      try {
        writeAtomically(record.filePath, record.contents, record.fileMode);
      } catch (candidate) {
        rollbackError ??= candidate;
      }
    }
    // ...
  }
}
```

---

**Lines 379-394: `classifyState` function**

```javascript
function classifyState(records) {
  const states = records.map(({ spec, contents }) => {
    const digest = requireKnownHash(spec.id, contents);
    return digest === spec.patchedSha256 ? "patched" : "original";
  });
  if (states.every((state) => state === "patched")) return "patched";
  if (states.every((state) => state === "original")) return "original";
  if (
    states[0] === "patched" &&
    states.slice(1).every((state) => state === "original")
  ) {
    return "r18-predecessor";                       // ONLY first-artifact-only-patched allowed
  }
  throw new Error("OpenClaw hotfix artifacts are in an unsupported partial state"); // Mixed state rejected
}
```

---

### Verdict: **NOT FIXED**

No changes detected to prevent this exact sequence. The vulnerable code patterns cited in findings.md remain identical:

| Vulnerability Pattern | Path:Line | Status |
| --- | --- | --- |
| `renameSync` before `syncDirectory` | `openclaw-gemini-stream-hotfix.mjs:300-301` | Unchanged |
| Catch block doesn't restore `filePath` | `openclaw-gemini-stream-hotfix.mjs:302-316` | Unchanged |
| `changed.push(record)` after success | `openclaw-gemini-stream-hotfix.mjs:426` | Unchanged |
| `classifyState` rejects mixed states | `openclaw-gemini-stream-hotfix.mjs:379-394` | Unchanged |

**Root cause confirmed**: Still accurate per findings.md description.

---

### Acceptance Criteria Assessment

| Criterion | Required Fix | Current State |
| --- | --- | --- |
| Restore destination if fsync fails | Rollback or atomic swap | ❌ NOT DONE |
| Record artifact in `changed` BEFORE fsync | Pre-log then operate | ❌ NOT DONE |
| Supported state after injection | One of three acceptable patterns | ❌ Mixed states rejected |
| `--ensure` passes for supported states | Idempotent repair | ❌ Fails on unsupported partial |

---

### New Defects Introduced

**None** — No fix was applied, so no regression possible.

---

## Summary

| Finding | Status | Path:Line | Impact |
| --- | --- | --- | --- |
| F-OC-008 | **NOT FIXED** | `integrations/openclaw/templates/openclaw-gemini-stream-hotfix.mjs:290-315, 421-432` | Gateway startup blocks on directory-fsync failure |

**Total findings verified**: 1  
**Fixed**: 0  
**Partial**: 0  
**Not Fixed**: 1  
**New defects**: 0

---

*Report written by subagent scan-oc-6 in Phase 6 recheck mode.*
*Evidence preserved verbatim; test status not run pending docs/execution/reports/p6/tests.md lead documentation.*
