# Quy ước phát triển

Tài liệu này quy định cách làm việc với repository Personal Tool. M1/T2 đã thiết lập baseline format, lint, test và repository verification; runtime, CI, database, RAG, AI agent hoặc ứng dụng vẫn chưa được suy diễn là đã tồn tại.

## Git và branch

- `main` là nhánh ổn định và là nhánh mặc định của repository.
- Commit bootstrap đầu tiên được tạo trực tiếp trên `main` để thiết lập repository trống. Sau đó, mỗi task dùng nhánh ngắn hạn theo mẫu `m<milestone>/t<task>-<slug>`, ví dụ `m1/t1-git-github-conventions`.
- Dùng chữ thường ASCII và dấu gạch ngang trong `slug`; không dùng khoảng trắng hoặc tên mơ hồ như `fix` hay `update`.
- Mọi thay đổi sau bootstrap được commit trên một task branch (`m<milestone>/t<task>-<slug>`) rồi push branch đó lên remote; **tạo hoặc merge pull request vào `main` cần owner authorization riêng** (xem `AGENTS.md` §12). Branch protection và required CI chỉ được cấu hình sau khi CI thực sự tồn tại.
- Không force-push vào `main`, không commit trực tiếp secret, binary build output hoặc runtime state.

## Commit

Dùng Conventional Commits theo mẫu `type(scope): summary`.

- `type` là một trong: `feat`, `fix`, `docs`, `test`, `refactor`, `build`, `ci`, `chore`.
- `scope` là lowercase, ngắn và tùy chọn; ví dụ `repo`, `docs` hoặc `knowledge`.
- `summary` dùng động từ mệnh lệnh, ngắn gọn, không có dấu chấm cuối. Ưu tiên dưới 72 ký tự.
- Ví dụ: `chore(repo): establish git conventions`.

### Agent execution commits và remote publication

- `PLAN.md` giữ durable lifecycle/authorization; khi task đã được owner approve,
  `docs/contracts/execution/ACTIVE.md` là source of truth cho implementation details.
- `dsh` execute và handoff; `dsh` không sở hữu final task commit/push theo mặc định.
- Codex chỉ tạo local implementation commit sau khi review/fix hội tụ và Final
  Quality Gate `PASS`.
- Sau implementation commit, Codex cập nhật `PLAN.md`, xóa `ACTIVE.md`, dọn state
  tạm, chạy lại gate bị ảnh hưởng và tạo local closeout commit.
- Khi closeout sạch, Codex push current non-`main` task branch lên configured
  remote; push branch không đồng nghĩa remote CI/Security đã `PASS`.
- Tạo/merge PR, push trực tiếp `main`, force-push/history rewrite, release và
  deployment vẫn cần owner authorization riêng.

## Định dạng và line ending

- `.editorconfig` là nguồn chuẩn về UTF-8, LF, whitespace và indentation.
- Mặc định dùng 2 spaces; Python dùng 4 spaces; Makefile dùng tab; Markdown giữ trailing whitespace để cho phép hard line break có chủ đích.
- `.gitattributes` chuẩn hóa text file về LF và đánh dấu binary assets. Không tự thêm Git LFS hoặc Jupyter diff driver khi chưa có nhu cầu và cấu hình hỗ trợ.
- Formatter, linter, test và repository verification được cung cấp qua npm scripts. Không thêm hoặc chạy command chất lượng chưa tồn tại như thể đã được triển khai.

## Lệnh kiểm chứng T1

Chạy từ repository root sau mỗi thay đổi T1. Hai lệnh `diff --check` không được xuất lỗi. Attribute của `README.md` phải thể hiện `text` và `eol: lf`. `.env` phải bị ignore, còn `.env.example` phải vẫn trackable.

```powershell
git status --short --branch
git diff --check
git diff --cached --check
git check-attr text eol -- README.md

git check-ignore -q --no-index .env
if ($LASTEXITCODE -ne 0) { throw '.env must be ignored.' }

git check-ignore -q --no-index .env.example
if ($LASTEXITCODE -eq 0) { throw '.env.example must remain trackable.' }
```

Trước commit, xem toàn bộ staged files bằng `git diff --cached --name-status` và chỉ commit file thuộc task đang active. Sau khi remote được cấu hình, xác nhận `main` theo dõi `origin/main` và `git ls-remote --heads origin main` trả về đúng branch.

## Toolchain và verification T2

- `engines` cho phép Node `>=24.15.0 <25` và npm `12.x`; `devEngines` bắt buộc Node trong range này và npm `12.0.2` cho development, verification và CI.
- `package-lock.json` được commit. Dùng `npm ci` cho clean verification và CI; chỉ dùng `npm install --save-dev --save-exact <package>` khi chủ động thêm/cập nhật dependency và tạo lại lockfile.
- Gate registry (`docs/development/conventions.md` là danh sách duy nhất, có thể kiểm tra được, liệt kê toàn bộ npm gate; `scripts/repository-policy.mjs` fail khi bảng này và `package.json.scripts` lệch nhau ở bất kỳ hướng nào):

| Script                       | What it checks                                                                                                                                                                                                         | Where it runs                                                                                                                            | NOT RUN condition                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`                     | `prettier --write` trên các glob đã bọc dấu nháy — đây là writer, không phải gate                                                                                                                                      | Windows, WSL                                                                                                                             | npm/node không khả dụng                                                                                                                                                                                                                                                                                                                                                    |
| `format:check`               | `prettier --check` trên đúng các target đó                                                                                                                                                                             | Windows, WSL, CI `quality-gate`                                                                                                          | npm/node không khả dụng                                                                                                                                                                                                                                                                                                                                                    |
| `lint`                       | `eslint` (scripts, tests, zink-skill-store/src+bin, zink-tools, integrations/openclaw) + `markdownlint-cli2`                                                                                                           | Windows, WSL, CI `quality-gate`                                                                                                          | npm/node không khả dụng                                                                                                                                                                                                                                                                                                                                                    |
| `test`                       | `node --test` trên **danh sách file tường minh** (không glob); reconciliation argv↔disk do `checkTestListReconciliation` giữ                                                                                           | Windows, WSL, CI `quality-gate`                                                                                                          | một file trong danh sách không tồn tại → gate fail, không im lặng; gate skip-expectation (`scripts/skip-expectation-gate.mjs`) đọc report của chính lần chạy này và fail khi một họ skip vượt kỳ vọng đã khai trong `docs/contracts/ci-skip-expectations.json`; case Postgres (`M11-06`) **skip** khi không có Docker → case đó là `NOT RUN`, không được cộng vào "fail 0" |
| `test:knowledge`             | `uv run --directory apps/knowledge --locked python -m pytest tests -q`                                                                                                                                                 | Windows (local, tokenizer đã pin), CI `python-quality`                                                                                   | `uv` hoặc model tokenizer không khả dụng → `NOT RUN`, không được viết thành pass                                                                                                                                                                                                                                                                                           |
| `test:m8`                    | `node --test tests/m8-*.test.mjs` (glob, do node expand)                                                                                                                                                               | Windows, WSL, CI `quality-gate` — `npm test` liệt kê tường minh cả 23 file khớp glob, nên script này chỉ là lối vào tắt của cùng bộ file | gọi tường minh khi glob không khớp file nào → gate fail ở bước reconciliation của `npm test`                                                                                                                                                                                                                                                                               |
| `rehearse:r16`               | driver rehearsal R16 trong private mount namespace trên bản clone runtime live (`r16-rehearsal.mjs`)                                                                                                                   | chỉ WSL, cần runtime live; **không chạy ở CI**                                                                                           | cần clone runtime live; trong programme này nó là rehearsal chết (case `R16-DRIVER-05` red ở baseline trên WSL) → `NOT RUN`                                                                                                                                                                                                                                                |
| `repo:check`                 | `node scripts/repository-check.mjs`: tracked/staged, Git whitespace, working-tree bytes, policy (workflow YAML, script existence, gate registry)                                                                       | Windows, WSL, CI `quality-gate`                                                                                                          | Git không khả dụng                                                                                                                                                                                                                                                                                                                                                         |
| `scripts/audit-baseline.mjs` | so `npm audit --json` với baseline đã ghi ở `.github/security/npm-audit-baseline.json`; đỏ khi một advisory lạ xuất hiện (kể cả advisory thay thế cùng severity, counts không đổi) hoặc khi một count vượt trần đã ghi | CI `Security / dependency-audit`                                                                                                         | baseline hoặc report audit không đọc được → gate fail closed, không được coi là pass                                                                                                                                                                                                                                                                                       |
| `scripts/merge-gate.mjs`     | nửa pre-merge của in-repo merge blocker: từ chối khi tip không có run `quality-gate` SUCCESS đúng SHA đó                                                                                                               | operator chạy trước merge; CI job `merge-gate-detector` chạy nửa post-merge với `always()`                                               | thiếu `gh`/token/mạng/SHA hoặc HEAD không có predecessor → FAIL CLOSED (refuse), không phải `NOT RUN`                                                                                                                                                                                                                                                                      |
| `gitleaks/gitleaks-action`   | quét secret trên toàn bộ lịch sử Git theo `.gitleaks.toml` và upload report làm artifact của run                                                                                                                       | CI `Security / secret-scan`                                                                                                              | action không tải/chạy được → `NOT RUN`, không được viết thành zero-leak                                                                                                                                                                                                                                                                                                    |
| `verify`                     | `format:check → lint → test → repo:check`, fail-fast; thứ tự là một contract                                                                                                                                           | Windows, WSL, CI `quality-gate`                                                                                                          | bất kỳ stage nào thiếu → gate không được coi là đã chạy                                                                                                                                                                                                                                                                                                                    |

Hai gate quy trình (`Review Convergence Gate`, `Final Quality Gate`) không phải npm script: chúng là verdict của người review, chỉ được nhận giá trị `PASS`/`FAIL`/`NOT RUN` theo `AGENTS.md` §11, và được ghi trong header Active Task của `PLAN.md`.

- Repository check dùng Git cho tracked/staged files và Git whitespace, đồng thời đọc byte của working tree để kiểm tra line ending, trailing whitespace và policy. Secret/credential guard chỉ xét tracked files, với allowlist cho example/template và fixture kiểm thử được khai báo.

Node 24.15.0 đi kèm npm bundled 11.12.1. Trong Codex sandbox, shim npm có thể fallback về bundled npm khi không đọc được user-global npm 12.0.2. Trên Windows, kiểm tra và gọi npm đúng như sau:

```powershell
node --version
& "$env:APPDATA\npm\npm.cmd" --version

$npm = "$env:APPDATA\npm\npm.cmd"
& $npm ci
& $npm run verify
```

## CI and Security workflows (M1/T3)

- `ci.yml` publishes `CI / quality-gate` and `CI / python-quality`; `security.yml` publishes `Security / dependency-audit` and `Security / secret-scan`. Both run for pull requests and pushes to `main` and through `workflow_dispatch`; Security also runs on `0 2 * * 1`.
- `CI / python-quality` is a blocking job and the **only** CI executor of `npm run test:knowledge`. It provisions `actions/setup-python` for Python `3.13`, installs `uv==0.12.0`, runs `uv sync --locked` in `apps/knowledge`, and runs `npm run test:knowledge`. The suite tokenizer is fetched from the pinned bge-reranker-v2-m3 revision and verified against a fixed SHA-256, so the gate cannot silently run against a different tokenizer. The `pdf-runtime` closure is deliberately not installed: it is Linux/x86_64-only and pulls torch/docling, so that suite stays an explicit `NOT RUN` rather than an implied pass. `repo:check` fails the build if this job is missing, reordered, non-blocking, pulls in `pdf-runtime`, or if the Knowledgebase Python suite is executed by any other job or by more than one job.
- `npm run verify` is the fail-fast Node-tier gate (`format:check`, `lint`, `test`, `repo:check`) and deliberately does not include the Knowledgebase Python stage, because every Node/npm job that runs `verify` would otherwise need the Python toolchain. On a host the Python tier is run explicitly with `npm run test:knowledge` or `make test-knowledge`.
- Every Node/npm job runs `actions/setup-node` with Node `24.15.0` and `package-manager-cache: false`, bootstraps npm `12.0.2` from `${{ runner.temp }}`, asserts exact Node/npm versions, and only then runs `npm ci`/`npm run verify` or `npm audit --audit-level=high`. `python-quality` carries the same Node/npm toolchain because it invokes the suite through npm.
- Every external Action is pinned by full 40-character SHA with a release-version comment. Gitleaks uses full history, does not persist checkout credentials and does not create PR comments; it uploads its report as a run artifact so a "zero leaks" claim stays re-inspectable, and it reads the tracked `.gitleaks.toml` configuration (that file is required — `repo:check` fails without it). Security grants only `contents: read` and `pull-requests: read`, the latter being needed to read PR commits.
- `repo:check` parses YAML 1.2 and validates executable `jobs.*.steps`. Comments, metadata, step names, and substrings are never evidence of a workflow contract. Branch protection remains out of scope until checks are stable.

Không sửa `PATH`, không cài lại Node/npm và không thay đổi global toolchain chỉ để xử lý fallback này. CI M1/T3 sẽ provision npm 12.0.2 rõ ràng.

## Generated tree, backup và state directory

- `backups/`, `logs/`, `temp/`, `scratch/` và `.agents/states/*.md` là các **generated tree**: không phải bản ghi chính, không được commit, và không được coi là bản ghi chuẩn nhất.
- **Owner:** `.agents/states/` — working memory của band đang chạy, do agent giữ; `scratch/` — làm việc tạm của agent; `temp/` — sản phẩm tạm của một phiên làm việc; `logs/` — output runtime; `backups/` — snapshot/dump của quá trình backup được owner cho phép.
- **Mức đích:** `.gitignore` khóa theo mẫu `**/backups/*`, `**/logs/*`, `**/temp/*` (không root-anchored), nên một thư mục `backups/`/`logs/`/`temp/` ở dưới bất kỳ module nào cũng không bị stage vào commit. `repo:check` có gate `checkNestedGeneratedTreesIgnored` kiểm tra quy tắc này.
- **Retention:** không được xóa dừng cờ dữ liệu chưa bản ghi chuẩn nhất. `docs/execution/findings.md` là register chính thức; `backups/findings.*.md` chỉ là **snapshot của register**, không phải bản ghi chuẩn nhất — khi hai bản khác nhau, `docs/execution/findings.md` là bản chuẩn. Snapshot trong `backups/` là dữ liệu local: không commit, không in ra báo cáo, và bị xóa theo quyết định của owner.
- **Bảo mật:** `backups/` chứa **script được track tạo ra** và **có digest được ghi lại**. Một file dump đẹn đứng trong thư mục backup là dữ liệu không có provenance — không được xem là bản ghi hợp lệ.

## Secret và dữ liệu cục bộ

- Không commit `.env`, credentials, private key, certificate, token, backup, log, runtime volume hoặc artifact sinh tự động.
- Chỉ commit tên biến và giá trị không nhạy cảm trong `.env.example`. Không copy secret thật vào ví dụ, README, issue, commit message hoặc log.
- Nếu secret bị staged, dừng commit và bỏ nó khỏi staged files. Nếu đã lộ ra remote, revoke/rotate secret ngay, ghi nhận sự cố và xử lý lịch sử repository trước khi tiếp tục phát hành.

## Cập nhật PLAN và CHANGELOG

- `PLAN.md` là nguồn durable task/lifecycle state. `ACTIVE.md` chỉ giữ transient approved implementation details và phải bị xóa khi closeout. Khi bắt đầu hoặc hoàn thành task, cập nhật Current Focus, trạng thái, contract pointer, bằng chứng kiểm chứng, blocker/limitation và next action theo protocol.
- Chỉ đánh dấu task hoặc milestone `COMPLETE` khi mọi Definition of Done và kiểm chứng liên quan đã đạt.
- `CHANGELOG.md` chỉ nhận entry `Added`, `Changed`, `Fixed` hoặc `Security` sau khi task đạt Definition of Done. Không ghi plan, placeholder, empty directory hoặc thay đổi chưa kiểm chứng.
