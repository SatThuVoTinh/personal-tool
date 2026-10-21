# Runbook — deploying the M12/T9 build: what the operator does

This is the operator-facing note for the M12/T9 band. It says what a person has
to do on the machine, and — just as important — what they do NOT have to do.

Everything below is typed **inside the WSL shell** (Windows Terminal → `wsl`).
A PowerShell prompt does not expand `~` or `*` the way bash does, which is why a
command pasted there can print nothing at all.

## Nothing to do: the ledger's derived snapshot

The M12/T9 band changed how the governance ledger re-derives a task's state
(F-160) and what a task carries (F-060). A snapshot written by an older build
therefore no longer agrees with its own journal, and the ledger would refuse to
read.

The deploy ceremony now **recomputes the derived snapshot from the journal**
before the apply, and it says so in its own output:

```text
[zink-operator] the derived ledger snapshot was recomputed from the journal: sequence=… tasks=…
```

The **journal is never written** — it is the record. Only the derived cache is
recomputed, and only when the two disagree. A journal that does not verify is
refused and nothing is written.

**So: run the deploy as usual. There is no manual step.**

## One thing to do: the stale backup file with loose permissions

The state root holds credential-bearing files, and the policy is that only the
owner may read them. The file that does not satisfy that today is a stale
**backup copy** of the config:

```text
~/.openclaw-zink/openclaw.json.bak-mobile-1789615159090
```

The live config is `~/.openclaw-zink/openclaw.json` — that file is not the one
in question, and it must not be touched.

List every file in the state root that another account could read (absolute
path, no glob, so it behaves the same in every shell):

```bash
find /home/hoang_vinh/.openclaw-zink -maxdepth 1 -type f ! -perm 600 -printf '%M %p\n'
```

- **Nothing is printed** ⇒ there is nothing to fix. Go to the deploy.
- A line is printed ⇒ fix that file, either one:

```bash
# option A — keep the backup, make it owner-only (recommended)
chmod 600 /home/hoang_vinh/.openclaw-zink/openclaw.json.bak-mobile-1789615159090

# option B — drop the stale copy
rm /home/hoang_vinh/.openclaw-zink/openclaw.json.bak-mobile-1789615159090
```

Verify by running the `find` command again: it must print **nothing**.

Until this is done, `--preflight` and `--apply` **refuse** on purpose. That is
the new check working, not a fault: the check is `F-035`, and it enumerates the
state root instead of looking at named paths.

## The deploy itself

The operator drivers take the state root as an **input** (F-219): they read
`ZINK_OPERATOR_STATE_DIR` or their first argument, and refuse with
`STATE_DIR_NOT_NAMED` when they are given neither. Naming it is the operator's
job — the driver never guesses a machine path.

```bash
cd "/mnt/c/Users/HOANG VINH/OneDrive/Documents/personal-tool"

# BƯỚC 0 — nạp biến môi trường router. `configure.mjs` đọc `ZINK_ROUTER_HOST` và
# `ZINK_ROUTER_PORT` từ môi trường để dựng config; thiếu một trong hai thì builder
# chết ngay với `ROUTER_HOST_UNAVAILABLE`/`ROUTER_PORT_UNAVAILABLE` và preflight báo
# FAIL mà không sửa gì. KHOÁA ROUTER KHÔNG CÒN Ở ĐÂY NỮA (F-036, quyết định H6
# của chủ): config chỉ mang một THAM CHIẾU, khoá nằm trong kho `pass` và được
# resolver giải lúc chạy. Nhập khoá một lần (nhập tay, không gõ giá trị vào lệnh):
#   pass insert zink/openclaw/ZINK_ROUTER_API_KEY
set -a; . "$HOME/.openclaw-zink/router.env"; set +a

# BƯỚC 0b — CHỈ ĐỊNH THƯ MỤC TRẠNG THÁI. Không có dòng này thì cả hai driver
# dưới đây dừng lại với `STATE_DIR_NOT_NAMED` và KHÔNG deploy gì cả.
export ZINK_OPERATOR_STATE_DIR="$HOME/.openclaw-zink"

# BƯỚC 1 — chỉ đọc, không sửa gì. Dòng kỳ vọng:
# {"identifiers":"VALID","builder_preflight":"PASS","installed_mutation":false}
node integrations/openclaw/topology/fixtures/runtime-regression/operator-preflight.mjs "$ZINK_OPERATOR_STATE_DIR"

# BƯỚC 2 — CHỈ chạy khi bước 1 in ra PASS. Đây là lần apply duy nhất: script tự snapshot
# trạng thái live trước khi sửa, apply, vá runtime, khởi động lại unit rồi đối chiếu từng byte;
# nếu không khớp nó tự rollback và in báo cáo FAIL kèm lý do.
node integrations/openclaw/topology/fixtures/runtime-regression/operator-apply.mjs "$ZINK_OPERATOR_STATE_DIR"

# BƯỚC 3 — kiểm tra sau triển khai
systemctl --user show openclaw-gateway-zink.service -p ActiveState -p MainPID -p NRestarts
```

## Nothing to do: the deployment's admission list

The packaged extension's bytes moved with this band (the packaged set grew from
34 to 45 assets), and the admission list in
`integrations/openclaw/configure.mjs` has to name the bytes that are **on the
host** so the preflight can accept them.

That list is already rolled: every asset of the deployed build is named, so
`--preflight` accepts the extension that is installed today. Nothing to do.

After the deploy, the extension on the host carries the NEW build's bytes, and
the NEXT deploy will need the new digests admitted. That roll is part of the
band that changes the packaged set, not an operator step.

## The order to do it in

1. `chmod 600` (or delete) the stale backup copy — the one manual step, and on
   the 2026-10-21 host it is already done.
2. Run the deploy above. The ceremony recomputes the derived ledger snapshot
   and prints a line when it does.
3. Watch the ceremony's output for the recompute line. If it is absent, the
   ledger already agreed with its journal and nothing was rewritten.

## If the deploy refuses

| The refusal says             | What it means                                                             | What to do                                                                 |
| ---------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `STATE_DIR_NOT_NAMED`        | the driver was not told the state root — **nothing was deployed**         | export `ZINK_OPERATOR_STATE_DIR` as above and run it again                 |
| `STATE_ROOT_FILE_MODE_DRIFT` | a file in the state root is readable by another account                   | fix the permissions it names, then re-run                                  |
| `snapshot workflow mismatch` | the derived snapshot still disagrees with the journal after the recompute | the journal itself changed shape: report it, do not hand-edit the snapshot |
| `Ledger state incomplete`    | half of the ledger pair is missing                                        | an operator action on the host: report it                                  |
