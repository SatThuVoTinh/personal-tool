# Quy ước phát triển

Tài liệu này quy định cách làm việc với repository Personal Tool. M1/T2 đã thiết lập baseline format, lint, test và repository verification; runtime, CI, database, RAG, AI agent hoặc ứng dụng vẫn chưa được suy diễn là đã tồn tại.

## Git và branch

- `main` là nhánh ổn định và là nhánh mặc định của repository.
- Commit bootstrap đầu tiên được tạo trực tiếp trên `main` để thiết lập repository trống. Sau đó, mỗi task dùng nhánh ngắn hạn theo mẫu `m<milestone>/t<task>-<slug>`, ví dụ `m1/t1-git-github-conventions`.
- Dùng chữ thường ASCII và dấu gạch ngang trong `slug`; không dùng khoảng trắng hoặc tên mơ hồ như `fix` hay `update`.
- Mọi thay đổi sau bootstrap được merge vào `main` qua pull request. Branch protection và required CI chỉ được cấu hình sau khi CI thực sự tồn tại.
- Không force-push vào `main`, không commit trực tiếp secret, binary build output hoặc runtime state.

## Commit

Dùng Conventional Commits theo mẫu `type(scope): summary`.

- `type` là một trong: `feat`, `fix`, `docs`, `test`, `refactor`, `build`, `ci`, `chore`.
- `scope` là lowercase, ngắn và tùy chọn; ví dụ `repo`, `docs` hoặc `knowledge`.
- `summary` dùng động từ mệnh lệnh, ngắn gọn, không có dấu chấm cuối. Ưu tiên dưới 72 ký tự.
- Ví dụ: `chore(repo): establish git conventions`.

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
- Các npm script là `format`, `format:check`, `lint`, `test`, `repo:check` và `verify`. `verify` chạy theo thứ tự fail-fast: format check, lint, test, rồi repository check.
- Repository check dùng Git cho tracked/staged files và Git whitespace, đồng thời đọc byte của working tree để kiểm tra line ending, trailing whitespace và policy. Secret/credential guard chỉ xét tracked files, với allowlist cho example/template và fixture kiểm thử được khai báo.

Node 24.15.0 đi kèm npm bundled 11.12.1. Trong Codex sandbox, shim npm có thể fallback về bundled npm khi không đọc được user-global npm 12.0.2. Trên Windows, kiểm tra và gọi npm đúng như sau:

```powershell
node --version
& "$env:APPDATA\npm\npm.cmd" --version

$npm = "$env:APPDATA\npm\npm.cmd"
& $npm ci
& $npm run verify
```

Không sửa `PATH`, không cài lại Node/npm và không thay đổi global toolchain chỉ để xử lý fallback này. CI M1/T3 sẽ provision npm 12.0.2 rõ ràng.

## Secret và dữ liệu cục bộ

- Không commit `.env`, credentials, private key, certificate, token, backup, log, runtime volume hoặc artifact sinh tự động.
- Chỉ commit tên biến và giá trị không nhạy cảm trong `.env.example`. Không copy secret thật vào ví dụ, README, issue, commit message hoặc log.
- Nếu secret bị staged, dừng commit và bỏ nó khỏi staged files. Nếu đã lộ ra remote, revoke/rotate secret ngay, ghi nhận sự cố và xử lý lịch sử repository trước khi tiếp tục phát hành.

## Cập nhật PLAN và CHANGELOG

- `PLAN.md` là nguồn trạng thái duy nhất. Khi bắt đầu hoặc hoàn thành task, cập nhật Current Focus, trạng thái, bằng chứng kiểm chứng, blocker/limitation và next action trong cùng change set khi phù hợp.
- Chỉ đánh dấu task hoặc milestone `COMPLETE` khi mọi Definition of Done và kiểm chứng liên quan đã đạt.
- `CHANGELOG.md` chỉ nhận entry `Added`, `Changed`, `Fixed` hoặc `Security` sau khi task đạt Definition of Done. Không ghi plan, placeholder, empty directory hoặc thay đổi chưa kiểm chứng.
