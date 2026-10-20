// F-264 (R7-D13-01) - the n8n PostgreSQL role password is expanded into
// `psql`'s argv, so every process in the container can read it from
// /proc/<pid>/cmdline for the duration of the call.
//
// The acceptance criterion: the secret is passed only via `PGPASSWORD` or a
// file with mode 0600, never via argv.
//
// `compose.core.yml:44` already delivers the superuser password through the
// environment, but the n8n role password has no such channel: it is a VALUE
// the bootstrap writes into the database, not a connection credential. So the
// file branch of the criterion is the one that applies, and the file is the
// only place the secret is allowed to live: it is created with mode 0600, the
// environment copy is dropped, and the client reads the value back through
// psql's own `\set` command substitution, which never puts it on a command
// line.
//
// The behavioural half runs the real script under a POSIX shell with a stub
// `psql` that records its own argv and stdin, so the criterion is checked
// against what the client would actually receive.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const SCRIPT_PATH = path.join(
  "infrastructure",
  "docker",
  "scripts",
  "bootstrap-postgres.sh",
);
const SECRET = "correct-horse-battery-staple-8f3a1c";

function scriptSource() {
  return readFileSync(path.join(root, SCRIPT_PATH), "utf8");
}

function posixShell() {
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  }
  return existsSync("/bin/sh") ? "/bin/sh" : null;
}

const STUB_PSQL = `#!/bin/sh
: > "$RECORD_DIR/argv.txt"
for argument in "$@"; do
  printf '%s\\n' "$argument" >> "$RECORD_DIR/argv.txt"
done
cat > "$RECORD_DIR/stdin.txt"
secret_path=$(sed -n 's/^\\\\set n8n_password \`cat \\(.*\\)\`$/\\1/p' "$RECORD_DIR/stdin.txt")
if [ -n "$secret_path" ]; then
  printf '%s\\n' "$secret_path" > "$RECORD_DIR/secret-path.txt"
  stat -c '%a' "$secret_path" > "$RECORD_DIR/secret-mode.txt" 2>/dev/null || printf 'missing\\n' > "$RECORD_DIR/secret-mode.txt"
  cat "$secret_path" > "$RECORD_DIR/secret-content.txt" 2>/dev/null || true
fi
exit 0
`;

const STUB_PG_ISREADY = `#!/bin/sh
exit 0
`;

function runBootstrapUnderStub() {
  const shell = posixShell();
  if (!shell) return null;
  const workspace = mkdtempSync(path.join(os.tmpdir(), "f-264-"));
  const binDirectory = path.join(workspace, "bin");
  const recordDirectory = path.join(workspace, "record");
  mkdirSync(binDirectory);
  mkdirSync(recordDirectory);
  const psqlStub = path.join(binDirectory, "psql");
  const isReadyStub = path.join(binDirectory, "pg_isready");
  writeFileSync(psqlStub, STUB_PSQL);
  writeFileSync(isReadyStub, STUB_PG_ISREADY);
  chmodSync(psqlStub, 0o755);
  chmodSync(isReadyStub, 0o755);

  const result = spawnSync(shell, [path.join(root, SCRIPT_PATH)], {
    env: {
      ...process.env,
      PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
      RECORD_DIR: recordDirectory,
      N8N_POSTGRES_PASSWORD: SECRET,
    },
    encoding: "utf8",
  });

  const read = (name) => {
    const file = path.join(recordDirectory, name);
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  };
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    argv: read("argv.txt"),
    stdin: read("stdin.txt"),
    secretPath: read("secret-path.txt")?.trim() ?? null,
    secretMode: read("secret-mode.txt")?.trim() ?? null,
    secretContent: read("secret-content.txt"),
  };
}

test("F-264: the bootstrap script never puts the role password on a command line", () => {
  const source = scriptSource();
  assert.doesNotMatch(
    source,
    /--set=n8n_password/,
    "the role password must not be expanded into a psql argument",
  );
  assert.doesNotMatch(
    source,
    /psql[^\n]*N8N_POSTGRES_PASSWORD/,
    "no psql invocation may carry the environment copy of the secret",
  );
  assert.doesNotMatch(
    source,
    /-v\s*n8n_password/,
    "the psql -v form is the same argv exposure",
  );
});

test("F-264: the secret is delivered through a 0600 file the client reads back", () => {
  const source = scriptSource();
  assert.match(source, /umask 077/, "the secret file must be created private");
  assert.match(source, /chmod 600/, "the secret file must be mode 0600");
  assert.match(
    source,
    /\\set n8n_password `cat /,
    "psql must read the value back from the private file",
  );
  assert.match(
    source,
    /unset N8N_POSTGRES_PASSWORD/,
    "the environment copy must be dropped once the file holds the secret",
  );
  assert.match(
    source,
    /trap '[^']*rm -f "\$secretFile"/,
    "the secret file must be removed when the script exits",
  );
});

test("F-264: the statement that consumes the password is unchanged", () => {
  const source = scriptSource();
  assert.match(
    source,
    /ALTER ROLE n8n LOGIN PASSWORD :'n8n_password'/,
    "the role password is still set from a psql variable, not interpolated",
  );
  assert.match(source, /CREATE EXTENSION IF NOT EXISTS vector/);
  assert.match(source, /CREATE ROLE n8n LOGIN/);
  assert.match(source, /CREATE DATABASE %I OWNER %I/);
});

test("F-264: the client receives the secret in neither argv nor the SQL stream", (t) => {
  const shell = posixShell();
  if (!shell) {
    t.skip("no POSIX shell is available to run the bootstrap script");
    return;
  }
  const run = runBootstrapUnderStub();
  assert.ok(run, "the bootstrap script must run under the stub client");
  assert.equal(
    run.status,
    0,
    `the bootstrap script must succeed: ${run.stderr || run.stdout}`,
  );
  assert.ok(run.argv !== null, "the stub client must have been invoked");
  assert.doesNotMatch(
    run.argv,
    /correct-horse-battery-staple/,
    `the role password must not appear in the client argv: ${run.argv}`,
  );
  assert.doesNotMatch(
    run.stdin,
    /correct-horse-battery-staple/,
    `the role password must not be written into the SQL stream: ${run.stdin}`,
  );
  assert.ok(
    run.secretPath,
    `the client must read the value from a private file: ${run.stdin}`,
  );
  assert.equal(
    run.secretMode,
    "600",
    `the secret file must be mode 0600, not ${run.secretMode}`,
  );
  assert.equal(
    run.secretContent,
    SECRET,
    "the private file must hold exactly the role password",
  );
  assert.equal(
    existsSync(run.secretPath),
    false,
    "the secret file must be removed when the script exits",
  );
});
