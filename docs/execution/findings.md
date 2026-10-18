# findings.md — DANH SÁCH BUG CẦN SỬA

Chủ file: `docs/execution/findings.md`. Đây là register mà `PLAN.md` và các archive contract vẫn gọi bằng tên cũ
`.agents/states/findings.md`; tham chiếu tới tên cũ trong `PLAN.md` §8 và `docs/contracts/execution/archive/` là lịch sử
của **cùng một** register, không phải một file khác. Vị trí mới do chủ quyết: "chuyển sang docs/execution đi"
(2026-10-17). Bản gốc trước khi tái cấu trúc: `backups/findings.pre-reclass-20261017-164726.md` (git-ignored).

**Gate mới:** vì nằm trong glob `docs/**/*.md`, file này bị `markdownlint-cli2` và `prettier --check` kiểm tra.
Sửa xong phải chạy `npm run format:check` và `npm run lint` trước khi commit.

**Quyền hạn:** `AGENTS.md` §2/§6 — được git track **không** nghĩa là có authority; register vẫn chỉ là danh sách việc
phải sửa. `PLAN.md` §4.17 là **disposition authority**, `PLAN.md` §8 và `CHANGELOG.md` là bằng chứng lịch sử của các
bản sửa, `docs/architecture/` và `docs/contracts/` là kiến trúc và hợp đồng đóng băng (file này không thuộc hai mục
đó).

## 0. NỘI QUY — KHỐI NÀY CẤM XÓA

**0.1 Vai trò file.** Đây là danh sách bug cần sửa. Mỗi bug đúng một khối `### F-xxx — <tiêu đề>` với 10 dòng field.
Ngoại trừ khối §0 và §0.4, file không chứa record lịch sử, không chứa proposal cải tiến, không chứa tường thuật phiên
làm việc — mấy thứ đó thuộc `PLAN.md` §8/`CHANGELOG.md`/archive, không thuộc đây.

**0.2 Quy trình bắt buộc với MỖI bug, đúng thứ tự:**

1. **Re-verify premise trước khi sửa.** Mở lại từng locator trong `Evidence:` ở HEAD hiện tại. Register có tuổi; premise
   sai đã giết 8 item ở Wave B và 4 ở Wave C. Defect không còn tồn tại → ghi `Status: REFUTED` kèm bằng chứng, không sửa.
2. **Tái hiện trước khi sửa.** Dựng test đỏ (test-first) hoặc bước probe mô tả đúng defect. Không có test đỏ → không viết
   code sửa. Không dựng được test → dừng và báo chủ, không tự nới acceptance.
3. **Một bug = một commit**, message trỏ `F-xxx` và legacy id. Không tiện tay sửa lan man ngoài bug đang làm.
4. **Sau khi sửa:** chạy hết gate bị ảnh hưởng và **đọc counts từ output của chính lệnh**, không suy ra từ exit code
   (WSL exit 0 kể cả khi test fail; lane Windows xanh không nghĩa là tree live xanh): `npm run verify`,
   `node --test <suite liên quan>`, lane WSL/PostgreSQL/Python khi diff đụng tới, `npm run repo:check`.
5. **Chứng minh test mới bắt đúng bug** bằng mutation probe: phá đúng control vừa thêm, test phải đỏ, rồi revert.
6. **Chỉ được xóa một bug khỏi file khi đủ cả ba:** (a) `CLOSED by <task> <item> (<commit>)`; (b) test đã chạy thật,
   đỏ-trước/xanh-sau, và gate của band không ở trạng thái `NOT RUN`; (c) dòng `Acceptance criteria:` được thỏa đúng nghĩa.
   Trước khi xóa phải ghi disposition vào `PLAN.md` §4.17/§8 **và thêm hàng vào §2 ở đây**. Thiếu một trong ba → **giữ lại**, đổi `Status:`. Số `F-xxx` đã cấp là **vĩnh viễn**: không đánh số lại, không tái sử dụng — xóa thì để lại khoảng trống, còn §1 đếm số hàng đang sống.
7. Không tự đổi `Severity`/`Category` khi chưa có bằng chứng; không hạ cấp để cho qua gate.
8. **Bug mới phát hiện trong khi sửa** → thêm ngay một khối `F-xxx` mới, `Status: OPEN`, không sửa nhân tiện. Thay đổi
   chạm kiến trúc/phạm vi là RED: dừng ở biên an toàn nhất và báo chủ (`AGENTS.md` §7).
9. `Status: EXCLUDED` / `BLOCKED` / `REFUTED` / `PARTIAL` không phải việc chưa làm: đó là quyết định của chủ hoặc premise
   đã bị bác. Không sửa cho tới khi chủ mở lại; thư từ `p1`/`r2`/`s1`/`t1` và các `H1`–`H11` là quyết định.
10. **File này không cấp quyền sửa code.** Quyền nằm ở `PLAN.md` (approval + execution authorization) và
    `docs/contracts/execution/ACTIVE.md` hợp lệ.

**0.3 Từ vựng `Status:`.** `OPEN` đã xác minh, chưa sửa · `LATENT` code-proven nhưng chưa cháy live ·
`HYPOTHESIS` cần xác minh · `PARTIAL` đã sửa một phần (phần còn vẫn mở) · `BLOCKED` thiếu bằng chứng/môi trường ·
`EXCLUDED` chủ gạt ra khỏi band · `REFUTED` premise sai, không phải bug.

**0.4 Bảng phân loại (dùng cho dòng `Category:`).**

| ID  | Nhóm lỗi                            | Nghĩa                            | Ví dụ                                                                                                 |
| --- | ----------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| F1  | Logic & Functional Bugs             | Lỗi logic, sai chức năng         | Kết quả tính sai, điều kiện xử lý sai, workflow chạy sai quy tắc                                      |
| F2  | Security & Authorization            | Lỗi bảo mật và phân quyền        | Vượt quyền agent, bypass approval, thoát sandbox, rò rỉ dữ liệu                                       |
| F3  | State & Lifecycle Integrity         | Lỗi trạng thái và vòng đời       | Sai task_id/run_id, ledger không nhất quán, task bị treo, chuyển trạng thái sai                       |
| F4  | Integration & Contract Violations   | Lỗi tích hợp và vi phạm hợp đồng | Discord–OpenClaw không tương thích, schema lệch nhau, tool trả dữ liệu sai định dạng                  |
| F5  | Data Integrity & Result Correctness | Lỗi toàn vẹn dữ liệu và kết quả  | Embedding/index lỗi thời, mất nguồn gốc dữ liệu, artifact giả hoặc kết quả không khớp dữ liệu         |
| F6  | Reliability & Performance           | Lỗi độ tin cậy và hiệu năng      | Retry lỗi, race condition, timeout, rò rỉ tài nguyên, phục hồi thất bại                               |
| F7  | Testing & Verification Gaps         | Thiếu kiểm thử và xác minh       | Thiếu regression test, assertion yếu, mock không phản ánh thực tế, kiểm tra không đủ để phát hiện lỗi |

Quy tắc áp dụng: `Category` lấy theo **bản chất lỗi**, không theo file chứa nó. `cat` cũ của register ánh xạ:
security/authorization → F2; lease·lifecycle·ledger state → F3; contract/schema/doc-bắt-sai-thực-tế → F4;
provenance·digest·index·artifact·data loss → F5; retry·race·timeout·perf → F6; test/gate/assertion yếu → F7; còn lại
sai chức năng hoặc logic nghiệp vụ → F1.

## 1. hiện trạng queue

Tổng **259** bug đang mở/đang chờ, chia theo nhóm:

| Nhóm     | Nội dung                                                              | Bug     | Critical | High | Medium | Low | Ungraded |
| -------- | --------------------------------------------------------------------- | ------- | -------- | ---- | ------ | --- | -------- |
| F1       | Logic & Functional Bugs — Lỗi logic, sai chức năng                    | 20      | 0        | 5    | 8      | 5   | 2        |
| F2       | Security & Authorization — Lỗi bảo mật và phân quyền                  | 41      | 3        | 19   | 15     | 4   | 0        |
| F3       | State & Lifecycle Integrity — Lỗi trạng thái và vòng đời              | 55      | 2        | 21   | 25     | 5   | 2        |
| F4       | Integration & Contract Violations — Lỗi tích hợp và vi phạm hợp đồng  | 43      | 0        | 18   | 21     | 4   | 0        |
| F5       | Data Integrity & Result Correctness — Lỗi toàn vẹn dữ liệu và kết quả | 41      | 1        | 15   | 22     | 3   | 0        |
| F6       | Reliability & Performance — Lỗi độ tin cậy và hiệu năng               | 19      | 0        | 4    | 13     | 2   | 0        |
| F7       | Testing & Verification Gaps — Thiếu kiểm thử và xác minh              | 40      | 0        | 10   | 26     | 4   | 0        |
| **Tổng** |                                                                       | **259** | 6        | 92   | 130    | 27  | 4        |

Theo trạng thái: OPEN 214 · EXCLUDED 12 · LATENT 15 · REFUTED 8 · PARTIAL 5 · HYPOTHESIS 4 · BLOCKED 1.

Hai lần cập nhật trong ngày 2026-10-17, ghi lại để arithmetic không bị hiểu là số của vòng audit: `F-038`/`R6-HUNT-01`
đi từ OPEN xuống PARTIAL sau phép đo dưới grant `e`; lượt duyệt `b2` sau đó xóa 5 hàng (4 hàng đóng bằng commit + test
chạy lại, 1 hàng trùng id), đổi 5 hàng sang REFUTED vì premise bị đo chết, và điền chữ thật vào 59 cặp field của nhóm
Critical/High.

Vòng audit R7 (2026-10-17 → 2026-10-18, delta) thêm 46 hàng `F-225`–`F-270`, `Legacy register id` theo assignment
`R7-D1`–`R7-D13`, gồm hai đợt; đối chiếu cuối vòng (`D9`) rút lại **6** hàng trùng root cause với hàng đã có
(`F-231`/`F-232`/`F-233` → F-125, `F-246` → F-059, `F-256` → F-166, `F-270` → F-205) và viết lại **11** hàng khác vì
severity hoặc premise của chúng không đứng ở HEAD (`F-226`, `F-228`, `F-229`, `F-234`, `F-242`, `F-248`, `F-249`, `F-251`,
`F-252`, `F-262` — hàng này bị refuted một nửa rồi ghi lại hẹp hơn, `F-269`). Net vòng delta để lại **40** hàng.

Hai đợt mở đúng những vùng mà sáu vòng trước chưa từng trích: đợt đầu (D1–D7, `F-225`–`F-241`) vào 13 schema
`zink-tools/contracts/**`, package `apps/knowledge/pdf-runtime`, script của `infrastructure/**`, policy JSON + contract
schema của `integrations/openclaw/topology/**`, provider adapter và các file config mồ côi; đợt hai (D8, D10A/B, D11A/B,
D12A/B, D13, `F-242` trở đi) phủ chính xác những gì đợt một tự khai ở mục "chưa inspect" trong report của nó — `guard.mjs`
đọc trọn file, `authority.mjs`, `database.py`/`config.py`/`main.py` của Knowledgebase, các surface trong
`integrations/openclaw/lib/`, 12 contract schema của topology đối chiếu reducer, census nhánh skip của 122 file test, và
toàn bộ script `.ps1`/`.sh` của `infrastructure/docker/scripts/`. Mở không có nghĩa là ra hàng: dedupe theo root cause đã
thưa nhiều claim về hàng cũ, và đọc mà không thấy lỗi thì register không có gì để ghi.

Số đo phủ, đo lại bằng `temp/coverage-probe3.mjs` trên `git ls-files` (300 file nguồn bị track): **113/300** trước vòng,
**160/300** sau vòng. Hai con số 99/300 → 137/300 ghi ở bản trước của đoạn này là **sai và bị rút**: predicate đo liệt kê
`js` trước `json` trong nhóm phần mở rộng, nên mọi path `.schema.json` bị cắt thành `.schema.js` và không khớp file tracked
nào. Vùng vẫn chưa có hàng tính theo path được trích: `tests` 69/122, `apps/knowledge` 29/48 (kể cả 7 file
`pdf-runtime/src`), `infrastructure/docker` 10/21, `zink-tools/contracts` 9/13, `zink-tools/adapters` 8/12 — vòng delta vì
vậy **chưa complete**, và đó là phần còn lại nếu chủ cho chạy tiếp. Mọi hàng của cả hai đợt đều được Lead tự mở lại
locator ở HEAD trước khi ghi; các claim không tự kiểm chứng được thì không ghi.

`R7-D*` là id **của vòng delta 2026-10-17**, không tra được về register sáu vòng (id `R7-` duy nhất ở đó là `R7-GATE-01`,
đã đóng ở §2). Xuất xứ, phán quyết của chủ cho vòng đó, và kết quả đọc lại cả 17 locator ở HEAD: `PLAN.md` §8, record
`the 17 rows this record under-counted`. Cả 17 hàng đều đã được phiên này tự kiểm tra lại path và khoảng dòng trước khi giữ.

Còn **40** bug chưa có `Acceptance criteria` (32 Medium, 6 Low, 2 Ungraded) và **73** bug chưa có bước tái hiện (62
Medium, 10 Low, 1 Ungraded) đo lại trên 259 hàng sau vòng R7; bản trước ghi 91 bug thiếu bước tái hiện, số đó giảm vì mọi
hàng R7 đều mang hai field này. Toàn bộ nằm ở nhóm Medium/Low/Ungraded, tức phần `b2` chưa chạy tới. Ngoặc "(47/110 trước
lượt `b2-m1…m3`)" của bản trước bị rút: 110 là số hàng còn thiếu ở một thời điểm đo, 47 là số hàng một lượt khác báo đã
điền, hai con số không cùng một phép đo nên không đặt cạnh nhau được. 23 bug vẫn lấy root cause từ chính kết luận ở tiêu
đề — con số của lượt `b2`, chưa đo lại. Đó là
nợ quy trình của vòng audit (audit chỉ đọc, không chạy tái hiện), không phải lỗi của hàng đợi: bug nào thiếu thì bước 1 và
bước 2 của nội quy mục 0.2 là bắt buộc.

File này được tái cấu trúc ngày 2026-10-17 từ register audit sáu vòng. Mỗi hàng giữ `Legacy register id` để
`PLAN.md` §4.17/§11 và các contract archive vẫn tra được về id cũ.

## 2. Bug đã sửa xong + đã kiểm chứng bằng test — đã xóa khỏi danh sách này

48 entry được xóa vì đủ ba điều kiện ở nội quy mục 0.2, khoản 6 — 43 ở lượt tái cấu trúc 2026-10-17 và thêm 5 ở lượt
duyệt lại `b2` cùng ngày (4 hàng đóng bằng commit + test chạy lại tận mắt, 1 hàng trùng id). Mỗi commit trong bảng đã được
đối chiếu bằng `git rev-parse --verify <hash>^{commit}` (39 hash, 0 lỗi) và `git merge-base --is-ancestor <hash> HEAD`.
Mức bằng chứng test không đồng đều, ghi rõ ở đây
để anh không phải đoán: các item `T2.1-*`, `A-*`, `B-*`, `R3-*`, `C-4`, `C-9`, `C-13`, `B-19` có test đỏ-trước/xanh-sau
và mutation probe ghi trong `PLAN.md` §8; sáu item tài liệu của Wave C (`C-1`, `C-2`, `C-3`, `C-5`, `C-6`, `C-7`)
đóng bằng "full gate xanh tại commit của chính item" (`npm run verify` + `repo:check` + re-measure §6.7) chứ không có
probe riêng. Lane live Discord vẫn `NOT TESTED` với mọi hàng ở đây, theo `PLAN.md` §2.

| Legacy id         | Đóng bởi — bằng chứng                                                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `R1-A04-01`       | M12/T2.2-R1 A-1 (ccf2ad7) — test-first 9/9, adjacent 66/66, WSL lane run                                                                                                                                        |
| `R1-A04-05`       | M12/T2.2-R1 A-2 (09aa698)                                                                                                                                                                                       |
| `R1-A04-06`       | M12/T2.2-R2 B-8 (a21c610)                                                                                                                                                                                       |
| `R1-A05-01`       | M12/T2.2-R2 B-10 (46852f3)                                                                                                                                                                                      |
| `R1-A02-04`       | M12/T2.2-R2 B-10 (46852f3) — same defect as `R1-A05-01`, filed twice; closed by the shipped test 'delivers the card as text when the component build itself throws' (re-run 2026-10-17: suite 12 pass / 0 fail) |
| `R1-A09-01`       | M12/T2.2-R2 B-10 (46852f3) — the by-elimination confirmation of `R1-A05-01`; same commit, same test, re-run green 2026-10-17                                                                                    |
| `R1-A13-03`       | M12/T2.2-R2 B-16 (5c156d4) — that commit message names `R1-A13-03`; tests/m12-t2.2-b16-denial-reason re-run 2026-10-17, combined with the registry suite: 19 tests / 19 pass / 0 fail                           |
| `R1-A08-08`       | M12/T2.2-R2 B-7 (6f3c970)                                                                                                                                                                                       |
| `R1-A12-07`       | M12/T2.2-R2 B-16 (5c156d4) — red-before 6/7, green-after 7/7, three mutation probes                                                                                                                             |
| `R1-A14-01`       | M12/T2.1 T2.1-6 (b3affc2) — B7-1/B7-2/B7-3                                                                                                                                                                      |
| `R1-A14-02`       | M12/T2.1 T2.1-6 (b3affc2) — B7-1/B7-2/B7-3                                                                                                                                                                      |
| `R5-E01-03`       | M12/T2.2-R2 B-13 (7bc3e5d)                                                                                                                                                                                      |
| `R5-E02-05`       | M12/T2.1 T2.1-7 (b7497ca) — test_retrieval.py, PDF row with a NULL page pair                                                                                                                                    |
| `R5-E04-03`       | M12/T2.1 T2.1-2 (2e7da50) — R22-08/R22-09, stat-based                                                                                                                                                           |
| `R5-E04-02`       | M12/T2.2-R3 R3-2 (812b8ec) — that commit says 'Closes R5-E04-02'; tests/m8-t3-governed-memory-learning re-run 2026-10-17 → 47 tests / 47 pass / 0 fail incl. T2h                                                |
| `R5-E05-04`       | M12/T2.2-R3 R3-7 (1bab75d) — shape test + scratch real-PostgreSQL run; two of its clauses were refuted at the pre-freeze read                                                                                   |
| `R5-E05-06`       | M12/T2.3-R1 C-9 (8bde65f, re-scoped) — red-before, 2/2 after, WSL lane 2/2                                                                                                                                      |
| `R5-E06-03`       | M12/T2.1 T2.1-3 (c4833e6) — stub HTTP service + marker scan; acceptance divergence recorded in PLAN.md §8                                                                                                       |
| `R5-E06-04`       | M12/T2.1 T2.1-4 (710f650) — real engine, marker scan, ETIMEDOUT shape observed                                                                                                                                  |
| `R5-E06-07`       | M12/T2.1 T2.1-1 (96a6dd2) — B6-4 + mutation probe                                                                                                                                                               |
| `R5-E07-02`       | M12/T2.2-R2 B-6 (3701804)                                                                                                                                                                                       |
| `R5-E07-03`       | M12/T2.2-R2 B-5 (b7d9d36)                                                                                                                                                                                       |
| `R5-E08-01`       | M12/T2.2-R2 B-2 (c449cd0)                                                                                                                                                                                       |
| `R5-E08-02`       | M12/T2.1 T2.1-8 (ba5ff08) — four driver gates; the residual host-evidence half stays open as R6-I01-03                                                                                                          |
| `R5-E08-03`       | M12/T2.2-R2 B-1 (a108cde)                                                                                                                                                                                       |
| `R5-E08-04`       | M12/T2.2-R2 B-3 (d34c666)                                                                                                                                                                                       |
| `R5-E10-03`       | M12/T2.2-R2 B-17 (0dddea4)                                                                                                                                                                                      |
| `R5-E11-02`       | M12/T2.3-R1 C-3 (e47e660, narrowed scope)                                                                                                                                                                       |
| `R5-E11-03`       | M12/T2.3-R1 C-1 (3685548)                                                                                                                                                                                       |
| `R5-E11-04`       | M12/T2.3-R1 C-4 (68fe25b + review fix cd1b541) — three mutation probes, WSL 12/12 twice                                                                                                                         |
| `R5-E11-05`       | M12/T2.3-R1 C-5 (0ccdd81)                                                                                                                                                                                       |
| `R5-E11-06`       | M12/T2.3-R1 C-6 (5e798aa)                                                                                                                                                                                       |
| `R5-E11-07`       | M12/T2.3-R1 C-2 (3248f60)                                                                                                                                                                                       |
| `R5-E12-04`       | M12/T2.3-R1 C-13 (d9e1bcc) — 35/35 policy tests + two real-tree probes                                                                                                                                          |
| `R5-E13-06`       | M12/T2.1-R3 owner answer A (91d788d) — the recovery report now states presence only; verified in tree at integrations/openclaw/topology/fixtures/runtime-regression/operator-lock-recovery.mjs:147              |
| `R5-E14-01`       | M12/T2.3-R1 C-7 (a4ed77d, re-scoped by location)                                                                                                                                                                |
| `R5-E14-05`       | M12/T2.2-R2 B-15 (7aebc39)                                                                                                                                                                                      |
| `R5-E16-01`       | M12/T2.2-R1 A-3 (d1378ba) + M12/T2.2-R2 B-12 (f93068e) — new lock/temp test file 203 lines                                                                                                                      |
| `R5-E16-02`       | M12/T2.2-R1 A-3 (d1378ba) + M12/T2.2-R2 B-12 (f93068e)                                                                                                                                                          |
| `R5-E16-03`       | M12/T2.2-R2 B-11 (937521c)                                                                                                                                                                                      |
| `R6-I01-01`       | M12/T2.1-R3 (ad4a8d6) — the skip that this defect caused now runs; Python lane 142 passed / 6 skipped                                                                                                           |
| `R6-I01-02`       | M12/T2.1-R3 owner answer A (91d788d) — assertion re-valued to a presence constant; disabling the omission reddens it                                                                                            |
| `R7-GATE-01`      | M12/T2.2-R2 B-19 (9fa6505) — gate now asserts heartbeats >= 1 (liveness) instead of tick rate; verified in tree                                                                                                 |
| `R1-A12-07-BLOCK` | narrative blocker for R1-A12-07; resolved when B-16 landed (5c156d4)                                                                                                                                            |
| `R5-E01-01`       | duplicate of R5-E02-01 (canonical row kept as the R5-E02-01 successor)                                                                                                                                          |
| `R1-A13-05`       | duplicate of R1-A12-03 (canonical row kept)                                                                                                                                                                     |
| `R1-A16-04`       | duplicate of R1-A09-02 and R1-A05-01                                                                                                                                                                            |
| `R6-CFG-03`       | duplicate of `R1-A04-01` (closed by A-1 ccf2ad7; tests/m12-t2.2-a1-stack-authority re-run 2026-10-17 → 9 pass / 0 fail)                                                                                         |

Bốn entry khác xóa vì là bản trùng (`R5-E01-01` → `R5-E02-01`, `R1-A13-05` → `R1-A12-03`,
`R1-A16-04` → `R1-A09-02`/`R1-A05-01`, và `R6-CFG-03` → `R1-A04-01` phát hiện ở lượt `b2`);
`R1-A12-07-BLOCK` là record blocker của `R1-A12-07`, đã gỡ khi `B-16` (`5c156d4`)
land. 51 proposal Vòng 3 (`R3-P01-*` … `R3-P06-*`) không thuộc file bug queue; thiết kế remediation của chúng nằm trong
contract archive và `PLAN.md`.

Hai residual không bị xóa theo: `R5-E08-02` đóng ở `T2.1-8` nhưng nửa "đường dẫn POSIX được dùng làm bằng chứng host"
sống tiếp dưới hàng `R6-I01-03` (PARTIAL), và `R1-A10-07` vẫn là hàng mở vì chỉ nửa coverage đóng ở `9c7af0f` — ba defect
nó che vẫn còn.

Các hàng `REFUTED`, `EXCLUDED`, `BLOCKED`, `PARTIAL` ở danh sách dưới đây không phải việc chưa làm; giữ lại để band sau
không nộp lại một premise đã bị bác hoặc một việc chủ đã gạt. Dọn chúng khỏi file là quyết định của anh, không của agent.

---

### F-002 — two decision/queue stores with two roots, and a load-once in-memory singleton used as live authority

- Category: F1 — Logic & Functional Bugs
- Legacy register id: `R1-A02-07`
- Affected modules: OpenClaw runtime libs
- Severity: High
- Status: OPEN · premise changed 2026-10-17: drift: homedir defaults now decision-ledger.mjs:42-52 and queue-manager.mjs:142-146 (were :25-35 / :112-118); the cited 'queue mutation bypassing withLock at :5658-5660' is now inside withLock (commit d1378ba), so that sub-symptom is remedi
- Root cause: ASK_USER can re-ask a question the owner already decided; a second process's save silently replaces the first's whole decision set (the lock serialises, it does not reload).
- Evidence: Where: lib/decision-ledger.mjs:25-35 and lib/queue-manager.mjs:112-118 (identical os.homedir() defaults) vs configured ledgerRoot (lib/policy.mjs:990-994); readers/writers index.mjs:2066-2070 (ASK_USER), :1279-1291 (owner confirm), :666 (defaultDecisionLedger), :5658-5660 (direct defaultQueueManager.queue mutation + save() bypassing withLock) · Evidence: read path is paths?.root ? new DecisionLedger(…) : defaultDecisionLedger; the write path derives from config.ledgerRoot — two different files. Live: ~/.openclaw-zink/task-queue.json mtime Sep 26 while the configured ledger is Oct 14; decision-ledger.json exists at neither root. The singleton's decisions Map is loaded once at import (decision-ledger.mjs:207,666) and rewritten whole-file (:238-295).
- Reproduction: Gate in a persistence test (idiom of tests/m7-lane-h5-persistence-deps.test.mjs): instantiate the defaultDecisionLedger (os.homedir root) and a DecisionLedger rooted at config.ledgerRoot, write a decision through the config-root writer, read it via the default singleton and assert not-found — proving two roots; then show the singleton's Map is populated once by the constructor load() (decision-ledger.mjs:223) and rewritten whole-file. The live mtime divergence needs the deployed WSL home.
- Acceptance criteria: One configured ledger/queue root governs both reads and writes, the process never falls back to an os.homedir() default, and no live authority is a singleton whose Map is filled at import — every read reflects durable on-disk state.
- Related findings: nguồn: A02 — module dependencies, shared components and duplication

### F-003 — #incidents can never post: the dedupe read uses a Discord endpoint that does not exist

- Category: F1 — Logic & Functional Bugs
- Legacy register id: `R1-A09-03`
- Affected modules: OpenClaw runtime libs, OpenClaw integration
- Severity: High
- Status: OPEN
- Root cause: non-2xx → throw → INCIDENT_SURFACE_SKIPPED … cause=THREAD_LIST_UNREADABLE → return null before any POST, by design ("a blind post is how a duplicate incident gets made"). Governance containments therefore never reach #incidents at warn level, while PLAN.md credits #incidents with its "first publish path".
- Evidence: Where: integrations/openclaw/lib/discord-forum-tags.mjs:135-162 (readActiveForumThreads), used at index.mjs:5140-5152 · Evidence: `https://discord.com/api/v10/channels/${channelId}/threads/active` — Discord exposes active threads as GET /guilds/{guild.id}/threads/active (channel-scoped listing is /channels/{id}/threads/public), yet the code parses body.threads.
- Reproduction: one read-only GET of both URLs with the main bot token, compare status.
- Acceptance criteria: a real incident produces exactly one tagged thread.
- Related findings: nguồn: A09 — Discord and external integrations

### F-004 — two plugin config keys are read but unreachable by configuration, killing skill approval and the guild gate

- Category: F1 — Logic & Functional Bugs
- Legacy register id: `R1-A09-05`
- Affected modules: OpenClaw governance plugin (Discord), OpenClaw runtime libs
- Severity: High
- Status: OPEN
- Root cause: every Approve-skill click answers ⛔ … APPROVAL_DECISION_REF_REQUIRED (Reject works); the WRONG_GUILD boundary is dead code, so guild isolation rests only on owner-snowflake equality.
- Evidence: Where: index.mjs:8342 (decisionRef: config.skillApprovalDecisionRef), :7555 (discordGuildId: config.discordGuildId); plugins/zink-governance/openclaw.plugin.json configSchema (additionalProperties:false); template lib/policy.mjs:989-1009 · Evidence: the written plugin config carries only ledgerRoot, ownerDiscordId, discord*, enabled; neither key exists in the template or the schema. :929-932 throws APPROVAL_DECISION_REF_REQUIRED; lib/authority.mjs:1069 if (configuredGuildId && …) never fires with undefined.
- Reproduction: Add to tests/m10-t2-r10-production-policy-load.test.mjs: load the built plugin config and assert it declares skillApprovalDecisionRef and discordGuildId. It fails today: openclaw.plugin.json:22-44 sets additionalProperties:false and lists neither key, and policy.mjs:991-1009 never emits them, so index.mjs:8359 throws APPROVAL_DECISION_REF_REQUIRED and the guild gate at :7572 (authority.mjs:1076) sees undefined. grep confirms skillApprovalDecisionRef appears once repo-wide, as a read that is never written.
- Acceptance criteria: Every config key the plugin reads is declared in configSchema and emitted by the policy template, so skill approval receives a real decisionRef and the guild gate receives a discordGuildId that can actually deny a cross-guild action.
- Related findings: nguồn: A09 — Discord and external integrations

### F-005 — M12/T2-R1's "one honest tag per category" rule caused the live approval outage; R3 reverted it for STACK only — the same rule still sits at the RISK/TYPE/STATUS siblings

- Category: F1 — Logic & Functional Bugs
- Legacy register id: `R1-A13-01`
- Affected modules: OpenClaw runtime libs, OpenClaw integration
- Severity: High
- Status: OPEN
- Root cause: the outage class the owner reported is not closed, it moved to two other categories.
- Evidence: Where: integrations/openclaw/lib/discord-forum-tags.mjs:330-350 (approvalRiskTag), :399-411 (resultStatusTag), :445-470 (resultTypeTag); callers index.mjs:265-309, :5057 · Evidence: c680a28 added if (distinct.length !== 1) return null; 0b55dfa deleted it for STACK only. A category that cannot be derived is pushed to absent → posted:false → APPROVAL_CARD_NOT_SURFACED (index.mjs:6769). · Detail: resultStatusTag returns null for outcome_status FAILED/BLOCKED (topology/contracts/ledger-event.schema.json:1481) while the only caller hardcodes decision:"ACCEPT" (index.mjs:298) — an accepted-but-failed result never opens #results; resultTypeTag has no entry for main/o1/o2.
- Reproduction: resultTagSelectionsFor({root_result:{outcome_status:"FAILED"},nodes:[{agent_id:"o1"}]}, []); grep live journal for DISCORD_TAG_UNRESOLVED category=RISK|TYPE.
- Acceptance criteria: no reachable policy/ledger combination can silently cancel a governed post.
- Related findings: nguồn: A13 — Git history and cross-milestone regressions (21…

### F-008 — two declared skill-search filters can never match: secondary_topics is always empty and the primary_topic check is a no-op

- Category: F1 — Logic & Functional Bugs
- Legacy register id: `R1-A10-06`
- Affected modules: Zink Skill Store, Zink Tools
- Severity: Medium
- Status: OPEN · premise changed 2026-10-18: all three locators drifted; the defect is unchanged. The no-op taxonomy check is `zink-tools/common/semantic-contract.mjs:417-424` (not `skill-adapter.mjs:531-539`), `canonicalSecondaryTopics = []` is `zink-skill-store/src/vector-sync.mjs:6
- Root cause: any request using the contract-declared secondary_topics filter returns NO_MATCH even when the skill exists, indistinguishable from "no such skill"; unknown primary_topic values pass to SQL and also return NO_MATCH — silent false negatives fed to the agent.
- Evidence: Where: zink-skill-store/src/vector-sync.mjs:684 (canonicalSecondaryTopics = []); skill-adapter.mjs:531-539; zink-tools/common/semantic-contract.mjs:391-395 · Evidence: the taxonomy check is literally void knownTopics.includes(metadataFilters.primary_topic); — computed and discarded, commented "Non-fatal … not exposed".
- Reproduction: Static, then one assertion in `tests/m8-t1-skill-vector-memory.test.mjs` (it already imports `prepareQueryEmbedding` and exercises `secondary_topics`). Measured at HEAD: `zink-skill-store/src/vector-sync.mjs:685` sets `const canonicalSecondaryTopics = [];` with the comment that canonical manifests have no `metadata` key, and passes it as `tags` to `deriveSemanticMetadata`, so `c.secondary_topics` is written empty for every skill; `zink-tools/common/semantic-contract.mjs:389-395` still forwards a caller's `secondary_topics` into `metadataFilters`, and `skill-adapter.mjs:548-556` turns it into `c.secondary_topics && ARRAY[...]::text[]` — an overlap test against a column that is always `{}`, so the filter can only ever remove rows. Assert that a search carrying a `secondary_topics` filter returns the same rows as the same search without it. Second half: `semantic-contract.mjs:417-424` computes `const knownTopics = Object.values(KNOWN_TAXONOMY_MAP).map((t) => t.primary_topic);` and then discards it with `void knownTopics.includes(metadataFilters.primary_topic);`, its own comment saying the result is not exposed — assert that an unknown `primary_topic` is either rejected or reported, not silently accepted.
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "two declared skill-search filters can never match: secondary_topics is always empty and the primary_topic check is a no-op", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: adjudication Vòng 2: Verified · nguồn: A10 — Zink Tools, adapters and execution contracts

### F-009 — 0b55dfa silently changed #incidents tag semantics without touching index.mjs; the call-site comment still states the reverted rule

- Category: F1 — Logic & Functional Bugs
- Legacy register id: `R1-A13-02`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: Medium
- Status: OPEN
- Root cause: Register kết luận: 0b55dfa silently changed #incidents tag semantics without touching index.mjs; the call-site comment still states the reverted rule. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: Where: index.mjs:321-343 (incidentTagSelectionsFor); git show --stat 0b55dfa · Evidence: the comment still claims a two-stack containment "reports unresolved and the thread is not opened"; surfaceStackTag({currentStack:null, nodeStackIds:["data_plant","intelligence"]}) now returns ANALYTICS (discord-forum-tags.mjs:381-391), and which task decides the tag depends on list order.
- Reproduction: no test passes more than one task (tests/m12-t2-governed-surface.test.mjs:464, 477).
- Acceptance criteria: The comment at index.mjs:321-324 and surfaceStackTag agree: either a two-stack containment really reports unresolved and opens no thread, or the comment states the precedence rule the function implements, and one test pins which task's stack wins when more than one is present.
- Related findings: nguồn: A13 — Git history and cross-milestone regressions (21…

### F-010 — skill-loop actor identity is re-derived a third way; the durable proposal records a constant, not the agent

- Category: F1 — Logic & Functional Bugs
- Legacy register id: `R1-A16-08`
- Affected modules: Zink Tools
- Severity: Medium
- Status: OPEN — _(third member of the payload-vs-context identity family with R1-A04-08 and R1-A10-04)_ · premise changed 2026-10-18: two locators drifted: the model-supplied destructure is `skill-adapter.mjs:774-781` (not `:757-764`) and the identity fallback is `:902-903` (not `:885-886`); `index.mjs:3449-3454`, `:3745-3746` and `:1113` all still hold
- Root cause: the owner approves a skill whose recorded proposer is the constant "specialist"; retrieval correlation is unlinkable to any run. M8-061 is asserted only at the wrapper (index.mjs:4194-4199).
- Evidence: Where: zink-tools/adapters/skill-store/skill-adapter.mjs:757-764 (requesting_agent from model input), :885-886 (requesting_agent || context?.agentId || "specialist"); the plugin ctx supplies requestingAgent, never agentId (index.mjs:3449-3455), so the trusted fallback is dead by key mismatch; consumers index.mjs:3745-3746, canonical stamp :1113
- Reproduction: Static, then gate it in `tests/m7-t5-remediation.test.mjs`, which already drives `executeGovernedSkillQuery`. Measured at HEAD: `skill-adapter.mjs:774-781` destructures `requesting_agent` straight out of the model-supplied `input`, and `:902-903` stamps the durable proposal with `requesting_agent: requesting_agent || context?.agentId || "specialist"`. The trusted fallback is dead by key mismatch — the plugin builds its context at `index.mjs:3449-3454` as `{ sessionKey, runId, taskId, requestingAgent: deriveTrustedRequester(_id) }`, so `context.agentId` is always `undefined` and a payload that omits the field records the literal string `specialist` instead of the real agent. Downstream, `index.mjs:3745-3746` prefers the proposal's own value over the trusted `ctx.requestingAgent`, and `:1113` writes `requestingActor: stored.requesting_agent ?? "unknown"` into the canonical provenance stamp. Call `propose` with a payload whose `requesting_agent` names a different agent than the trusted context and assert the recorded proposal carries the context's identity; then call it with the field omitted and assert the record is not `specialist`.
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "skill-loop actor identity is re-derived a third way; the durable proposal records a constant, not the agent", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: adjudication Vòng 2: Verified with correction, raised to High · bug mở: R1-A04-08, R1-A10-04 · nguồn: A16 — independent end-to-end traceability

### F-011 — the Discord channel plugin path is pinned by a hardcoded install content-hash

- Category: F1 — Logic & Functional Bugs
- Legacy register id: `R2-B08-04`
- Affected modules: OpenClaw host install (npm)
- Severity: Medium
- Status: OPEN · premise changed 2026-10-18: the file is `integrations/openclaw/topology/lib/native-patch.mjs`, not `integrations/openclaw/lib/native-patch.mjs`; `:169` does not reference the constant (it is `return path.join(root, "dist", file);`), and the two in-file consumers are `
- Root cause: a plugin reinstall/upgrade that changes the hashed directory name turns inspect/apply/verify into NATIVE_SOURCE_DRIFT on a supported runtime version.
- Evidence: Where: native-patch.mjs:122-123 (npm/projects/openclaw-discord-c0892df945/…), used at :169, :889-896, :906-925; comment :854-896 claims derivation from the pins · Evidence: (live match today)
- Reproduction: Static, and gate it where the constant is already imported: `tests/m10-t2-r8-preflight-lineage.test.mjs:90` asserts only `NATIVE_DISCORD_CHANNEL_RELATIVE.includes("@openclaw/discord")`, which a stale install slug satisfies. Measured at HEAD: `native-patch.mjs:122-123` hardcodes `export const NATIVE_DISCORD_CHANNEL_RELATIVE = "npm/projects/openclaw-discord-c0892df945/node_modules/@openclaw/discord";` while the comment directly above it at `:118-121` claims it is "the single source of truth for the executing tree" from which "the patch roots, the snapshot relatives and the operator fixtures all derive". `grep -rn NATIVE_DISCORD_CHANNEL_RELATIVE --include="*.mjs"` shows the slug `c0892df945` reaching `native-patch.mjs:894` and `:914` (snapshot relatives), plus `operator-apply.mjs:45`, `operator-rollback.mjs:54` and `live-governance-probe.mjs:44`, so one npm reinstall that changes the install directory silently repoints the patch root, the snapshot set and all three operator commands together. Assert the relative is resolved from the live install tree, or that a mismatch between it and the tree is a named refusal rather than a wrong path.
- Acceptance criteria: resolve the channel root from the installed-plugin manifest, or refuse with a named code.
- Related findings: nguồn: B08 — adversarial independent audit (attempted refutation…

### F-012 — a caller that disables rerank for latency gets an unfiltered page whose "scores" are meaningless against any 0-1 threshold, and cannot distinguish low-confidence hits from filtered ones

- Category: F1 — Logic & Functional Bugs
- Legacy register id: `R5-E02-03`
- Affected modules: Zink Knowledgebase
- Severity: Medium
- Status: OPEN
- Root cause: a caller that disables rerank for latency gets an unfiltered page whose "scores" are meaningless against any 0-1 threshold, and cannot distinguish low-confidence hits from filtered ones. The M11/T1-R1 fix (comment :452-455) removed a false-emptying behaviour by gating on reranked instead of separating score semantics — i.e. the fix traded one defect for this one.
- Evidence: Where: main.py:451-457 (min_score gate), :414, :430 · Evidence: if reranked and request.min_score is not None: — with rerank: false the threshold is never applied and nothing rejects the combination (:79 declares min_score nullable). The same branch sets raw_scores = [item.rrf_score for item in fused_candidates] yet emits it as "rerank_score".
- Reproduction: Register chưa có bước tái hiện riêng; bước gần nhất suy từ acceptance/remediation: the response never labels a non-reranker number as a rerank score, and an unenforceable threshold is refused.
- Acceptance criteria: the response never labels a non-reranker number as a rerank score, and an unenforceable threshold is refused.
- Related findings: nguồn: E02 — Knowledgebase retrieval, provenance and citations (7…

### F-013 — node -e comparing deriveSemanticMetadata({}) with deriveSemanticMetadata({namespace:"general"}) — only resolved_namespaces differs

- Category: F1 — Logic & Functional Bugs
- Legacy register id: `R5-E07-01`
- Affected modules: Zink Skill Store, Zink Tools
- Severity: Medium
- Status: OPEN
- Root cause: the taxonomy gate (B05) is bypassable by omitting input rather than by choosing a bad value — a skill proposed with an empty namespace array is admitted and indexed as general.
- Evidence: Where: semantic-contract.mjs:213-219 (deriveSemanticMetadata), :175; consumer gate skill-adapter.mjs:842 · Evidence: const ambiguous = resolvedNamespaces.length === 0 && nsList.length > 0; / let domain = ambiguous ? "AMBIGUOUS" : "general"; — so with namespace absent or [] the function returns domain/primary_topic/subtopic/ambiguous byte-identical to an explicit namespace:"general", and general satisfies the consumer's CANONICAL_DOMAINS.includes(semanticMeta.domain) gate.
- Reproduction: node -e comparing deriveSemanticMetadata({}) with deriveSemanticMetadata({namespace:"general"}) — only resolved_namespaces differs.
- Acceptance criteria: an empty/absent namespace cannot produce a domain that passes CANONICAL_DOMAINS validation.
- Related findings: nguồn: E07 — Zink Tools shared layer (7 findings; the shared…

### F-014 — one corpus split by spelling — a document tagged research indexes with primary_topic domain-research while kb/knowledge-base/literature (which do reach the alias) index as kb-ingestion, and neither the filter nor the envelope can…

- Category: F1 — Logic & Functional Bugs
- Legacy register id: `R5-E07-04`
- Affected modules: Zink Skill Store
- Severity: Medium
- Status: OPEN
- Root cause: one corpus split by spelling — a document tagged research indexes with primary_topic domain-research while kb/knowledge-base/literature (which do reach the alias) index as kb-ingestion, and neither the filter nor the envelope can reconcile them. Root cause is two registries extended independently with no precedence or collision check.
- Evidence: Where: semantic-contract.mjs:48 (NAMESPACE_ALIAS_MAP "research"), :141-145, :172-174 · Evidence: the alias registry (B22) declares research → knowledge, but resolveNamespace consults KNOWN_TAXONOMY_MAP first and that map contains a research key, so the alias is unreachable — and this is the single dead entry, because every other alias value (lscm, power-bi, optimization, python, knowledge, sql) has no shadowing key.
- Reproduction: Static, and gate it in `tests/m8-t1-skill-vector-memory.test.mjs`, which already imports the semantic contract. Measured at HEAD: `zink-tools/common/semantic-contract.mjs:48` declares the alias `research: "knowledge"` inside `NAMESPACE_ALIAS_MAP`, but `resolveNamespace` at `:169-179` tests `if (KNOWN_TAXONOMY_MAP[ns]) return { resolved: ns, ambiguous: false };` at `:172` before it ever consults the alias map, and `KNOWN_TAXONOMY_MAP` has a `research` key at `:141-145` (`domain: "research"`, `primary_topic: "domain-research"`, `subtopic: "literature-and-notes"`) because `research` is also listed in `CANONICAL_DOMAINS` at `:17`. So `resolveNamespace("research")` returns `research` and the alias is unreachable, while `kb`, `knowledge-base` and `literature` have no shadowing key and do resolve to `knowledge` — one corpus indexed under two different `primary_topic` values depending on the spelling the ingester happened to use. Assert `resolveNamespace` returns the same canonical namespace for every alias in `NAMESPACE_ALIAS_MAP`, which today fails for exactly this one entry.
- Acceptance criteria: alias and taxonomy keys are provably disjoint, or one documented precedence yields identical metadata for both spellings.
- Related findings: nguồn: E07 — Zink Tools shared layer (7 findings; the shared…

### F-015 — any skill whose manifest capability is not already lowercase-kebab is permanently unfindable by the capability filter — the search returns NO_MATCH, indistinguishable from "no such skill"

- Category: F1 — Logic & Functional Bugs
- Legacy register id: `R5-E07-05`
- Affected modules: Zink Skill Store, Zink Tools
- Severity: Medium
- Status: REFUTED — refuted at the pre-freeze read of `M12/T2.2-R3` (head `7996a16`): `catalog.mjs:31` SLUG is enforced on `identity.capability` and re-checked by the adapter, so the NO_MATCH path is unreachable. Not a defect — kept only so no later band re-admits it.
- Root cause: any skill whose manifest capability is not already lowercase-kebab is permanently unfindable by the capability filter — the search returns NO_MATCH, indistinguishable from "no such skill". Explicitly the adjacent, unrecorded seam to R1-A10-06 (which E07 cross-checked and did not restate).
- Evidence: Where: semantic-contract.mjs:372-378 and :254, :256-265; writer vector-sync.mjs:500-504 (+ :654); filter skill-adapter.mjs:483-487 · Evidence: the query side normalizes (const cap = params.capability.trim().toLowerCase();) while the concept side builds a _different field_ (rawCapability.replace(/-/g," "), returned as concept, no capability key) and the writer stores record.manifest.identity.capability verbatim; the SQL then compares c.capability = ${escapeSqlLiteral(metadataFilters.capability)}.
- Reproduction: Not reproducible — the premise was measured dead and the row stays only so no later band re-admits it. Re-verified at this head: `zink-skill-store/src/catalog.mjs:31` defines `const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;` and `:306` refuses a record whose `identity.capability` fails it (re-checked at `:1127`), so no capability that is not already lowercase-kebab can enter the catalog. The asymmetry the row described is real but harmless: `semantic-contract.mjs:397-398` normalizes the query side with `const cap = params.capability.trim().toLowerCase();` while `:260` builds a separate `concept` field as `rawCapability.replace(/-/g, " ")` and `vector-sync.mjs:498-506` stores the manifest value verbatim — but the stored value is SLUG-constrained, so the comparison at `skill-adapter.mjs:500-502` (`c.capability = <literal>`) can always match. A regression test worth keeping: assert that a manifest whose `identity.capability` is `My_Capability` is refused at catalog admission, which is what makes the filter's normalization sufficient.
- Acceptance criteria: a write-then-search round trip on a mixed-case capability returns the row.
- Related findings: bug mở: R1-A10-06 · disposition: refuted at the pre-freeze read of `M12/T2.2-R3` (head `7996a16`): `catalog.mjs:31` SLUG is enforced on `identity.capability` and re-checked by the adapter, so the NO_MATCH path is unreachable. Not a defect — kept only so no later band re-admits it. · nguồn: E07 — Zink Tools shared layer (7 findings; the shared…

### F-016 — incident dedupe ignores Discord's truncation flag

- Category: F1 — Logic & Functional Bugs
- Legacy register id: `R2-B07-02`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: Low (/Latent)
- Status: OPEN
- Root cause: Register kết luận: incident dedupe ignores Discord's truncation flag. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: Evidence: (code): discord-forum-tags.mjs:157 consumes body.threads and never reads has_more, so a first-page-only listing is treated as complete truth → a duplicate #incidents thread is posted for an incident the guard was written to dedupe.
- Reproduction: Static, and gate it in `tests/m12-t2-forum-tags.test.mjs`, which already drives `readActiveForumThreads` against a stubbed `fetch`. Measured at HEAD: `integrations/openclaw/lib/discord-forum-tags.mjs:154-161` throws on a non-ok response, then returns `(Array.isArray(body?.threads) ? body.threads : []).map(...)` at `:157` and never reads `body.has_more` or `body.next_cursor`; a repo-wide `grep -rn "has_more" --include="*.mjs" integrations/` returns zero hits, so nothing in the plugin paginates. Discord's `GET /channels/{id}/threads/active` caps the response, so once a forum holds more active threads than one page carries, the listing is silently partial and the dedupe at `index.mjs:5140-5146` (`threads.some((thread) => thread.name.includes(token))`) answers false for an incident that is already open. Return a stub body with `has_more: true` and one unrelated thread, then assert the caller refuses to conclude "not already surfaced" rather than posting a duplicate `#incidents` thread.
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "incident dedupe ignores Discord's truncation flag", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: nguồn: B07 — end-to-end: dedup decisions, one refutation, and a…

### F-017 — a real provider outage is attributed to the service's own bug, so operators tune the wrong thing and callers do not retry, because 503 is the retryable code the adapter understands

- Category: F1 — Logic & Functional Bugs
- Legacy register id: `R5-E02-07`
- Affected modules: Zink Knowledgebase
- Severity: Low
- Status: REFUTED — premise measured dead 2026-10-18: both halves of the premise measured dead at this head. (1) The `raise AssertionError("Embedding retry loop exhausted without a result.")` is at `apps/knowledge/app/model_probe.py:138`, not `:128`, and it is **unreachable**: the enclosing lo (was: OPEN)
- Root cause: a real provider outage is attributed to the service's own bug, so operators tune the wrong thing and callers do not retry, because 503 is the retryable code the adapter understands.
- Evidence: Where: model_probe.py:128 consumed by main.py:364, :473-474 · Evidence: raise AssertionError("Embedding retry loop exhausted without a result."), but the search path catches only except (httpx.HTTPError, ModelProbeError), so the AssertionError bypasses the 503 mapping and lands in the generic except Exception: returning INTERNAL_ERROR 500 — and AssertionError is stripped entirely under python -O.
- Reproduction: Not reproducible — the premise is dead and the row stays only so no later band re-admits it. To re-measure: read `apps/knowledge/app/model_probe.py:111-138` and enumerate the exits of `for attempt in range(2)`; both iterations return on success and the second raises `ModelProbeError(failure_code)` on failure, so the trailing `raise AssertionError(...)` at `:138` has no reaching path. Then confirm `main.py:391-392` maps `ModelProbeError` to 503 `EMBEDDING_MODEL_UNAVAILABLE` before the generic `except Exception` at `:500-501` can turn it into a 500. A worthwhile regression test to keep regardless: force both embedding attempts to fail with a transient status and assert the search endpoint returns 503 `EMBEDDING_MODEL_UNAVAILABLE`, never 500 `INTERNAL_ERROR` — that pins the mapping the row was worried about, without depending on an unreachable raise.
- Acceptance criteria: every embedding failure mode on the search path resolves to a specific 503 code, never a bare 500.
- Related findings: nguồn: E02 — Knowledgebase retrieval, provenance and citations (7…

### F-018 — an operator believes an editable workspace template exists on disk and edits a directory nothing reads

- Category: F1 — Logic & Functional Bugs
- Legacy register id: `R5-E14-04`
- Affected modules: OpenClaw runtime libs, OpenClaw integration
- Severity: Low
- Status: OPEN · premise changed 2026-10-18: locator drifted: `assertWorkspaceMatchesTemplate` is exported at `integrations/openclaw/lib/policy.mjs:1498` and called at `:1553`, not `:1496`
- Root cause: an operator believes an editable workspace template exists on disk and edits a directory nothing reads.
- Evidence: Where: integrations/openclaw/templates/main-workspace/.gitkeep · Evidence: ls -a shows .gitkeep only; git ls-files shows nothing else there; a repo-wide grep for main-workspace returns zero hits outside that path — while lib/policy.mjs:1496 assertWorkspaceMatchesTemplate() implements the template in code.
- Reproduction: Static, and gate it in `tests/m7-lane-g-policy.test.mjs`, which already exercises `lib/policy.mjs` exports. Measured at HEAD: `ls -a integrations/openclaw/templates/main-workspace/` returns only `.gitkeep`, `git ls-files integrations/openclaw/templates/` lists `main-workspace/.gitkeep`, `openclaw-gemini-stream-hotfix.mjs` and `openclaw-pass-resolver` and nothing else under that directory, and a repo-wide grep for `main-workspace` outside the register and `.agents/states/` returns zero hits — no code, doc, test or CI step opens it. The template an operator would expect to edit is instead implemented in code as `assertWorkspaceMatchesTemplate` (`integrations/openclaw/lib/policy.mjs:1498`, called at `:1553`). So the directory reads as the editable source of truth and is inert: editing a file there changes nothing, and the real template can only be changed by editing `policy.mjs`. Assert either that the function derives its expectations from files under `templates/main-workspace/`, or that the directory carries a README stating the template lives in `policy.mjs` and the `.gitkeep` is a placeholder.
- Acceptance criteria: no tracked empty directory whose name a check claims to use.
- Related findings: nguồn: E14 — repository hygiene: tracked junk, stale artifacts…

### F-019 — a $$ inside a bounded error message truncates the failure-path SQL block

- Category: F1 — Logic & Functional Bugs
- Legacy register id: `R6-R3-NEW-02`
- Affected modules: Zink Skill Store
- Severity: Low
- Status: OPEN — Confirmed (code shape); outcome is fail-closed
- Root cause: the reason string is interpolated into a dollar-quoted body instead of being passed as a bind parameter.
- Evidence: Where: zink-skill-store/src/vector-sync.mjs (failSql, shipped by R3-7 at 1bab75d); the READY path in buildSkillSyncTransaction already carries the same exposure · Evidence: boundedReason is interpolated inside a DO $$ … $$; body, so a reason containing $$ terminates the statement early. The statement is then rejected and the secondary write escalates as VECTOR_FAILURE_WRITE_FAILED, so the outcome is fail-closed rather than silent; R3-7 joins an existing class instead of creating one.
- Reproduction: scratch-database probe feeding a reason containing $$ through failSql and reading the resulting row.
- Acceptance criteria: the reason reaches the failure row intact, or the block is built with parameters so no message can truncate a statement.
- Related findings: nguồn: M12/T2.2-R3 close (2026-10-17)

### F-020 — the thread-body copy is unbounded while the component copy truncates at 2000, so a long card fails the REST post, is logged as a warn and returns — a recorded request with no reachable card

- Category: F1 — Logic & Functional Bugs
- Legacy register id: `R2-B01-04`
- Affected modules: Chưa xác định — đọc lại Where khi re-verify
- Severity: Ungraded
- Status: REFUTED — premise measured dead 2026-10-18: the thread-body copy is **not** unbounded. `openGovernedForumThread` (`integrations/openclaw/lib/discord-forum-tags.mjs:617`) builds its REST body at `:656-660` as `name: String(title ?? "").slice(0, 100)` and `message: { content: String(bo (was: OPEN)
- Root cause: Register kết luận: the thread-body copy is unbounded while the component copy truncates at 2000, so a long card fails the REST post, is logged as a warn and returns — a recorded request with no reachable card. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: (sub-defect of A09-04): the thread-body copy is unbounded while the component copy truncates at 2000, so a long card fails the REST post, is logged as a warn and returns — a recorded request with no reachable card.
- Reproduction: Not reproducible as stated — both copies are bounded at 2000 and the row stays only so no later band re-admits it. To re-measure: read `integrations/openclaw/lib/discord-forum-tags.mjs:656-660` (thread `message.content` is `String(bodyContent ?? "").slice(0, 2000)`) beside `integrations/openclaw/plugins/zink-governance/index.mjs:1684` (component `content` is `bodyContent.slice(0, 2000)`). A **different and narrower** concern does survive here and should be filed as its own row rather than folded into this one: both sites slice by UTF-16 code units, so a 2000-code-unit cut can split a surrogate pair and post a lone surrogate, while `index.mjs:1935-1939` documents that exact class of bug and `truncateUtf8` (`index.mjs:1953-1958`) already exists to bound by bytes instead. That is a code-unit-vs-byte question, not an unbounded-length question, and this row's evidence does not support it.
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "the thread-body copy is unbounded while the component copy truncates at 2000, so a long card fails the REST post, is logged as a warn and returns — a recorded request with no reachable card", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: nguồn: B01 — security / authorization (all 14 assigned claims…

### F-021 — pickup-loop eligibility is a one-shot existsSync at register() time (index.mjs:6095-6101), so a snapshot created after load (first install, or after a guarded lock/snapshot recovery) leaves the coordinator lane permanently dark until…

- Category: F1 — Logic & Functional Bugs
- Legacy register id: `R2-B02-01`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: Ungraded
- Status: OPEN · premise changed 2026-10-17: locator drifted: the one-shot existsSync is now index.mjs:6112-6118 (was cited as :6095-6101); the loop start at :6119-6120 still depends on it
- Root cause: Register kết luận: pickup-loop eligibility is a one-shot existsSync at register() time (index.mjs:6095-6101), so a snapshot created after load (first install, or after a guarded lock/snapshot recovery) leaves the coordinator lane permanently dark until…. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: : pickup-loop eligibility is a one-shot existsSync at register() time (index.mjs:6095-6101), so a snapshot created after load (first install, or after a guarded lock/snapshot recovery) leaves the coordinator lane permanently dark until restart — silent no-execution right after the recovery procedures the owner already runs.
- Reproduction: Read index.mjs:6112-6118: `const ledgerSnapshotPresent = (() => { try { return existsSync(paths.snapshot) } catch { return false } })()` is evaluated once inside register(), and :6119-6120 starts startCoordinatorPickupLoop only when that snapshot existed at load. Gate it in tests/m10-t1-coordinator-pickup.test.mjs: register the plugin against an empty state dir, create the snapshot afterwards, then assert an approved task is still claimed — today the lane stays dark until restart, which is exactly the state the guarded lock/snapshot recovery procedures leave behind.
- Acceptance criteria: Pickup eligibility is evaluated when work could be claimed, not once at register() time: a snapshot created after plugin load (first install, or after a guarded recovery) starts the coordinator lane without a restart, and an absent snapshot still refuses to start it.
- Related findings: nguồn: B02 — runtime / lifecycle (13 assigned claims)

### F-022 — the deployed plugin loads live repository source through a hardcoded Windows mount path, bypassing the digest-gated packaged assets

- Category: F2 — Security & Authorization
- Legacy register id: `R1-A02-01`
- Affected modules: OpenClaw governance plugin (Discord), OpenClaw integration, Gates + CI
- Severity: Critical
- Status: OPEN · premise changed 2026-10-17: line drift, consumers now :536/:577/:762/:817/:850/:1075/:1453/:8346; the literal is also legitimately in README.md:216 (an operator cd) and in the gate's own string at test:731, so a widened gate must key off the resolution set, not every
- Root cause: a branch switch or an uncommitted edit to a validator/adapter/catalog silently changes governed behaviour with no redeploy and no digest change. This hollows out the repository's central deployment evidence form — "all installed paths byte-equal to the packaged build" pins the plugin tree but not the modules it loads from the working tree at runtime; OneDrive placeholder files can also ENOENT/EIO at the first tool call.
- Evidence: Where: integrations/openclaw/plugins/zink-governance/index.mjs:508-516 (findRepoRoot()), consumers :538 (skill adapter), :579 (knowledge adapter), :758 (loadRepoModule), :815 (vector sync), :851 (duckdb bridge), :1075/:1453 (skill catalog), :8344 (skills root) · Evidence: the candidate array contains the literal "/mnt/c/Users/HOANG VINH/OneDrive/Documents/personal-tool"; ZINK_REPO_ROOT appears nowhere else in the repo and the live unit sets no WorkingDirectory/env; path.resolve(import.meta.url,"../../../..") lands on /home/hoang_vinh in the deployed tree, so only the machine literal ever matches. tests/m7-lane-g-policy.test.mjs:726-732 greps only schema.mjs + guard.mjs for that path, so the gate is blind to the sole violator — the entrypoint itself — contradicting guard.mjs:107 ("M7-063 … machine-specific absolute paths are prohibited").
- Reproduction: In tests/m7-lane-g-policy.test.mjs M7-063 (:725-736) add 'integrations/openclaw/plugins/zink-governance/index.mjs' to the iterated relative-path list and run `node --test`. The assertion that no iterated source contains the machine path fails, proving the entrypoint carries a path the gate never inspects. The deployed-only half (path.resolve landing on /home/hoang_vinh) needs the live WSL gateway.
- Acceptance criteria: No tracked governance-resolution source contains a machine-specific absolute path, and the M7-063 file list is derived from the resolution dependency set rather than hand-enumerated, so the entrypoint cannot drift past the gate.
- Related findings: adjudication Vòng 2: Verified, Critical unchanged, and B08's alternative hypothesis refuted / → Verified, Critical upheld. — B08's attack failed and instead tightened the claim: the live unit and… · nguồn: A02 — module dependencies, shared components and duplication

### F-023 — the owner's APPROVE is bound to a task id only — no plan, brief-revision or digest binding

- Category: F2 — Security & Authorization
- Legacy register id: `R1-A07-01`
- Affected modules: Workflow topology + ledger, Workflow topology
- Severity: Critical
- Status: OPEN — _(the binding consequence of R1-A03-02 / R1-A09-04 rendering)_
- Root cause: an APPROVE issued after a re-brief executes the new plan under the old consent; combined with the model-authored card text, nothing ties what the owner read to what runs.
- Evidence: Where: index.mjs:1984-1998 (handleDiscordAction), topology/lib/workflow.mjs:714-754 (WORKFLOW_USER_APPROVAL_DECIDED reducer), topology/contracts/ledger-event.schema.json:1136-1169 · Evidence: the reducer's optional fields include scope_digest, and scope_digest: data.scopeDigest ?? null (index.mjs:1996) — caller-supplied, nullable, never read. Digest binding exists for result verdicts (workflow.mjs:700-708, index.mjs:1868-1871) and for tool invocations (guard.mjs:379-394 recomputes and asserts approval_scope_digest), with no analogue for approvals. WORKFLOW_APPROVAL_REQUESTED records brief_revision (workflow.mjs:780-784); the decision does not.
- Reproduction: Add a case to tests/m7-lane-a-workflow.test.mjs: build a task with applyWorkflowEvent('WORKFLOW_OPENED', …), then applyWorkflowEvent('WORKFLOW_USER_APPROVAL_DECIDED', {decision:'APPROVE', scope_digest: 'f'.repeat(64)}) and assert the reducer rejects the unbound digest or records the brief_revision it approved. A node probe on this host shows it silently reaches workflow_status=QUEUED with approved_at set and the bogus digest ignored. Runs with `node --test`.
- Acceptance criteria: A recorded APPROVE is bound to a specific plan: the decision carries and validates a required non-null scope_digest against the pending brief (as the result-verdict and tool-invocation paths do) or records the brief_revision it approved, so a stale or wrong-scope approval cannot transition the task.
- Related findings: adjudication Vòng 2: Verified, Critical upheld / → Verified, Critical upheld. — scope_digest has exactly one writer (index.mjs:1996), one permitted-field list (workflow.mjs:718) and one schema… · bug mở: R1-A03-02, R1-A09-04 · nguồn: A07 — governance and the approval workflow

### F-024 — two resolvers for the same governance dependencies disagree; the live one points at an incomplete hand-seeded directory

- Category: F2 — Security & Authorization
- Legacy register id: `R1-A02-02`
- Affected modules: OpenClaw governance plugin (Discord), Workflow topology + ledger, Workflow topology, Zink Tools
- Severity: High
- Status: OPEN · premise changed 2026-10-17: line drift 236→238, and the ready return now also carries policyLoaded; the 'incomplete hand-seeded tree' half is WSL-bound, only the unconditional flag and the resolver split are verifiable here
- Root cause: whenGovernanceDependenciesReady() reports ready:true with validateSqlQuery === null; guard-gated tools fail closed as GOVERNANCE_DEPENDENCY_MISSING while a second, differently-versioned copy governs the same decision, and stale Sep-24 schemas feed generateSchemaManifest()'s checksum so repo contract edits are invisible to production.
- Evidence: Where: topology/lib/guard.mjs:203-235 (loadShared, path.resolve(_moduleDir,"../../../../"+p)) vs index.mjs:796-811; guard.mjs:236 sets depsLoaded = true unconditionally; consumers guard.mjs:1595,1606,1665,1891,1947 · Evidence: deployed __dirname is ~/.openclaw-zink/extensions/zink-governance/lib, so guard's paths resolve to /home/hoang_vinh/zink-tools/…. Orchestrator live confirmation: ls /home/hoang_vinh/zink-tools → only contracts and sql — no common/path-safety.mjs, no sql/validator.mjs, no n8n/trigger.mjs, and nothing in configure.mjs/governancePluginFiles() ever materialises or GCs that tree (hand-copied 2026-09-24).
- Reproduction: Static chain: guard.mjs:200-214 loadShared resolves from _moduleDir/'../../../../' plus cwd only and forbids machine absolute paths, while index.mjs:508-510/759 findRepoRoot/loadRepoModule accepts a hardcoded /mnt/c path — two resolvers for the same zink-tools deps. guard.mjs:238 sets depsLoaded = true regardless of depsSqlLoaded and :252 returns ready: depsLoaded. The deployed probe (call whenGovernanceDependenciesReady() from ~/.openclaw-zink with the validators absent → ready:true yet validateSqlQuery === null, consumers failing GOVERNANCE_DEPENDENCY_MISSING at :95/:1664) needs the live WSL layout and is not runnable here.
- Acceptance criteria: whenGovernanceDependenciesReady().ready is true only when path-safety, the SQL validator and the n8n adapter have actually loaded (non-null), and guard plus the plugin resolve one common zink-tools root through a single mechanism.
- Related findings: adjudication Vòng 2: Verified, High kept, confidence raised to Confirmed · nguồn: A02 — module dependencies, shared components and duplication

### F-025 — the execution-approval card renders model-authored plan text, so the owner's APPROVE is not bound to the plan that executes

- Category: F2 — Security & Authorization
- Legacy register id: `R1-A03-02`
- Affected modules: OpenClaw governance plugin (Discord), OpenClaw integration
- Severity: High ((orchestrator escalation from the agent's Medium))
- Status: OPEN
- Root cause: consent bound to the admitted brief. Actual: the plan the owner reads is model output while the plan executed is the ledger brief.
- Evidence: Where: integrations/openclaw/plugins/zink-governance/index.mjs:5291-5319 (maybePublishDiscordCard), buttons 5366-5379 · Evidence: payload = JSON.parse(findingsText) from the child's findings; bodyContent = card.content; the custom id carries only buildComponentCustomId(…, APPROVE, taskId, String(briefRevision)) — no digest over the displayed text. · Expected/Actual: consent bound to the admitted brief. Actual: the plan the owner reads is model output while the plan executed is the ledger brief.
- Reproduction: craft child findings JSON differing from the snapshot brief; confirm card body ≠ admitted plan.
- Acceptance criteria: approved text is derived from and cryptographically bound to the admitted brief.
- Related findings: nguồn: A03 — security and trust boundaries

### F-026 — completeTask verifies no principal and self-satisfies its own result digest

- Category: F2 — Security & Authorization
- Legacy register id: `R1-A03-04`
- Affected modules: OpenClaw governance plugin (Discord), OpenClaw runtime libs, OpenClaw integration
- Severity: High ((orchestrator escalation))
- Status: OPEN
- Root cause: completion bound to the ledger-authoritative owner + result digest. Actual: any non-empty principal is accepted and the digest check is trivially self-satisfying.
- Evidence: Where: integrations/openclaw/lib/queue-manager.mjs:739-759 (completeTask); plugins/zink-governance/index.mjs:5777-5782 (applyOwnerDecisionEffect) · Evidence: the identity check runs only when item.ownerPrincipalRef is non-empty; the caller passes resultDigest: getTask(taskId)?.resultDigest read back from the same queue object; the origin ref can fall back to the literal "owner" (index.mjs:7620). · Expected/Actual: completion bound to the ledger-authoritative owner + result digest. Actual: any non-empty principal is accepted and the digest check is trivially self-satisfying.
- Reproduction: drive completeTask with ownerPrincipalRef=null and a self-supplied digest.
- Acceptance criteria: completion without the authoritative owner+digest pair is refused.
- Related findings: adjudication Vòng 2: Verified, worse than stated · nguồn: A03 — security and trust boundaries

### F-027 — the KB_ACCESS_MATRIX L1 (DISCOVER) tier is never enforced at the retrieval seam

- Category: F2 — Security & Authorization
- Legacy register id: `R1-A04-02`
- Affected modules: OpenClaw governance plugin (Discord), OpenClaw runtime libs, OpenClaw integration
- Severity: High
- Status: OPEN
- Root cause: every non-L0 namespace (main.finance, o2.research, excel.governance) returns full text + citation to all 7 agents; apps/knowledge carries no agent_id scoping, so this gate is the only control. The L1/L2 column currently carries no security meaning.
- Evidence: Where: integrations/openclaw/lib/policy.mjs:455-457 (if (level === "L1" && action === "read")) consumed at plugins/zink-governance/index.mjs:3070-3082 (params.action || "search") · Evidence: zink-knowledge.schema.json $defs.input.action enum is search|retrieve|citation|metadata — no "read" exists, so the L1 branch is unreachable dead code.
- Reproduction: evaluateToolAccess("main","zink_knowledge_search",{namespace:"finance",query:"x"}) → expect deny, observe allow.
- Acceptance criteria: L1 denies search/retrieve/metadata content, or L1 is removed from the matrix.
- Related findings: adjudication Vòng 2: Verified, scope wider than R1 stated · nguồn: A04 — policy and capability enforcement

### F-028 — Skill Store scoping is namespace-blind and the per-agent apply scope strings are decorative

- Category: F2 — Security & Authorization
- Legacy register id: `R1-A04-03`
- Affected modules: OpenClaw runtime libs, Zink Tools
- Severity: High
- Status: OPEN
- Root cause: main or excel can request namespace:"excel", skill_id:`python/<cap>`, action:"apply" and receive another stack's verified skill bytes. The catalog also lists Knowledgebase namespaces (knowledge, kb, literature), blurring the Skill Store / Knowledgebase isolation AGENTS.md §9 declares.
- Evidence: Where: lib/policy.mjs:461-478; index.mjs:3084-3119; zink-tools/adapters/skill-store/skill-adapter.mjs:121,384 · Evidence: the zink_skill branch consults only `SKILL_STORE_ACCESS_MATRIX[agentId][action]` and never reads resource/namespace; all 7 apply rows are non-false, so apply is L3-allowed for everyone and no scope string is compared anywhere; loadVerifiedRecord(skillsDir, targetSkillId) takes no namespace, so the gated params.namespace does not constrain the skill served; execute spreads {action:"search", …params} making action model-controlled.
- Reproduction: Measured on this host: `node -e` importing evaluateCapabilityAccess shows agent o1 — whose only apply scope is approved_research_domain — returns {allowed:true, level:'L3'} for namespace 'excel', for 'power-bi', and for anything else, because policy.mjs:461-477 reads only policy[action]. Gate it in the tests/m7-lane-g-policy.test.mjs idiom over exported evaluateCapabilityAccess (policy.mjs:384), and pair it with loadVerifiedRecord(skillsDir, targetSkillId) (skill-adapter.mjs:121) taking no namespace, so the gated params.namespace never constrains the served skill.
- Acceptance criteria: A zink_skill apply grants L3 only when the requested namespace matches that agent's declared apply scope string; a non-false but unmatched scope denies, and the served skill id is bound to the gated namespace.
- Related findings: adjudication Vòng 2: Verified, High upheld · nguồn: A04 — policy and capability enforcement

### F-029 — model-supplied action, api_key and timeout reach the adapters and override governance decisions

- Category: F2 — Security & Authorization
- Legacy register id: `R1-A10-04`
- Affected modules: Zink Tools
- Severity: High
- Status: OPEN
- Root cause: a model can pick the executed verb (search → read/apply/discover), inject an arbitrary credential into the only outbound internal-service call, and raise the 120 s per-attempt ceiling (extends R1-A14-07). Same family as R1-A04-08 (payload-identity trust) and R1-A04-03 (namespace-blind skill scope).
- Evidence: Where: index.mjs:3457-3464, 3568-3580, 3695-3699 ({action:"…", …params} — payload wins); zink-tools/adapters/knowledge/knowledge-adapter.mjs:240-241, :252-258; registered parameters at index.mjs:3386-3412, :3486-3520 drop the contract's additionalProperties:false · Evidence: const reqTimeout = input?.timeout || context?.timeout || this.timeout; apiKey = this.options.apiKey || input.api_key || env → sent as Authorization: Bearer.
- Reproduction: Measured on this host: `node -e` shows {action:'search', ...{action:'apply'}} yields action='apply', and grep confirms the registered zink_skill/zink_knowledge parameter blocks (index.mjs:3386-3412) carry no additionalProperties:false although zink-tools/contracts/README.md mandates closed objects. Add three assertions to tests/m7-t3-tools-contract.test.mjs: the registered schemas set additionalProperties:false; a payload built as {action:'search', ...params} stays 'search' when params.action='apply'; and knowledge-adapter.mjs honours neither input.timeout (:283) nor input.api_key (:295-300), sending Authorization only from governance/this.options.
- Acceptance criteria: Model-supplied action, api_key and timeout cannot reach the adapters: registered parameters reject unknown keys, and the outgoing request's action, bearer token and timeout come solely from governance context.
- Related findings: bug mở: R1-A14-07, R1-A04-08, R1-A04-03 · nguồn: A10 — Zink Tools, adapters and execution contracts

### F-030 — WORKFLOW_CANCELLED channel/message provenance is unconstrained in schema and unchecked at runtime

- Category: F2 — Security & Authorization
- Legacy register id: `R1-A11-04`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: High
- Status: OPEN
- Root cause: a cancel record can claim any channel and a fabricated message id, so owner-cancel vs coordinator-cancel provenance is unfalsifiable in the durable history — while every other verdict is bound to a real surface.
- Evidence: Where: ledger-event.schema.json:514-519 (channel/message_id as bare "type":"string") vs the pinned siblings at :745, :761, :795, :847 (const:"results", snowflake pattern); reducer workflow.mjs:497-521 lists both in optional exactKeys and validates neither (:506-515 checks reason_code/actor only)
- Reproduction: Register chưa có bước tái hiện riêng; bước gần nhất suy từ acceptance/remediation: an invalid cancel channel or message_id fails before append.
- Acceptance criteria: an invalid cancel channel or message_id fails before append.
- Related findings: nguồn: A11 — contracts, schemas and canonical definitions

### F-031 — user_principal_ref for ANSWER_USER is minted with a hardcoded HMAC key

- Category: F2 — Security & Authorization
- Legacy register id: `R2-B01-01`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: High
- Status: OPEN
- Root cause: Register kết luận: user_principal_ref for ANSWER_USER is minted with a hardcoded HMAC key. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: Evidence: index.mjs:2137-2139 calls derivePrincipalRef("identity-key", String(userPrincipal)) while ingress uses the 32-byte identity secret (:7613-7620); canonical.mjs:351-355 is createHmac("sha256", key). A durably recorded "verified user principal" is computable by anyone who knows the snowflake, and two trust levels share one vocabulary so any later comparison is meaningless.
- Reproduction: Measured on this host: `node -e` over canonical.mjs derivePrincipalRef for the same snowflake returns b2c2d80d… for the ANSWER_USER path (index.mjs:2136-2138, which passes the literal 'identity-key') and 1df415f9… for the ingress path (index.mjs:7635, which passes the 64-hex identity.key) — equal? false, and the first is recomputable from public source. Gate it in tests/m12-t1-task-identity.test.mjs.
- Acceptance criteria: ANSWER_USER principal refs are minted with the same identity.key secret the ingress path uses, so a recorded 'verified user principal' cannot be recomputed from public source and the two trust levels share one vocabulary.
- Related findings: nguồn: B01 — security / authorization (all 14 assigned claims…

### F-032 — the durable reducer admits APPROVE for a plan that was never requested or surfaced

- Category: F2 — Security & Authorization
- Legacy register id: `R2-B01-03`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: High
- Status: OPEN — REVISING; no approval_requested_at/approval_thread_id precondition, and WORKFLOW_OPENED sets ACTIVE. Snapshot replay therefore turns an un-surfaced task into QUEUED under actor "user".
- Root cause: Register kết luận: the durable reducer admits APPROVE for a plan that was never requested or surfaced. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: Evidence: workflow.mjs:733-743 requires only !terminal + ACTIVE
- Reproduction: Measured on this host: `node --test tests/m10-t2-r12-first-spawn-approval.test.mjs` → 9 pass / 0 fail, and its helper (:131-145) already reaches QUEUED via OPENED→BRIEF_ACTIVATED→APPROVE with NO WORKFLOW_APPROVAL_REQUESTED, proving the hole. Add the red case in that file: replay WORKFLOW_OPENED then WORKFLOW_USER_APPROVAL_DECIDED {actor:'user', channel:'approvals', decision:'APPROVE'} with no REQUESTED event and assert INVALID_STATE_TRANSITION; today workflow.mjs:735-753 checks only actor/channel/non-terminal/ACTIVE and snap.approval_requested_at stays null.
- Acceptance criteria: applyWorkflowEvent rejects WORKFLOW_USER_APPROVAL_DECIDED/APPROVE for a task with no recorded WORKFLOW_APPROVAL_REQUESTED, so an owner approval can never bind to a plan that was not requested or surfaced.
- Related findings: nguồn: B01 — security / authorization (all 14 assigned claims…

### F-033 — the probe forges origin: discord provenance into live durable state

- Category: F2 — Security & Authorization
- Legacy register id: `R2-B03-01`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: High
- Status: OPEN
- Root cause: Register kết luận: the probe forges origin: discord provenance into live durable state.. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: Evidence: live-governance-probe.mjs:88-101 writes origin_principal_ref: "a".repeat(64), origin_message_id: String(900000000000000000n + BigInt(Date.now())) and derives the task id from that origin, so fabricated rows are indistinguishable from real intake except by message-id range — and synthetic ids never collide, which keeps the duplicate guard permanently untested.
- Reproduction: Static proof chain: live-governance-probe.mjs:25 points at the live ledger root (/home/hoang_vinh/.openclaw-zink), :90 sets origin_principal_ref to 'a'.repeat(64), :91 mints a synthetic snowflake from 900000000000000000n + Date.now(), :93 derives the task id from that forged origin and :94 persists it via recordWorkflowEvent. Synthetic ids never fall inside Discord's real range, so the duplicate guard cannot trip. Executable only from the WSL operator shell with OPENCLAW_STATE_DIR repointed at a throwaway directory.
- Acceptance criteria: The operator probe writes synthetic origin provenance only into a disposable state dir, never the live ledger, so forged rows stay distinguishable from real intake and the duplicate guard remains exercisable.
- Related findings: nguồn: B03 — governance / ledger / audit integrity (10 claims…

### F-034 — AGENTS.md §11 treats gates as blocking, but no check is required, so a red pipeline of any kind merges into main

- Category: F2 — Security & Authorization
- Legacy register id: `R5-E09-02`
- Affected modules: Chưa xác định — đọc lại Where khi re-verify
- Severity: High
- Status: EXCLUDED — excluded pending decision `H2` (branch protection is not enableable on this plan; choose a substitute). · premise unverifiable 2026-10-17: status EXCLUDED (owner H2); branch protection is a GitHub repo setting with no in-tree representation, and the failing-run claim needs the live Actions API
- Root cause: AGENTS.md §11 treats gates as blocking, but no check is required, so a red pipeline of any kind merges into main. Every "gate" in this repository is advisory, including dependency-audit, secret-scan and quality-gate. Remediation direction is explicitly _not_ a code fix: enabling protection is an owner/plan decision; the in-repo substitute would be a workflow-internal merge blocker whose run PLAN.md must cite.
- Evidence: Where: repository-level — gh api repos/SatThuVoTinh/personal-tool/branches/main/protection · Evidence: {"message":"Upgrade to GitHub Pro or make this repository public to enable this feature.", "status":"403"} — no protection rule exists. gh run list --branch main shows the Security workflow failure on 38222922937, 37280863207, 36394881558.
- Reproduction: From an authenticated operator shell, read-only: `gh api repos/SatThuVoTinh/personal-tool/branches/main/protection` returns 403 'Upgrade to GitHub Pro or make this repository public' (no rule exists), and `gh run list --branch main` shows the Security workflow failing on 38222922937, 37280863207 and 36394881558. In-tree corroboration: grep finds no required-status-check or enforce config under .github, although ci.yml and security.yml both define quality-gate and Security. Not executable in this task: network use is forbidden.
- Acceptance criteria: main enforces required status checks (quality-gate plus Security) with enforce_admins, so a commit whose verify or Security check fails cannot merge or push to main; observable as those contexts in the protection API.
- Related findings: quyết định chủ: H2 · disposition: excluded pending decision `H2` (branch protection is not enableable on this plan; choose a substitute). · nguồn: E09 — CI: the gate tier that can print green without…

### F-035 — find /home/hoang_vinh/.openclaw-zink -maxdepth 1 -type f ! -perm 600 — prints modes and names, no bodies

- Category: F2 — Security & Authorization
- Legacy register id: `R5-E13-01`
- Affected modules: Chưa xác định — đọc lại Where khi re-verify
- Severity: High
- Status: OPEN — (live host)
- Root cause: the repo's gates check only named paths — configure.mjs:1062, :1471-1503 (requireFileMode), runtime-backup.mjs:64 (openSync(file,"wx",0o600)), :283, :352 — and nothing enumerates the state root for other-mode copies, so an operator-made backup is never covered by any gate. — Hệ quả: any uid in the WSL VM can read the live credential set indefinitely, and rotating a credential does not remove the stale readable copy.
- Evidence: Where: /home/hoang_vinh/.openclaw-zink/openclaw.json.bak-mobile-1789615159090 (WSL state root, not the repo) · Evidence: ls -l shows -rw-r--r-- 1 hoang_vinh hoang_vinh 17097 Sep 17 10:19 openclaw.json.bak-mobile-… while every sibling config copy is -rw------- (openclaw.json, .bak, .bak-pre-apply, .last-good, .clobbered._, .pre-mig-_). Kind: a full runtime-config snapshot (provider credentials + token material); values not read and not printed. · Detail: fixing the _file_ is an operator action on live data → needs its own guarded command and explicit authorization, exactly like the orphan-lock recovery. It is not a code fix and is not in M12/T2.1.
- Reproduction: find /home/hoang_vinh/.openclaw-zink -maxdepth 1 -type f ! -perm 600 — prints modes and names, no bodies. Do not cat any of them.
- Acceptance criteria: preflight/apply fails closed if any credential-derived file under the state root is group- or other-readable.
- Related findings: nguồn: E13 — secrets, identity and permission surfaces (6…

### F-036 — M10/T2-R9 removed the auth _profiles_ from the secrets plan (comment at :1314) but not the key

- Category: F2 — Security & Authorization
- Legacy register id: `R5-E13-02`
- Affected modules: OpenClaw runtime libs
- Severity: High
- Status: EXCLUDED — excluded pending decision `H6` (route the router key through the SecretRef indirection).
- Root cause: M10/T2-R9 removed the auth _profiles_ from the secrets plan (comment at :1314) but not the key. — Hệ quả: one secret is duplicated in plaintext into every config copy the tooling makes — .last-good, .clobbered._, .pre-mig-_ were all observed present — so its blast radius is the whole backup set, and it cannot be rotated without a re-apply.
- Evidence: Where: lib/policy.mjs:896 (model provider block), :1303-1311 (resolveRouterApiKey), :1313-1317 (buildSecretsPlan) · Evidence: apiKey: resolveRouterApiKey(), with the file's own comment "The credential is supplied by the environment at apply time and written into the generated openclaw.json", while buildSecretsPlan states bot tokens and the gateway token "are resolved through secrets.providers" — i.e. the SecretRef indirection exists in this very template and the router key does not use it. · Detail: this interacts directly with the owner's 9Router→OpenClaw model-ownership goal (E/A2), so it should be decided in that conversation, not silently patched.
- Reproduction: Static proof: policy.mjs:896-898 builds the provider block with apiKey: resolveRouterApiKey(); :1308-1313 resolveRouterApiKey reads process.env.ZINK_ROUTER_API_KEY directly; and buildSecretsPlan (:1315-1321), whose own comment says bot tokens and the gateway token resolve through secrets.providers, returns no target for the router key. Add a test asserting buildSecretsPlan emits a SecretRef for the router key instead of an env-resolved plaintext value. Not run against a live apply: deployment is unauthorized.
- Acceptance criteria: The router credential is supplied through the same secrets.providers SecretRef indirection as the bot and gateway tokens, so the generated openclaw.json carries a reference rather than an env-resolved key.
- Related findings: quyết định chủ: H6 · disposition: excluded pending decision `H6` (route the router key through the SecretRef indirection). · nguồn: E13 — secrets, identity and permission surfaces (6…

### F-037 — model-authored SQL can reach a host file read whose contents return as result rows that the model — and then the Discord card — read

- Category: F2 — Security & Authorization
- Legacy register id: `R5-E15-03`
- Affected modules: Zink Tools
- Severity: High ((if reachable))
- Status: HYPOTHESIS — Strongly Supported (pattern list), HYPOTHESIS (reachability)
- Root cause: a positive allow-list of read-only statement/function forms / a fail-open blocklist.
- Evidence: Where: zink-tools/sql/duckdb-bridge.mjs:23-44 (ESCAPE_PATTERNS), :102-138, executed at :263 execFileSync("duckdb", ["-json", "-c", initSql]) · Evidence: the deny-list covers ATTACH|DETACH|COPY|read_csv*|read_parquet*|read_json*|parquet_scan|INSTALL|LOAD| PRAGMA|CALL|EXECUTE|IMPORT|EXPORT plus host words. glob, read_text, read_blob, CREATE SECRET and SET are absent. Every denial lives inside for (const pattern of ESCAPE_PATTERNS) if (pattern.test(query)), so a query matching no listed pattern is accepted by construction. · Expected/Actual: a positive allow-list of read-only statement/function forms / a fail-open blocklist.
- Reproduction: read zink-tools/sql/validator.mjs (validateSqlQuery, imported at duckdb-bridge.mjs:4) and establish whether it independently allow-lists statement/function forms, and whether executeGovernedDuckDbQuery calls it before :263. If it does, this degrades to defence-in-depth. Not read within budget — this is the lane's top unresolved item.
- Acceptance criteria: a query using an unlisted table function is refused.
- Related findings: bug mở: R5-E06-05 · đã sửa/xóa khỏi file: R5-E06-04 · nguồn: E15 — untrusted-input security paths (5 findings; the…

### F-038 — a gitignored scratch worktree embeds a live Discord bot token and sends real messages outside governance

- Category: F2 — Security & Authorization
- Legacy register id: `R6-HUNT-01`
- Affected modules: Gates + CI, Scratch worktrees (untracked)
- Severity: High
- Status: PARTIAL — literal half resolved by deletion (re-measured 2026-10-17 under the owner's `e` grant); rotation and the ungoverned outbound path stay open and are the owner's calls
- Root cause: one-off operator convenience scripts written by past agent sessions directly into scratch/, with the token pasted to avoid an env lookup.
- Evidence: Where: scratch/wt-discord-idle-reset/scripts/notify.mjs (11,828 B, mtime 2026-10-15 09:42) and the sibling copy at scratch/wt-discord-incident-tag-fix/scripts/notify.mjs; scratch/ is gitignored at .gitignore:64 · Evidence: the script reads process.env.DISCORD_BOT_TOKEN || `<literal>` — a credential literal in source position — then performs live outbound Discord calls with no governance path involved (a channel message post, a forum-thread create with applied_tags/auto_archive_duration, and a thread reply); the comment on the channel id says it was read from the live openclaw.json. Nothing was printed, hashed or copied during the audit. Not tracked, so git add -A cannot commit it, but any "clean up scratch/" or force-add tool would put it in history. · **Re-measured 2026-10-17:** both named files are gone — `scratch/wt-discord-idle-reset/scripts/` now holds only `repository-check.mjs` and `repository-policy.mjs`, and `scratch/wt-discord-incident-tag-fix/` no longer exists as a worktree (`git worktree list` returns only the idle-reset one). A token-shape sweep of every file under `scratch/` (snowflake-dot-dot token form plus Discord webhook URLs) returns **0** files, and no `process.env.DISCORD_BOT_TOKEN ||` fallback remains anywhere. `git log --all --diff-filter=ACDMR -- '*notify.mjs'` is empty, so the literal **never entered git objects on any ref**. The surviving outbound scripts (`scratch/notify-execution-complete.mjs`, `notify-office-ready.mjs`, `check-approvals-channel.mjs`, `test-publish-discord-thread.mjs`, `check-bot-users.sh`) resolve tokens from `pass` entries keyed `zink/openclaw/DISCORD_BOT_TOKEN_*` and still post outside the governed plugin path.
- Reproduction: run `ls scratch/*/scripts/notify.mjs`, then `grep -rlE --exclude-dir=node_modules '[0-9]{17,20}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{25,}' scratch`, then `git log --all --oneline --name-only --diff-filter=ACDMR -- '*notify.mjs'`; read only the **shape** of any credential expression, never its value. All three now return nothing, which proves the literal half is gone; the ungoverned-call half reproduces by reading the `Authorization: Bot ${…}` sites in those five surviving scripts.
- Acceptance criteria: (a) no credential literal exists in any repository-adjacent file — **met by the 2026-10-17 sweep, but met by deletion rather than by a commit and an executed test, so §0.2 rule 6 forbids closing the row here**; (b) rotation of the token that sat in that literal — only the owner can do it and this register cannot verify it; (c) every outbound Discord call either goes through the governed plugin path or is a named operator tool with a documented credential source — the five scripts are named operator tools with a `pass` source, but none is governed, and governing them is lifecycle work, not a scratch edit.
- Related findings: nguồn: Vòng 6 bổ sung — wave-2 loose ends (2026-10-15)

### F-039 — media-root containment on the native send path is lexical, not symlink-safe

- Category: F2 — Security & Authorization
- Legacy register id: `R1-A03-01`
- Affected modules: OpenClaw runtime libs, OpenClaw integration
- Severity: Medium
- Status: OPEN
- Root cause: a symlink inside a declared root that points outside passes the prefix test. Today message_sending applies the realpath-based gate first, so this is weakened defence-in-depth, not a proven escape.
- Evidence: Where: integrations/openclaw/lib/discord-native-send.mjs:419-443 (assertMediaInsideRoots) · Evidence: path.resolve(mediaUrl) + resolvedMedia.startsWith(path.resolve(root)+sep); the sibling containOutboundAttachment (index.mjs:3047) does use realpathSync — two containment idioms for one boundary.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc integrations/openclaw/lib/discord-native-send.mjs:419-443 (assertMediaInsideRoots) ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng media-root containment on the native send path is lexical, not symlink-safe trước khi sửa (nội quy mục 3).
- Acceptance criteria: a symlinked media path resolving outside the root is refused.
- Related findings: nguồn: A03 — security and trust boundaries

### F-040 — handleExecutionFinished reads and hashes an artifact path with only optional containment

- Category: F2 — Security & Authorization
- Legacy register id: `R1-A03-03`
- Affected modules: OpenClaw runtime libs
- Severity: Medium
- Status: OPEN — (residual of the fixed out-of-sandbox class)
- Root cause: a caller omitting sandboxDir can name an absolute host path and have its bytes hashed and recorded unchecked. No non-test caller was found; the live guarded path is guard.mjs:1946-1955, which validates relative logical paths — so LATENT.
- Evidence: Where: index.mjs:2187-2352, esp. 2279-2298, 2342 (effectiveSandbox = sandboxDir || technicalConfig.sandboxDir || null); lib/artifact-validator.mjs:411,432 gate the symlink and sandbox checks behind sandboxDir · Evidence: (code shape)
- Reproduction: tests/m7-lane-f-result-integrity.test.mjs already calls handleExecutionFinished over a temp ledger. Add a case that passes an artifact whose path is an absolute host path outside the fixture root while omitting sandboxDir, and assert the artifact is refused. At HEAD index.mjs:2342 sets effectiveSandbox = sandboxDir || technicalConfig.sandboxDir || null, and artifact-validator.mjs:411 and :432 both put the symlink and sandbox checks behind `if (… sandboxDir)`, so with neither supplied the bytes are read, hashed and recorded unchecked.
- Acceptance criteria: an out-of-sandbox absolute artifact is refused at this seam.
- Related findings: nguồn: A03 — security and trust boundaries

### F-041 — the memory-tool executors trust model-supplied session_key / run_id / task_id over the trusted context

- Category: F2 — Security & Authorization
- Legacy register id: `R1-A04-08`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: Medium
- Status: OPEN — _(directly relevant to the memory subsystem; feeds Vòng 3)_
- Root cause: retrieval is logged and scoped by attacker-chosen ids → citation/provenance attributed to another task's run, taskId:"unbound-task" fallbacks silently degrading the audit trail. requestingAgent stays trusted, so namespace authority is not bypassed — provenance and correlation are.
- Evidence: Where: index.mjs:3449-3455 (skill) and 3560-3566 (knowledge) · Evidence: sessionKey: `params?.session_key || _id?.sessionKey || "unbound-session"` — payload wins, contradicting the adjacent comment "M8-061: … trusted runtime context only. Tool payload never impersonates." The registered schemas advertise `session_key/run_id/task_id/path_prefix/rerank` as model-fillable and drop the contract's additionalProperties:false and required action.
- Reproduction: Drive the skill memory-tool executor with a model payload whose session_key, run_id and task_id differ from the trusted context and assert the recorded retrieval scope comes from the trusted context. Measured at HEAD: index.mjs:3449-3452 reads `sessionKey: params?.session_key || _id?.sessionKey || "unbound-session"` and `runId: params?.run_id || _id?.runId || "unbound-run"`, so the payload wins, contradicting the adjacent M8-061 comment; the registered schemas advertise all three as model-fillable. Gate it in tests/m7-lane-d2-question-answer.test.mjs or tests/m12-t1-task-identity.test.mjs.
- Acceptance criteria: trusted fields win unconditionally; payload correlation keys are refused.
- Related findings: nguồn: A04 — policy and capability enforcement

### F-042 — invocation leases and run-start waiters share one process-global registry keyed without the governance scope

- Category: F2 — Security & Authorization
- Legacy register id: `R1-A06-07`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: Medium
- Status: OPEN
- Root cause: with two configured state roots (known K10), an identical triple minted under one root authorizes the other, and stopping one registration silently revokes the other's pending authorizations. leases.delete(key) also burns the proof when the call is then blocked, so no retry can re-authorize.
- Evidence: Where: index.mjs:4777-4800 (Symbol.for("…native.leases")), :4684-4697 (leaseKey), :4803-4807, :7438-7449, :7470 · Evidence: leaseKey hashes only {sessionKey, runId, toolCallId} — no ledgerRoot — although registerNativeGuard is scope-keyed (native-boundary.mjs:74); gateway_stop runs leases.clear() and resolves every startingRuns waiter.
- Reproduction: Static proof at HEAD, then a two-root test. leaseKey (index.mjs:4684-4697) hashes only {sessionKey, runId, toolCallId} with no ledgerRoot, while the registry is one process-global Symbol.for("zink.governance.native.leases") map (:4777-4780); gateway_stop then runs leases.clear() and resolves every startingRuns waiter (:4803-4807, :7438-7449, :7470). Gate: instantiate the plugin twice with different ledgerRoot in one process, mint a lease triple under root A, call the governed tool under root B with the same triple and assert refusal; then stop A's registration and assert B's pending authorizations survive.
- Acceptance criteria: a lease minted under one ledger root never satisfies a call governed by another.
- Related findings: adjudication Vòng 2: Verified · nguồn: A06 — task, run and session lifecycle

### F-043 — the verdict path never checks that the interaction happened in the recorded approval thread

- Category: F2 — Security & Authorization
- Legacy register id: `R1-A07-04`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: Medium
- Status: OPEN
- Root cause: a reposted/forwarded/stale card for task A, or an owner reply in an unrelated thread, yields a valid durable APPROVE — with no digest to catch it (R1-A07-01).
- Evidence: Where: index.mjs:1994-1995, :2022-2023 (thread_id: data.threadId ?? null); workflow.mjs:717-718, :826-833
- Reproduction: In tests/m7-lane-d-decision.test.mjs, replay WORKFLOW_USER_APPROVAL_DECIDED for a task whose card was surfaced in thread T1 while the payload carries thread_id T2, and assert INVALID_STATE_TRANSITION. At HEAD the verdict path records `thread_id: data.threadId ?? null` (index.mjs:1994-1995, :2022-2023) and the reducer (workflow.mjs:717-718, :826-833) never compares it against the task's approval_thread_id, so a reposted card, a forwarded message or a reply in an unrelated thread all yield a durable APPROVE.
- Acceptance criteria: A recorded approval decision is accepted only when its thread_id equals the thread the card was surfaced in for that task; a decision from any other thread is refused, and an absent thread id cannot satisfy the comparison.
- Related findings: adjudication Vòng 2: Verified, raised Medium → High · bug mở: R1-A07-01 · nguồn: A07 — governance and the approval workflow

### F-044 — Excel write-side containment is lexical while the read side is realpath — the weaker twin remains on the last write path

- Category: F2 — Security & Authorization
- Legacy register id: `R1-A10-08`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: Medium
- Status: OPEN
- Root cause: a link/junction inside the agent sandbox redirects the writes outside while the tool returns only path.basename values and status:"success" — recreating the M10/T2-R19 class. Same two-idioms root cause as R1-A03-01.
- Evidence: Where: lib/excel-writer.mjs:203-210 (path.relative only), :277-287 (mkdirSync + three writeFileSync) vs index.mjs:3046-3055 (realpathSync) · Evidence: (code shape), reachability Hypothesis
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc lib/excel-writer.mjs:203-210 (path.relative only), :277-287 (mkdirSync + three writeFileSync) vs index.mjs:3046-3055 (realpathSync) ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng Excel write-side containment is lexical while the read side is realpath — the weaker twin remains on the last write path trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "Excel write-side containment is lexical while the read side is realpath — the weaker twin remains on the last write path", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: adjudication Vòng 2: Verified · bug mở: R1-A03-01 · nguồn: A10 — Zink Tools, adapters and execution contracts

### F-045 — a canonical skill can carry an owner-attributed ACTIVE event no decision backs — §9 makes provenance the store's own responsibility

- Category: F2 — Security & Authorization
- Legacy register id: `R5-E04-07`
- Affected modules: Zink Skill Store
- Severity: Medium
- Status: EXCLUDED — excluded by owner letter `p1` (packaged entrypoint) — belongs to the `M12/T5` A2 band, which is scheduled and not authorized.
- Root cause: index.mjs:1117-1118 states "provenance is derived from the ref this approval actually carries — never a constant" / the store re-introduces a constant default at its entry point (promoteApprovedSkill), which any future caller can omit, producing a record that asserts owner approval and an unrelated plan provenance.
- Evidence: Where: catalog.mjs:992-997 and :1186-1200 · Evidence: default parameters requestingActor = "unknown", ownerActor = "owner", … references = [{ type:"plan", ref:"M8/T3-R1" }], written verbatim into lifecycle:[{status:"ACTIVE", actor:String(ownerActor), decision_ref: decisionRef}] and provenance:{source_type: sourceType, references} with sourceType = "demonstration". · Expected/Actual: index.mjs:1117-1118 states "provenance is derived from the ref this approval actually carries — never a constant" / the store re-introduces a constant default at its entry point (promoteApprovedSkill), which any future caller can omit, producing a record that asserts owner approval and an unrelated plan provenance.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc catalog.mjs:992-997 and :1186-1200 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng a canonical skill can carry an owner-attributed ACTIVE event no decision backs — §9 makes provenance the store's own responsibility trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "a canonical skill can carry an owner-attributed ACTIVE event no decision backs — §9 makes provenance the store's own responsibility", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: bug mở: R1-A16-08, R1-A04-08, R1-A10-04 · disposition: excluded by owner letter `p1` (packaged entrypoint) — belongs to the `M12/T5` A2 band, which is scheduled and not authorized. · nguồn: E04 — Skill Store catalog internals (9 findings; the store…

### F-046 — the 1024-d vectors in skills.segments — and therefore which skill an agent retrieves — can come from a swapped or unversioned model while the sync reports READY

- Category: F2 — Security & Authorization
- Legacy register id: `R5-E05-05`
- Affected modules: Zink Skill Store
- Severity: Medium
- Status: BLOCKED — awaits evidence: `M12/T2.2-R3` `R3-0` is `NOT RUN` (this host carries no `OLLAMA_URL`), owner letter `t1` produced no evidence yet.
- Root cause: the 1024-d vectors in skills.segments — and therefore which skill an agent retrieves — can come from a swapped or unversioned model while the sync reports READY. Important for Vòng 6: the register's own line records "P1-05 FIXED … model_version digest equality", so this was believed closed and will not be re-examined unless someone is told to. That is exactly the accepted-evidence-drift class.
- Evidence: Where: vector-sync.mjs:392-405 (guards), :13-15 (pins), :343-344 (embedFn bypass) · Evidence: if (data.model && data.model !== modelName) throw … and if (data.model_version && EXPECTED_MODEL_DIGEST && data.model_version !== EXPECTED_MODEL_DIGEST) throw … — both conditioned on the endpoint _volunteering_ the field, so omission is a pass and EXPECTED_MODEL_DIGEST is unenforceable against any producer that does not echo it.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc vector-sync.mjs:392-405 (guards), :13-15 (pins), :343-344 (embedFn bypass) ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng the 1024-d vectors in skills.segments — and therefore which skill an agent retrieves — can come from a swapped or unversioned model while the sync reports READY trước khi sửa (nội quy mục 3).
- Acceptance criteria: a response omitting model or model_version raises, and the digest pin has a reachable enforcement path.
- Related findings: disposition: awaits evidence: `M12/T2.2-R3` `R3-0` is `NOT RUN` (this host carries no `OLLAMA_URL`), owner letter `t1` produced no evidence yet. · nguồn: E05 — Skill Store vector sync (8 findings; the derived…

### F-047 — a credential committed to the task branch can reach main unscanned, and the "zero leaks" claim in PLAN.md cannot be re-inspected because no artifact exists

- Category: F2 — Security & Authorization
- Legacy register id: `R5-E09-07`
- Affected modules: Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: a credential committed to the task branch can reach main unscanned, and the "zero leaks" claim in PLAN.md cannot be re-inspected because no artifact exists. No secret value was exposed to E09 and none is printed here.
- Evidence: Where: security.yml:45-59 · Evidence: secret-scan triggers only on main push/PR plus cron: `"0 2 * * 1"` — a schedule only runs on the default branch — so on this branch it exists only as a manual dispatch; and it runs with GITLEAKS_ENABLE_COMMENTS: "false" and GITLEAKS_ENABLE_UPLOAD_ARTIFACT: "false".
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc security.yml:45-59 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng a credential committed to the task branch can reach main unscanned, and the "zero leaks" claim in PLAN.md cannot be re-inspected because no artifact exists trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "a credential committed to the task branch can reach main unscanned, and the "zero leaks" claim in PLAN.md cannot be re-inspected because no artifact exists", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: nguồn: E09 — CI: the gate tier that can print green without…

### F-048 — the repository — which lives under OneDrive, a synced third-party store, and is pushable to a remote — contains the complete server-scoped bot/role/channel identity map, enabling targeted impersonation of an agent mention surface, and the…

- Category: F2 — Security & Authorization
- Legacy register id: `R5-E13-03`
- Affected modules: OpenClaw runtime libs, README
- Severity: Medium
- Status: OPEN
- Root cause: the repository — which lives under OneDrive, a synced third-party store, and is pushable to a remote — contains the complete server-scoped bot/role/channel identity map, enabling targeted impersonation of an agent mention surface, and the 28 copies can silently diverge.
- Evidence: Where: README.md:46-52 plus :60/74/95/107/118/129/140 and :272-275; lib/authority.mjs:619-625, :628-636 · Evidence: README publishes seven 19-digit literals as agent Discord IDs plus seven more as channel/forum IDs; authority.mjs hardcodes the same set twice (DISCORD_BOT_IDS, DISCORD_ROLE_IDS). Values not echoed here. The registry comment at :610-617 correctly notes the owner's own id is deliberately absent.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc README.md:46-52 plus :60/74/95/107/118/129/140 and :272-275; lib/authority.mjs:619-625, :628-636 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng the repository — which lives under OneDrive, a synced third-party store, and is pushable to a remote — contains the complete server-scoped bot/role/channel… trước khi sửa (nội quy mục 3).
- Acceptance criteria: no tracked markdown file contains a raw Discord snowflake; authority.mjs stays the only source (a source-guard test of the kind M12/T2-R1 added for tags).
- Related findings: nguồn: E13 — secrets, identity and permission surfaces (6…

### F-049 — third-party Discord identities accumulate verbatim in durable, long-lived events and prompt transcripts, which §10 treats as content that must not be exposed

- Category: F2 — Security & Authorization
- Legacy register id: `R5-E13-04`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: Medium
- Status: OPEN
- Root cause: third-party Discord identities accumulate verbatim in durable, long-lived events and prompt transcripts, which §10 treats as content that must not be exposed; blast radius grows with the ledger, and R1-A08-05 already established that this journal cannot safely be rewritten.
- Evidence: Where: index.mjs:6148-6153 (beforeIngress); ledger-event.schema.json:410-431, :502-517, :736-759, :785-810 · Evidence: prompt: sanitizeDelegationText(event.prompt).split(config.ownerDiscordId).join("[OWNER_PRINCIPAL]") — exactly one principal is tokenized; the ledger contract requireds raw identity fields per event type (actor, user_principal_ref, message_id, channel) and a schema grep finds no redaction/sensitive keyword anywhere.
- Reproduction: Register chưa có bước tái hiện riêng; bước gần nhất suy từ acceptance/remediation: replace the single-id substitution with a referential scheme (map known principals to stable opaque refs at the ingress seam) and state the policy for unknown ids in the contract. Because it would change what is written to durable state, this is a schema/durable-state decision (RED), not a fix.
- Acceptance criteria: replace the single-id substitution with a referential scheme (map known principals to stable opaque refs at the ingress seam) and state the policy for unknown ids in the contract. Because it would change what is written to durable state, this is a schema/durable-state decision (RED), not a fix.
- Related findings: bug mở: R1-A08-05 · nguồn: E13 — secrets, identity and permission surfaces (6…

### F-050 — M7-063 is decorative: the only tracked occurrence sits outside its scope

- Category: F2 — Security & Authorization
- Legacy register id: `R5-E13-05`
- Affected modules: Workflow topology + ledger, Workflow topology, OpenClaw integration, Gates + CI
- Severity: Medium
- Status: OPEN — — the guard is aimed at the wrong files
- Root cause: M7-063 is decorative: the only tracked occurrence sits outside its scope. This is the _guard_ half of R1-A02-01 (the working-tree runtime load) and shows why that defect survived a gate written specifically against machine paths.
- Evidence: Where: index.mjs:511; tests/m7-lane-g-policy.test.mjs:724-733 (M7-063) · Evidence: index.mjs:511 contains the literal "/mnt/c/Users/HOANG VINH/OneDrive/Documents/personal-tool", while the test that bans machine paths iterates for (const rel of ["integrations/openclaw/topology/lib/schema.mjs","integrations/openclaw/topology/lib/guard.mjs"]) — the plugin file carrying the literal is not in the list.
- Reproduction: Register chưa có bước tái hiện riêng; bước gần nhất suy từ acceptance/remediation: no machine-specific absolute path in tracked source, and the guard's file list is derived from the resolution dependency set rather than hand-enumerated. Correction (orchestrator re-derivation, 2026-10-14): index.mjs:511 is not the only tracked occurrence. A repo-wide grep for /mnt/c/Users/HOANG VINH returns three hits: README.md:216 (cd "/mnt/c/Users/HOANG VINH/OneDrive/Documents/personal-tool" — the operator's…
- Acceptance criteria: no machine-specific absolute path in tracked source, and the guard's file list is derived from the resolution dependency set rather than hand-enumerated. Correction (orchestrator re-derivation, 2026-10-14): index.mjs:511 is not the only tracked occurrence. A repo-wide grep for /mnt/c/Users/HOANG VINH returns three hits: README.md:216 (cd "/mnt/c/Users/HOANG VINH/OneDrive/Documents/personal-tool" — the operator's documented WSL entry point, and legitimate), index.mjs:511 (the defect), and tests/m7-lane-g-policy.test.mjs:731 (the guard's own assertion string). Constraint this adds to the fix: widening M7-063 must…
- Related findings: bug mở: R1-A02-01 · nguồn: E13 — secrets, identity and permission surfaces (6…

### F-051 — dispatch a non-excel governed tool call carrying ../ in a path-shaped input through guard.beforeToolCall and observe that no SCHEMA_VALIDATION_FAILED is produced

- Category: F2 — Security & Authorization
- Legacy register id: `R5-E15-01`
- Affected modules: OpenClaw governance plugin (Discord), Workflow topology + ledger, Workflow topology, OpenClaw integration
- Severity: Medium
- Status: LATENT — Confirmed (code shape), reachability Strongly Supported
- Root cause: a schema-driven check over every path-shaped field / enforcement keyed by tool id, so a path field on any other tool (storage artifact_id, a power-bi template) is never examined, and the block is skipped silently rather than failing closed.
- Evidence: Where: integrations/openclaw/topology/lib/guard.mjs:1591-1612 (§6); other production sites guard.mjs:1946-1955, plugins/zink-governance/index.mjs:6357, :6564 · Evidence: if (candidateToolId === "zink_excel" && validatedParams.input?.file_path) and the same shape for "zink_python"/entrypoint. A repo-wide grep for validateArtifactLogicalPath finds only these sites plus tests. zink-tools/excel/README.md:33 asserts every file path passes that validator. · Expected/Actual: a schema-driven check over every path-shaped field / enforcement keyed by tool id, so a path field on any other tool (storage artifact_id, a power-bi template) is never examined, and the block is skipped silently rather than failing closed. · Detail: whether any governed contract besides excel/python actually carries a path-shaped field was not established (zink-tools/contracts/*.schema.json unread), which is what would move this LATENT → live.
- Reproduction: dispatch a non-excel governed tool call carrying ../ in a path-shaped input through guard.beforeToolCall and observe that no SCHEMA_VALIDATION_FAILED is produced. Not run — read-only lane.
- Acceptance criteria: a traversal-bearing path field on any governed tool is refused at ingress.
- Related findings: bug mở: R1-A16-03 · nguồn: E15 — untrusted-input security paths (5 findings; the…

### F-052 — putLandingArtifact({ artifact_id: "../silver/x" }) is accepted today

- Category: F2 — Security & Authorization
- Legacy register id: `R5-E15-02`
- Affected modules: Zink Tools
- Severity: Medium
- Status: LATENT
- Root cause: today the adapter's storage is an in-process Map (a documented test double, :30-34), so the loss is zone-namespace confusion plus a has(key) immutability check that can be shaped. When a real R2/S3 client lands, artifact_id becomes a literal object-key prefix escape across the governed landing/silver zones. The defect is that the hardening was applied to the demonstrated failing value rather than to the key-assembly boundary.
- Evidence: Where: zink-tools/adapters/storage/r2-adapter.mjs:68, :126-142, :144, :220-223, :85 · Evidence: const key = \silver/${artifact_id}/v${version}\; immediately preceded by a comment naming the exact threat — "a value like ../../landing/orders injects path syntax into the namespace". Only version is range/type-checked (:131-142); artifact_id gets a truthiness check (:61, :120), and provider_run_id: \r2-${run_id}\ is raw.
- Reproduction: putLandingArtifact({ artifact_id: "../silver/x" }) is accepted today. Not executed.
- Acceptance criteria: a non-logical artifact_id fails with its own error code.
- Related findings: nguồn: E15 — untrusted-input security paths (5 findings; the…

### F-053 — the knowledge adapter's SSRF allowlist has a blanket off switch

- Category: F2 — Security & Authorization
- Legacy register id: `R1-A03-06`
- Affected modules: Zink Tools
- Severity: Low
- Status: OPEN
- Root cause: an operator-supplied flag disables host checking with no log or positive control. Inputs are operator config, so severity stays Low, but this is the only path reaching the internal knowledge service.
- Evidence: Where: zink-tools/adapters/knowledge/knowledge-adapter.mjs:172-185 (if (!allowedHosts.has(host) && !this.options.allowRemote)), endpoint from process.env.KNOWLEDGE_ENDPOINT · Evidence: (code shape)
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc zink-tools/adapters/knowledge/knowledge-adapter.mjs:172-185 (if (!allowedHosts.has(host) && !this.options.allowRemote)), endpoint from process.env.KNOWLEDGE_ENDPOINT ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng the knowledge adapter's SSRF allowlist has a blanket off switch trước khi sửa (nội quy mục 3).
- Acceptance criteria: the outbound host is always checked against an explicit allowlist, and a bypass is announced.
- Related findings: nguồn: A03 — security and trust boundaries

### F-054 — static — no validation of containerName exists between :239 and :253

- Category: F2 — Security & Authorization
- Legacy register id: `R5-E15-04`
- Affected modules: Zink Skill Store
- Severity: Low
- Status: OPEN
- Root cause: an environment value reused as an argv token with no charset check; a local kill mistaken for cancellation. — Hệ quả: two distinct losses. (1) Container identity is an unvalidated environment/caller string positioned where docker exec still parses a leading-- value as its own option, so a caller controlling adapter options can alter the invocation shape. (2) A timed-out psql keeps running against Postgres after the client reports DB_TIMEOUT, so the advertised 30 s bound is a client-side illusion — the server-side query is unbounded.
- Evidence: Where: zink-skill-store/src/vector-sync.mjs:234-276 (executePostgresQuery) · Evidence: process.env.POSTGRES_CONTAINER || options.postgresContainer || "personal-tool-postgres-1" then spawn("docker", ["exec","-i",containerName,"psql",…]); the timeout branch does child.kill() only.
- Reproduction: static — no validation of containerName exists between :239 and :253.
- Acceptance criteria: an invalid container name is refused before spawn, and a timeout provably cancels the backend query.
- Related findings: nguồn: E15 — untrusted-input security paths (5 findings; the…

### F-055 — the vault path that gets validated is a different path object from the one that gets opened

- Category: F2 — Security & Authorization
- Legacy register id: `R5-E15-05`
- Affected modules: Zink Knowledgebase
- Severity: Low
- Status: HYPOTHESIS
- Root cause: the validated candidate is the object subsequently opened / two path objects, one checked and one used.
- Evidence: Where: apps/knowledge/app/pdf_foundation.py:150-171 (helper at :110-111, :122-147; config at config.py:64) · Evidence: supplied_relative = sidecar_path.relative_to(vault_root), then canonical_vault_path(...) (:162) runs the link/reparse checks on a re-derived candidate root.joinpath(*posix.parts), while :169 sidecar_path.stat() and :171 sidecar_path.read_bytes() read the original, un-normalised object. · Expected/Actual: the validated candidate is the object subsequently opened / two path objects, one checked and one used.
- Reproduction: read database.py:235-266 symlink gates plus this call chain with a symlinked vault root in a fixture.
- Acceptance criteria: the read handle comes from the validated candidate.
- Related findings: nguồn: E15 — untrusted-input security paths (5 findings; the…

### F-056 — the queue lease lifecycle has no runtime driver — a crashed claim never returns

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A06-01`
- Affected modules: OpenClaw runtime libs, OpenClaw integration, README, Governance records
- Severity: Critical
- Status: OPEN · premise changed 2026-10-17: drift: heartbeat now :621, detect :874; the index.mjs 'heartbeat' hits from :4427 are the unrelated liveness-trigger concept; README.md:740 and :874 still promise the reap happens 'periodically', which is unfunded
- Root cause: expired lease → revoke, attempt+1, requeue, re-pickup. Actual: the item stays EXECUTING with a past leaseExpiresAt forever.
- Evidence: Where: integrations/openclaw/lib/queue-manager.mjs:586 (heartbeat), :839 (detectAndRecoverStaleTasks) · Evidence: repo-wide grep finds zero non-test callers for both; lib/coordinator-pickup.mjs:129-134 only scans status === QUEUED. README.md:740, :874 and PLAN.md:1087 claim the Control Plane "periodically" reaps stale tasks. · Expected/Actual: expired lease → revoke, attempt+1, requeue, re-pickup. Actual: the item stays EXECUTING with a past leaseExpiresAt forever.
- Reproduction: In tests/m10-t1-coordinator-pickup.test.mjs add a case: claim a task (EXECUTING), force leaseExpiresAt into the past, then run startCoordinatorPickupLoop and assert the item is reclaimed. It passes the failure — the item stays EXECUTING forever, because grep across integrations/, zink-tools/, zink-skill-store/, scripts/ and apps/ shows detectAndRecoverStaleTasks has zero non-test callers and coordinator-pickup.mjs:134 filters status === QUEUED only. Runs on this host.
- Acceptance criteria: A background driver invokes detectAndRecoverStaleTasks on a schedule, so an EXECUTING item past its leaseExpiresAt is revoked, attempt incremented, returned to QUEUED and re-picked-up without operator intervention.
- Related findings: adjudication Vòng 2: Verified, Critical kept / / R1-A16-01 → Verified with correction, severity kept. — Post-approval execution is genuinely unreachable and no second enqueue path exists (enqueueTask… · nguồn: A06 — task, run and session lifecycle

### F-057 — post-approval execution is unreachable: nothing ever writes task.primary_coordinator

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A16-01`
- Affected modules: Gates + CI, Architecture + contracts docs
- Severity: Critical
- Status: OPEN — _(independent confirmation of R1-A06-02, from the flow side)_
- Root cause: every approved task dies at COORDINATOR_NOT_EXECUTABLE before enqueueTask (:5907), while the owner is told "Đã đưa vào hàng đợi thực thi" and the ledger says QUEUED. Silent and permanent.
- Evidence: Where: index.mjs:2528 deriveGovernedDispatchTarget (:2535, :2539), executeApprovedTask:5847-5859, pickup wiring :6106 → lib/coordinator-pickup.mjs:187-206 · Evidence: primary_coordinator is assigned only in tests/; WORKFLOW_OPENED's exactKeys (workflow.mjs:281-297) has no such field; docs/contracts/coordinator-session-binding.md:75 requires it "never defaulted".
- Reproduction: A node probe on this host: applyWorkflowEvent('WORKFLOW_OPENED', real payload) yields a derived task with no primary_coordinator, and deriveGovernedDispatchTarget(task) then returns {ok:false, error:'COORDINATOR_NOT_EXECUTABLE'}. Gate it in tests/m10-t1-coordinator-pickup.test.mjs: replay admission→approval using ONLY reducer events (no test-injected field) and run runCoordinatorPickup; assert it dispatches. Today it refuses for every ledger-built task.
- Acceptance criteria: Some reducer or admission step durably writes task.primary_coordinator for every approvable task, so a ledger-built (not test-faked) approved task resolves a dispatchable coordinator and the pickup loop can claim it.
- Related findings: bug mở: R1-A06-02 · nguồn: A16 — independent end-to-end traceability

### F-058 — the Skill Store imports the plugin's internal file-lock.mjs by relative path, creating two lock instances per process — a structural cause of the recurring orphan lock

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A02-03`
- Affected modules: OpenClaw runtime libs, OpenClaw integration, Zink Skill Store
- Severity: High
- Status: OPEN — _(extends K09 with its root cause)_ · premise changed 2026-10-17: consumer line drift 854→905-912; the coupling by relative path is real, but the two-instance symptom is a deployed-topology effect not observable on this single-root Windows tree
- Root cause: ownsRecordedLock() is false across instances, so release skips cleanup and leaves the lock directory behind — the mechanism behind the 2026-10-14 outage class. Also violates AGENTS.md §9 (Zink Tools is the only OpenClaw-facing boundary).
- Evidence: Where: zink-skill-store/src/catalog.mjs:24-27 (import { withFileLock, lockDirFor } from "../../integrations/openclaw/lib/file-lock.mjs"), lock state at integrations/openclaw/lib/file-lock.mjs:82 (const heldTokens = new Map()), consumer catalog.mjs:854, loaded by index.mjs:1075/:1453 · Evidence: in production the plugin loads catalog.mjs from /mnt/c/…, so it binds integrations/openclaw/lib/file-lock.mjs while the plugin's own ./lib/file-lock.mjs is the packaged copy at a different URL — two ESM instances with separate heldTokens; catalog.mjs's own comment warns a second implementation "would be a parallel policy".
- Reproduction: Static proof chain: catalog.mjs:27-29 binds withFileLock/lockDirFor from ../../integrations/openclaw/lib/file-lock.mjs and uses them at :905-912, while decision-ledger.mjs:15, queue-manager.mjs:16, guard.mjs:38 and ledger.mjs:20 import ./lib/file-lock.mjs; heldTokens (file-lock.mjs:83) is per-instance module state and configure.mjs:535 packages a second lib/file-lock.mjs asset. Under the deployed dual root (catalog served from /mnt/c by index.mjs:1075 while the packaged plugin loads its own copy) the same source resolves at two URLs → two heldTokens maps. Reproducible only in WSL.
- Acceptance criteria: One file-lock.mjs instance governs the writer lock in a process, so heldTokens reflects every live holder and the Skill Store cannot run a parallel lock policy.
- Related findings: adjudication Vòng 2: Verified with correction, causality downgraded · nguồn: A02 — module dependencies, shared components and duplication

### F-059 — admission loses the original cause and the inter-session digest binding is optional, so a resumed continuation can be minted started without comparison

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A05-08`
- Affected modules: Workflow topology + ledger, Workflow topology
- Severity: High
- Status: OPEN · premise changed 2026-10-17: the premise's native-boundary half is already fixed: enterNativeRun logs decision.reason via logDecisionReason (:511) and rethrows GOVERNANCE_RUN_UNAVAILABLE with {cause:error} (:531). Only the guard-side cause-loss and the optional digest
- Root cause: after a restart an admission refusal is indistinguishable across candidate-count / lineage / snapshot-read failures, and the ledger gains WORKFLOW_CONTINUATION_STARTED for a run whose payload was never compared.
- Evidence: Where: topology/lib/guard.mjs:1113-1210 (beforeRun), :1133 (void findErr;), :1144, :1159-1183; native-boundary.mjs:495, 504-513 · Evidence: the original findSession error is explicitly discarded; assert/fail (:253-258) throw bare codes with no cause; the E13 digest comparison runs only if (entry.trigger_run_id !== entry.previous_run_id) and if (context.inputProvenance.senderDigest); enterNativeRun logs error.message only and drops decision.reason. · R7 (nạp vị trí mới từ hàng `F-246` bị rút vì trùng root cause): the optional binding is not just conditional, it has no producer — a grep for `senderDigest` across `integrations/` returns only the two read sites `guard.mjs:1162` and `:1164`, so the `assert` can never run and every admitted continuation reaches `WORKFLOW_CONTINUATION_STARTED` (`guard.mjs:1170`) with the trigger digest unexamined. The first-generation case (`entry.trigger_run_id === entry.previous_run_id`, `:1159`) skips the block entirely, so even a produced field would not be compared there.
- Reproduction: Add a beforeRun test (idiom of tests/m7-lane-e-spawn-boundary.test.mjs or tests/m8-t2.11-r14-native-lineage.test.mjs): build an inter-session continuation whose entry.trigger_run_id === entry.previous_run_id with no inputProvenance.senderDigest, and assert beforeRun still returns allow — proving the E13 digest binding at guard.mjs:1157/:1162 is skippable. Separately assert the findSession error is discarded at :1131 (`void findErr`) and that fail()/assert (guard.mjs:255) emit bare codes with no cause.
- Acceptance criteria: beforeRun cryptographically binds an inter-session continuation to its trigger digest whenever a prior run or sender provenance exists, instead of allowing the check to be skipped, and a refused admission preserves the original findSession cause.
- Related findings: nguồn: A05 — runtime, entrypoints and startup behaviour · R7 delta audit: `F-246` withdrawn as a duplicate of this row, its locations merged here

### F-060 — primary_coordinator is a phantom ledger field, so the live pickup loop can never claim anything

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A06-02`
- Affected modules: OpenClaw governance plugin (Discord), Architecture + contracts docs
- Severity: High
- Status: OPEN
- Root cause: every task returns COORDINATOR_NOT_EXECUTABLE (and NO_EXECUTABLE_SPECIALIST while nodes is empty); the tick ends NO_PICKUP_CANDIDATE. Live corroboration read read-only by the agent: 0 WORKFLOW_TASK_CLAIMED, 0 WORKFLOW_COORDINATOR_RUN_BOUND — the whole coordinator execution lane is inert and fails silently.
- Evidence: Where: plugins/zink-governance/index.mjs:2535 (deriveGovernedDispatchTarget), wired as deriveTarget at :6106; read-only at :1890 · Evidence: grep -rn primary_coordinator finds two reads and no writer — no reducer event, schema field or tool ever sets it. docs/contracts/coordinator-session-binding.md §2.1 requires the coordinator be "taken from the ledger's primary_coordinator, never defaulted".
- Reproduction: Add a red case to tests/m10-t1-coordinator-pickup.test.mjs (21 pass / 0 fail today): build a task purely from production ledger events (WORKFLOW_OPENED … WORKFLOW_USER_APPROVAL_DECIDED in topology/lib/workflow.mjs) and assert deriveGovernedDispatchTarget(task) returns {ok:false, error:'COORDINATOR_NOT_EXECUTABLE'}, because no reducer event, schema field or tool writes primary_coordinator — index.mjs:2535 and :1890 read it and the only assignments live under tests/. The current suite passes only by hand-setting the field in fixtures.
- Acceptance criteria: A task reconstructed solely from production ledger events carries primary_coordinator, and deriveGovernedDispatchTarget resolves a coordinator from it so the live pickup loop can claim approved work.
- Related findings: adjudication Vòng 2: Verified with correction · nguồn: A06 — task, run and session lifecycle

### F-061 — once a coordinator task reaches EXECUTING the state machine has no exit at all

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A06-03`
- Affected modules: Workflow topology + ledger, Workflow topology, OpenClaw runtime libs, OpenClaw integration
- Severity: High
- Status: OPEN · premise changed 2026-10-17: 'no exit at all' is overstated: the question/answer round-trip is a live exit; the heartbeat recovery and WORKFLOW_CANCELLED handler exist but are unwired or dead
- Root cause: the first successful pickup creates a task nothing can close; queue and ledger diverge permanently. Depends on R1-A06-02 to actually occur.
- Evidence: Where: topology/lib/workflow.mjs:854-867, :1155-1202, :497-521; lib/queue-manager.mjs:951-960, :997-1028 · Evidence: no transition EXECUTING→QUEUED; WORKFLOW_CANCELLED has no emitter anywhere in integrations/; handleExecutionFinished (index.mjs:2187) is exported but never called; contract §9 forbids a coordinator run producing a result.
- Reproduction: Run `node --test tests/m10-t1-coordinator-pickup.test.mjs` (21 pass), then extend it: after WORKFLOW_TASK_CLAIMED (workflow.mjs:872 sets EXECUTING), assert the only EXECUTING exit reachable from a production caller is WORKFLOW_USER_QUESTION_RECORDED (→ WAITING_FOR_USER, looping back at :1042). grep proves handleExecutionFinished (index.mjs:2187) has zero non-export call sites, detectAndRecoverStaleTasks is called only from tests, and WORKFLOW_CANCELLED appears only as a reducer handler (workflow.mjs:505) and a schema enum with no emitter.
- Acceptance criteria: A task in EXECUTING reaches a pending or terminal state through an event some production path actually emits (completion or cancellation), so a stuck coordinator run can exit EXECUTING without depending on unwired recovery.
- Related findings: adjudication Vòng 2: Verified, High kept · bug mở: R1-A06-02 · nguồn: A06 — task, run and session lifecycle

### F-062 — runId is reused across fallback re-entries while liveness is runId-keyed and consumed destructively

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A06-04`
- Affected modules: Workflow topology + ledger, Workflow topology
- Severity: High
- Status: OPEN — (extends known K01)
- Root cause: only the first run-end of a run can classify like admission; the 2nd+ end — or one whose record aged out of the 256-entry map — loses trigger, so a heartbeat/liveness run falls into full completion governance → GOVERNANCE_DENIED → GOVERNANCE_COMPLETION_UNAVAILABLE, the unattributable error seen live 4× per run. Dedup note: replay protection itself is intact — findTaskByOriginBinding (index.mjs:7629) yields one durable task per message, so fallback re-entry does not duplicate tasks.
- Evidence: Where: topology/lib/native-boundary.mjs:558 (takeRunLiveness), :369-383; index.mjs:7665-7677, :7276 (forgetAdmissionLiveness) · Evidence: ingress admits the same runId as a retry, and const liveness = takeRunLiveness(context.runId) deletes the record before the guard runs.
- Reproduction: tests/m10-t2-r9-c-fallback-reentry.test.mjs (6 pass) already proves fallback reuses the same runId. Add a case: rememberAdmissionLiveness(R), then beforeRunEnd for R calls forgetAdmissionLiveness (index.mjs:7293, which deletes), then a second fallback attempt under R finds readAdmissionLiveness(R) undefined so isLivenessHeartbeat returns false (index.mjs:4571). Mirror it in native-boundary: finishNativeRun's takeRunLiveness(R) (:580) has already consumed the record, so trigger and transcriptPrompt fall through to undefined. Not run: mutating real state.
- Acceptance criteria: A model-fallback re-entry under an already-consumed runId still resolves its admission liveness (or run-end supplies an equivalent), so the fallback attempt is judged by the same governance predicate as the primary.
- Related findings: adjudication Vòng 2: Verified with correction, cause narrowed · nguồn: A06 — task, run and session lifecycle

### F-063 — read-only duplicate-sequence check on the live journal (grep -o '"sequence":[0-9]*' then sort/uniq -d)

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A08-02`
- Affected modules: OpenClaw runtime libs
- Severity: High
- Status: LATENT
- Root cause: single-writer is enforced only by an externally removable mkdir lock, and the integrity check is fail-stop with no fork rule. — Hệ quả: this upgrades the severity of the known orphan-lock class — from "writes are blocked" to "the 144-event governance history becomes unreadable". It is the concrete reason P02-09's "never auto-reclaim" rule matters: the guarded recovery tool racing a live writer is the fork.
- Evidence: Where: ledger.mjs:495-507 (sequence: snapshot.sequence + 1, previous_event_digest), 310-317; lib/file-lock.mjs:14 · Evidence: throw new Error("event chain mismatch") when event.sequence !== lastSequence + 1 || event.previous_event_digest !== previous; file-lock's header states "There is intentionally NO age-based stale-lock reclaim". · Expected/Actual: two appends behind one lock serialise vs after a lock-steal both writers emit seq N+1 from the same digest — replay _detects_ the fork and has no reconciliation path.
- Reproduction: read-only duplicate-sequence check on the live journal (grep -o '"sequence":[0-9]*' then sort/uniq -d).
- Acceptance criteria: a fixture with one forked pair replays and reports the discarded branch.
- Related findings: nguồn: A08 — ledger and event-store integrity *(Vòng 1: 16/16…

### F-064 — skill read/validate/apply cannot reach the ACTIVE version once any superseded version exists

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A10-01`
- Affected modules: Zink Skill Store, Zink Tools
- Severity: High
- Status: OPEN
- Root cause: deprecating v1 makes v2 unreadable and un-applicable — the skill silently disappears from the apply boundary, and zink-skill.schema.json:21 allows a / in skill_id while the error text demands a qualified id.
- Evidence: Where: zink-tools/adapters/skill-store/skill-adapter.mjs:120-174 (loadVerifiedRecord) → :365, :406; zink-skill-store/src/catalog.mjs:767 sorts by path only, while getActiveSkill (:780) does filter lifecycle · Evidence: the resolver iterates catalog.records, takes resolved[0], and never filters ACTIVE nor version; input.version is destructured at :210 and never used.
- Reproduction: In tests/m10-t2-r25-skill-read-apply-integrity.test.mjs (13 pass today, no two-version fixture exists) add a fixture with two records for one capability: DEPRECATED 1.0.0 at the lower relativePath and ACTIVE 2.0.0, then call read/apply for ns/cap. loadVerifiedRecord takes resolved[0] (path-sorted by catalog.mjs:802), i.e. 1.0.0, and the caller gate then throws SKILL_NOT_ACTIVE (skill-adapter.mjs:382, :423), so the ACTIVE version is unreachable. It never uses catalog.getActiveSkill (catalog.mjs:811 filters on lifecycle) and honours no requested version.
- Acceptance criteria: read, validate and apply resolve the record whose manifest.lifecycle.at(-1).status is ACTIVE (via getActiveSkill or explicit version selection), so a coexisting superseded version never blocks the ACTIVE one.
- Related findings: adjudication Vòng 2: Verified with correction · nguồn: A10 — Zink Tools, adapters and execution contracts

### F-065 — version governance: two duplicated supported-version lists, unconditional refusal, and cross-record era inference on replay

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A11-06`
- Affected modules: Workflow topology + ledger, Workflow topology
- Severity: High
- Status: OPEN
- Root cause: Register kết luận: version governance: two duplicated supported-version lists, unconditional refusal, and cross-record era inference on replay. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: Where: topology/lib/ledger.mjs:176-187, :230-240, :295-305, :311-317, :331-351, :366-383, :434-439 · Evidence: unknown schema_version/governance_version are refused (closed enum at ledger-event.schema.json:18-29, SCHEMA_VERSION const canonical.mjs:12) but there is no tolerant reader or migration path, so bumping either turns the whole ledger into EXECUTION_STATE_UNKNOWN "Ledger corruption" with the real cause only in error.cause; supportedVersions exists as two independent copies derived from neither the schema enum nor each other; an m8-t2.2-r4 record's meaning is decided by journalHasPreVerdictStamp (:295) — i.e. by which other lines happen to be present — while tail records replay under today's strict rules (workflow.mjs:543, :720). · Detail: the end-state re-verify at :377-382 hashes anchoredBudget[taskId]; if that field set is narrower than the task projection, reducer rule changes get absorbed silently.
- Reproduction: Measure the divergence directly: supportedVersions is two independent hard-coded literals (ledger.mjs:210 and :264), derived from neither the ledger-event.schema.json governance_version enum (:22-35) nor each other. Add a red case to tests/m8-t2.3-writer-semantics.test.mjs (9 pass today): replay a lone m8-t2.2-r4 event, then replay the same event with a PRE_VERDICT_VERSIONS line present, and assert preVerdictForEvent's answer is unchanged — today :338's journalHasPreVerdictStamp flips it. Also pin that a record with an unlisted governance_version throws EXECUTION_STATE_UNKNOWN (:222, :278) with the true cause only in error.cause (:488).
- Acceptance criteria: The reader tolerates or migrates a valid but unrecognized schema/governance_version, supportedVersions has one source shared with the schema enum, and each record's replay semantics derive from its own stamp alone, never from co-present lines.
- Related findings: nguồn: A11 — contracts, schemas and canonical definitions

### F-066 — the documented EXECUTION_FINISHED result chain is unreachable in production while two suites keep it green

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A12-03`
- Affected modules: Architecture + contracts docs, README
- Severity: High
- Status: OPEN — (canonical: R1-A12-03)
- Root cause: tests/m7-lane-f-result-integrity.test.mjs (10) + tests/m11-t1-openclaw-outbound-and-caches.test.mjs (12) pin behaviour no caller can produce; a green gate over dead code, and the operator doc describes a lifecycle the build does not have.
- Evidence: Where: index.mjs:2187 (handleExecutionFinished, definition only), :2373 (sole queueManager.finishExecution), :2405 (sole formatGovernedResultCard); registered hooks are only gateway_stop, before_tool_call, before_prompt_build, subagent_ended, subagent_spawned, message_sending, message_received (:7438-8559); grep execution_finished = 0 hits repo-wide · Evidence: README.md:88, 619, 637, 640 and docs/contracts/m7-m8-red-team-backlog.md:1575, 1606 state execution finish → RESULT_PENDING_REVIEW → #results card. #results is only surfaced from ACCEPT_RESULT (index.mjs:5770, 5812), i.e. after acceptance.
- Reproduction: `grep -rn 'handleExecutionFinished(' integrations/openclaw | grep -v 'export function'` returns zero hits, and enumerating the api.on(...) registrations (:7455-8576: gateway_stop, before_tool_call, before_prompt_build, subagent_ended, subagent_spawned, message_sending, message_received) shows no execution_finished handler, so queueManager.finishExecution (:2373) and formatGovernedResultCard (:2405) are reachable only from the never-invoked handler. Add a test asserting no message_received or subagent path dispatches to it.
- Acceptance criteria: A real runtime event fires EXECUTION_FINISHED → RESULT_PENDING_REVIEW and surfaces the result card on #results before ACCEPT_RESULT, observable by replaying the end-to-end flow; otherwise the README and backlog claim is removed.
- Related findings: đã sửa/xóa khỏi file: R1-A13-05 · nguồn: A12 — test validity and regression coverage

### F-067 — the operator lock recovery covers 1 of at least 4 governed lock roots, while M11/T3 widened the unprotected one

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A13-04`
- Affected modules: Workflow topology, OpenClaw runtime libs, Zink Skill Store
- Severity: High
- Status: OPEN
- Root cause: a stranded queue / decision-ledger / skill-store lock freezes task enqueue with FILE_LOCK_BUSY and has no guarded recovery, while PLAN.md §4/§8 presents the tool as the recovery the lock design assumed.
- Evidence: Where: topology/fixtures/runtime-regression/operator-lock-recovery.mjs:81 (hardcoded lockDirFor(ledgerPaths(…).root, "writer.lock")); other roots lib/queue-manager.mjs:140, lib/decision-ledger.mjs:262, zink-skill-store/src/catalog.mjs:849 · Evidence: 3cb8274 moved enqueueTask and clear() behind the queue lock; withFileLockSync is single-attempt (lib/file-lock.mjs:356) and release errors are swallowed when fn succeeded (:385-389) — the documented stranding path.
- Reproduction: `grep -rn 'lockDirFor('` shows at least four distinct governed lock roots — ledger writer.lock (operator-lock-recovery.mjs:83), queue-manager `<storage>.lock` (:162), decision-ledger `<storage>.lock` (:284) and the skill-store catalog writer lock (:905/:912) — while operator-lock-recovery.mjs clears only writer.lock. Red test: plant a stranded queue-manager lock, run the recovery, assert the queue still throws FILE_LOCK_BUSY. file-lock.mjs withFileLockSync does a single tryAcquire (:356) and drops the release error when fn succeeded (:384-389), which is the documented stranding path.
- Acceptance criteria: Operator lock recovery enumerates and clears every governed lock root (ledger, queue, decision-ledger, skill-store), or each module ships its own guarded recovery, so a stranded non-writer lock is diagnosable instead of permanent.
- Related findings: nguồn: A13 — Git history and cross-milestone regressions (21…

### F-068 — the coordinator pickup loop reports failures as return values that no one reads, so a permanently blocked queue logs nothing

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A14-06`
- Affected modules: OpenClaw integration
- Severity: High
- Status: OPEN — (pairs with R1-A06-02)
- Root cause: a claim failing every tick (e.g. QUEUE_LOCK_TIMEOUT, the queue-side twin of the live orphan-lock class K09) emits zero lines — approved tasks stay queued with no operator signal; LEDGER_CLAIM_RECORD_FAILED additionally leaves the queue EXECUTING while the ledger still says QUEUED.
- Evidence: Where: integrations/openclaw/lib/coordinator-pickup.mjs:407-424 (tick), :272-316, :743-781 · Evidence: tick() does await runOnce(); and discards the result; onError fires only on a _thrown_ error, while pickup returns {ok:false, error:"PICKUP_CLAIM_FAILED"|"PICKUP_ALREADY_CLAIMED"|"LEDGER_CLAIM_RECORD_FAILED"|"COORDINATOR_RUNTIME_SEAM_UNAVAILABLE"}.
- Reproduction: tests/m10-t1-coordinator-pickup.test.mjs (21 pass / 0 fail) already imports createPickupScheduler; none of its cases asserts onError on a returned ok:false. Add one: stub runOnce to return {ok:false, error:'PICKUP_CLAIM_FAILED'} (a value, never a throw) with an onError spy and assert onError fires each tick — today it is called zero times, so a permanently blocked queue is silent. Cover 'PICKUP_ALREADY_CLAIMED', 'LEDGER_CLAIM_RECORD_FAILED' and 'COORDINATOR_RUNTIME_SEAM_UNAVAILABLE' the same way (:277-309).
- Acceptance criteria: tick() inspects runOnce()'s result and routes {ok:false, error} to onError/logging, so a repeatedly failing pickup emits a diagnostic on every tick instead of silence.
- Related findings: bug mở: R1-A06-02 · nguồn: A14 — failure handling and reliability

### F-069 — no operator runbook covers the five live outage classes, and the guarded recovery tool lives in a fixtures directory

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A15-03`
- Affected modules: Workflow topology, Architecture + contracts docs, README, Governance records
- Severity: High
- Status: REFUTED — premise measured dead 2026-10-17: remediated after the row was filed: docs/runbooks/governed-outage-classes.md now documents all five classes with code, read-only check and non-authorizations (grep counts: FILE_LOCK_BUSY 1, GOVERNANCE_COMPLETION_UNAVAILABLE 6, APPROVAL_CARD (was: OPEN — _(the runbook gap the memory of this repo already flagged; now measured)_)
- Root cause: facing "bot stuck in #office" an operator cannot separate orphan lock / failed apply / buttonless card / fallback re-entry / tag refusal from the log — the exact confusion this session started in.
- Evidence: Where: docs/runbooks/ contains only knowledge-platform.md + operational-live-ledger.record.json; AGENTS.md:22-30 maps operator procedures → docs/runbooks/; the tool is at topology/fixtures/runtime-regression/operator-lock-recovery.mjs · Evidence: FILE_LOCK_BUSY, GOVERNANCE_COMPLETION_UNAVAILABLE, candidate_failed, APPROVAL_CARD_NOT_SURFACED, COMPONENT_SDK_UNAVAILABLE, model-fallback, re-entry → zero hits across README, runbooks, integration README, conventions and .agents/skills/ (only DISCORD_TAG_UNRESOLVED at README.md:278). README §15 troubleshooting table (:562-571) lists only DuckDB/R2/n8n/port items.
- Reproduction: Run `ls docs/runbooks/` (governed-outage-classes.md is present) and grep the five codes across docs/runbooks/ and its README — all five resolve to a documented class with a machine code, a read-only confirmation step and explicit non-authorizations.
- Acceptance criteria: Already satisfied: an operator-facing runbook in docs/runbooks/ enumerates each governed outage class with its code, a read-only check and the forbidden actions.
- Related findings: nguồn: A15 — documentation, operations and deployment consistency

### F-070 — preflight PASS is structurally blind to the orphaned writer lock that has twice killed an apply

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A15-04`
- Affected modules: Workflow topology + ledger, Workflow topology, README, Repo tooling + deploy scripts
- Severity: High
- Status: OPEN
- Root cause: one wasted deployment grant per orphan, while the ledger keeps failing closed meanwhile (CHANGELOG:34: 202 write failures).
- Evidence: Where: configure.mjs:1507-1511 (preflight returns) vs :1734 (upgradeEmptyLegacyLedger) → topology/lib/ledger.mjs:212-221 → :442-455 (withWriterLock, "Ledger writer unavailable"/EXECUTION_STATE_UNKNOWN); README.md:225-239 gates the lock check behind "CHỈ khi apply báo …" · Evidence: preflight only calls inspectLedgerUpgrade (the _read_ lock, ledger.mjs:164-190); the writer-lock call is reachable only in apply mode, after FIRST_MUTATING_STAGE = "builder-apply" (apply-orchestration.mjs:76-77).
- Reproduction: Red test in tests/m8-t2.8-r11-transactional-rollback.test.mjs: seed a temp ledger root, plant an orphan writer.lock/owner.json naming a dead pid, then call inspectLedgerUpgrade(paths) — it reads the snapshot and events directly (ledger.mjs:198 does only existsSync/readFileSync, never withWriterLock) and returns CURRENT/MISSING, so preflight PASSes blind to the orphan. Then call upgradeEmptyLegacyLedger(paths), which does take withWriterLock (:1805) and throws 'Ledger writer unavailable' / EXECUTION_STATE_UNKNOWN (ledger.mjs:488). This proves the lock probe is reachable only on the apply path.
- Acceptance criteria: --preflight actively probes the writer lock (a bounded tryAcquire or a liveness read of writer.lock/owner.json), so an orphaned writer.lock fails preflight instead of surfacing only at --apply.
- Related findings: nguồn: A15 — documentation, operations and deployment consistency

### F-071 — the Knowledgebase citation/provenance round trip breaks at the adapter: three advertised actions have no server route, and index identity is dropped

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A16-07`
- Affected modules: Zink Knowledgebase, Zink Tools
- Severity: High
- Status: OPEN
- Root cause: citation/metadata answer HTTP 404 → CONTROLLED_FAILURE; surviving citations cannot be tied to an index run, so provenance reaches the owner only as redacted free text — AGENTS.md §9's citation/provenance ownership is unmet end to end.
- Evidence: Where: zink-tools/adapters/knowledge/knowledge-adapter.mjs:150-158 (GET /v1/chunk, /v1/citation, /v1/metadata) vs apps/knowledge/app/main.py routes :224, 240, 322, 478, 541 (only /v1/search + /v1/index-runs); actions exposed to the model at index.mjs:3495-3498, :3533-3536; mapping drops index_id/indexed_by_run_id (knowledge-adapter.mjs:361-380); the root result envelope forbids artifact refs (guard.mjs:1095-1098)
- Reproduction: Measured on this host: an ASGI probe over create_app returns 404 {"detail":"Not Found"} for GET /v1/chunk, /v1/citation and /v1/metadata (apps/knowledge/app/main.py routes only /healthz, /readyz, POST /v1/search and POST+GET /v1/index-runs), and the adapter probe returns CONTROLLED_FAILURE/HTTP_404 for all three actions, with index_id and indexed_by_run_id absent from the mapping. Add to tests/m7-t5-remediation.test.mjs, reusing its http.createServer + listen(0,'127.0.0.1') idiom (:533) and its assert.equal(rejected.error,'HTTP_422') style, cases that executeGovernedKnowledgeQuery({action:'retrieve'|'citation'|'metadata'}) is not CONTROLLED_FAILURE and that a 200 mapping keeps index_id plus indexed_by_run_id. Mirror server-side in apps/knowledge/tests/test_b18_index_run_attribution.py. `node --test tests/m7-t5-remediation.test.mjs` → 33 pass / 0 fail today.
- Acceptance criteria: Each action advertised at index.mjs:3497 resolves to a real route, so search, retrieve, citation and metadata each return governed_status SUCCESS with a result for an indexed chunk, and the mapped result carries the index id plus indexed_by_run_id so a surfaced citation names the run that produced it.
- Related findings: adjudication Vòng 2: Verified, High · nguồn: A16 — independent end-to-end traceability

### F-072 — identity is a mutable text path plus an index-run UUID

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R5-E02-02`
- Affected modules: Zink Knowledgebase
- Severity: High
- Status: OPEN
- Root cause: identity is a mutable text path plus an index-run UUID. After a Vault edit or re-index the owner cannot tell which revision an answer came from; indexed_by_run_id covers thousands of files and is not a content revision; the same path in two builds is indistinguishable; citations cannot be re-verified by re-hashing. §9 makes provenance the Knowledgebase's own responsibility.
- Evidence: Where: database.py:1050-1082 (both branch projections), :128-145 (SearchCandidate), main.py:419-449 · Evidence: the dense/FTS select list is id, source_path, title, primary_topic, tags, heading_path, text, line_start, line_end, page_start, page_end, bbox, segment_type, indexed_by_run_id — no sha256, no source_id, and no join to knowledge.sources, although the digest is available and used elsewhere (SELECT source_path, sha256 FROM knowledge.sources, database.py:998). The response citation block re-emits only source_path plus line/page numbers.
- Reproduction: Runs on this host without PostgreSQL: a python probe prints SearchCandidate.**dataclass_fields** → has sha256? False, has source_id? False; inspect.getsource(search_candidates) → sha256? False, joins knowledge.sources? False (database.py:1050-1082 selects id, source_path … indexed_by_run_id only), while source_hashes proves the digest is reachable (:998). Pin the intent in apps/knowledge/tests/test_retrieval.py or test_m11_api_attribution.py: every serialized /v1/search result exposes an immutable source identity beside source_path.
- Acceptance criteria: Every search result and its citation block carries identity a file move or edit cannot reassign — the source sha256 and/or source_id joined from knowledge.sources — so two chunks sharing a path but differing in bytes are distinguishable in a surfaced citation.
- Related findings: nguồn: E02 — Knowledgebase retrieval, provenance and citations (7…

### F-073 — an upstream-supplied Retry-After: 86400 sleeps unbounded with the permit held, freezing both slots of the process-wide sharedSearchSemaphore(2)

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R5-E06-01`
- Affected modules: Zink Tools
- Severity: High
- Status: OPEN
- Root cause: an upstream-supplied Retry-After: 86400 sleeps unbounded with the permit held, freezing both slots of the process-wide sharedSearchSemaphore(2); every later zink_knowledge_search from any agent queues forever and the run dies on the host deadline. Extends R1-A14-07 — its "≈364 s worst case" arithmetic does not bound this path. Cross-lane note: this is the adapter-side mirror of R5-E02-06's 90 s embedding sleep inside the service's 2-slot limiter — the same outage shape at both ends of one call.
- Evidence: Where: knowledge-adapter.mjs:232-235, :317-332, :408-411 · Evidence: await sharedSearchSemaphore.acquire(); … const retryHeader = response.headers?.["retry-after"]; const seconds = parseInt(retryHeader, 10); if (!isNaN(seconds) && seconds > 0) retryDelayMs = seconds * 1000; … await setTimeout(retryDelayMs + jitterMs); with release only in finally.
- Reproduction: Measured on this host with `node --input-type=module -e` against a local server answering 429 + retry-after: 2: arrival timestamps were A#1@232ms, B#1@261ms, A#2@2502ms, B#2@2503ms, C#1@2508ms, D#1@2509ms — the third and fourth searches are gated by the upstream-chosen sleep because :370 sets retryDelayMs = seconds * 1000 uncapped and :380 awaits it while still holding the permit released only in the finally at :462-466. Add that case to tests/m7-t5-remediation.test.mjs (its http.createServer idiom, :533) asserting the 3rd/4th arrive at ~0ms.
- Acceptance criteria: The search permit is returned before any Retry-After wait and the wait is clamped to a repo-owned ceiling, so an upstream Retry-After: 86400 cannot delay further concurrent searches beyond that clamp, and two concurrent sleeps never occupy both slots of the process-wide semaphore.
- Related findings: bug mở: R1-A14-07, R5-E02-06 · nguồn: E06 — Zink Tools adapters (9 findings; two High, and they…

### F-074 — the sole cross-agent evidence store has no version, no diff history, no CI visibility and no backup

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R5-E12-03`
- Affected modules: Architecture + contracts docs
- Severity: High
- Status: OPEN · premise changed 2026-10-17: two halves of the original evidence are wrong: .gitignore:57 ignores .agents/states/*.md and :61 ignores ACTIVE.md — findings.md was never ignored, it was simply untracked because it lived in the ignored directory; and validating/SKILL.md:1
- Root cause: the sole cross-agent evidence store has no version, no diff history, no CI visibility and no backup; it is simultaneously declared non-authoritative, untracked and mandatory; and the zero-OPEN test cannot be independently executed by a reviewer on another machine. Parallel writers are already interleaving into it — which this session did, six lanes at once.
- Evidence: Where: validating/SKILL.md:103; code-review/SKILL.md:83; .gitignore:57, :61 · Evidence: validating:103 makes the gate depend on findings.md having "zero OPEN findings", while code-review:83 declares the same file "navigation/working-memory aids only; they are never authority". .gitignore:57 ignores it; it is 283,001 bytes and grew mid-audit (12 Status: OPEN on first grep, 24+ minutes later), with concurrent out-of-order appends — R5-E05-03 at :2172 precedes R5-E05-02 at :2192 and R5-E05-01 at :2207. · Detail: this is exactly the R3-P04-08 question the owner has not answered yet, so it is a decision, not a fix.
- Reproduction: Measured on this host before the commit: `git ls-files --error-unmatch docs/execution/findings.md` fails, `git status --porcelain docs/execution/` prints '?? docs/execution/', `git log -- docs/execution/findings.md` is empty and `git check-ignore` exits 1 (not ignored), while .agents/skills/code-review/SKILL.md:122 and validating/SKILL.md:96 assert the register is tracked and permanent. After the closeout commit, `git ls-files` must list it — pin that as an assertion in tests/repository-policy.test.mjs, which already scans tracked files through execFileSync. File measured at 430,703 bytes / 224 rows / 186 OPEN.
- Acceptance criteria: `git ls-files` lists docs/execution/findings.md, so every row edit carries a commit, an author and a diff, an append is reviewable in git show, and the 'tracked, permanent' claim in both skills is literally true. Whether the register may gate a task remains a separate owner decision.
- Related findings: bug mở: R5-E05-03, R5-E05-02, R5-E05-01, R3-P04-08 · nguồn: E12 — skills procedure vs practice (7 findings; the two…

### F-075 — the coordinator pickup loop is started per register() with no process-level latch — four loops observed in one live process

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A02-08`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: Medium
- Status: OPEN · premise changed 2026-10-17: locator corrected: the loop is created at index.mjs:6111-6138 (was cited as :6094-6122) and stopped only at :7459-7464; the four-loop live observation cannot be re-measured on this host
- Root cause: concurrent duplicate claims / repeated WORKFLOW_TASK_CLAIMED and duplicated coordinator turns over the shared defaultQueueManager singleton.
- Evidence: Where: index.mjs:6094-6122 (let coordinatorPickupLoop = null inside register), :7442-7447; neighbouring state _does_ latch (:196, :203 globalThis[Symbol.for(…)], :4778 leases, :4804 startingRuns) · Evidence: comment claims "exactly one scheduler instance per plugin registration"; live journal PID 68567 logs coordinator pickup loop started at 13:26:06, 13:26:18, 13:50:52 and 13:52:34 — four loops, one process.
- Reproduction: At HEAD the scheduler is created inside register() with no process-level latch: index.mjs:6111-6118 evaluates ledgerSnapshotPresent once and :6119-6138 calls startCoordinatorPickupLoop, while neighbouring state does latch on globalThis (:196, :203, the lease map at :4777-4780, startingRuns at :4804) and the only stop is gateway_stop (:7459-7464). Gate it in tests/m10-t1-coordinator-pickup.test.mjs: call register() twice in one process against one state dir and assert exactly one scheduler claims work.
- Acceptance criteria: One process runs exactly one coordinator pickup scheduler: a second register() in the same process attaches to the existing loop instead of starting another, so two loops sharing defaultQueueManager can never both claim the same queued task.
- Related findings: adjudication Vòng 2: Verified, re-graded Medium → Low, live-reproduced · nguồn: A02 — module dependencies, shared components and duplication

### F-076 — ASK_USER attributes a governed question to a run that did not ask it

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A06-05`
- Affected modules: Workflow topology + ledger, Workflow topology
- Severity: Medium
- Status: OPEN
- Root cause: WAITING_FOR_USER binds waiting_question_run_id/agent_id to a fabricated owner, breaking the origin-message → task → run → answer correlation that M12 depends on.
- Evidence: Where: index.mjs:2113-2120; topology/lib/workflow.mjs:226-248, :938-988 (:976-982 requires the payload to equal that resolution) · Evidence: the asker is resolveCurrentRunOwner(authoritativeTask) = the RUNNING delegation or else the root run; coordinator_runs is not part of the resolution, so a coordinator can never be the recorded asker.
- Reproduction: Measured at HEAD: index.mjs:2113 resolves the asker with resolveCurrentRunOwner(authoritativeTask) and :2114-2116 records WORKFLOW_USER_QUESTION_RECORDED with that agent_id and run_id; workflow.mjs:226-228 ownerRunAgentId returns the RUNNING delegation's agent or the root run and coordinator_runs takes no part in the resolution, so a coordinator that actually asked can never be the recorded asker — and :976-982 then requires the answer payload to equal that same fabricated resolution. Gate it in tests/m7-lane-d2-question-answer.test.mjs: ask from a coordinator run and assert the recorded asker is that run.
- Acceptance criteria: The recorded asker of a governed question is the run that actually asked: waiting_question_run_id and agent_id resolve from the asking run including a coordinator run, and the answer correlation check compares against that same resolution.
- Related findings: nguồn: A06 — task, run and session lifecycle

### F-077 — the reducer admits a digest-less result into review, then every verdict requires a digest

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A06-06`
- Affected modules: Workflow topology + ledger, Workflow topology, OpenClaw runtime libs
- Severity: Medium
- Status: OPEN
- Root cause: an unresolvable RESULT_PENDING_REVIEW with no cancellation emitter, plus queue/ledger divergence.
- Evidence: Where: topology/lib/workflow.mjs:1198-1201 vs :1568-1571; index.mjs:2315-2319; lib/queue-manager.mjs:685-688 · Evidence: task-level WORKFLOW_RESULT_RECORDED treats payload_digest as optional, but requireResultIdentityMatch fails RESULT_MISMATCH unless a digest string exists; callers pass payloadDigest, null when no artifact exists, while finishExecution mints its own fallback digest the ledger never learns. · R7 (nạp cơ chế mới từ hàng `F-248`, để lại `LATENT`): the store is conditional (`workflow.mjs:1207-1210` sets `execution_payload_digest` only `if (payload.payload_digest)`) while every verdict path opens with `requireCondition(typeof currentDigest === "string", "RESULT_MISMATCH")` at :1580-1583, and the comment at :1584-1587 records that an earlier null-versus-undefined mistake "made EVERY verdict fail and wedged the task in review". Measured at HEAD this session: an event carrying `payload_digest: null` is rejected at append by `validateContract("ledger-event", …)` (`topology/lib/ledger.mjs:543`) with `SCHEMA_INVALID: SCHEMA_VALIDATION_FAILED` — verified by handing a synthetic event to that validator — so the live artifact-less run fails the append rather than wedging, and the wedge itself needs an emitter that omits the key.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc topology/lib/workflow.mjs:1198-1201 vs :1568-1571; index.mjs:2315-2319; lib/queue-manager.mjs:685-688 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng the reducer admits a digest-less result into review, then every verdict requires a digest trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "the reducer admits a digest-less result into review, then every verdict requires a digest", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: adjudication Vòng 2: Verified, Medium kept · nguồn: A06 — task, run and session lifecycle · R7 delta audit: `F-248` kept as the `LATENT` successor of this row

### F-078 — a spawn reservation stuck in SPAWN_UNKNOWN has no timeout, no terminal event and no reconciler

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A06-08`
- Affected modules: Workflow topology + ledger, Workflow topology
- Severity: Medium
- Status: OPEN
- Root cause: one lost spawn receipt wedges a task (WORKFLOW_ROOT_RESULT_RECORDED → MISSING_PREREQUISITE) with no operator path forward.
- Evidence: Where: topology/lib/workflow.mjs:35, :400-406, :1081, :1811, :561-564; index.mjs:4857 · Evidence: activeRun includes SPAWN_UNKNOWN; only WORKFLOW_SPAWN_RECEIVED clears it; WORKFLOW_NATIVE_ENDED needs a matching native_run_id, which is unset, so a late child report fails LINEAGE_MISMATCH; awaitSpawnReceipt gives up after 10 s and records nothing while the authorizing lease lives 10 min.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc topology/lib/workflow.mjs:35, :400-406, :1081, :1811, :561-564; index.mjs:4857 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng a spawn reservation stuck in SPAWN_UNKNOWN has no timeout, no terminal event and no reconciler trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "a spawn reservation stuck in SPAWN_UNKNOWN has no timeout, no terminal event and no reconciler", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: adjudication Vòng 2: Verified with correction · nguồn: A06 — task, run and session lifecycle

### F-079 — isPreAdmittedFixture is a fixture-named admission branch fully reachable in production

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A07-05`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: Medium
- Status: OPEN · premise changed 2026-10-17: locators drifted about 17 lines: the flag is set at index.mjs:6893-6912 and the branch is at :6916 (cited as :6876-6899 / :6899-6922)
- Root cause: the branch returns the guard verdict directly and never calls requestFirstSpawnApproval, so an AUTH_APPROVAL_REQUIRED denial there is a silent dead end with no owner card; a snapshot read failure is swallowed into isPreAdmittedFixture = false.
- Evidence: Where: index.mjs:6876-6899 (set), :6899-6922 (branch), inside the live event.toolName === "sessions_spawn" path; discriminator is model-supplied parsedProposal.node_id/inputs from event.params.task (:6866-6871) · Evidence: (reachability)
- Reproduction: Read index.mjs:6893-6916 at HEAD: isPreAdmittedFixture is set from a snapshot read inside the live `event.toolName === 'sessions_spawn'` path, its discriminator is model-supplied parsedProposal.node_id and inputs taken from event.params.task, and :6916 returns guard.beforeToolCall's verdict directly without ever calling requestFirstSpawnApproval — so an AUTH_APPROVAL_REQUIRED denial there is a dead end with no owner card, and a snapshot read failure is swallowed into `isPreAdmittedFixture = false` (:6912). Gate it in tests/m10-t2-r12-first-spawn-approval.test.mjs with a production-shaped spawn whose node_id matches a fixture name.
- Acceptance criteria: no production spawn path can skip the approval surface based on model-supplied JSON.
- Related findings: adjudication Vòng 2: Verified with correction, severity kept Medium · nguồn: A07 — governance and the approval workflow

### F-080 — handleDiscordAction's authoritative-state resolution and its ledger write are both optional (paths-gated)

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A07-06`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: Medium
- Status: OPEN
- Root cause: without paths the verdict is evaluated against caller-supplied currentState; a nonexistent task id passes, and the verdict returns allowed:true with no durable audit trail. The reducer only backstops when a write is attempted.
- Evidence: Where: index.mjs:1862 (if (paths)), :1872 (if (authoritativeTask)), :1977 (if (paths && auth.nextState))
- Reproduction: handleDiscordAction (index.mjs:1797) reads authoritative state only inside `if (paths)` (:1862), applies it only inside `if (authoritativeTask)` (:1872), and writes the ledger only inside `if (paths && auth.nextState)` (:1977). Gate it in tests/m7-lane-d-decision.test.mjs: call handleDiscordAction with no paths and a task id that does not exist, and assert the verdict is DENIED — today it evaluates against the caller-supplied currentState, returns allowed:true, and leaves no durable audit trail.
- Acceptance criteria: an approval verdict without an authoritative ledger task returns DENIED.
- Related findings: adjudication Vòng 2: Verified with correction, raised Medium → High · nguồn: A07 — governance and the approval workflow

### F-081 — terminal forensics for the known 4-NATIVE_ENDED/144-events gap is unresolvable from the ledger alone, and event-count reconciliation is impossible

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A08-03`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: Medium
- Status: OPEN
- Root cause: a dedupe should journal the receipt (or return an explicit discarded signal) vs the writer returns success having appended nothing — the ledger cannot distinguish "arrived and was ignored" from "never happened".
- Evidence: Where: ledger.mjs:607-618; reducer "late duplicate receipt" returns at workflow.mjs:279, 417-421, 546, 549-551, 1069, 1135 · Evidence: if (canonicalHash(…current) === canonicalHash(…projected)) return current;, with the reducer starting const next = structuredClone(snapshot) and returning it unchanged. · Expected/Actual: a dedupe should journal the receipt (or return an explicit discarded signal) vs the writer returns success having appended nothing — the ledger cannot distinguish "arrived and was ignored" from "never happened".
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc ledger.mjs:607-618; reducer "late duplicate receipt" returns at workflow.mjs:279, 417-421, 546, 549-551, 1069, 1135 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng terminal forensics for the known 4-NATIVE_ENDED/144-events gap is unresolvable from the ledger alone, and event-count reconciliation is impossible trước khi sửa (nội quy mục 3).
- Acceptance criteria: duplicate receipts appear in the journal, or the caller gets discarded:true.
- Related findings: bug mở: R1-A16-06 · nguồn: A08 — ledger and event-store integrity *(Vòng 1: 16/16…

### F-082 — read-only — list snapshot tasks whose workflow_status is non-terminal and which have no matching terminal event

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A08-04`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: Medium
- Status: OPEN
- Root cause: 56 opens against 4 closes, with zero detection from the ledger layer. Ghost tasks also skew the active-run prerequisite gates.
- Evidence: Where: replay validation ledger.mjs:224-418; ledger-event.schema.json type enum (26 values, none for expiry); ledger-snapshot.schema.json workflow_status enum · Evidence: no WORKFLOW_EXPIRED-class event type exists ("EXPIRED" appears only as the reason AUTH_APPROVAL_EXPIRED, guard.mjs:373); the snapshot accepts non-terminal ACTIVE/EXECUTING/REVISING/BLOCKED indefinitely; replay validates digests only. · Detail: 56 opens against 4 closes, with zero detection from the ledger layer. Ghost tasks also skew the active-run prerequisite gates.
- Reproduction: read-only — list snapshot tasks whose workflow_status is non-terminal and which have no matching terminal event.
- Acceptance criteria: replay flags or closes every task lacking a terminal record.
- Related findings: bug mở: R1-A16-06, R1-A07-03 · nguồn: A08 — ledger and event-store integrity *(Vòng 1: 16/16…

### F-083 — silent capability loss at load: no host-compatibility assertion and no interactive-surface self-check

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A09-07`
- Affected modules: OpenClaw governance plugin (Discord), OpenClaw runtime libs
- Severity: Medium
- Status: OPEN · premise changed 2026-10-17: locator drifted: the guard is index.mjs:8307-8308 (cited as :8290); the rest of the evidence is unchanged and the host-log half needs the live WSL tree
- Root cause: the collision resolves correctly today by precedence, but stale pre-M12 builds stay discoverable and nothing at load proves the component SDK/handler exists — so "unit active, 7 sockets, zero refusals" is not evidence any button can work.
- Evidence: Where: index.mjs:8290 (if (typeof api.registerInteractiveHandler === "function"), no else); openclaw.plugin.json declares no host version; banner index.mjs:4751 v2026.9.24 vs pinned OPENCLAW_RELEASE = "2026.6.34" (lib/policy.mjs:53); SDK resolved from process.argv[1] (discord-native-send.mjs:227-245) · Evidence: live host log duplicate plugin id resolved by explicit config-selected plugin; global plugin will be overridden by config plugin (… extensions/zink-governance-pre-mig-20260928/index.mjs); ~/.openclaw-zink/extensions/ holds three trees all declaring id: "zink-governance".
- Reproduction: At HEAD index.mjs:8307 guards interactive registration with `if (typeof api.registerInteractiveHandler === 'function')` and has no else branch, so a host without that API loads green while every button is silently lost; openclaw.plugin.json declares no host version, the banner (index.mjs:4751) reports v2026.9.24 while lib/policy.mjs:53 pins OPENCLAW_RELEASE '2026.6.34', and the component SDK is resolved from process.argv[1] (discord-native-send.mjs:227-245). Gate it in tests/m12-t1-discord-component-registry.test.mjs: register against an api stub lacking registerInteractiveHandler and assert load emits a capability line naming the loss.
- Acceptance criteria: load emits a capability line for interactive + component-SDK; backup trees live outside the discovery directory.
- Related findings: nguồn: A09 — Discord and external integrations

### F-084 — the §3 release-gate cell still records the pre-deployment build, so a reader concludes the deployment never happened

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A09-08`
- Affected modules: Governance records
- Severity: Medium
- Status: OPEN
- Root cause: PLAN.md is internally inconsistent — the durable §8 record and §4 header were updated, the §3 milestone cell was not — so any agent that bootstraps from the release-gate table reads the deployment as never having happened. This is the same failure mode as R1-A15-05 and it is what misled the orchestrator earlier in this session.
- Evidence: Detail: live lib/discord-forum-tags.mjs = 18fbb077… while "PLAN records it as e0a755bb… still installed", i.e. the deployed build is not the recorded one.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc entry không còn `Where:` — dựng lại locator từ `PLAN.md` §8 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng → VERIFIED WITH CORRECTION by the orchestrator: the live build IS the recorded build; the stale record is PLAN.md's own milestone cell trước khi sửa (nội quy mục 3).
- Acceptance criteria: every digest claim about the installed build agrees across §3, §4 and §8.
- Related findings: bug mở: R1-A15-05 · nguồn: A09 — Discord and external integrations

### F-085 — the owner-verdict enum: schema permits 6 values, the reducer accepts 3, authority uses different names

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A11-02`
- Affected modules: OpenClaw runtime libs
- Severity: Medium
- Status: OPEN
- Root cause: three schema-permitted verdicts are dead vocabulary, and a future writer trusting the published contract mints a replay-proof event the reducer refuses.
- Evidence: Where: ledger-event.schema.json:1149-1156 vs workflow.mjs:720-725 vs lib/authority.mjs:47-73 · Evidence: schema allows APPROVE, REJECT, REQUEST_REVISION, ACCEPT, REJECT_RESULT, REQUEST_REVISION_RESULT; the reducer fails the last three with SCHEMA_INVALID; BLOCK exists only as a const (:850) on another event type; authority names them REJECT_APPROVAL/ACCEPT_RESULT, mapped only in plugin code (index.mjs:1904-1915).
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc ledger-event.schema.json:1149-1156 vs workflow.mjs:720-725 vs lib/authority.mjs:47-73 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng the owner-verdict enum: schema permits 6 values, the reducer accepts 3, authority uses different names trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "the owner-verdict enum: schema permits 6 values, the reducer accepts 3, authority uses different names", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: nguồn: A11 — contracts, schemas and canonical definitions

### F-086 — two "byte-equal" deployment post-checks report different denominators (35 vs 37) for a packaged set that did not change

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A13-06`
- Affected modules: Workflow topology, OpenClaw runtime libs, OpenClaw integration, Governance records
- Severity: Medium
- Status: OPEN
- Root cause: Register kết luận: two "byte-equal" deployment post-checks report different denominators (35 vs 37) for a packaged set that did not change. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: Where: PLAN.md:40, :88-89 (35) vs PLAN.md:5009 (37) · Evidence: git diff --stat b6d04e8 HEAD -- integrations/ shows only configure.mjs, lib/discord-forum-tags.mjs, operator-lock-recovery.mjs, operator-preflight.mjs; governancePluginFiles() asset lists (lib/policy.mjs:1182-1277) unchanged. Not settleable without executing the packager (readdirSync(topology/contracts)).
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc PLAN.md:40, :88-89 (35) vs PLAN.md:5009 (37) ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng two "byte-equal" deployment post-checks report different denominators (35 vs 37) for a packaged set that did not change trước khi sửa (nội quy mục 3).
- Acceptance criteria: one documented denominator, both records restated against it.
- Related findings: nguồn: A13 — Git history and cross-milestone regressions (21…

### F-087 — tool-call lease verification deletes the lease before checking it; three distinct denials collapse to POLICY_DENIED and leak identity values into the log

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A14-04`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: Medium
- Status: OPEN · premise changed 2026-10-17: locators drifted: before_tool_call is index.mjs:7467, the unconditional delete is :7487 and the denial :7488 (cited as :7447-7478); leaseKey's identity-bearing throw is :4690
- Root cause: one bogus or duplicate call destroys the one-shot lease and denies the real call; combined with the 4× model-fallback re-entry (K01) a failed attempt can consume the lease so the retry is denied and surfaces as GOVERNANCE_DENIED.
- Evidence: Where: index.mjs:7447-7478 (api.on("before_tool_call")), :4684-4697 (leaseKey) · Evidence: leases.delete(key); if (!matched) throw new Error("POLICY_DENIED"); — delete is unconditional; leaseKey throws LINEAGE_MISMATCH: sessionKey=…, runId=…, toolCallId=… which is logged verbatim two lines below, contradicting the module's own "no params, no hash" policy at :7468; leaseKey reads context.X ?? event.X, mixing trusted context with tool payload.
- Reproduction: Read index.mjs:7467-7490 at HEAD: `leases.delete(key)` (:7487) runs unconditionally before `if (!matched) throw new Error('POLICY_DENIED')` (:7488), so one bogus or duplicate call burns the one-shot lease and the correct call that follows is denied; the catch at :7489-7490 logs err.message verbatim while leaseKey's throw (:4690) embeds sessionKey, runId and toolCallId, contradicting the 'no params, no hash' comment at :7484. Gate it in the lease suite: deny once with a wrong digest, replay the correct call and assert it is still authorized, and assert no identity value reaches the log.
- Acceptance criteria: a mismatched call does not disable the next correct call, and the three causes are distinguishable in the log.
- Related findings: adjudication Vòng 2: Verified with correction · nguồn: A14 — failure handling and reliability

### F-088 — event.yielded === true grants run-end approval before the success assertion, so a failed run passes with no terminal record

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A14-05`
- Affected modules: Workflow topology + ledger, Workflow topology
- Severity: Medium
- Status: OPEN — _(candidate cause of R1-A06/K-now-4)_
- Root cause: the mirror image of K01 — a failed run passes governance and records nothing, so the ledger shows an open task the owner was told finished. Whether the host ever emits yielded on a real run-end is Not Verified.
- Evidence: Where: topology/lib/guard.mjs:970 (beforeRunEnd) · Evidence: if (owner.delegation || event.yielded === true) return { allow: true }; immediately before assert(event.success === true, "EXECUTION_STATE_UNKNOWN").
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc topology/lib/guard.mjs:970 (beforeRunEnd) ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng event.yielded === true grants run-end approval before the success assertion, so a failed run passes with no terminal record trước khi sửa (nội quy mục 3).
- Acceptance criteria: no run-end path returns allow: true without success === true or a recorded terminal event.
- Related findings: adjudication Vòng 2: Verified · nguồn: A14 — failure handling and reliability

### F-089 — PLAN.md is 377 KB / 5,054 lines with a 1,203-word single table cell, while the documented process requires reading it whole

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A15-05`
- Affected modules: Gates + CI, README, Governance records
- Severity: Medium
- Status: OPEN — _(the strongest input to Vòng 3's memory/linking proposals)_
- Root cause: authorization decisions get made from partial reads — proven this session by R1-A09-08, where the stale §3 cell contradicted the §8 record.
- Evidence: Where: PLAN.md:40 (8,550 chars), :41 (408 words); .agents/skills/execution/SKILL.md:75 "Read AGENTS.md + PLAN.md"; .agents/states/README.md:51-52 "before any write operation, re-read PLAN.md", :131; AGENTS.md:112-116 vs AGENTS.md §4 "read only what is needed" · Evidence: measured ≈94,000 tokens, over the 2,000-line read limit (needs 3 passes). package.json:21-22 prettier globs and .markdownlint-cli2.mjs:6-9 exclude PLAN.md and AGENTS.md, so nothing checks structure or doc↔code sync and cells grow unbounded.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc PLAN.md:40 (8,550 chars), :41 (408 words); .agents/skills/execution/SKILL.md:75 "Read AGENTS.md + PLAN.md"; .agents/states/README.md:51-52 "before any write operation, re-read PLAN.md", :131; AGENTS.md:112-116 vs AGENTS.md §4 "read only what is needed" ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng PLAN.md is 377 KB / 5,054 lines with a 1,203-word single table cell, while the documented process requires reading it whole trước khi sửa (nội quy mục 3).
- Acceptance criteria: the bootstrap-required section fits one read pass and is linted.
- Related findings: bug mở: R1-A09-08 · nguồn: A15 — documentation, operations and deployment consistency

### F-090 — rehearsal traffic increments budget counters in live state

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R2-B03-02`
- Affected modules: Repo tooling + deploy scripts
- Severity: Medium
- Status: OPEN
- Root cause: Register kết luận: rehearsal traffic increments budget counters in live state.. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: Evidence: live-governance-probe.mjs:241-242 asserts delegated_runs_used === 6, transitions_used === 1 against the production snapshot, so a later audit of real task spend reads rehearsal numbers.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc entry không còn `Where:` — dựng lại locator từ `PLAN.md` §8 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng rehearsal traffic increments budget counters in live state. trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "rehearsal traffic increments budget counters in live state.", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: nguồn: B03 — governance / ledger / audit integrity (10 claims…

### F-091 — the digest is computed once per process and nothing in its key can change at runtime, so after a PDF runtime/manifest/tokenizer change a long-lived /readyz probes forever against a stale expectation — permanent false not_ready (replica…

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R5-E01-02`
- Affected modules: Zink Knowledgebase
- Severity: Medium
- Status: LATENT
- Root cause: the digest is computed once per process and nothing in its key can change at runtime, so after a PDF runtime/manifest/tokenizer change a long-lived /readyz probes forever against a stale expectation — permanent false not_ready (replica marked unhealthy) or green readiness that no longer predicts the run path, which recomputes fresh each run (index_lifecycle.py:254-256). The P3-07 memo was keyed on configuration paths rather than on the content it hashes.
- Evidence: Where: main.py:238-297 (readyz_pdf_identity, cache_key) with pdf_runtime.py:81-91 · Evidence: the memo's comment at :236-237 promises "recomputed only if one of those inputs changes", but cache_key (:284-291) is 3 embedding fields plus str(lock_path), str(manifest_path), str(tokenizer_path) — all path strings — while the memoized value is content-derived (runtime_lock_digest = _sha256_file(runtime_lock_path), pdf_runtime.py:89-91, and sha256_file(configured_settings.tokenizer_path) at main.py:146).
- Reproduction: Register chưa có bước tái hiện riêng; bước gần nhất suy từ acceptance/remediation: key the memo on cheap content evidence (st_mtime_ns + st_size), or drop the memo and keep the bounded asyncio.to_thread recompute. Do not widen the probe lock timeout (ceiling rule).
- Acceptance criteria: key the memo on cheap content evidence (st_mtime_ns + st_size), or drop the memo and keep the bounded asyncio.to_thread recompute. Do not widen the probe lock timeout (ceiling rule).
- Related findings: nguồn: E01 — Knowledgebase service internals (6 findings + a…

### F-092 — bounded, retryable recovery / an unbatched bulk delete under a 30 s command_timeout sitting on the only path that makes the service ready

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R5-E03-03`
- Affected modules: Zink Knowledgebase
- Severity: Medium
- Status: OPEN
- Root cause: bounded, retryable recovery / an unbatched bulk delete under a 30 s command_timeout sitting on the only path that makes the service ready.
- Evidence: Where: database.py:1519-1565 recover_interrupted_runs, :1626-1646 _purge_index_content, :191 pool command_timeout=30; main.py:166-195 · Evidence: UPDATE knowledge.indexes SET status='FAILED' … WHERE status='BUILDING' (:1547-1555) then a single DELETE FROM knowledge.segments WHERE index_id = ANY($1::uuid[]) (:1641) for every FAILED index, in one transaction, one statement; await database.recover_interrupted_runs() (main.py:172/175) has no try. The comment at :1556-1558 identifies it as the M11/T1-R1 "leave zero content rows behind" sweep. · Expected/Actual: bounded, retryable recovery / an unbatched bulk delete under a 30 s command_timeout sitting on the only path that makes the service ready.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc database.py:1519-1565 recover_interrupted_runs, :1626-1646 _purge_index_content, :191 pool command_timeout=30; main.py:166-195 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng bounded, retryable recovery / an unbatched bulk delete under a 30 s command_timeout sitting on the only path that makes the service ready trước khi sửa (nội quy mục 3).
- Acceptance criteria: startup against a FAILED index holding a full-corpus segment set reaches readiness; an incomplete sweep is named and resumed next attempt.
- Related findings: nguồn: E03 — Knowledgebase persistence: schema, SQL, migrations…

### F-093 — read-only SELECT count(*) FROM knowledge.pdf_content_builds b WHERE NOT EXISTS (SELECT 1 FROM knowledge.pdf_source_details d WHERE d.build_id=b.id)

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R5-E03-04`
- Affected modules: Zink Knowledgebase, Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: every distinct PDF content revision — plus every BUILDING row orphaned by a crash whose PDF later changed identity — permanently keeps its full extracted text and provenance jsonb. Re-indexed or edited PDFs in the read-only Vault accumulate an unreclaimable second copy of their whole text, growing the largest tables and every backup with no operator-visible bound (§10 ceiling risk).
- Evidence: Where: 002_pdf_ingestion_foundation.sql:1-91 (:20-26 partial unique index, :80-81 FK ON DELETE RESTRICT); database.py:1492-1517, :1626-1646 · Evidence: repo-wide grep for DELETE FROM .*(pdf_content_builds|pdf_content_segments|pdf_content_batches) returns only a test assertion (apps/knowledge/tests/test_m11_index_hygiene.py:154); _purge_index_content deletes segments, pdf_source_details, sources (:1641-1644) and nothing else; the RESTRICT edge forbids any cascade from reaching the build rows.
- Reproduction: read-only SELECT count(*) FROM knowledge.pdf_content_builds b WHERE NOT EXISTS (SELECT 1 FROM knowledge.pdf_source_details d WHERE d.build_id=b.id).
- Acceptance criteria: after a PDF is edited or removed and a run publishes, the retired build's segments are gone.
- Related findings: nguồn: E03 — Knowledgebase persistence: schema, SQL, migrations…

### F-094 — confirm zink-skill-store/ has no migration runner or .sql asset

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R5-E03-07`
- Affected modules: Zink Skill Store
- Severity: Medium
- Status: EXCLUDED — excluded by owner letter `s1`; needs decision `H5` (where the `skills.*` schema lives — to be decided on DDL placement alone).
- Root cause: the Skill-Store vector schema was filed under apps/knowledge/migrations/ for convenience, so schema evolution and constraint policy live in the wrong module and apply only when the Knowledgebase boots. — Hệ quả: the Knowledgebase's startup path mutates a peer module's persistence — precisely the §9 "no direct mutation of another owner's database/vector/object-store state" prohibition; a Skill Store schema change requires a Knowledgebase release; and a stale or empty active-key set in that hard DELETE drops derived rows irreversibly. (The interpolation at that call site — escapeSqlLiteral, vector-sync.mjs:625-633 — belongs to E05 and is not counted here.)
- Evidence: Where: 003_skills_vector_schema.sql:7-39 applied by database.py:1715-1733; consumer zink-skill-store/src/vector-sync.mjs:499,540,618-632,772 · Evidence: 003 does CREATE SCHEMA IF NOT EXISTS skills; with status text NOT NULL CHECK (status IN ('ACTIVE')) and sync_status … CHECK (sync_status IN ('PENDING','READY','FAILED')). vector-sync.mjs:618-621 states verbatim: "The pre-fix UPDATE wrote status='DEPRECATED' and sync_status='TOMBSTONED', which migration 003 CHECK constraints do not admit… The tombstone now DELETES the derived row". · Expected/Actual: per §9 the Skill Store owns governed learned-skill persistence / its entire durable schema is defined and deployed by the Knowledgebase's migration runner, and because 003's CHECK set cannot express a deprecated/tombstoned state, the Skill Store's only escape is a destructive DELETE FROM skills.catalog_index (003:29 cascades skills.segments). · Detail: this is a §9 module-ownership item, i.e. RED — it is not foldable into M12/T2.1 without a decision about where Skill-Store schema lives.
- Reproduction: confirm zink-skill-store/ has no migration runner or .sql asset; read docs/architecture/'s Skill Store ownership claim against 003's file location.
- Acceptance criteria: deploying the Knowledgebase applies zero statements against skills.*.
- Related findings: disposition: excluded by owner letter `s1`; needs decision `H5` (where the `skills.*` schema lives — to be decided on DDL placement alone). · nguồn: E03 — Knowledgebase persistence: schema, SQL, migrations…

### F-095 — the owner cannot withdraw a wrong skill through any supported path — the first ACTIVE version freezes a capability permanently, and the only route is out-of-band tree editing, which is precisely the path that reaches R5-E04-01/02. Round…

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R5-E04-05`
- Affected modules: OpenClaw integration, Zink Skill Store, Zink Tools, Architecture + contracts docs
- Severity: Medium
- Status: EXCLUDED — excluded by owner letter `r2`; needs decision `H8` (governed DEPRECATED retirement, forward migration because applied migrations are now digest-pinned).
- Root cause: the owner cannot withdraw a wrong skill through any supported path — the first ACTIVE version freezes a capability permanently, and the only route is out-of-band tree editing, which is precisely the path that reaches R5-E04-01/02. Round 3's P01-08 rehearsal assumed retirement exists.
- Evidence: Where: catalog.mjs:1177-1182, :45, :419-424; docs/contracts/skill-store/agent-skill-store.md:32-34; skill-adapter.mjs:42 · Evidence: the SKILL_ACTIVE_CONFLICT message tells the caller "capability already has ACTIVE version …; deprecate it before promoting"; the contract lists [CANDIDATE, ACTIVE, DEPRECATED] and "at most one version per namespace/capability is ACTIVE"; yet const FORBIDDEN_ACTIONS = new Set(["publish","deprecate", "admin"]) and grep across zink-skill-store, zink-tools and integrations/openclaw finds no code that writes a DEPRECATED event. promoteApprovedSkill is the only transition ("create ACTIVE"), and the writer also refuses to touch an existing version (:1139). · Detail: this is a new in-store capability + contract-visible lifecycle edge → RED for the owner.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc catalog.mjs:1177-1182, :45, :419-424; docs/contracts/skill-store/agent-skill-store.md:32-34; skill-adapter.mjs:42 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng the owner cannot withdraw a wrong skill through any supported path — the first ACTIVE version freezes a capability permanently, and the only route is… trước khi sửa (nội quy mục 3).
- Acceptance criteria: a documented governed action produces CANDIDATE,ACTIVE,DEPRECATED accepted by scanCatalog.
- Related findings: bug mở: R5-E04-01 · disposition: excluded by owner letter `r2`; needs decision `H8` (governed DEPRECATED retirement, forward migration because applied migrations are now digest-pinned). · nguồn: E04 — Skill Store catalog internals (9 findings; the store…

### F-096 — the caller branches on error.code (index.mjs:1123-1125 recognizes only SKILL_ACTIVE_CONFLICT/SKILL_VERSION_CONFLICT), so "your input is invalid" (retryable) and "the tree is poisoned" (needs an operator) share one code — a proposal can be…

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R5-E04-08`
- Affected modules: Zink Skill Store
- Severity: Medium
- Status: PARTIAL — the writer half CLOSED by `M12/T2.2-R3` `R3-5` (`74c42df`, `T2k` + two mutation probes); the caller half (`index.mjs:1140`) stays excluded by owner letter `p1`.
- Root cause: the caller branches on error.code (index.mjs:1123-1125 recognizes only SKILL_ACTIVE_CONFLICT/SKILL_VERSION_CONFLICT), so "your input is invalid" (retryable) and "the tree is poisoned" (needs an operator) share one code — a proposal can be left CANDIDATE for either — and the documented diagnostic entry point skill-store validate reports nothing.
- Evidence: Where: catalog.mjs:1012-1062, :1166, :1220, :1253; bin/skill-store.mjs:103-115 · Evidence: SKILL_IDENTITY_INVALID is thrown for identity grammar, empty content, the 262,144-byte ceiling, invalid source_type, an invalid references array, an invalid reference item, and non-empty lifecycle actors; CATALOG_INVALID is thrown for pre-existing store errors, staged-record validation failure and post-publish re-validation; and the CLI's } catch { collapses everything to code: "OPERATIONAL_FAILURE", details: [].
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc catalog.mjs:1012-1062, :1166, :1220, :1253; bin/skill-store.mjs:103-115 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng the caller branches on error.code (index.mjs:1123-1125 recognizes only SKILL_ACTIVE_CONFLICT/SKILL_VERSION_CONFLICT), so "your input is invalid" (retryable)… trước khi sửa (nội quy mục 3).
- Acceptance criteria: every promotion failure maps to exactly one outcome the plugin can classify without parsing text.
- Related findings: disposition: the writer half CLOSED by `M12/T2.2-R3` `R3-5` (`74c42df`, `T2k` + two mutation probes); the caller half (`index.mjs:1140`) stays excluded by owner letter `p1`. · nguồn: E04 — Skill Store catalog internals (9 findings; the store…

### F-097 — git clean -fdx or a lost worktree destroys all five rounds of audit evidence (the ~3,700-line register exists as one untracked working file), and because ACTIVE.md is ignored no diff and no CI can ever gate an edit to it — so a silent…

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R5-E14-07`
- Affected modules: Architecture + contracts docs, Governance records
- Severity: Medium
- Status: EXCLUDED — REPORTED, not decided — decision `H10` owns whether this register becomes tracked and what size policy applies.
- Root cause: git clean -fdx or a lost worktree destroys all five rounds of audit evidence (the ~3,700-line register exists as one untracked working file), and because ACTIVE.md is ignored no diff and no CI can ever gate an edit to it — so a silent rewrite of "frozen" implementation details is undetectable. That is a control gap in the governance layer itself, and it is the reason this session's R2→NO flip is visible only in the file.
- Evidence: Where: .gitignore:57-62 — .agents/states/*.md and /docs/contracts/execution/ACTIVE.md · Evidence: git status --ignored shows .agents/states/{context,findings,handoff}.md and docs/contracts/execution/ ignored, while AGENTS.md §2 makes a valid ACTIVE.md "the sole source of truth for the current task's frozen implementation details".
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc .gitignore:57-62 — .agents/states/*.md and /docs/contracts/execution/ACTIVE.md ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng git clean -fdx or a lost worktree destroys all five rounds of audit evidence (the ~3,700-line register exists as one untracked working file), and because… trước khi sửa (nội quy mục 3).
- Acceptance criteria: the owner's ruling recorded, and ignored evidence has a stated durability path.
- Related findings: quyết định chủ: H10 · disposition: REPORTED, not decided — decision `H10` owns whether this register becomes tracked and what size policy applies. · nguồn: E14 — repository hygiene: tracked junk, stale artifacts…

### F-098 — a skill manifest lifecycle event cannot cite the repository's own dotted task ids

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R6-C-NEW-01`
- Affected modules: Zink Skill Store
- Severity: Medium
- Status: OPEN
- Root cause: the id grammar predates the dotted revision convention and was never re-derived against it.
- Evidence: Where: zink-skill-store/src/catalog.mjs:34 (DECISION regex) · Evidence: the pattern admits only `PLAN:M<n>/T<n>-R<n>`, so `PLAN:M12/T2.3-R1` is rejected as "A lifecycle event is invalid." The repository's current task ids are dotted, so a real promotion cannot cite the contract that authorized it; the Wave C fixture had to use PLAN:M12/T2-R1 to stay inside scope.
- Reproduction: stage a promotion whose manifest cites PLAN:M12/T3-R1 and read the diagnostic.
- Acceptance criteria: the DECISION grammar accepts the task-id shape the plan actually uses, or the plan's id grammar is narrowed to match — either way it is a schema decision and needs its own approved contract.
- Related findings: nguồn: M12/T2.3-R1 close (2026-10-17, PLAN.md §8)

### F-099 — lock-hold time grows linearly with the ledger, which worsens the FILE_LOCK_BUSY / orphan-lock class (known item) and gateway latency

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A08-06`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: Low
- Status: OPEN
- Root cause: anchoring at snapshot.sequence should let replay verify incrementally vs the cost is O(total history) per operation, with no compaction or checkpointing.
- Evidence: Where: ledger.mjs:158-160, 443-458, 472-485, 306-360; per-request readSnapshot at index.mjs:1864, 2229, 4809, 4971, … · Evidence: for (const line of lines) { validateContract("ledger-event", event); canonicalHash(…); applyWorkflowEvent(…) } runs for all lines, the anchored region included, on every call inside withWriterLock. · Expected/Actual: anchoring at snapshot.sequence should let replay verify incrementally vs the cost is O(total history) per operation, with no compaction or checkpointing.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc ledger.mjs:158-160, 443-458, 472-485, 306-360; per-request readSnapshot at index.mjs:1864, 2229, 4809, 4971, … ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng lock-hold time grows linearly with the ledger, which worsens the FILE_LOCK_BUSY / orphan-lock class (known item) and gateway latency trước khi sửa (nội quy mục 3).
- Acceptance criteria: per-operation replay work scales with the unanchored tail, not total history.
- Related findings: nguồn: A08 — ledger and event-store integrity *(Vòng 1: 16/16…

### F-100 — schema-accepted events should be uniformly replayable vs these two are invisible before the snapshot head and brick the read after it

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A08-07`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: Low
- Status: LATENT — (no production emitter)
- Root cause: schema-accepted events should be uniformly replayable vs these two are invisible before the snapshot head and brick the read after it.
- Evidence: Where: ledger-event.schema.json type enum (TASK_CREATED, DELEGATION_RESERVED); ledger.mjs:331, 401-402 · Evidence: if (event.type !== "BUDGET_RESERVED") throw new Error("unreconciled event after snapshot"); while anchored replay silently ignores any non-WORKFLOW_/non-BUDGET_RESERVED type (:331 branches only on WORKFLOW_). appendEvent( and reserveBudgetAtomically( have zero non-test callers, and live BUDGET_RESERVED = 0/144. · Expected/Actual: schema-accepted events should be uniformly replayable vs these two are invisible before the snapshot head and brick the read after it. · Detail: all 23 WORKFLOW_* types are exactly covered by the reducer dispatch (comm of the schema enum against the reducer's if (type === …) list found no code-only and no reducer-missing type).
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc ledger-event.schema.json type enum (TASK_CREATED, DELEGATION_RESERVED); ledger.mjs:331, 401-402 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng schema-accepted events should be uniformly replayable vs these two are invisible before the snapshot head and brick the read after it trước khi sửa (nội quy mục 3).
- Acceptance criteria: every schema-permitted type has defined replay behaviour in both anchored and tail regions.
- Related findings: nguồn: A08 — ledger and event-store integrity *(Vòng 1: 16/16…

### F-101 — superseded shadow-index cleanup can fail indefinitely with zero evidence (the owner sees only silent Postgres growth), and any 500/503 is unattributable after the fact — the Knowledgebase module has its own copy of the attribution…

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R5-E01-05`
- Affected modules: Zink Knowledgebase
- Severity: Low
- Status: PARTIAL — the 19 `from None` sites CLOSED by `M12/T2.2-R2` `B-14` (`f316c83`); the bare `except Exception:` handlers stay open.
- Root cause: superseded shadow-index cleanup can fail indefinitely with zero evidence (the owner sees only silent Postgres growth), and any 500/503 is unattributable after the fact — the Knowledgebase module has its own copy of the attribution collapse that cluster C-C describes for OpenClaw. Fixing only the OpenClaw side, as M12/T2.1-R1 currently does, leaves this half untouched.
- Evidence: Where: index_lifecycle.py:435-440 (cleanup) and main.py:473-474 · Evidence: except Exception: # Cleanup is explicitly outside the correctness lifecycle. / return, while grep -rn "logging|logger|print(" apps/knowledge/app/*.py returns no matches, and every failure path discards its cause (raise HTTPException(500, {"code":"INTERNAL_ERROR"}) from None at :474; from None at :363-365, :381, :404-406).
- Reproduction: Register chưa có bước tái hiện riêng; bước gần nhất suy từ acceptance/remediation: a failed cleanup or 500 leaves one attributable record naming code and identifier. Correction + severity challenge (orchestrator re-derivation, 2026-10-14): the from None count is not four — measured 28 raise sites plus 8 bare except Exception: across apps/knowledge/app/, and the zero-logging grep matches nothing in the whole directory (not only *.py). See the Vòng 6 correction list. sev: Low is therefore…
- Acceptance criteria: a failed cleanup or 500 leaves one attributable record naming code and identifier. Correction + severity challenge (orchestrator re-derivation, 2026-10-14): the from None count is not four — measured 28 raise sites plus 8 bare except Exception: across apps/knowledge/app/, and the zero-logging grep matches nothing in the whole directory (not only *.py). See the Vòng 6 correction list. sev: Low is therefore challenged to Medium: a module with no logging facility at all cannot satisfy M12/T2.1's own attribution objective, and the owner reads its 500s as "the model failed" exactly as he reads OpenClaw's. Grading is…
- Related findings: disposition: the 19 `from None` sites CLOSED by `M12/T2.2-R2` `B-14` (`f316c83`); the bare `except Exception:` handlers stay open. · nguồn: E01 — Knowledgebase service internals (6 findings + a…

### F-102 — a green contract test that pins dead schema (assert on the table's existence, not its behaviour) is a re-base cost the next refactor cannot remove without appearing to break a gate — and if anything ever does write a sidecar, the next…

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R5-E03-08`
- Affected modules: Zink Knowledgebase, Gates + CI
- Severity: Low
- Status: OPEN
- Root cause: a green contract test that pins dead schema (assert on the table's existence, not its behaviour) is a re-base cost the next refactor cannot remove without appearing to break a gate — and if anything ever does write a sidecar, the next incremental publish silently drops those rows for the new ACTIVE index because the clone omits the relation: data loss with no error.
- Evidence: Where: 001_initial.sql:87-96 (source_sidecars), :70 (enum ('MARKDOWN','PDF','IMAGE','VIDEO')), :117-118 (time_start_ms/time_end_ms); database.py:872-963 accept_incremental, :1643; tests/m3-t1-contract.test.mjs:116, :132 · Evidence: repo grep for source_sidecars returns only the DDL, the comment "Removing the source rows also cascades source_sidecars" (database.py:1643), and two source-text assertions in tests/m3-t1-contract.test.mjs. No INSERT/SELECT/UPDATE in any apps/knowledge/app/*.py names the table, and accept_incremental clones sources, segments, pdf_source_details (:911-963) — not it.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc 001_initial.sql:87-96 (source_sidecars), :70 (enum ('MARKDOWN','PDF','IMAGE','VIDEO')), :117-118 (time_start_ms/time_end_ms); database.py:872-963 accept_incremental, :1643; tests/m3-t1-contract.test.mjs:116, :132 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng a green contract test that pins dead schema (assert on the table's existence, not its behaviour) is a re-base cost the next refactor cannot remove without… trước khi sửa (nội quy mục 3).
- Acceptance criteria: no table exists whose rows the lifecycle can neither create nor carry across a publish, and no contract test asserts purely on schema source text.
- Related findings: nguồn: E03 — Knowledgebase persistence: schema, SQL, migrations…

### F-103 — if (context.agentId) reqHeaders["X-Agent-Id"] (knowledge-adapter.mjs:261) is always false on the live path while X-Task-Id (:260) is payload-populated → the internal service gets attacker-chosen correlation and no identity

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R2-B01-02`
- Affected modules: Zink Tools
- Severity: Ungraded
- Status: OPEN
- Root cause: Register kết luận: if (context.agentId) reqHeaders["X-Agent-Id"] (knowledge-adapter.mjs:261) is always false on the live path while X-Task-Id (:260) is payload-populated → the internal service gets attacker-chosen correlation and no identity. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: (sub-defect of C-A): if (context.agentId) reqHeaders["X-Agent-Id"] (knowledge-adapter.mjs:261) is always false on the live path while X-Task-Id (:260) is payload-populated → the internal service gets attacker-chosen correlation and no identity.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc entry không còn `Where:` — dựng lại locator từ `PLAN.md` §8 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng if (context.agentId) reqHeaders["X-Agent-Id"] (knowledge-adapter.mjs:261) is always false on the live path while X-Task-Id (:260) is payload-populated → the… trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "if (context.agentId) reqHeaders["X-Agent-Id"] (knowledge-adapter.mjs:261) is always false on the live path while X-Task-Id (:260) is payload-populated → the internal service gets attacker-chosen correlation and no…", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: nguồn: B01 — security / authorization (all 14 assigned claims…

### F-104 — the bot token that opens a production #approvals thread is chosen from event-supplied childSessionKey, not from the ledger

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R2-B01-05`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: Ungraded
- Status: OPEN
- Root cause: Register kết luận: which bot token opens a production #approvals thread is derived from event-supplied childSessionKey (index.mjs:5292-5295, allowlist o1/o2) rather than the ledger-assigned account. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: : which bot token opens a production #approvals thread is derived from event-supplied childSessionKey (index.mjs:5292-5295, allowlist o1/o2) rather than the ledger-assigned account. Low.
- Reproduction: At HEAD maybePublishDiscordCard (index.mjs:5291) derives the posting agent from `event.childSessionKey` — :5292-5295 match /^agent:([^:]+)/ and then apply an o1/o2 allowlist — and the token used downstream follows that agentId, while the ledger's coordinator/delegation record for the task is never read. Gate it in tests/m12-t2-governed-surface.test.mjs, which already drives this function over a real ledger: announce with a childSessionKey naming o2 for a task the ledger assigned to o1 and assert the o1 account posts.
- Acceptance criteria: The account that opens an #approvals thread is the one the ledger assigned to the task; an event-supplied childSessionKey may select an agent only when it matches that assignment, and a mismatch is refused instead of silently re-routing the card to another bot.
- Related findings: nguồn: B01 — security / authorization (all 14 assigned claims…

### F-105 — integrations/openclaw/orchestration/patterns re-creates the retired L&SC Data Plant and a second orchestrator

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R1-A01-01`
- Affected modules: Legacy orchestration patterns (unwired), OpenClaw integration, Gates + CI, README
- Severity: High
- Status: OPEN
- Root cause: AGENTS.md §9 + docs/architecture/lsc-data-flow.md:60-69 forbid an in-repo ETL control plane, a Bronze/Silver/Gold lakehouse, and "a second orchestrator that duplicates OpenClaw/n8n". Actual: the repo ships exactly that, green-tested.
- Evidence: Where: integrations/openclaw/orchestration/patterns/index.mjs:33-421 (executePattern1_N8nToR2Landing … executePattern10_SyntheticComposition), integrations/openclaw/orchestration/README.md · Evidence: exports stitch landing/silver/gold tiers, MLflow/DagsHub, workflow_id: "data_plant_ingest"; the only consumer is tests/m7-t4-orchestration.test.mjs; no configure.mjs, plugin or lib/ import. · Expected/Actual: AGENTS.md §9 + docs/architecture/lsc-data-flow.md:60-69 forbid an in-repo ETL control plane, a Bronze/Silver/Gold lakehouse, and "a second orchestrator that duplicates OpenClaw/n8n". Actual: the repo ships exactly that, green-tested.
- Reproduction: `node --test tests/m7-t4-orchestration.test.mjs` → 12 pass / 0 fail today, which is the point: the forbidden surface is green-tested (it includes 'Gate G9/G10: Orchestration Patterns P6-P9, Synthetic Composition P10'). Measure the isolation: grep 'orchestration/patterns|executePattern' shows importers are only that test plus README.md:522, orchestration/README.md and zink-tools/python/README.md:33, and configure.mjs, plugins/ and lib/ import none. Pin the invariant in tests/repository-policy.test.mjs: no tracked, test-enforced module may export landing→silver→gold tiers or an MLflow/DagsHub sync chain.
- Acceptance criteria: No tracked, test-enforced module in this repository stitches landing/silver/gold tiers, a model-registry sync, or a composition function that sequences them; the data/compute flow exists only as the external contract in docs/architecture/lsc-data-flow.md.
- Related findings: nguồn: A01 — architecture and system boundaries

### F-106 — apply mutates surfaces the transaction preimage never captures, yet rollbackSucceeded is licensed by those bytes alone — and one apply stage deletes irreversibly

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R1-A05-02`
- Affected modules: OpenClaw governance plugin (Discord), Workflow topology + ledger, Workflow topology, Repo tooling + deploy scripts
- Severity: High
- Status: OPEN · premise changed 2026-10-17: one locator is wrong: configure.mjs:1743-1773 is the governance-entrypoint digest allowlist and holds no rollback code — the driver is topology/fixtures/runtime-regression/apply-orchestration.mjs (restore :288, verdict :299-323); 'two auth
- Root cause: a failed apply can report rollbackSucceeded: true while the resolver, hotfix utility, plans and unit drop-in stay at the new revision, and the r12 quarantine evidence is permanently gone.
- Evidence: Where: topology/lib/transaction-snapshot.mjs:74-90 (SNAPSHOT_TARGETS), :334-361 (verifyLiveRestore); configure.mjs:1743-1773; topology/fixtures/runtime-regression/operator-apply.mjs:119-122 · Evidence: snapshot targets are openclaw.json + extensions/zink-governance/ + patch-derived runtime/discord targets. Nothing lists bin/openclaw-pass-resolver, bin/openclaw-gemini-stream-hotfix.mjs, the two auth plans, or ~/.config/systemd/user/…/10-zink.conf (outside stateDir). pruneQuarantine runs rmSync(…, {recursive:true}) on backups/r12/quarantined-t2.
- Reproduction: Read-only `node -e` over createTransactionSnapshot prints Object.keys(snapshot.files): 11 paths (openclaw.json, 4 extension files, 1 channel preflight, 5 dist patch targets) — covering bin/openclaw-pass-resolver? false, zink-auth-secret-plan.json? false, bin/openclaw-gemini-stream-hotfix.mjs? false, 10-zink.conf? false — while transaction-snapshot.mjs:338 has verifyLiveRestore compare only the captured paths and apply-orchestration.mjs:323 sets report.rollbackSucceeded = true. Add to tests/m8-t2.8-r11-transactional-rollback.test.mjs (its mkdtempSync fixture and verifyLiveRestore(rt, snapshot) idiom) a case that mutates one of those during a failing apply and asserts the verdict names it.
- Acceptance criteria: rollbackSucceeded: true is emitted only when every path the apply stage can write lies inside the preimage and byte-matches after restore, and no apply stage deletes anything the preimage cannot recreate.
- Related findings: adjudication Vòng 2: Verified, High kept, with live confirmation · nguồn: A05 — runtime, entrypoints and startup behaviour

### F-107 — a card is durably recorded SURFACED while its interactive part never arrived, and is then un-re-drivable forever

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R1-A09-02`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: High
- Status: OPEN
- Root cause: M12/T1-R1 promises a re-drive for anything the owner cannot act on. Actual: "a recorded surface means never show again".
- Evidence: Where: index.mjs:6774-6784 (WORKFLOW_APPROVAL_SURFACED) precedes :6790-6860; the dedupe gate is :6633 / :5435 (if (t.approval_thread_id) … return) · Evidence: SURFACED only needs the thread POST; the delivery failure path logs first-approval component delivery failed and returns normally; a re-drive requires !approval_thread_id, which was already recorded. Same shape in the announce path (:5491 then :5511). · Expected/Actual: M12/T1-R1 promises a re-drive for anything the owner cannot act on. Actual: "a recorded surface means never show again".
- Reproduction: Add to tests/m12-t2-governed-surface.test.mjs (16 pass / 0 fail today; its P2 test already asserts exactly two WORKFLOW_APPROVAL_SURFACED sites and the file exposes pluginSource, a real ledger and tagsFetch({postStatus})): drive the first-approval site with the thread POST (:6778) succeeding but the component POST (:6808) failing, then assert a later attempt still surfaces. Today approval_thread_id is recorded by WORKFLOW_APPROVAL_SURFACED (:6792) and the re-drive gate ':6650 if (t.approval_thread_id) … return' blocks forever — the file's own comment at :6646 says it 'can never get a second card'. The announce path repeats the shape (:5435 gate, :5491 SURFACED, :6873-6877 catch that only logs).
- Acceptance criteria: A task whose interactive component never reached the owner keeps approval_thread_id unset, or carries a separate delivery verdict the re-drive reads, so the next attempt surfaces an actionable card; SURFACED is recorded only for a card the owner can act on.
- Related findings: nguồn: A09 — Discord and external integrations

### F-108 — parent_agent_id is declared twice with contradictory value sets

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R1-A11-01`
- Affected modules: Workflow topology
- Severity: High
- Status: OPEN
- Root cause: a spawn reserved by a non-coordinator parent is ledger-legal but envelope-illegal (or the reverse) — the reservation is journalled and then the handoff hard-fails, leaving a sealed half-record in the audit trail.
- Evidence: Where: topology/contracts/delegation-envelope.schema.json:36 (enum: ["main","o1","o2"]) vs topology/contracts/ledger-event.schema.json:1350 (reserved payload enum = all 7 agents) · Evidence: both files are actually enforced — guard.mjs:1474 validates delegation-envelope, ledger.mjs:505 validates ledger-event. No shared $ref.
- Reproduction: Measured on this host: `node -e` walking both parsed schemas prints delegation-envelope → [main,o1,o2] (delegation-envelope.schema.json:36) and ledger-event → [main,o1,o2,excel,power-bi,sql,python] (:1349-1351, all seven, equal to AGENT_IDS), and `grep -n '"\$ref"'` shows neither references the other. Both are enforced at runtime (guard.mjs:1473 validateContract('delegation-envelope', handoff, 32768); ledger.mjs:342 and :543), so a parent_agent_id legal in the ledger is rejected in the envelope. Add a same-field enum-equality scan across topology/contracts/_.json to tests/repository-policy.test.mjs (tests/m3-t_-contract.test.mjs is the contract-suite alternative).
- Acceptance criteria: parent_agent_id is declared once, in a shared $defs block both contracts $ref, so any value the ledger accepts the delegation envelope accepts and vice versa; a second inline enum for the same field fails the contract scan.
- Related findings: nguồn: A11 — contracts, schemas and canonical definitions

### F-109 — the announce seam discards the card-publish verdict and still returns deliver; an unparseable payload drops with no log line at all

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R1-A14-03`
- Affected modules: OpenClaw governance plugin (Discord)
- Severity: High
- Status: OPEN
- Root cause: the host is told a result/decision was announced when it never left the process, while WORKFLOW_APPROVAL_REQUESTED may already be durable with no thread and no failure state (:5411-5452). The prose-answer path is 100% silent, so it is undetectable from logs.
- Evidence: Where: plugins/zink-governance/index.mjs:7241-7252 (beforeAnnounce), :5291-5318 (maybePublishDiscordCard), callee catch { return; } after JSON.parse(findingsText) · Evidence: await maybePublishDiscordCard(event); — the return value is never read; the callee swallows a non-JSON findings payload in an empty catch that emits nothing.
- Reproduction: Extend tests/m12-t2.2-k1-announce-discard-reason.test.mjs (6 pass / 0 fail today, and it already drives the announce seam over a real mkdtemp ledger) from the guard to the plugin hook: call beforeAnnounce with an o1/o2 event.findings that is not JSON plus a capturing api.logger, and assert nothing is logged and the decision is still 'deliver' (index.mjs:5312-5314 `catch { return; }`, :7262 discards the returned verdict); then a case where publish returns {status:'BLOCKED'} (:5363) and assert the seam surfaces that verdict instead of returning deliver.
- Acceptance criteria: Each path where an approval card is not published — unparsable payload, no configured destination, blocked task correlation, failed post — yields a verdict the announce seam reads and records, so no publish attempt ends silently and deliver is never returned for an unpublished card.
- Related findings: nguồn: A14 — failure handling and reliability

### F-110 — integrations/openclaw/README.md still documents the retired Google-provider deployment end to end

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R1-A15-01`
- Affected modules: OpenClaw governance plugin (Discord), OpenClaw runtime libs, OpenClaw integration, README
- Severity: High
- Status: OPEN
- Root cause: an operator following it inserts 21 unresolvable pass entries, runs openclaw secrets apply against an empty plan, sets per-agent auth orders nothing reads, and ends with a config validateConfig rejects — spending a deployment grant.
- Evidence: Where: integrations/openclaw/README.md:24-29, 61-66, 70-88, 172, 197-207, 214-248 vs lib/policy.mjs:490, 534-543, 606-607, 1375 · Evidence: README states plugins.allow=["google","discord","zink-governance"], google/gemini-flash-latest, for index in $(seq -w 1 21); do pass insert "zink/openclaw/GEMINI_API_KEY_${index}" and seven auth order set; the build emits PLUGIN_ALLOWLIST = ["discord"] and five router ids, and the 21 keys were removed.
- Reproduction: Measured on this host: `node -e` importing lib/policy.mjs prints PLUGIN_ALLOWLIST ['discord'], GOVERNANCE_PLUGIN_ALLOWLIST ['discord','zink-governance'], ROUTER_PROVIDER_ID 'router' with 5 model ids, and GEMINI_API_KEY present in PASS_ENTRY_IDS? false (groups: discord, gateway); `grep -c 'provider google|"google"' configure.mjs` → 0. Yet integrations/openclaw/README.md still prints plugins.allow=["google","discord","zink-governance"] (:25), google/gemini-flash-latest (:64), the 21-key pass insert loop (:198-199) and seven `auth order set --provider google` (:234-247). Add a README-vs-policy consistency check to tests/repository-policy.test.mjs.
- Acceptance criteria: integrations/openclaw/README.md documents only what the build emits: provider router with its five model ids, allowlist ['discord','zink-governance'], the current PASS_ENTRY_IDS, and every command it prints is one the current configure/policy code would accept.
- Related findings: nguồn: A15 — documentation, operations and deployment consistency

### F-111 — the only documented deploy path bypasses the apply orchestration; "one apply per grant" has no tool support

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R1-A15-02`
- Affected modules: Workflow topology, OpenClaw integration, README, Governance records
- Severity: High
- Status: OPEN
- Root cause: bare --apply mutates config/plugin/drop-in with no snapshot, no native patch, no byte verification and no rollback — and the one-apply rule is unfalsifiable.
- Evidence: Where: integrations/openclaw/README.md:106-126, 138-148; configure.mjs:745, 1507; topology/fixtures/runtime-regression/operator-apply.mjs:116-192, apply-orchestration.mjs:59-70 · Evidence: README shows bare --dry-run/--apply and never --preflight (the mode operator-preflight.mjs:31-32 uses). CHANGELOG.md:20-22 records "the apply's own report JSON was never seen"; PLAN.md:40 asserts "exactly one apply and is spent" with no counter or grant ledger.
- Reproduction: Add a docs/ops-consistency case to tests/repository-policy.test.mjs (its idiom is: read a tracked file, assert each command string resolves): every `configure.mjs --<flag>` printed in integrations/openclaw/README.md must be a flag configure.mjs:798 accepts, AND the deploy block must name operator-apply.mjs. Executable proof today: grep shows createTransactionSnapshot / applyNativePatch / restoreTransactionSnapshot / verifyLiveRestore / restartScopedGateway appear 0 times in configure.mjs and 2-4 times in topology/fixtures/runtime-regression/operator-apply.mjs, while `grep -- '--preflight|operator-apply'` in the README returns nothing; bare --apply reaches builder-apply with none of the 11 APPLY_STAGES (apply-orchestration.mjs:59-70).
- Acceptance criteria: The README deploy block prints the entrypoint the orchestration actually uses and advertises --preflight as configure.mjs:776 defines it; no documented command reaches builder-apply without the snapshot, native-patch, byte-verify and restart stages, and one --apply cannot be issued twice against the same grant.
- Related findings: nguồn: A15 — documentation, operations and deployment consistency

### F-112 — a second dead end in the same hop: dispatch capabilities include the coordinator, spawn policy never does

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R1-A16-02`
- Affected modules: OpenClaw runtime libs
- Severity: High
- Status: OPEN
- Root cause: even if primary_coordinator were populated, the chosen coordinator is never in its own spawnable set — flow 3 is doubly unwired and no DAG Main can author is dispatchable.
- Evidence: Where: index.mjs:2542-2544 (capabilities from task.nodes) and :2559-2569 (SPECIALIST_NOT_REACHABLE_FROM_COORDINATOR) vs lib/queue-manager.mjs:1003-1014 (coordinators explicitly excluded — "the assignment, not a capability") and lib/policy.mjs:555-563 (AGENT_SPAWN_POLICY), with guard.mjs:869-874 forcing every Main brief node into [o1,o2]
- Reproduction: Runable now without editing: `node -e` importing index.mjs, policy.mjs and queue-manager.mjs and printing both sets for {primary_coordinator:'o1', nodes:[o1,excel]} — deriveGovernedDispatchTarget returns {ok:false, error:'SPECIALIST_NOT_REACHABLE_FROM_COORDINATOR', unreachable:['o1']} while queue-manager.mjs:1039-1048 projects ['excel']. Then add to tests/m9-t1-functional-truth-remediation.test.mjs (Domain A already calls deriveGovernedDispatchTarget(makeTask()) at :50-82) a case whose nodes name the task's own coordinator and assert the two sets match; red today.
- Acceptance criteria: For every task guard.beforeRun commits, deriveGovernedDispatchTarget(task).ok is true and its requiredCapabilities equal queue-manager.mjs:1039-1048's projection of the same nodes; a coordinator id among node agent_ids is never reported unreachable, and AGENT_SPAWN_POLICY is never required to contain a coordinator.
- Related findings: nguồn: A16 — independent end-to-end traceability

### F-113 — no producer ever surfaces a pending result to #results; the accept path has nothing to accept

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R1-A16-03`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: High
- Status: OPEN — _(same root as R1-A12-03 / R1-A13-05, from the flow side — keep one canonical and link the three)_
- Root cause: the flow terminates with no user-visible record after approval — the owner sees APPROVED then permanent silence.
- Evidence: Where: index.mjs:2187 (handleExecutionFinished, zero production callers), :2405, :2424; WORKFLOW_RESULT_SURFACED only at :5087 inside surfaceAcceptedResult (:5023), reachable only from ACCEPT_RESULT (:5812); state set at workflow.mjs:1198, and guard.mjs:2100 moves delegation results to RESULT_PENDING_REVIEW with nothing posting that state
- Reproduction: Add to tests/m7-lane-f-result-integrity.test.mjs (idiom: handleExecutionFinished({...}) over a temp ledger, e.g. :106): drive a task to RESULT_PENDING_REVIEW (workflow.mjs:1207) and assert some NON-TEST seam produces the owner-visible pending surface. Run `node --test tests/m7-lane-f-result-integrity.test.mjs` — 10 pass today with no producer wired. Static chain: `grep -rn handleExecutionFinished --include=*.mjs integrations` yields the definition plus a comment and 7 test callers, and the only ACCEPT control (discord-formatter.mjs:898) is built inside formatGovernedResultCard, reachable only from the uncalled handler.
- Acceptance criteria: Any task in RESULT_PENDING_REVIEW has an owner-visible surface carrying the accept control plus a durable event proving it; ACCEPT_RESULT is not the only producer able to make a pending result visible, and no task can sit pending with zero producers able to announce it.
- Related findings: bug mở: R1-A12-03 · đã sửa/xóa khỏi file: R1-A13-05 · nguồn: A16 — independent end-to-end traceability

### F-114 — Discord root tasks are opened durably inside the admission predicate and never closed — on success or denial

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R1-A16-06`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: High
- Status: OPEN — _(the ledger half of the owner's "log không ghi nhận lần chạy")_
- Root cause: opens survive refused runs and every plain #office reply leaves an ACTIVE task with no end record (matching 4 WORKFLOW_NATIVE_ENDED in 144 events); the 4× re-entry amplifies it.
- Evidence: Where: index.mjs:7706 recordWorkflowEvent(WORKFLOW_OPENED) inside authenticateIngress, called at :6222 before guard.beforeRun (:6243; asserts at guard.mjs:1190-1209); boundary converts any later throw (native-boundary.mjs:495, :513); root terminal producers exist only for delegations (index.mjs:7887, :7996); conversational allow writes nothing (:7409-7418) · Evidence: native-boundary.mjs:60-66 states the admission predicate must be "side-effect free … it never writes the ledger" — beforeRun's copy is not.
- Reproduction: Add an admit-then-deny row to tests/m10-t2-r8-ingress-verdict-matrix.test.mjs: a mention-main context that reaches index.mjs:7723 (so WORKFLOW_OPENED is written) whose guard.beforeRun then refuses (brief_state not ACTIVE at guard.mjs:1187-1192, or an aborted signal). Assert after.sequence equals before.sequence and the task count is unchanged — red today because the write precedes the call. End-to-end denial injection needs the live WSL ledger; the suite passes 1/1 because every DENY row denies before :7723.
- Acceptance criteria: Whatever the outcome — admitted, denied after admission, thrown at native-boundary.mjs:512, or a Main conversational reply that opens no work — the ledger never retains a task whose whole event history is one WORKFLOW_OPENED, and a denied admission leaves sequence and task count untouched.
- Related findings: nguồn: A16 — independent end-to-end traceability

### F-115 — packaging cannot express the runtime dependency set, so A02-01's own acceptance criterion is unreachable

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R2-B04-01`
- Affected modules: Workflow topology + ledger, Workflow topology, Zink Skill Store, Zink Tools
- Severity: High
- Status: OPEN
- Root cause: Register kết luận: packaging cannot express the runtime dependency set, so A02-01's own acceptance criterion is unreachable. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: Evidence: governancePluginFiles() (policy.mjs:1182-1246) ships 7 topology/lib + 14 lib + contracts + 2 policy files, and the live deployed directory has no zink-tools, no zink-skill-store. Deleting the literal without expanding packaging converts the whole governed tool surface into permanent ADAPTER_UNAVAILABLE/GOVERNANCE_DEPENDENCY_MISSING; expanding the packaged set is itself a RED scope/packaging decision (§7).
- Reproduction: Cheap executable form today: `node -e` over governancePluginFiles() prints assets=34 with zero keys matching zink-tools|zink-skill-store, while a regex over index.mjs loadRepoModule('…') shows the entrypoint loads zink-tools/sql/validator.mjs, zink-tools/common/path-safety.mjs and zink-skill-store/src/catalog.mjs (call sites :783, :799, :1075, :1453). Add that parity check to tests/m7-t2-plugin-packaging.test.mjs: every runtime module the packaged entrypoint loads must be a key of the assets map, or registration must refuse.
- Acceptance criteria: Run from the deployed extension directory with the repository absent, zink_sql / zink_excel / zink_skill / zink_knowledge calls neither return GOVERNANCE_DEPENDENCY_MISSING nor ADAPTER_UNAVAILABLE nor drop validation silently: every runtime module the entrypoint imports is packaged, or its absence stops registration.
- Related findings: nguồn: B04 — deployment / dependency integrity

### F-116 — an answer scoped to a namespace is really corpus-wide — the owner cites content from another namespace believing it was governed, and no error ever surfaces

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R5-E02-01`
- Affected modules: Zink Knowledgebase
- Severity: High
- Status: OPEN
- Root cause: an answer scoped to a namespace is really corpus-wide — the owner cites content from another namespace believing it was governed, and no error ever surfaces. extra="forbid" rejects unknown keys, so known-but-unused keys pass unnoticed forever.
- Evidence: Where: apps/knowledge/app/main.py:75-78 (SearchRequest) + :322-341 + database.py:1040-1047 · Evidence: namespace/subtopic/secondary_topics/capability are declared under extra="forbid", but the shared WHERE reads only $3 primary_topic, $4 tags, $5 path_prefix, $6 segment_type; a grep of app/*.py for request.(namespace|subtopic|capability|secondary_topics) returns zero uses. The caller destructures all four (knowledge-adapter.mjs:99-111) and the shared layer claims fail-closed namespace resolution (semantic-contract.mjs:168-212). canonical_topics is ingested (001_initial.sql:107) but appears in neither projection (database.py:1053,1071) nor the response.
- Reproduction: Add to apps/knowledge/tests/test_main_api.py, whose search tests already POST /v1/search through httpx.ASGITransport over a mocked database (:66-110): post {"query":"x","namespace":"finance"} and assert the mocked retrieval receives the namespace — it never does, so the case is red. Run `python -m pytest tests/test_main_api.py` with KNOWLEDGE_TOKENIZER_PATH provisioned (CI provisions it; here it reports 1 skipped, i.e. NOT RUN). Static equivalent on this host: a python AST probe shows SearchRequest declares namespace/subtopic/secondary_topics/capability while main.py:366 passes normalize_filters only three args, and `grep -c namespace` is 0 in database.py and retrieval.py.
- Acceptance criteria: A /v1/search request carrying namespace, subtopic, secondary_topics or capability returns only segments matching it (omitting the filter returns a superset), or the API rejects those fields as unknown instead of accepting and ignoring them; canonical_topics reaches either the WHERE clause or the response.
- Related findings: nguồn: E02 — Knowledgebase retrieval, provenance and citations (7…

### F-117 — every contract-valid parameterized zink_sql call fails at the engine, while the traversal/escape scan over parameter values protects data that never reaches SQL

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R5-E06-05`
- Affected modules: Zink Tools
- Severity: High
- Status: OPEN
- Root cause: :name placeholders bound from the declared parameter array before execution / validation _requires_ placeholder/parameter equality, then the query goes to duckdb -c with placeholders unsubstituted and the values discarded.
- Evidence: Where: zink-tools/sql/duckdb-bridge.mjs:141-167, :188, :192, :252-259, :263 ; sql/validator.mjs:516-540 · Evidence: bridge: if (Array.isArray(parameters)) { for (const param of parameters) { … then const initSql = [ … input.query.trim() … ].join(" ") — parameters never appears again; validator: // 3. Exact set equality: Set(query placeholders) === Set(parameters.map(p => p.name)). · Expected/Actual: :name placeholders bound from the declared parameter array before execution / validation _requires_ placeholder/parameter equality, then the query goes to duckdb -c with placeholders unsubstituted and the values discarded.
- Reproduction: Register chưa có bước tái hiện riêng; bước gần nhất suy từ acceptance/remediation: a contract-valid call with parameters either returns data or fails with a code naming binding.
- Acceptance criteria: a contract-valid call with parameters either returns data or fails with a code naming binding.
- Related findings: bug mở: R1-A04-03 · nguồn: E06 — Zink Tools adapters (9 findings; two High, and they…

### F-118 — any routing or ownership decision made from the canonical document dispatches ETL work to O2, which the guard denies

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R5-E11-01`
- Affected modules: OpenClaw runtime libs, OpenClaw integration, Architecture + contracts docs, README
- Severity: High
- Status: OPEN — — the canonical ownership table is INVERTED against the enforced spawn tree
- Root cause: the table was written from a retired roster and never re-verified against AGENT_SPAWN_POLICY. — Hệ quả: any routing or ownership decision made from the canonical document dispatches ETL work to O2, which the guard denies. §9 module ownership is ambiguous on paper, and this is the doc an agent reads before touching the coordinator.
- Evidence: Where: docs/architecture/five-stack.md:10-13 vs integrations/openclaw/lib/policy.mjs:555-563 (+ :566-572), README.md:47-48, :608-612, :888 · Evidence: five-stack.md:10 | Data Plant | O2 | Excel, SQL, Python |, :11 | Semantic | O1 | Power BI, SQL, Excel, Python |, :12 Intelligence = O1. Code: policy.mjs:557 o1: ["excel","sql","python"], :558 o2: ["power-bi","python"], and the comment at :570 names o1 "ETL Coordinator" and o2 "Analytics Coordinator". · Expected/Actual: the architecture doc makes O2 the Data Plant owner and O1 the Semantic/Intelligence owner / the code binds the ETL specialists under O1 and BI under O2 — the exact inverse.
- Reproduction: diff AGENT_SPAWN_POLICY + AGENT_DEFINITIONS display names against the five-stack table (read-only).
- Acceptance criteria: each stack row names the coordinator that can actually spawn that stack's specialists.
- Related findings: nguồn: E11 — `docs/architecture/**` and `docs/contracts/**`…

### F-119 — Cluster A goes RED on landing with no owner approval for that red

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R6-V01-01`
- Affected modules: Gates + CI
- Severity: High
- Status: OPEN — — 4A.1 cannot land green; it collides with a PINNED gate assertion
- Root cause: Cluster A goes RED on landing with no owner approval for that red. §4.5 obtained an explicit "G có" for its known-red; 4A.1 has none, so either the executor silently edits a gate assertion (which AGENTS.md §10 treats as weakening an integrity control and §12 does not authorize) or it silently skips the item. Both are exactly the failure mode the whole audit is chasing.
- Evidence: Where: tests/m8-t1-skill-vector-memory.test.mjs:112-119 vs ACTIVE.md §3 (:126) and §4A.1 (:361-368) · Evidence: the suite comments // Empty catalog is valid at :112, then asserts at :118-119 assert.equal(emptyReport.status, "READY") and assert.equal(emptyReport.active_count, 0). The existing gate therefore enshrines the defect 4A.1 exists to remove: the required named refusal makes that state return a refusal code instead of READY, so the assertion must change. m8-t1-skill-vector-memory is a named gate file (ACTIVE.md:686, gate 3's mandatory WSL list), while §3 states Cluster A "adds cases, no existing case deleted".
- Reproduction: read :118 and §4A.1's fix text — they are mutually exclusive.
- Acceptance criteria: M12/T2.1-R3 either records an explicit grant for the gate edit or excludes 4A.1 with its successor named.
- Related findings: nguồn: V01 — Cluster A (4A.1–4A.4): three CONFIRMED, one…

### F-120 — this is the single outcome the owner was promised for Cluster D

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R6-V05-04`
- Affected modules: OpenClaw governance plugin (Discord), Workflow topology + ledger, Workflow topology, OpenClaw runtime libs
- Severity: High
- Status: OPEN — — the promise made to the owner about M7-063 is not backed · Confirmed (mechanism) / Conditional (outcome) · premise changed 2026-10-17: the test's own line :731 contains the banned prefix, so an 'all tracked files' derivation is permanently red — the archived contract already flags that
- Root cause: this is the single outcome the owner was promised for Cluster D. The item can land fully green and be recorded as an accepted red that never happened, or land red from ENOENT/self-match and be recorded as the expected red. Neither is the truth, and both would be written into PLAN.md §8 as evidence.
- Evidence: Where: ACTIVE.md :550-559 (§4A.16(i)), :694-700 (§6.11), :759-760 (§7); tests/m7-lane-g-policy.test.mjs:725-736; topology/lib/schema.mjs:113-155; lib/policy.mjs:1182-1276 · Evidence: the contract tells the owner, three times, that widening M7-063's file list will make the gate go red because it will bring plugins/zink-governance/index.mjs:511 into scope. But (1) the only resolution call already inside that test is resolveContractFilePath("zink-sql") at :734, and schema.mjs:113-155 searches seven candidate paths that all end in ${cleanName}.schema.json and returns the first existing path or null — it can structurally never return a .mjs path, so a "governance resolution set" derived from it is schema.mjs, guard.mjs plus contract JSON and excludes index.mjs. Under that reading the widened guard stays GREEN, §6.11(b)'s known-red is fabricated, and §7's "catches the literal at index.mjs:511" is false. (2) There _is_ a mechanism that covers it — governancePluginFiles() at policy.mjs:1182, whose assets are deployed-relative keys and whose separate entrypoint field at :1272-1275 reads plugins/zink-governance/index.mjs through GOVERNANCE_PLUGIN_TEMPLATE (:671-676). The literal sits inside findRepoRoot()'s candidate array and PACKAGE_REWRITES.entrypoint (:733-736)…
- Reproduction: Executable here with no mutation: replay m7-lane-g-policy.test.mjs:726-733 over ['topology/lib/schema.mjs','topology/lib/guard.mjs','plugins/zink-governance/index.mjs'] — the third turns RED because index.mjs:511 carries the WSL literal — then call resolveContractFilePath on any .mjs name and get null (probes for 'index.mjs', 'plugins/zink-governance/index.mjs', 'schema' and 'guard' all returned null). `node --test tests/m7-lane-g-policy.test.mjs` is 9 pass / 0 fail as shipped.
- Acceptance criteria: The row states which derivation it means: resolveContractFilePath can never return a .mjs path, while M7-063's explicit file list at :726-729 does reach index.mjs:511 and turns red when widened; no contract tier asserts a known-red it has not produced, and README.md is not in the set.
- Related findings: nguồn: V05 — Cluster D (4A.15, 4A.16): the contract promises the…

### F-121 — platforms/knowledge-platform/ names a fourth module that no canonical architecture doc owns

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R1-A01-03`
- Affected modules: Architecture + contracts docs, README, Legacy top-level trees
- Severity: Medium
- Status: OPEN
- Root cause: an agent may treat platforms/ as canonical and nest Knowledge there, conflicting with the accepted apps/knowledge/ runtime invariant (AGENTS.md §9).
- Evidence: Where: platforms/README.md, platforms/knowledge-platform/{knowledge-ai,services,stores}/… (7 files, all README/.gitkeep) · Evidence: docs/architecture/README.md indexes 7 docs, none mentioning platforms/. The tree literally names knowledge-ai/ and "Knowledge Platform".
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc platforms/README.md, platforms/knowledge-platform/{knowledge-ai,services,stores}/… (7 files, all README/.gitkeep) ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng platforms/knowledge-platform/ names a fourth module that no canonical architecture doc owns trước khi sửa (nội quy mục 3).
- Acceptance criteria: every top-level module path maps to a documented owner.
- Related findings: nguồn: A01 — architecture and system boundaries

### F-122 — silent data_plant stack defaults substitute for a denial in four places

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R1-A04-04`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: Medium
- Status: OPEN
- Root cause: a missing/unmapped stack assumes authority, then binds it to zink_python's input.stack === del.stack_id (guard.mjs:1791-1795) and writes it into durable WORKFLOW_BRIEF_ACTIVATED nodes; a roster agent added without editing three literals silently records data_plant. power-bi→intelligence / o2→intelligence also disagree with the guard's own inverted rule (R1-A04-01).
- Evidence: Where: guard.mjs:1726-1734; index.mjs:7023, 7044-7046, 7331-7340 (CANONICAL_AGENT_PRIMARY_STACK[id] || "data_plant")
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc guard.mjs:1726-1734; index.mjs:7023, 7044-7046, 7331-7340 (CANONICAL_AGENT_PRIMARY_STACK[id] || "data_plant") ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng silent data_plant stack defaults substitute for a denial in four places trước khi sửa (nội quy mục 3).
- Acceptance criteria: absent/unmapped stack yields a canonical denial code and records nothing.
- Related findings: đã sửa/xóa khỏi file: R1-A04-01 · nguồn: A04 — policy and capability enforcement

### F-123 — STATUS: EXPIRED is not producible for a workflow approval; an unanswered approval never expires

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R1-A07-03`
- Affected modules: Workflow topology
- Severity: Medium
- Status: OPEN — _(closes the PLAN note "EXPIRED needs a sweeper" as a defect, not a TODO)_
- Root cause: a task stays APPROVAL_PENDING indefinitely and a months-old card's text approval still applies; nothing escalates a never-answered request.
- Evidence: Where: topology/contracts/ledger-snapshot.schema.json:138-152 (enum has ACTIVE…REJECTED, no EXPIRED; comment says it is "deliberately absent, because nothing here expires a card"); only producers are the skill-candidate store (index.mjs:996) and AUTH_APPROVAL_EXPIRED (guard.mjs:373, compared against caller-injected currentTime)
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc topology/contracts/ledger-snapshot.schema.json:138-152 (enum has ACTIVE…REJECTED, no EXPIRED; comment says it is "deliberately absent, because nothing here expires a card"); only producers are the skill-candidate store (index.mjs:996) and… ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng STATUS: EXPIRED is not producible for a workflow approval; an unanswered approval never expires trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "STATUS: EXPIRED is not producible for a workflow approval; an unanswered approval never expires", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: nguồn: A07 — governance and the approval workflow

### F-124 — the announce approval card publishes model-authored prose, twice, unsanitised and silently truncated

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R1-A09-04`
- Affected modules: OpenClaw runtime libs
- Severity: Medium
- Status: OPEN — (same family as R1-A03-02)
- Root cause: the owner approves prose the ledger never admitted; @everyone/<@id> and banned patterns are not stripped; >2000 chars is cut with no truncation mark; the body arrives twice per task.
- Evidence: Where: index.mjs:5291-5337, :5463-5469 (thread body), :5511-5523 (text: bodyContent.slice(0, 2000)); helper lib/discord-forum-tags.mjs:658, bypassed formatter lib/discord-formatter.mjs:701-731 · Evidence: card = extractApprovalCard(payload.output) — the model's own announce text becomes the thread body and is re-posted with buttons; contrast the spawn site at :6706-6709, which explicitly reads from the durable brief. formatForDiscord/sanitizeDiscordText run only in message_sending.
- Reproduction: Read index.mjs:5291-5337 at HEAD: the card is extractApprovalCard(payload.output) — the model's own announce text — which becomes the thread body (:5463-5469) and is re-posted with buttons as `text: bodyContent.slice(0, 2000)` (:5511-5523), with discord-forum-tags.mjs:658 slicing again and no truncation mark; formatForDiscord/sanitizeDiscordText (discord-formatter.mjs:701-731) run only in message_sending, so @everyone and mention patterns survive. Gate it in tests/m12-t2-governed-surface.test.mjs with an announce payload over 2000 chars containing a mention, asserting one ledger-derived body, mention-safe and marked if cut.
- Acceptance criteria: every approval body is ledger-derived, single, and mention-safe.
- Related findings: adjudication Vòng 2: Verified, raised Medium → High · bug mở: R1-A03-02 · nguồn: A09 — Discord and external integrations

### F-125 — memory-tool output contracts are declared but validated nowhere, and the adapters already emit out-of-contract values

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R1-A10-03`
- Affected modules: Zink Tools, OpenClaw governance plugin + runtime libs
- Severity: Medium
- Status: OPEN
- Root cause: Register kết luận: memory-tool output contracts are declared but validated nowhere, and the adapters already emit out-of-contract values. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: Where: index.mjs:4344-4353 (isCallableExecutionTool excludes zink_skill_* / zink_knowledge_search); skill-adapter.mjs:257-263; knowledge-adapter.mjs:386-391 · Evidence: governed_status:"FAILED" and error_code are outside zink-skill.schema.json:141-153; "NO_MATCH" and semantic_contract_version are outside zink-knowledge.schema.json:86-92 (additionalProperties:false). · R7 (nạp vị trí mới từ ba hàng `F-231`/`F-232`/`F-233` bị rút vì trùng root cause): `loadToolContractSchemas` at index.mjs:3151-3160 does register zink_skill_search, zink_skill_propose and zink_knowledge_search against their contract files, so the three `$defs.output` blocks are loaded and hash-pinned and then never compared to the wire — the gate is not merely untested, it is wired to nothing. `knowledge-adapter.mjs:435-444` returns `governed_status: formattedResults.length === 0 ? "NO_MATCH" : "SUCCESS"` plus `semantic_contract_version`, while the schema's required list is exactly `action, namespace, results, total_count, governed_status` with the object closed; `skill-adapter.mjs:274-280` returns `FAILED` with `error_code: "SKILL_CATALOG_INVALID"` and :761-766 adds a top-level `query` that the ten declared keys of `zink-skill.schema.json:141-153` do not include. Static consequence: with the tool id outside `isCallableExecutionTool`, `outputSchema` is null and `validateToolOutputEnvelope` returns `{ ok: true }` for every one of those payloads.
- Reproduction: At HEAD isCallableExecutionTool (index.mjs:4344-4353) lists zink_excel, zink_power_bi, zink_sql and the other execution tools but not zink_skill_* or zink_knowledge_search, so validateToolOutputEnvelope never runs for them; the adapters already emit outside their declared schemas — governed_status 'FAILED' with an error_code against zink-skill.schema.json:141-153, and 'NO_MATCH' plus semantic_contract_version against zink-knowledge.schema.json:86-92 which sets additionalProperties:false. Gate it in tests/m7-t3-tools-contract.test.mjs: take a real adapter response and validate it against that tool's own declared output schema.
- Acceptance criteria: each emitted envelope passes its own declared output schema.
- Related findings: nguồn: A10 — Zink Tools, adapters and execution contracts · R7 delta audit: `F-231`–`F-233` withdrawn as duplicates of this row, their locations merged here

### F-126 — zink_excel implements less than its contract: template_path ignored, extra sheets dropped, validate is an existence check

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R1-A10-05`
- Affected modules: Zink Tools
- Severity: Medium
- Status: OPEN
- Root cause: template-driven deliverables are silently regenerated from model-supplied data, losing the owner's formatting and formulas, while rules are accepted and never consulted — both reported status:"success".
- Evidence: Where: lib/excel-writer.mjs:167-315 vs zink-tools/contracts/tools/zink-excel.schema.json:20-53, zink-tools/excel/contract.md · Evidence: repo-wide grep for template_path finds only the schema and the advertised parameter list (index.mjs:3814) — no reader; only specification.sheets[0] is used (:255); load returns hardcoded sheets:["Sheet1"] (:233); validate sets valid: exists (:239-251).
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc lib/excel-writer.mjs:167-315 vs zink-tools/contracts/tools/zink-excel.schema.json:20-53, zink-tools/excel/contract.md ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng zink_excel implements less than its contract: template_path ignored, extra sheets dropped, validate is an existence check trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "zink_excel implements less than its contract: template_path ignored, extra sheets dropped, validate is an existence check", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: nguồn: A10 — Zink Tools, adapters and execution contracts

### F-127 — outcome_status is copied six times and the reason-code matrix declares an outcome no schema can express

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R1-A11-03`
- Affected modules: Workflow topology + ledger, Workflow topology
- Severity: Medium
- Status: OPEN — _(same family as R1-A04-05; both are "matrix is de-facto authority")_
- Root cause: editing the matrix silently re-labels history or rejects writes for undeclared outcomes; agent-result-payload renames the same set to outcome_claim.
- Evidence: Where: topology/policy/reason-code-matrix.json:71-107 (COMPLETE|PARTIAL|BLOCKED|FAILED|CANCELLED) vs ledger-event.schema.json:1481,1492, ledger-snapshot.schema.json:306, execution-brief.schema.json:35-38, agent-result-payload.schema.json:23 (all 4 values), topology/lib/runtime.mjs:91,194-203 (re-declared as a regex); workflow.mjs:507 hardcodes ["OWNER_CANCELLED","PARENT_CANCELLED"] instead of reading the matrix row, dropping SUPERSEDED_REVISION; brief_state: SUPERSEDED (ledger-snapshot:136) has no writer
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc topology/policy/reason-code-matrix.json:71-107 (COMPLETE|PARTIAL|BLOCKED|FAILED|CANCELLED) vs ledger-event.schema.json:1481,1492, ledger-snapshot.schema.json:306, execution-brief.schema.json:35-38, agent-result-payload.schema.json:23 (all 4 values)… ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng outcome_status is copied six times and the reason-code matrix declares an outcome no schema can express trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "outcome_status is copied six times and the reason-code matrix declares an outcome no schema can express", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: đã sửa/xóa khỏi file: R1-A04-05 · nguồn: A11 — contracts, schemas and canonical definitions

### F-128 — the published contract version is fabricated, and schema files resolve through process.cwd()

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R1-A11-05`
- Affected modules: Workflow topology + ledger, Workflow topology, Zink Tools
- Severity: Medium
- Status: OPEN
- Root cause: version-level drift is invisible to any consumer comparing manifest versions — only sha256 moves, and only when verifySchemaManifestChecksums runs; a missing repo-relative copy lets a different cwd supply a same-named schema (compounds R1-A02-01/02).
- Evidence: Where: topology/lib/schema.mjs:139-148 (candidates 7–8), :381, :394 · Evidence: version = parsed["x-zink-contract-version"] || parsed.version || "1.0.0" — no governance contract carries the marker, so all 12 report "1.0.0" regardless of content (only zink-tools/* sets it, and zink-skill is 1.1.0 while its peers are 1.0.0); the tools loop at :394 omits the parsed.version fallback used at :381; contract lookup can fall back to process.cwd()/zink-tools/contracts[/tools].
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc topology/lib/schema.mjs:139-148 (candidates 7–8), :381, :394 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng the published contract version is fabricated, and schema files resolve through process.cwd() trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "the published contract version is fabricated, and schema files resolve through process.cwd()", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: bug mở: R1-A02-01 · nguồn: A11 — contracts, schemas and canonical definitions

### F-129 — governance docs no longer describe reality: executor role, validation vocabulary, branch discipline

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R1-A15-07`
- Affected modules: Architecture + contracts docs, Governance records
- Severity: Medium
- Status: OPEN
- Root cause: "DEPLOYED AND VERIFIED" coexists with an undefined NOT TESTED for the acceptance behaviour that actually matters — M12/T2-R2 was declared verified while all three surfaces were untested, and they broke the next day. The branch drift is silent integration risk.
- Evidence: Where: AGENTS.md:98-116 (names "dsh — executor") vs .agents/skills/{execution:108,116-120, code-review:64, planning:176, validating:90} (all name "Cursor", which AGENTS.md never defines); AGENTS.md:287-291 statuses PASS|FAIL|NOT RUN vs NOT TESTED used 12× in PLAN, 6× in CHANGELOG; docs/development/conventions.md:12-16 ("merge vào main qua pull request") vs measured branch topology: HEAD is 144 commits ahead of local main (f03ee4a, 2026-09-17) and local main is 66 behind origin/main.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc AGENTS.md:98-116 (names "dsh — executor") vs .agents/skills/{execution:108,116-120, code-review:64, planning:176, validating:90} (all name "Cursor", which AGENTS.md never defines); AGENTS.md:287-291 statuses PASS|FAIL|NOT RUN vs NOT TESTED used 12× in PLAN… ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng governance docs no longer describe reality: executor role, validation vocabulary, branch discipline trước khi sửa (nội quy mục 3).
- Acceptance criteria: one role vocabulary, one status enumeration, and the branch/integration reality recorded rather than implied.
- Related findings: nguồn: A15 — documentation, operations and deployment consistency

### F-130 — stale comments and cited config keys that assert rules the build no longer follows

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R1-A15-08`
- Affected modules: OpenClaw runtime libs, README
- Severity: Medium
- Status: OPEN
- Root cause: a maintainer "fixes" inheritParent toward a misstated README, and the resolver silently cannot reach entries 3–5 of the owner's ordered chain while comments claim the host steps down the whole chain.
- Evidence: Where: lib/policy.mjs:1040-1042 vs README.md:304; lib/quota-telemetry.mjs:204-206, 214-219 vs :220, :236-263 and MODEL_ALLOWLIST (policy.mjs:534-543, 633); README.md:276, 309 vs lib/policy.mjs:1033; lib/policy.mjs:513-517, :569 · Evidence: quota-telemetry still says the governed set is a single execute entry and "the fallback branches below are unreachable"; README cites channels.discord.directMessages.enabled (zero matches in policy/configure — the persisted key is dm:{enabled,groupEnabled}); the policy comment describes a README statement of inheritParent:true that the README does not make.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc lib/policy.mjs:1040-1042 vs README.md:304; lib/quota-telemetry.mjs:204-206, 214-219 vs :220, :236-263 and MODEL_ALLOWLIST (policy.mjs:534-543, 633); README.md:276, 309 vs lib/policy.mjs:1033; lib/policy.mjs:513-517, :569 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng stale comments and cited config keys that assert rules the build no longer follows trước khi sửa (nội quy mục 3).
- Acceptance criteria: no comment or README line asserts a provider, key or value the build does not emit.
- Related findings: nguồn: A15 — documentation, operations and deployment consistency

### F-131 — the runtime-backup plugin enumerator hard-fails --apply on any plugin-tree content it has never seen

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R2-B08-05`
- Affected modules: Chưa xác định — đọc lại Where khi re-verify
- Severity: Medium
- Status: OPEN
- Root cause: adding a legitimate governed asset (a topology/ dir, a .json under lib/) turns deployment into an unexplained hard failure, and the same guard makes the rollback step refuse to run.
- Evidence: Where: runtime-backup.mjs:73-95 (pluginFiles), reached synchronously from createRuntimeBackup:143 on the --apply path (:124-128); the same guard runs in restoreT1RuntimeFiles:318 · Evidence: anything outside lib|contracts|policy → BACKUP_UNEXPECTED_PLUGIN_CONTENT; files must match one regex naming exactly 4 root files; symlinks → BACKUP_SYMLINK_DENIED.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc runtime-backup.mjs:73-95 (pluginFiles), reached synchronously from createRuntimeBackup:143 on the --apply path (:124-128); the same guard runs in restoreT1RuntimeFiles:318 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng the runtime-backup plugin enumerator hard-fails --apply on any plugin-tree content it has never seen trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "the runtime-backup plugin enumerator hard-fails --apply on any plugin-tree content it has never seen", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: nguồn: B08 — adversarial independent audit (attempted refutation…

### F-132 — total_count reports the page length, so a 20-candidate pool cut to limit=5 reads as "only 5 matches exist"

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R5-E02-04`
- Affected modules: Zink Knowledgebase
- Severity: Medium
- Status: OPEN
- Root cause: total_count reports the page length, so a 20-candidate pool cut to limit=5 reads as "only 5 matches exist". Silent truncation: an agent or the owner concludes the knowledge base holds nothing more on a topic and answers from an incomplete set — with no has_more or cursor anywhere, and both branches already capped at 40 rows (database.py:1060,1079).
- Evidence: Where: main.py:458-464; :395, :412; retrieval.py:12 · Evidence: bounded_results = results[:request.limit] then "total_count": len(bounded_results), while the pool feeding it is `fuse_candidates(dense, fts)[:candidate_limit]` and MAX_FUSED_CANDIDATES = 80 is unreachable dead truncation.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc main.py:458-464; :395, :412; retrieval.py:12 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng total_count reports the page length, so a 20-candidate pool cut to limit=5 reads as "only 5 matches exist" trước khi sửa (nội quy mục 3).
- Acceptance criteria: a caller can tell from one response whether more results existed than were returned.
- Related findings: nguồn: E02 — Knowledgebase retrieval, provenance and citations (7…

### F-133 — the durable proposal state contradicts the derived index in both directions — a serving skill flagged INDEX_FAILED (with no retry path at all), or an INDEX_FAILED proposal whose content is live for agents. Governance decisions then rest…

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R5-E05-08`
- Affected modules: Zink Skill Store, OpenClaw governance plugin + runtime libs
- Severity: Medium
- Status: EXCLUDED — excluded by owner letter `p1` (deployed-digest admission).
- Root cause: the durable proposal state contradicts the derived index in both directions — a serving skill flagged INDEX_FAILED (with no retry path at all), or an INDEX_FAILED proposal whose content is live for agents. Governance decisions then rest on a status that does not describe the index.
- Evidence: Where: vector-sync.mjs:806-818; index.mjs:1158-1170 · Evidence: the sync rolls up status = "PARTIAL"/FAILED whenever any skill fails, per-skill, while the caller keys governance state off the aggregate only: status: report?.status === "READY" ? "READY" : "INDEX_FAILED", ignoring the per-skill entry (sync_status: "READY", :744-750).
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc vector-sync.mjs:806-818; index.mjs:1158-1170 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng the durable proposal state contradicts the derived index in both directions — a serving skill flagged INDEX_FAILED (with no retry path at all), or an… trước khi sửa (nội quy mục 3).
- Acceptance criteria: proposal status and that skill's catalog row status always agree, or a retry closes the gap.
- Related findings: disposition: excluded by owner letter `p1` (deployed-digest admission). · nguồn: E05 — Skill Store vector sync (8 findings; the derived…

### F-134 — deleting the Node toolchain or the tokenizer checksum step from ci.yml keeps repo:check and CI green — the two guards the workflow's own comment claims exist

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R5-E09-05`
- Affected modules: Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: deleting the Node toolchain or the tokenizer checksum step from ci.yml keeps repo:check and CI green — the two guards the workflow's own comment claims exist. checkWorkflowDefinitions (scripts/repository-policy.mjs:584) constrains a step list, not the toolchain the job depends on.
- Evidence: Where: tests/repository-policy.test.mjs:84-95 vs ci.yml:69-100 · Evidence: the golden VALID_CI_WORKFLOW python-quality job is exactly checkout, setup-python, pip install uv, uv sync --locked, npm run test:knowledge, while the real job additionally installs Node 24.15 + npm 12.0.2 and fetches the pinned tokenizer, because ci.yml:65-68 warns that "without this toolchain … npm abort before pytest collects anything". The fixture also omits working-directory.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc tests/repository-policy.test.mjs:84-95 vs ci.yml:69-100 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng deleting the Node toolchain or the tokenizer checksum step from ci.yml keeps repo:check and CI green — the two guards the workflow's own comment claims exist trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "deleting the Node toolchain or the tokenizer checksum step from ci.yml keeps repo:check and CI green — the two guards the workflow's own comment claims exist", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: nguồn: E09 — CI: the gate tier that can print green without…

### F-135 — LATENT is neither OPEN nor FIXED, so the code-review:128 "zero OPEN" precondition is satisfiable by re-labelling confirmed High findings, and CLOSED/Duplicate records bypass README:83's "FIXED requires validation" rule. The per-round…

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R5-E12-02`
- Affected modules: README, Governance records
- Severity: Medium
- Status: OPEN · 2026-10-17 partial repair, recorded not closed: the register moved to `docs/execution/findings.md` and `.agents/states/README.md` + `code-review/SKILL.md` were rewritten so the register's §0 vocabulary is now the only finding vocabulary and `QUALITY REVIEW PASS` is scoped to one review — the locators in `Evidence:` above therefore point at superseded line numbers. Unverified by any test, so it stays open under §0.2 rule 6.
- Root cause: the two vocabularies disagreed — the register carried LATENT/PARTIAL/EXCLUDED while `code-review/SKILL.md` gated review on "zero OPEN" and `.agents/states/README.md` demanded OPEN/FIXED/ACCEPTED-RISK/INVALID, so re-labelling a confirmed finding could satisfy the gate without any fix, and CLOSED/Duplicate records bypassed the "FIXED requires validation" rule. Residual after the 2026-10-17 rewrite: the register still accepts a status change on assertion alone — §0.2 rule 7 forbids re-grading but nothing checks it.
- Evidence: Where: .agents/states/README.md:68-84; code-review/SKILL.md:119-128; register lines 589, 608, 663, 698 · Evidence: README mandates Affected paths: / Required remediation: / Validation after remediation: — grep counts in the register: 0, 0, 0 — while Where: = 168 and Acceptance: = 130. Mandated vocabulary is OPEN | FIXED | ACCEPTED-RISK | INVALID; the register actually uses Status: LATENT (4 records, severities High/High/Medium/Low) plus Verified with correction 23×, Not reproduced 6×, CLOSED 5×, Duplicate 2×.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc .agents/states/README.md:68-84; code-review/SKILL.md:119-128; register lines 589, 608, 663, 698 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng LATENT is neither OPEN nor FIXED, so the code-review:128 "zero OPEN" precondition is satisfiable by re-labelling confirmed High findings, and CLOSED/Duplicate… trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "LATENT is neither OPEN nor FIXED, so the code-review:128 "zero OPEN" precondition is satisfiable by re-labelling confirmed High findings, and CLOSED/Duplicate records bypass README:83's "FIXED requires validation"…", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: nguồn: E12 — skills procedure vs practice (7 findings; the two…

### F-136 — no attributable writer discipline for the only finding register, no serialization (see R5-E12-03), and a "must" any agent can satisfy by declining to write

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R5-E12-06`
- Affected modules: README, Governance records
- Severity: Medium
- Status: OPEN
- Root cause: no attributable writer discipline for the only finding register, no serialization (see R5-E12-03), and a "must" any agent can satisfy by declining to write.
- Evidence: Where: execution/SKILL.md:120; code-review/SKILL.md:111-114; .agents/states/README.md:29-31 · Evidence: execution:120 says the register is "owned by Codex review/remediation; Cursor must not use it to broaden implementation scope"; code-review:111 makes it "must create/update … when useful" (a must with an opt-out in the same clause); README:30 assigns the typical writer as "reviewer/debugger/validator". The register's IDs are R1-A01..A16, R2-B.., R5-E01..E16 — delegated-lane records — while AGENTS.md §3 states "Delegation never expands authority."
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc execution/SKILL.md:120; code-review/SKILL.md:111-114; .agents/states/README.md:29-31 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng no attributable writer discipline for the only finding register, no serialization (see R5-E12-03), and a "must" any agent can satisfy by declining to write trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "no attributable writer discipline for the only finding register, no serialization (see R5-E12-03), and a "must" any agent can satisfy by declining to write", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: bug mở: R5-E12-03 · nguồn: E12 — skills procedure vs practice (7 findings; the two…

### F-137 — empty untracked models/ and shared/ are ownerless legacy scaffolding duplicating Zink Tools

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R1-A01-04`
- Affected modules: Legacy top-level trees
- Severity: Low
- Status: OPEN
- Root cause: duplicate top-level trees with no owner; agents write there expecting a real surface.
- Evidence: Where: models/{forecast,optimization,operations-research,simulation}, shared/{assets,constants,libraries,prompts,schemas,telemetry,templates,utilities} — git ls-files empty, 0 files
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc models/{forecast,optimization,operations-research,simulation}, shared/{assets,constants,libraries,prompts,schemas,telemetry,templates,utilities} — git ls-files empty, 0 files ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng empty untracked models/ and shared/ are ownerless legacy scaffolding duplicating Zink Tools trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "empty untracked models/ and shared/ are ownerless legacy scaffolding duplicating Zink Tools", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: nguồn: A01 — architecture and system boundaries

### F-138 — Zink Tools provider adapters exceed the declared tool-ownership set

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R1-A01-05`
- Affected modules: Zink Tools
- Severity: Low
- Status: OPEN · premise changed 2026-10-17: two locators drifted — the "do not create provider adapters" rule is `zink-tools-boundaries.md:100`, not `lsc-data-flow.md:74` (that file is 69 lines and never mentions provider adapters), and the doc tool list is `:12-20`, not `:11-18`. The defect stands and is one adapter wider than the register recorded (`storage/r2-adapter.mjs`).
- Root cause: docs/architecture/zink-tools-boundaries.md:12-20 declares the Zink Tools ownership set (Excel, Power BI, SQL, Python, n8n integration, Forecast, Optimization, Operations Research, Simulation) and :100 states "Do not create provider adapters until a real provider difference requires one", yet nine provider adapters ship outside that set.
- Evidence: Where: zink-tools/adapters/{mlops/dagshub,mlops/huggingface,mlops/mlflow,compute/databricks,compute/kaggle,analytics/bigquery,analytics/motherduck,app/streamlit}-adapter.mjs, registered at zink-tools/adapters/index.mjs:33-43 · Expected/Actual: docs/architecture/zink-tools-boundaries.md lists only Excel/Power BI/SQL/Python/n8n/forecast/optimization/OR/simulation, and lsc-data-flow.md:74 says "do not create provider adapters until a real provider difference requires one".
- Reproduction: Measured at HEAD: `ls zink-tools/adapters/` returns analytics, app, compute, knowledge, mlops, skill-store and storage (dagshub, huggingface, mlflow, databricks, kaggle, bigquery, motherduck, streamlit adapters inside them) and adapters/index.mjs:30-43 exports StreamlitAdapter, KnowledgeAdapter and SkillAdapter, while docs/architecture/zink-tools-boundaries.md:12-20 lists only Excel, Power BI, SQL, Python, n8n integration, Forecast, Optimization, Operations Research and Simulation and :100 of that same file says not to create provider adapters until a real provider difference requires one. Gate it in tests/repository-policy.test.mjs: every directory under zink-tools/adapters/ must appear in the boundary doc's tool list.
- Acceptance criteria: the documented tool list matches adapters/.
- Related findings: nguồn: A01 — architecture and system boundaries

### F-139 — two different owner-snowflake validators and two owner sources

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R1-A03-05`
- Affected modules: OpenClaw runtime libs
- Severity: Low
- Status: OPEN
- Root cause: a 20-digit or leading-zero configured owner passes config admission but resolves to undefined, denying every owner action (fail-closed self-DoS, not escalation).
- Evidence: Where: index.mjs:4715-4720 (resolveOwnerDiscordId: /^[0-9]{17,19}$/) vs index.mjs:4767 and lib/authority.mjs:85 (/^[1-9][0-9]{16,19}$/); isConfiguredOwnerActor reads DISCORD_OWNER_ID while the button/ingress gates read config.ownerDiscordId
- Reproduction: Both validators are live and disagree: resolveOwnerDiscordId (index.mjs:4715-4718) accepts any 17-19 digits, while :4767 and lib/authority.mjs:85 require a non-zero first digit and up to 20, so a 20-digit or leading-zero configured owner passes config admission and then resolves to undefined — a fail-closed self-DoS rather than an escalation. isConfiguredOwnerActor also reads DISCORD_OWNER_ID while the button and ingress gates read config.ownerDiscordId. Gate it in tests/m12-t2.17-owner-identity-hygiene.test.mjs: configure a leading-zero owner id and assert one canonical verdict from every gate.
- Acceptance criteria: all gates share one canonical validator and one owner source.
- Related findings: nguồn: A03 — security and trust boundaries

### F-140 — Independently derived by two lanes; E01's addition is the reachability arithmetic — with limit < 20, ranks limit+1…20 of MAX_RERANK_CANDIDATES = 20 are dropped, and anything past the 40-per-branch SQL cap (database.py:1060, :1079) is…

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R5-E01-06`
- Affected modules: Zink Knowledgebase
- Severity: Low
- Status: OPEN
- Root cause: Register kết luận: Independently derived by two lanes; E01's addition is the reachability arithmetic — with limit < 20, ranks limit+1…20 of MAX_RERANK_CANDIDATES = 20 are dropped, and anything past the 40-per-branch SQL cap (database.py:1060, :1079) is…. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: Independently derived by two lanes; E01's addition is the reachability arithmetic — with limit < 20, ranks — limit+1…20 of MAX_RERANK_CANDIDATES = 20 are dropped, and anything past the 40-per-branch SQL cap — (database.py:1060, :1079) is unreachable with no offset or continuation field on SearchRequest, so an — agent cannot tell "only 2 matches" from "2 of ≥40" and stops early, citing an incomplete evidence set. E01 — recommends reporting the fused/pool candidate count separately or adding a continuation token, and explicitly — not raising any existing ceiling.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc entry không còn `Where:` — dựng lại locator từ `PLAN.md` §8 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng Independently derived by two lanes; E01's addition is the reachability arithmetic — with limit < 20, ranks limit+1…20 of MAX_RERANK_CANDIDATES = 20 are… trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "Independently derived by two lanes; E01's addition is the reachability arithmetic — with limit < 20, ranks limit+1…20 of MAX_RERANK_CANDIDATES = 20 are dropped, and anything past the 40-per-branch SQL cap…", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: nguồn: E01 — Knowledgebase service internals (6 findings + a…

### F-142 — read-only — confirm nothing else populates the index, and the unnest('{}'::text[]) semantics

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R5-E05-03`
- Affected modules: Zink Skill Store
- Severity: Critical (High (→ Critical candidate))
- Status: REFUTED — refuted by the `A-5` re-read (`639fc47` stopped; the guard built from it was measured red on 35 of 87 Skill Store tests and reverted). Residual survives as `R6-A05-01`.
- Root cause: a sync run against the repo's real skills root — or any wrong-but-existing skillsRoot — deletes the entire derived vector index and reports READY with synced_count 0. The report is indistinguishable from a healthy no-op, and retrieval then fails closed as SKILL_INDEX_STALE, so the owner loses learned skills and sees a staleness error rather than a destruction event. Only caller: index.mjs:1158-1162.
- Evidence: Where: vector-sync.mjs:610 (activeKeys), :628-631, :806-814; toPostgresArrayLiteral :73 · Evidence: the tombstone is DELETE FROM skills.catalog_index WHERE status='ACTIVE' AND (…) NOT IN (SELECT unnest(${escapeSqlLiteral(toPostgresArrayLiteral(activeKeys))}::text[])), and toPostgresArrayLiteral returns "{}" when arr.length === 0. SQL semantics: x NOT IN (empty set) is TRUE, so every ACTIVE row is deleted (skills.segments cascades, 003:29). Rollup then sees failed_count > 0 false ⇒ status = "READY". · Detail: zink-skill-store/skills/ holds only README.md (0 SKILL.md tracked), and catalog.mjs:639 tolerates a root README, so scanCatalog returns {errors: [], records: []}.
- Reproduction: read-only — confirm nothing else populates the index, and the unnest('{}'::text[]) semantics.
- Acceptance criteria: an empty scan either leaves rows untouched or reports a distinct non-READY status.
- Related findings: bug mở: R6-A05-01 · disposition: refuted by the `A-5` re-read (`639fc47` stopped; the guard built from it was measured red on 35 of 87 Skill Store tests and reverted). Residual survives as `R6-A05-01`. · nguồn: E05 — Skill Store vector sync (8 findings; the derived…

### F-143 — one crash/ENOSPC/drvfs-EIO mid-append makes every readSnapshot, appendEvent and recordWorkflowEvent fail gateway-wide, forever

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R1-A08-01`
- Affected modules: Workflow topology + ledger, Workflow topology
- Severity: High
- Status: LATENT
- Root cause: the read path treats every line as sealed chain data; there is no torn-write tolerance. — Hệ quả: one crash/ENOSPC/drvfs-EIO mid-append makes every readSnapshot, appendEvent and recordWorkflowEvent fail gateway-wide, forever; recovery is manual file surgery. Note this is a worse failure than R1-A14-01's temp residue and is a different defect.
- Evidence: Where: topology/lib/ledger.mjs:252-317 (fault 419-439, append 488-523, "repair" 224/417) · Evidence: const event = JSON.parse(line); over split("\n")…filter(Boolean); the catch emits "Ledger corruption: trusted state cannot be verified". The only recovery is if (tail.length > 0 && repairSnapshot) writeSnapshotAtomic(…) — snapshot lag, never journal damage. · Expected/Actual: a torn final line should be detected and dropped (safe, because the snapshot is written _after_ the event, so a torn tail provably has no snapshot anchor) vs any unparseable line throws on full replay.
- Reproduction: append truncated bytes to a journal in a temp dir and call readSnapshot (not run — read-only).
- Acceptance criteria: replay of a journal with a torn tail succeeds and reports the dropped remainder.
- Related findings: đã sửa/xóa khỏi file: R1-A14-01 · nguồn: A08 — ledger and event-store integrity *(Vòng 1: 16/16…

### F-144 — every successful zink_excel and zink_sql result is rejected by its own output contract — success is punished, failure passes

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R1-A10-02`
- Affected modules: OpenClaw governance plugin (Discord), OpenClaw integration, Zink Tools
- Severity: High
- Status: OPEN
- Root cause: a workbook or query that genuinely ran is reported to the agent as INVALID_OUTPUT_SCHEMA, while a failed tool passes the gate. tests/m7-lane-b-ingress:234-270 only feeds non-JSON or exempt statuses, so no success envelope is ever asserted.
- Evidence: Where: integrations/openclaw/plugins/zink-governance/index.mjs:4343-4398 (validateToolOutputEnvelope); emitters integrations/openclaw/lib/excel-writer.mjs:293-314, zink-tools/sql/duckdb-bridge.mjs:310-319 · Evidence: zink-excel.schema.json:56-66 requires success:boolean (never emitted) and forbids status/tool/preview_*; zink-sql.schema.json:86-111 requires rows of objects while the bridge emits arrays plus 5 undeclared keys → both envelopes return SCHEMA_INVALID. Failures (status: BLOCKED/ERROR) are exempted at index.mjs:4383-4389, and the exempt list still names a stale "governed" value (:4388) no emitter produces.
- Reproduction: Add to tests/m7-lane-b-ingress.test.mjs, whose M8-060 block (:235-279) already builds contracts via loadToolContractSchemas(): assert the exact envelopes excel-writer.mjs:293-314 and duckdb-bridge.mjs:310-319 return pass validateToolOutputEnvelope. A `node -e` probe shows both fail today (zink-excel.schema.json requires success, zink-sql requires rows of objects), while {status:'BLOCKED'} and {status:'governed'} pass. Also assert every exempt status string is emitted somewhere: `grep -rn '"governed"' --include=*.mjs integrations zink-tools` hits only index.mjs:4388. Run `node --test tests/m7-lane-b-ingress.test.mjs` (13 pass today).
- Acceptance criteria: A successful zink_excel or zink_sql run returns the tool's own result instead of INVALID_OUTPUT_SCHEMA, and every status string in the exemption list at index.mjs:4380-4388 is a value some emitter actually writes.
- Related findings: adjudication Vòng 2: → Verified. — Independently re-derived by pure computation over schema.mjs (check required at :321, additionalProperties:false at :333): zink-excel.$defs.output requires… · nguồn: A10 — Zink Tools, adapters and execution contracts

### F-145 — a knowledge-service failure returns a success-shaped envelope, and fabricated placeholder provenance is counted as evidence under governed_status: "SUCCESS"

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R1-A14-08`
- Affected modules: OpenClaw runtime libs, Zink Tools
- Severity: High
- Status: OPEN
- Root cause: an unreachable knowledge base reads as "no evidence exists", and uncited rows are counted as retrieved evidence — the exact provenance guarantee the module exists to enforce.
- Evidence: Where: zink-tools/adapters/knowledge/knowledge-adapter.mjs:413-424, :337-392, :367-372 · Evidence: non-KnowledgeAdapterError faults (JSON SyntaxError, raw socket errors) fall through to {governed_status:"CONTROLLED_FAILURE", error:"KNOWLEDGE_SERVICE_UNAVAILABLE", message: error.message} — unsanitized, unlike the deliberate 300-char slice at :394. Success rows use chunk_id: r.segment_id || r.chunk_id || "unknown", title: … || "Untitled", citation: … || "", then total_count: formattedResults.length with governed_status:"SUCCESS". NO_MATCH and CONTROLLED_FAILURE both return results: [], total_count: 0, distinguished only by one field whose enforcement is a prompt sentence (lib/policy.mjs:1176); code checks SUCCESS only for proposals (index.mjs:1409, 3707).
- Reproduction: Extend the BUG-07 stub idiom in tests/m7-t5-remediation.test.mjs:533-596 (http.createServer + options.endpoint): (1) serve HTTP 200 with a non-JSON body so the JSON.parse at :387 throws, and assert the returned message is the fixed sentence containing no exception text — today :475 copies error.message verbatim; (2) serve 200 with a result row lacking segment_id/title/citation and assert governed_status is not SUCCESS and total_count does not count invented provenance. Run `node --test tests/m7-t5-remediation.test.mjs` (33 pass today, none covering either path).
- Acceptance criteria: A fault that is not a KnowledgeAdapterError yields a fixed reason code and zero upstream exception text; a row whose chunk_id/title/citation had to be invented is never counted in total_count nor returned under governed_status SUCCESS, and NO_MATCH differs from CONTROLLED_FAILURE by more than one field.
- Related findings: đã sửa/xóa khỏi file: R5-E06-03 · nguồn: A14 — failure handling and reliability

### F-146 — the native-patch lineage-upgrade branch takes no backup and has no rollback — and it is the branch the live host version would use

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R2-B08-01`
- Affected modules: Workflow topology + ledger, Workflow topology, OpenClaw integration
- Severity: High
- Status: OPEN · premise changed 2026-10-17: mitigation exists and is gated: NATIVE_PATCH_PREDECESSORS' only key is the pinned 2026.6.34, and R22-04 asserts every file the branch mutates is transaction-tracked, so applyRuntime's snapshot — not ensureNativeBackup — is the recovery path
- Root cause: a mid-write failure leaves the runtime half-upgraded with no preimage set; every later apply/verify fails NATIVE_SOURCE_DRIFT with no recovery short of reinstalling the host. Sibling: :1098 calls assertNoLinks(backupRoot) with backupRoot undefined → a raw TypeError from path.isAbsolute instead of a governance code.
- Evidence: Where: integrations/openclaw/topology/lib/native-patch.mjs:1039-1066 (applyNativePatch PREDECESSOR branch); the converge branch does the opposite (ensureNativeBackup :1107, restore-on-throw :1123-1126) · Evidence: the backupRoot parameter (:1030) is never referenced in the predecessor branch; it replaceAtomic(...)s each non-PATCHED artifact then returns. The live unit carries Environment=OPENCLAW_SERVICE_VERSION=2026.6.34, whose pin declares selection-DopzNY3I.js predecessor R10 → successor R5 (:561-570).
- Reproduction: Static proof on this host: `awk 'NR>=1039 && NR<=1067' native-patch.mjs | grep -c backupRoot` returns 0, while the converge branch calls ensureNativeBackup (:1107, :1123-1126) and operator-apply.mjs:133 still passes nativeBackup so the caller believes a backup exists. Host execution is UNVERIFIABLE on Windows: `node --test tests/m8-t2.11-r14-native-lineage.test.mjs` gives 1 pass / 24 skipped ('operator backup not reachable'). Red test in the applyRuntime idiom of tests/m8-t2.13-r16-apply-rehearsal.test.mjs: drive a predecessor-shaped fixture whose mid-loop write throws and assert backupRoot holds a complete restorable preimage — it is created empty.
- Acceptance criteria: After applyNativePatch takes the predecessor branch, the backupRoot it was handed contains a complete, restorable preimage of every artifact that branch rewrote; if it cannot back up, applyNativePatch rejects the backupRoot argument instead of silently discarding it.
- Related findings: nguồn: B08 — adversarial independent audit (attempted refutation…

### F-147 — restoreT1RuntimeFiles never installs the preimages it captured — it only quarantines current content

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R2-B08-03`
- Affected modules: OpenClaw governance plugin (Discord), Workflow topology + ledger, Workflow topology, Governance records
- Severity: High
- Status: OPEN
- Root cause: the documented rollback step returns filesRestored:true while leaving the gateway with no governance plugin and no workspace AGENTS.md; recovery needs an operator manually copying from a directory the function never names.
- Evidence: Where: topology/lib/runtime-backup.mjs:296-372 (restore) vs preimage writes :172-174 and verification :237-252 · Evidence: restore writes only t1-config.json → openclaw.json (:347-351) and then renameSyncs workspaces/*/AGENTS.md and the whole extensions/zink-governance tree into quarantined-t2/ (:353-361); no code in the repo reads root/preimages/ back.
- Reproduction: Register chưa có bước tái hiện riêng; bước gần nhất suy từ acceptance/remediation: post-restore state digests equal the manifest preimage digests.
- Acceptance criteria: post-restore state digests equal the manifest preimage digests.
- Related findings: nguồn: B08 — adversarial independent audit (attempted refutation…

### F-148 — only 3 of 35 governed paths carry any live-reachability assertion (R13 P1, R13 P2, R7 P1)

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R2-B16-02`
- Affected modules: OpenClaw governance plugin (Discord), OpenClaw runtime libs, OpenClaw integration, Repo tooling + deploy scripts
- Severity: High
- Status: OPEN — Confirmed (measured, two lanes)
- Root cause: only 3 of 35 governed paths carry any live-reachability assertion (R13 P1, R13 P2, R7 P1). Every other packaged asset can drift forward indefinitely with no gate noticing. — Hệ quả: configure.mjs accepts only --preflight, --apply, --dry-run; there is no drift override. A single unadmitted asset makes --preflight print Governance plugin asset drift detected and refuse — documented in this repo already for lib/file-lock.mjs at configure.mjs:515-527 ("was undeployable until its outgoing digest was admitted"). So the Wave B remediation cannot be deployed today through any of these nine paths.
- Evidence: Where: integrations/openclaw/configure.mjs ALLOWED_GOVERNANCE_ASSET_SHA256 plus the per-mode entrypoint lists at :1497/:1764; the live tree at /home/hoang_vinh/.openclaw-zink/extensions/zink-governance. · Evidence: a read-only sweep of all 35 governed packaged files on the WSL lane, using the predicate the tests already apply, returns 9 UNREACHABLE assets (live→current, admitted-entry count): lib/guard.mjs 263d72c4→92a4b7f6 (13), lib/ledger.mjs c984cda8→2cbe3ad0 (3), lib/workflow.mjs 2009e9fe→95133505 (7), lib/policy.mjs d621c85f→44bd5e8a (17), lib/discord-formatter.mjs 26ecc883→3933eee6 (1), lib/discord-native-send.mjs 4d36d8ab→94800b14 (1), lib/authority.mjs c38e1a6b→25484e41 (7), lib/queue-manager.mjs a5580bb6→8cd9446a (3), lib/decision-ledger.mjs 1d9518ca→0d5edbb4 (4). index.mjs is NOT one of them: the first sweep read only the asset table and flagged it, but its live digest 513beb15… is admitted in both per-mode entrypoint lists. · Detail: R7 P1 fails on WSL — the live lib/authority.mjs digest c38e1a6b… is neither the current build nor an admitted predecessor (tests/m10-t2-r7-authority-predecessor.test.mjs:236). Windows is silent on the whole class (48 skips: the live tree is not mountable), which is why npm run verify exits 0 over it. Not caused by…
- Reproduction: Register chưa có bước tái hiện riêng; bước gần nhất suy từ acceptance/remediation: --preflight reaches the deployed extension, and the new sweep gate fails if any governed path stops being current-or-admitted. Confidence: Confirmed for the nine rows and the refusal semantics; the per-asset commit provenance is NOT yet re-derived — that is the work M-1 authorizes.
- Acceptance criteria: --preflight reaches the deployed extension, and the new sweep gate fails if any governed path stops being current-or-admitted. Confidence: Confirmed for the nine rows and the refusal semantics; the per-asset commit provenance is NOT yet re-derived — that is the work M-1 authorizes.
- Related findings: nguồn: Correction to the entry above (2026-10-16)

### F-149 — the lock was introduced for the M4 acceptance-backup flow and the default startup branch was left outside it

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R5-E03-02`
- Affected modules: Zink Knowledgebase
- Severity: High
- Status: OPEN — Strongly Supported (severity depends on the unread config default)
- Root cause: the lock was introduced for the M4 acceptance-backup flow and the default startup branch was left outside it; coordinator.reserve() (main.py:483, index_runner.py:38) guards only runs, which start later. — Hệ quả: two replicas or a restart overlapping an old process race CREATE EXTENSION IF NOT EXISTS vector and the unguarded CREATE TYPE, and Postgres raises duplicate_object/unique_index_violation on concurrent IF-NOT-EXISTS DDL. The loser's except Exception: (database.py:210) closes the pool and records only DATABASE_UNAVAILABLE, so a schema race is reported to the operator as "database down" and recover_startup (main.py:172) never runs.
- Evidence: Where: apps/knowledge/app/database.py:180-219 start(), :1710-1738 _apply_migrations; apps/knowledge/app/main.py:168-175 lifespan · Evidence: `if self._acceptance_backup_barrier_dir is None or barrier_completed:` → `await self._apply_migrations()` (:194-195) with no lock; only the other branch acquires acquire_advisory_lock(…) (:197) and passes that connection to `_apply_migrations(connection)` (:203). The fallback acquires a bare pool connection at :1737-1738. · Expected/Actual: DDL serialized by the same advisory lock that guards run acceptance / the default production shape applies the entire schema on an unserialized pool connection.
- Reproduction: open apps/knowledge/app/config.py for `acceptance_backup_barrier_dir`'s deployed default; `grep start()` for a lock before `_apply_migrations`; check the unit journal for DATABASE_UNAVAILABLE at boot with no preceding connection error.
- Acceptance criteria: two simultaneous starts converge once, the loser waits or exits with a named migration code, and no DATABASE_UNAVAILABLE is recorded.
- Related findings: nguồn: E03 — Knowledgebase persistence: schema, SQL, migrations…

### F-150 — one killed promotion of 2.0.0 makes skill-store get/validate, getActiveSkill, syncSkillsToVectorStore and every later promotion fail closed store-wide — because the contract says a malformed record prevents all normal retrieval — until a…

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R5-E04-01`
- Affected modules: Zink Skill Store
- Severity: High
- Status: LATENT
- Root cause: one killed promotion of 2.0.0 makes skill-store get/validate, getActiveSkill, syncSkillsToVectorStore and every later promotion fail closed store-wide — because the contract says a malformed record prevents all normal retrieval — until a human finds a hidden directory. The residue of the writer's own transaction is an error class for every reader.
- Evidence: Where: catalog.mjs:893 (healWriterResidue), :679-687 (walk), :1160-1170 (pre-check) · Evidence: if (entry.startsWith(${version}.pending-)) — healing is scoped to the caller's own version, while stagingName() = ${version}.pending-${pid}-… lives inside the scanned tree and walk reports DIRECTORY_GRAMMAR_INVALID for anything failing SLUG.test(currentName) || parts.length > 9.
- Reproduction: Register chưa có bước tái hiện riêng; bước gần nhất suy từ acceptance/remediation: residue from version X neither nulls records nor blocks promotion of version Y, and a documented sweeper clears it.
- Acceptance criteria: residue from version X neither nulls records nor blocks promotion of version Y, and a documented sweeper clears it.
- Related findings: nguồn: E04 — Skill Store catalog internals (9 findings; the store…

### F-151 — cost grows with total catalog × every promotion (index.mjs:1158-1162 runs the FULL sync per approved skill)

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R5-E05-01`
- Affected modules: Zink Skill Store
- Severity: High
- Status: OPEN — — deliberately unimplemented (owner answer I2-A, option a); pinned by A-7 (fd302d4)
- Root cause: cost grows with total catalog × every promotion (index.mjs:1158-1162 runs the FULL sync per approved skill); each run deletes and reinserts every 1024-d vector, so dead tuples and HNSW bloat compound (003:38-39), with a 30 s timeout per segment. A stored digest that is output-only is the root cause.
- Evidence: Where: vector-sync.mjs:700-716, :722-724, :517-530 · Evidence: for (const seg of segments) { … await generateSkillEmbeddings([envelopeText], options) — one HTTP round trip per segment, with the batch form (input: textList) never used; skillEmbeddingHash is written to embedding_input_sha256 but no read ever compares it; the success path is ON CONFLICT … DO UPDATE SET source_sha256 = EXCLUDED.source_sha256 then DELETE FROM skills.segments WHERE skill_id = v_skill_id.
- Reproduction: Register chưa có bước tái hiện riêng; bước gần nhất suy từ acceptance/remediation: a re-run over an unchanged catalog issues zero embedding calls and zero segment rewrites.
- Acceptance criteria: a re-run over an unchanged catalog issues zero embedding calls and zero segment rewrites.
- Related findings: nguồn: E05 — Skill Store vector sync (8 findings; the derived…

### F-152 — one malformed SKILL.md anywhere pins every previously READY row, including rows for deprecated skills — retirement stops taking effect

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R5-E05-02`
- Affected modules: Zink Skill Store, Zink Tools
- Severity: High
- Status: OPEN
- Root cause: one malformed SKILL.md anywhere pins every previously READY row, including rows for deprecated skills — retirement stops taking effect. Freshness uses max(synced_at) of the _surviving_ rows, so the index still reports FRESH for up to the 7-day SLA (DEFAULT_INDEX_FRESHNESS_SLA_MS, :20) while the adapter keeps serving retired skills.
- Evidence: Where: vector-sync.mjs:563-573 vs :625-634; consumer gates skill-adapter.mjs:549-552, :682-688 · Evidence: if (catalog.errors.length > 0) { return {status:"FAILED", error_code:"CATALOG_INVALID", …} } precedes the tombstone DELETE. catalog.mjs:772 returns records: [] and any single bad file (e.g. MULTIPLE_ACTIVE_VERSIONS, :756-764) sets errors.
- Reproduction: read-only grep — DELETE FROM skills.catalog_index exists only at :626.
- Acceptance criteria: a catalog with one invalid file still removes deprecated rows, or the adapter refuses to serve past the SLA.
- Related findings: nguồn: E05 — Skill Store vector sync (8 findings; the derived…

### F-153 — AGENTS.md §11 forbids committing implementation until the review-convergence and Final Quality Gate are PASS — and neither token has ever been recorded in any tracked artifact

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R5-E12-01`
- Affected modules: Architecture + contracts docs, README, Governance records
- Severity: High
- Status: OPEN · premise changed 2026-10-17: Gate fields were added post-finding; older milestone-table closures are still prose-only, and the skills' literal token never appears in PLAN.md.
- Root cause: AGENTS.md §11 forbids committing implementation until the review-convergence and Final Quality Gate are PASS — and neither token has ever been recorded in any tracked artifact. No task in this repository's history can be shown to have run the convergence loop; a skipped or partial review is indistinguishable from a completed one, and Rounds 1–5 all inherited an unprovable "validated" premise.
- Evidence: Where: .agents/skills/validating/SKILL.md:97-110, :162-177; code-review/SKILL.md:132-156; docs/contracts/execution/README.md:82 · Evidence: repo-wide grep for "QUALITY REVIEW PASS" returns 5 hits, all inside the two skill files (validating:102, :168; code-review:128, :144, :147). git log --oneline -S 'QUALITY REVIEW PASS' -- PLAN.md = empty; git log -S 'Final Quality Gate' = empty. PLAN.md:40-41 mark tasks CLOSED/COMPLETE/REMOTE-BACKED with prose gate summaries that never assert either token.
- Reproduction: Static measurement on this host: `git grep 'QUALITY REVIEW PASS'` yields only the five skill-file hits and PLAN.md contains the literal zero times. The Final-Quality-Gate half now contradicts the premise: PLAN.md:434 and :462 carry populated 'Review Convergence Gate: PASS' and 'Final Quality Gate: PASS' cells for M12/T2.2-R3, added by 3506e80/5ac1540 after this was filed.
- Acceptance criteria: Every PLAN.md row marked CLOSED/COMPLETE/REMOTE-BACKED shows an explicit populated Review Convergence Gate and Final Quality Gate status (PASS/FAIL/NOT RUN), one pair per closed task, never a prose-only summary.
- Related findings: nguồn: E12 — skills procedure vs practice (7 findings; the two…

### F-154 — the queue manager's durable writer does not lock itself, and one shipped caller relies on it

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R6-A03-01`
- Affected modules: OpenClaw governance plugin (Discord), OpenClaw runtime libs, OpenClaw integration, Gates + CI
- Severity: High
- Status: OPEN — Confirmed (lost-update path reachable)
- Root cause: save() was written to rely on every caller wrapping its work in withLock, and no self-lock was added when a shipped caller started calling it bare.
- Evidence: Where: integrations/openclaw/lib/queue-manager.mjs:222 (save() takes no lock; decision-ledger.mjs:261 does), caller integrations/openclaw/plugins/zink-governance/index.mjs:5658-5663, singleton queue-manager.mjs:1080 · Evidence: the caller sets defaultQueueManager.queue and calls save() directly, so it persists a snapshot taken at construction or the last withLock; that write can erase a concurrent locked writer's committed change, and its catch path restores memory only, never disk. The live journal shows four pickup loops starting inside one PID (R1-A02-08), so concurrent writers on this document are not hypothetical. The two secondary halves (temp opened w instead of wx, residue left on a failed write) CLOSED by M12/T2.2-R2 B-12 (f93068e, tests/m12-t2.2-a3-queue-writer-lock.test.mjs).
- Reproduction: re-read queue-manager.mjs:222 and index.mjs:5658 at the current head (both still hold as of 04cdbd6), then drive two concurrent writers on one queue document and compare the persisted projection against the last committed mutation.
- Acceptance criteria: queue-manager.save() self-locks the way decision-ledger already does (option 1 of the recorded recommendation — the smallest change that closes the reachable path), and a concurrent unlocked caller can no longer lose a committed write.
- Related findings: bug mở: R1-A02-08 · nguồn: Vòng 6 bổ sung — `A-3` note (2026-10-15)

### F-155 — the admitted item that the contract grades as removing a real cost would land as a no-op that still rewrites rows, or as a change that produces different results depending on document length

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R6-V06-01`
- Affected modules: Zink Skill Store
- Severity: High
- Status: REFUTED — premise measured dead 2026-10-17: The aggregate-versus-per-segment arithmetic is real and is exactly why the owner refused §4A.13; the described broken no-op skip was never shipped. (was: OPEN — — §4A.13's fix as scoped cannot work)
- Root cause: the admitted item that the contract grades as removing a real cost would land as a no-op that still rewrites rows, or as a change that produces different results depending on document length. A working skip must hoist envelope rendering + computeEmbeddingInputHash + the aggregate hash above the generateSkillEmbeddings call — and §4A.13's own "do not restructure the sync in the same change" forbids exactly that. The item is self-blocking. Second-order hazard §4A.13 does not state: the FAILED marker at :779-781 keeps the real source_sha256 while zeroing…
- Evidence: Where: ACTIVE.md §4A.13 (:481-489) vs zink-skill-store/src/vector-sync.mjs:700-724, :500/:509/:519 · Evidence: §4A.13 tells the implementer the loop "computes embeddingInputHash at :705 and never compares it to the stored embedding_input_sha256 it writes at :500/:517-519". But :509/:519 write skillEmbeddingHash — the row-level sha256 over _all_ per-segment envelope hashes joined with \n (:722-724) — which is only computable after the loop that contains the HTTP call at :707. A per-segment :705-versus-stored-column comparison therefore can never match for a multi-segment skill: no HTTP round trip is saved, and behaviour is silently inconsistent between single- and multi-segment skills.
- Reproduction: There is no skip comparison to break: the loop at vector-sync.mjs:701-716 always calls generateSkillEmbeddings (:716), and a node -e replica of :706/:731 shows the stored `embedding_input_sha256` (sha256 over the joined per-segment hashes) never equals a per-segment hash at any size. §4A.13 was never landed — owner decision A-7 (recorded at :708-715) refused the skip — and the contract that demanded it is deleted.
- Acceptance criteria: No skip-when-unchanged path exists in vector-sync.mjs, every segment of every active skill reaches the embedding endpoint, and the owner's A-7 refusal is the documented reason, so no contract can silently demand an impossible per-segment-versus-aggregate compare.
- Related findings: nguồn: V06 — adversarial check of the orchestrator's own four…

### F-156 — the governance plugin mutates the Skill Store canonical store and vector index through direct src/ imports, bypassing the Zink Tools boundary

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R1-A01-02`
- Affected modules: OpenClaw governance plugin (Discord), OpenClaw integration, Zink Skill Store
- Severity: Medium
- Status: OPEN · premise changed 2026-10-17: the "only through the Zink Tools boundary" half no longer holds for promotion — platform-boundaries.md:16-22 says promotion happens "in governed runtime code, not in Tools", system-overview.md:18-24 names "trusted internal promotion" beside the model-visible Tools path, and `C-3` (`e47e660`) already corrected the contract sentence. What is unmet is the `src/`-level coupling itself plus the absence of any gate; adjacent to owner decision `H5`.
- Root cause: docs/architecture/platform-boundaries.md:18-22 and system-overview.md:19-22 — OpenClaw reaches the Skill Store only through the governed Zink Tools boundary. Actual: the promotion path hard-couples to Skill Store internal file layout (SkillAdapter exposes only querySkillStore/propose, zink-tools/adapters/skill-store/skill-adapter.mjs:209).
- Evidence: Where: integrations/openclaw/plugins/zink-governance/index.mjs:554,820,830,1075,1453 (loadRepoModule("zink-skill-store/src/catalog.mjs"), vector-sync.mjs, promoteApprovedSkillUnlocked, withSkillStoreWriterLock) · Expected/Actual: docs/architecture/platform-boundaries.md:18-22 and system-overview.md:19-22 — OpenClaw reaches the Skill Store only through the governed Zink Tools boundary. Actual: the promotion path hard-couples to Skill Store internal file layout (SkillAdapter exposes only querySkillStore/propose, zink-tools/adapters/skill-store/skill-adapter.mjs:209).
- Reproduction: At HEAD the plugin imports Skill Store internals directly: index.mjs:554 resolves the zink-tools skill adapter by relative path and :1075/:1453 load `zink-skill-store/src/catalog.mjs` and `vector-sync.mjs` through loadRepoModule, calling promoteApprovedSkillUnlocked under withSkillStoreWriterLock, while SkillAdapter exposes only querySkillStore/propose (skill-adapter.mjs:209). Measured 2026-10-17, the doc half of the original claim is weaker than filed: platform-boundaries.md:16-22 puts promotion "in governed runtime code, not in Tools" and system-overview.md:18-24 names "trusted internal promotion" beside the model-visible Tools path, so no architecture file forbids the call — what is missing is any rule or gate about importing `src/` at all. Gate it in tests/repository-policy.test.mjs: no integrations/openclaw source may resolve a zink-skill-store/src path.
- Acceptance criteria: no zink-skill-store/src/* import from integrations/openclaw.
- Related findings: nguồn: A01 — architecture and system boundaries

### F-157 — one concept, two implementations: deriveApprovalScopeDigest exists twice with different payload shapes, plus dead duplicates and three canonicalizers

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R1-A02-05`
- Affected modules: Workflow topology + ledger, Workflow topology, OpenClaw runtime libs
- Severity: Medium
- Status: OPEN
- Root cause: governancePluginFiles() flattens both files into one deployed lib/, so any later import of the canonical copy yields a different digest for the same approval scope — verification either fails closed or stops changing when the scope changes.
- Evidence: Where: lib/policy.mjs:2099-2113 (7-field tuple, the bound one via guard.mjs:154) vs topology/lib/canonical.mjs:347-349 (verbatim hash, imported nowhere); canonical.mjs:343 deriveReferenceId dead while guard.mjs:1492 inlines it; stableJson defined at lib/policy.mjs:1387 (key-order-dependent) and topology/lib/schema.mjs:106 (key-sorted compact), with canonicalJson a third
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc lib/policy.mjs:2099-2113 (7-field tuple, the bound one via guard.mjs:154) vs topology/lib/canonical.mjs:347-349 (verbatim hash, imported nowhere); canonical.mjs:343 deriveReferenceId dead while guard.mjs:1492 inlines it; stableJson defined at… ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng one concept, two implementations: deriveApprovalScopeDigest exists twice with different payload shapes, plus dead duplicates and three canonicalizers trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "one concept, two implementations: deriveApprovalScopeDigest exists twice with different payload shapes, plus dead duplicates and three canonicalizers", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: nguồn: A02 — module dependencies, shared components and duplication

### F-158 — a missing or unparseable governance manifest surfaces as a raw filesystem error, not a denial

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R1-A04-07`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: Medium
- Status: OPEN
- Root cause: ENOENT/SyntaxError escapes to the host and, per the run-end seam, is re-attributed as a model failure; a module-level load failure takes the whole plugin down. Unknown governance_version rows do fail correctly (GOVERNANCE_HASH_MISMATCH), so only file-level failure is mis-shaped.
- Evidence: Where: index.mjs:4865-4872 (manifestFor), consumed by guard.mjs:928-936, :7212; runtime.mjs:11 module-level matrix load
- Reproduction: Read index.mjs:4865-4872: manifestFor parses the mapping with JSON.parse(readFileSync(…)) and no try/catch, so a missing manifest raises ENOENT and a corrupt one SyntaxError; both escape to the host, where the run-end seam re-attributes them as a model failure, and runtime.mjs:11 loads the reason matrix at module level so that failure takes the whole plugin down. guard.mjs:928-936 and :7212 consume the result, and unknown governance_version rows already fail correctly with GOVERNANCE_HASH_MISMATCH. Gate it in tests/m8-t2.9-manifest-completeness.test.mjs: delete and corrupt the manifest, assert a declared canonical code either way.
- Acceptance criteria: every policy-artifact read is wrapped and yields a declared canonical code.
- Related findings: nguồn: A04 — policy and capability enforcement

### F-159 — apply-mode diagnostics carry 11 reason classes against preflight-mode's 27, so identical refusals degrade to APPLY_REJECTED

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R1-A05-07`
- Affected modules: Workflow topology
- Severity: Medium
- Status: OPEN — _(extends K02, which fixed only one instance)_
- Root cause: Register kết luận: apply-mode diagnostics carry 11 reason classes against preflight-mode's 27, so identical refusals degrade to APPLY_REJECTED. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: Where: topology/fixtures/runtime-regression/operator-preflight.mjs:59-90 vs apply-orchestration.mjs:334-353 · Evidence: named only in preflight — ROUTER_HOST/PORT/API_KEY_UNAVAILABLE, Systemd drop-in, mode drift, symlink, Ledger corruption, Gemini stream hotfix utility, Password-store resolver, Auth order plan, T2 backup manifest, Existing config must be canonical JSON, must be a numeric Discord snowflake. Two hand-maintained classifier lists for one producer.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc topology/fixtures/runtime-regression/operator-preflight.mjs:59-90 vs apply-orchestration.mjs:334-353 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng apply-mode diagnostics carry 11 reason classes against preflight-mode's 27, so identical refusals degrade to APPLY_REJECTED trước khi sửa (nội quy mục 3).
- Acceptance criteria: every fixed diagnostic configure.mjs can emit resolves to the same code in either mode.
- Related findings: nguồn: A05 — runtime, entrypoints and startup behaviour

### F-160 — any future maintenance operation on the journal can irreversibly corrupt or mis-derive the governance history

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R1-A08-05`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: Medium
- Status: LATENT — Confirmed (mechanism from code, classification from live counts)
- Root cause: the ambiguous version m8-t2.2-r4 was emitted under two writer semantics, and the discriminator was moved to journal scope. — Hệ quả: any future maintenance operation on the journal can irreversibly corrupt or mis-derive the governance history. This directly constrains P02-06's residue sweep and P02-08's effect check: touching the journal is not a safe operational action today.
- Evidence: Where: ledger.mjs:286-305 (journalHasPreVerdictStamp, preVerdictForEvent), 377-382; workflow.mjs:42-57 · Evidence: return journalHasPreVerdictStamp; for r4-stamped events, and the file's own comment admits "seq 26 is r4-stamped yet pre-verdict". Live counts: r4 ×79, r13 ×24 (the only pre-verdict stamps present), r5 ×41. · Expected/Actual: an event's semantics should be sealed in the event vs they depend on which _other_ stamps exist somewhere in the same file. Compaction, tail surgery, or a mixed backup restore that drops those 24 legacy lines flips r4 replay into verdict semantics → snapshot workflow mismatch → ledger unreadable, or silently re-resolves root results.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc ledger.mjs:286-305 (journalHasPreVerdictStamp, preVerdictForEvent), 377-382; workflow.mjs:42-57 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng any future maintenance operation on the journal can irreversibly corrupt or mis-derive the governance history trước khi sửa (nội quy mục 3).
- Acceptance criteria: replay of any valid journal subset yields identical classification.
- Related findings: nguồn: A08 — ledger and event-store integrity *(Vòng 1: 16/16…

### F-161 — PLAN.md cites 18 sections of a file that is Git-ignored and deleted at closeout, so durable evidence is unrecoverable

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R1-A15-06`
- Affected modules: Architecture + contracts docs, README, Governance records
- Severity: Medium
- Status: OPEN
- Root cause: the admitted-digest lineage, the R2 forensic result and heartbeat content decisions cannot be re-derived. The one precedent that does preserve evidence (docs/contracts/m7-m8-red-team-backlog.md) is ad hoc.
- Evidence: Where: PLAN.md:406, 425, 428, 503-504, 1218, 1261, 1317, 1356, 1707, 1763, 1793, 1867, 1921, 1974, 2016, 2061, 5011; .gitignore:61; docs/contracts/execution/README.md:97 · Evidence: PLAN cites "ACTIVE.md R18 8" for entrypoint/asset admission and forensic results; the execution README states ACTIVE.md must not survive closeout; ls docs/contracts/execution/ → only README.md, and git log --all -- ACTIVE.md is empty.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc PLAN.md:406, 425, 428, 503-504, 1218, 1261, 1317, 1356, 1707, 1763, 1793, 1867, 1921, 1974, 2016, 2061, 5011; .gitignore:61; docs/contracts/execution/README.md:97 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng PLAN.md cites 18 sections of a file that is Git-ignored and deleted at closeout, so durable evidence is unrecoverable trước khi sửa (nội quy mục 3).
- Acceptance criteria: every `ACTIVE.md R<n>` citation resolves to a tracked file.
- Related findings: nguồn: A15 — documentation, operations and deployment consistency

### F-162 — excel-writer.mjs is digest-pinned _and_ overridden from the working tree

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R2-B04-02`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: Medium
- Status: OPEN — | process.cwd() with no packaged fallback, while policy.mjs:1213 packages the file and :1204-1208 says the packaged preview imports ./excel-writer.mjs → two module instances of the artifact writer in
- Root cause: Register kết luận: excel-writer.mjs is digest-pinned _and_ overridden from the working tree. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: Evidence: index.mjs:2493-2498 uses findRepoRoot()
- Reproduction: At HEAD index.mjs:2493-2498 resolves `findRepoRoot() || process.cwd()` and imports integrations/openclaw/lib/excel-writer.mjs from the working tree, so the module whose digest was admitted is not necessarily the module that runs. Measure it two ways: `node -e` printing findRepoRoot() from the deployed layout, and a digest comparison between the packaged asset and the working-tree file — editing the tree changes governed behaviour with no digest change. Gate it in tests/m8-t2.6-r8-asset-provenance.test.mjs.
- Acceptance criteria: The excel writer that executes is the one whose digest was admitted: the deployed plugin resolves it from its own packaged assets, or the pin covers the working-tree path it actually loads, so a tree edit cannot change governed behaviour without a digest change.
- Related findings: nguồn: B04 — deployment / dependency integrity

### F-163 — fixed-name exclusive-create temp files are never cleaned, so one interrupted apply/restore permanently blocks retries

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R2-B08-02`
- Affected modules: Workflow topology + ledger, Workflow topology
- Severity: Medium
- Status: OPEN — _(same class as R1-A14-01, but worse: the name is constant, so collision is guaranteed rather than per-PID)_
- Root cause: Register kết luận: fixed-name exclusive-create temp files are never cleaned, so one interrupted apply/restore permanently blocks retries. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: Where: topology/lib/native-patch.mjs:837-844 (replaceAtomic, ${file}.zink-r12-tmp, "wx" at :828); topology/lib/runtime-backup.mjs:325-327 (openclaw.json.zink-r12-restore → RESTORE_TEMP_CONFLICT); restoreNativePatch:1131-1202 never unlinks either · Evidence: (code), LATENT live
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc topology/lib/native-patch.mjs:837-844 (replaceAtomic, ${file}.zink-r12-tmp, "wx" at :828); topology/lib/runtime-backup.mjs:325-327 (openclaw.json.zink-r12-restore → RESTORE_TEMP_CONFLICT); restoreNativePatch:1131-1202 never unlinks either ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng fixed-name exclusive-create temp files are never cleaned, so one interrupted apply/restore permanently blocks retries trước khi sửa (nội quy mục 3).
- Acceptance criteria: a forced mid-write failure leaves no residue and the next apply succeeds.
- Related findings: đã sửa/xóa khỏi file: R1-A14-01 · nguồn: B08 — adversarial independent audit (attempted refutation…

### F-164 — in the ordinary "Postgres starts later" race, boot failure becomes a sticky flag: no pool, no _apply_migrations, and both recovery calls skipped for the process lifetime — so interrupted RUNNING index runs and their shadow BUILDING…

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R5-E01-04`
- Affected modules: Zink Knowledgebase
- Severity: Medium
- Status: OPEN
- Root cause: in the ordinary "Postgres starts later" race, boot failure becomes a sticky flag: no pool, no _apply_migrations, and both recovery calls skipped for the process lifetime — so interrupted RUNNING index runs and their shadow BUILDING indexes are never recovered, and search/index-runs answer 503/504 until an external restart. The state the operator most needs repaired is exactly the state that is skipped. Pairs with R5-E03-02 (same start() method, different defect) and R5-E03-03 (the recovery that gets skipped).
- Evidence: Where: database.py:210-219 (start() except) + main.py:166-175 (lifespan recovery gate) · Evidence: except Exception: self.startup_error_code = "DATABASE_UNAVAILABLE" … await self._pool.close(); self._pool = None, then if database.available: guards coordinator.recover_startup() and database.recover_interrupted_runs() — and available (:177) depends on the pool, which nothing reopens after start().
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc database.py:210-219 (start() except) + main.py:166-175 (lifespan recovery gate) ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng in the ordinary "Postgres starts later" race, boot failure becomes a sticky flag: no pool, no _apply_migrations, and both recovery calls skipped for the… trước khi sửa (nội quy mục 3).
- Acceptance criteria: exit non-zero when the pool cannot be established, or re-attempt connect and run recovery once the DB returns; keep existing healthz/readyz semantics.
- Related findings: bug mở: R5-E03-02, R5-E03-03 · nguồn: E01 — Knowledgebase service internals (6 findings + a…

### F-165 — two slow embedding responses hold both slots for up to 90 s, so the third and every later caller is refused outright

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R5-E02-06`
- Affected modules: Zink Knowledgebase
- Severity: Medium
- Status: OPEN
- Root cause: two slow embedding responses hold both slots for up to 90 s, so the third and every later caller is refused outright. One degraded embedding provider turns the whole retrieval surface into a 429 wall, and the owner sees "no results"-style failures rather than back-pressure — the same attribution trap as cluster C-C, in the Knowledgebase this time.
- Evidence: Where: main.py:324-326, :356; model_probe.py:30; retrieval.py:53-65 · Evidence: the query-embedding call runs under httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=3.0)) inside a limiter documented as "A two-slot, no-queue limiter" whose exhaustion path is 429 SEARCH_CAPACITY_EXCEEDED with no Retry-After.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc main.py:324-326, :356; model_probe.py:30; retrieval.py:53-65 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng two slow embedding responses hold both slots for up to 90 s, so the third and every later caller is refused outright trước khi sửa (nội quy mục 3).
- Acceptance criteria: bound the query-embedding call with a request-level deadline shorter than the client default, and signal retry timing on the refused path. (Note the deliberate parallel to the router's timeoutSeconds: 100 × 5-candidate dead time already recorded against the owner.)
- Related findings: nguồn: E02 — Knowledgebase retrieval, provenance and citations (7…

### F-166 — read-only SELECT typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='knowledge'

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R5-E03-01`
- Affected modules: Zink Knowledgebase
- Severity: Medium
- Status: OPEN
- Root cause: the existence check copied the index-naming convention (knowledge_*) instead of the catalog key. — Hệ quả: re-running the set (repaired version row, a schema rebuilt from a dump that excluded schema_migrations, or the race in R5-E03-02) aborts on duplicate_type/duplicate_table, the whole migration transaction rolls back, and startup reports DATABASE_UNAVAILABLE.
- Evidence: Where: apps/knowledge/migrations/001_initial.sql:3-22 (DO block) vs :24-96; 002_pdf_ingestion_foundation.sql:1,20,24,28,47,71,84 · Evidence: the guard asks SELECT 1 FROM pg_type WHERE typname = 'knowledge_index_status' while the object it then creates is CREATE TYPE knowledge.index_status AS ENUM (…); the same prefix mismatch repeats for knowledge_index_run_status→index_run_status and knowledge_index_run_kind→index_run_kind. Postgres stores the unqualified name in pg_type.typname, so the predicate can never match and the guard is dead code; 002 uses bare CREATE TABLE/CREATE UNIQUE INDEX with no IF NOT EXISTS. · Expected/Actual: a replayable migration set / 001 and 002 are replayable only while the schema_migrations row exists. 003 is the only genuinely idempotent file. · R7 (nạp số đo mới từ hàng `F-256` bị rút vì trùng root cause): `grep -c "IF NOT EXISTS"` over the migration set measures 001_initial.sql = 14, 003_skills_vector_schema.sql = 5, 002_pdf_ingestion_foundation.sql = **0** — 002:1 is a bare `CREATE TABLE knowledge.pdf_content_builds (` and 002:20 a bare `CREATE UNIQUE INDEX knowledge_pdf_content_builds_one_building_idx`, so 002 is the only file whose replay is not self-guarding, independently of the dead pg_type predicate above. The runner keys `schema_migrations.version` on the filename, so a restored dump that omits that row or a renamed file re-executes 002 against a schema that already owns those objects.
- Reproduction: read-only SELECT typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='knowledge'.
- Acceptance criteria: applying the set twice against a scratch database leaves identical catalog state and no error.
- Related findings: bug mở: R5-E03-02 · nguồn: E03 — Knowledgebase persistence: schema, SQL, migrations… · R7 delta audit: `F-256` withdrawn as a duplicate of this row, its measurement merged here

### F-167 — read-only EXPLAIN (ANALYZE, BUFFERS) of the dense branch + SELECT index_id, count(*) FROM knowledge.segments GROUP BY 1, taken while no run holds the lock

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R5-E03-05`
- Affected modules: Zink Knowledgebase
- Severity: Medium
- Status: EXCLUDED — excluded pending decision `H9` (reclamation of unreclaimable PDF text copies — a retention decision that deletes derived content).
- Root cause: during every incremental run the graph holds two identical copies of each vector, so roughly half of the 100 scanned ANN neighbours belong to a non-ACTIVE index and are discarded before LIMIT 40 fills — recall silently drops for the duration of a run, degrades with total segments rows (including un-purged FAILED content per R5-E03-04), and DDL time grows with corpus while the owner lock is held.
- Evidence: Where: 001_initial.sql:143-144 (global HNSW) vs database.py:1012-1082 search_candidates, :872-963 accept_incremental · Evidence: CREATE INDEX … USING hnsw (embedding vector_cosine_ops) has no WHERE clause and is not partitioned, while the query filters index_id = $1::uuid AND segment_type = ANY($6::text[]) (:1041-1046) under SET LOCAL hnsw.ef_search = 100 / hnsw.max_scan_tuples = 20000 (:1037-1038); accept_incremental clones the entire live segment set (:927-948).
- Reproduction: read-only EXPLAIN (ANALYZE, BUFFERS) of the dense branch + SELECT index_id, count(*) FROM knowledge.segments GROUP BY 1, taken while no run holds the lock.
- Acceptance criteria: candidate recall for a fixed query set is identical with and without a shadow clone present.
- Related findings: bug mở: R5-E03-04 · quyết định chủ: H9 · disposition: excluded pending decision `H9` (reclamation of unreclaimable PDF text copies — a retention decision that deletes derived content). · nguồn: E03 — Knowledgebase persistence: schema, SQL, migrations…

### F-168 — the same bytes under a second owner decision silently resolve ALREADY_ACTIVE, so the second decision_ref is never persisted and nothing tells the caller it was dropped — the approval digest the owner confirmed binds only the markdown…

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R5-E04-04`
- Affected modules: Zink Skill Store, Architecture + contracts docs
- Severity: Medium
- Status: LATENT
- Root cause: the same bytes under a second owner decision silently resolve ALREADY_ACTIVE, so the second decision_ref is never persisted and nothing tells the caller it was dropped — the approval digest the owner confirmed binds only the markdown. Same family as R1-A07-01 (approval not bound to the plan) in the store.
- Evidence: Where: catalog.mjs:1120-1132 (probe) vs :1186-1200 (record built) · Evidence: if (recordedHash === contentSha256 && currentHash === contentSha256 && lastStatus === "ACTIVE") return { status:"ALREADY_ACTIVE", … } — the compared digest covers only SKILL.md, never the manifest; decision_ref, provenance.references, source_type and actors are not part of the equality test, and there is no canonical-JSON record digest (the manifest is written as JSON.stringify(manifest, null, 2), :1212).
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc catalog.mjs:1120-1132 (probe) vs :1186-1200 (record built) ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng the same bytes under a second owner decision silently resolve ALREADY_ACTIVE, so the second decision_ref is never persisted and nothing tells the caller it… trước khi sửa (nội quy mục 3).
- Acceptance criteria: a repeat promotion carrying a different decision_ref cannot report success as ALREADY_ACTIVE.
- Related findings: bug mở: R1-A07-01 · nguồn: E04 — Skill Store catalog internals (9 findings; the store…

### F-169 — one stray control byte in one SKILL.md body makes that skill permanently unsyncable, and its FAILED marker suppresses it from retrieval while its outdated segments stay in the ANN set

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R5-E05-07`
- Affected modules: Zink Skill Store
- Severity: Medium
- Status: OPEN
- Root cause: one stray control byte in one SKILL.md body makes that skill permanently unsyncable, and its FAILED marker suppresses it from retrieval while its outdated segments stay in the ANN set. Two escaping regimes for two representations of the same untrusted file text.
- Evidence: Where: vector-sync.mjs:485-489, :111-114, :74-91, :191 · Evidence: heading_path goes through toPostgresArrayLiteral, which throws ARRAY_LITERAL_CONTROL_CHARACTER; but content goes only through escapeSqlLiteral, which "doubles single quotes" and nothing else. A heading whose only oddity is NUL/ESC survives :191 (replace(/\s+/g," ") does not match \x00 or \x1b), so both paths end in a hard failure of the whole skill's transaction (:726) — and per R5-E05-04 the FAILED row then keeps stale vectors.
- Reproduction: Register chưa có bước tái hiện riêng; bước gần nhất suy từ acceptance/remediation: a body containing 0x00 fails at scan with a named error rather than as a database error, and never leaves half-updated segments.
- Acceptance criteria: a body containing 0x00 fails at scan with a named error rather than as a database error, and never leaves half-updated segments.
- Related findings: đã sửa/xóa khỏi file: R5-E05-04 · nguồn: E05 — Skill Store vector sync (8 findings; the derived…

### F-170 — the declared 50 MB ceiling admits up to ~150 MB UTF-8 for Vietnamese/CJK text, and any multi-byte character straddling a chunk boundary is silently replaced by U+FFFD — corrupted retrieved evidence is then formatted and counted as…

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R5-E06-02`
- Affected modules: Zink Tools
- Severity: Medium
- Status: OPEN
- Root cause: the declared 50 MB ceiling admits up to ~150 MB UTF-8 for Vietnamese/CJK text, and any multi-byte character straddling a chunk boundary is silently replaced by U+FFFD — corrupted retrieved evidence is then formatted and counted as SUCCESS. The fifth instance of the byte-vs-character class this file itself documents for MAX_RESULT_TEXT_BYTES at :39-53 ("the FOURTH defect of the byte-vs-character class"), at a new seam. Directly relevant to how the owner's Vietnamese queries come back.
- Evidence: Where: knowledge-adapter.mjs:23 (MAX_KNOWLEDGE_RESPONSE_BYTES = `50 * 1024 * 1024`), :275-288 · Evidence: let data = ""; res.on("data", (chunk) => { data += chunk; if (data.length > MAX_KNOWLEDGE_RESPONSE_BYTES) — .length counts UTF-16 code units, and each Buffer chunk is coerced to a string independently.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc knowledge-adapter.mjs:23 (MAX_KNOWLEDGE_RESPONSE_BYTES = `50 * 1024 * 1024`), :275-288 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng the declared 50 MB ceiling admits up to ~150 MB UTF-8 for Vietnamese/CJK text, and any multi-byte character straddling a chunk boundary is silently replaced… trước khi sửa (nội quy mục 3).
- Acceptance criteria: a body is refused at exactly 50 MB of bytes and no retrieved text contains adapter-introduced U+FFFD.
- Related findings: nguồn: E06 — Zink Tools adapters (9 findings; two High, and they…

### F-171 — the traversal fix was applied to the numeric field and its comment, not to the caller-supplied identifier beside it (artifact_id is only checked for truthiness at :61-66, :120-125)

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R5-E06-09`
- Affected modules: Zink Tools
- Severity: Medium
- Status: OPEN
- Root cause: the traversal fix was applied to the numeric field and its comment, not to the caller-supplied identifier beside it (artifact_id is only checked for truthiness at :61-66, :120-125). — Hệ quả: artifact_id: "../silver/foo/v1" creates landing/../silver/foo/v1, a key distinct from silver/foo/v1, so the landing-immutability check (this.storage.has(key)) and the Silver collision check are aliasable; on a path-keyed object store the zone semantics diverge, so a contract-green run is not evidence the real boundary holds.
- Evidence: Where: zink-tools/adapters/storage/r2-adapter.mjs:68, :144, :220-223 (rule stated at :126-131) · Evidence: const key = landing/${artifact_id}; and const key = silver/${artifact_id}/v${version}; with no validation of artifact_id; the file's own comment says "The version is interpolated straight into the storage key … a value like ../../landing/orders injects path syntax into the namespace".
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc zink-tools/adapters/storage/r2-adapter.mjs:68, :144, :220-223 (rule stated at :126-131) ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng the traversal fix was applied to the numeric field and its comment, not to the caller-supplied identifier beside it (artifact_id is only checked for… trước khi sửa (nội quy mục 3).
- Acceptance criteria: a traversal-shaped artifact_id is refused and no two keys can address the same object.
- Related findings: nguồn: E06 — Zink Tools adapters (9 findings; two High, and they…

### F-172 — on the only live runtime (Linux/WSL) a backslash path is one flat filename at the sandbox root, not a directory path, while callers — e.g

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R5-E07-06`
- Affected modules: Zink Tools, README
- Severity: Medium
- Status: OPEN — — security-adjacent, feeds the guard
- Root cause: on the only live runtime (Linux/WSL) a backslash path is one flat filename at the sandbox root, not a directory path, while callers — e.g. integrations/openclaw/topology/lib/guard.mjs:214 — believe a hierarchy was checked. Every failure is the same opaque SCHEMA_VALIDATION_FAILED (including non-string input), and isArtifactLogicalPathValid discards it, so a programming error and a traversal attempt are indistinguishable — the attribution class again.
- Evidence: Where: path-safety.mjs:36, :39, :63, :12-13, :66-73; zink-tools/common/README.md:45, :22-25 · Evidence: const segments = logicalPath.split(/[/\\]/u); … if (segments.length === 0) { throw … } … return logicalPath; — the function returns the raw input unchanged, so data\sub\f.csv passes (backslash is a separator only inside split) and is handed back verbatim; segments.length === 0 is unreachable because split never returns [] for a non-empty string. The README's example claims a "normalized" return and UNC rejection.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc path-safety.mjs:36, :39, :63, :12-13, :66-73; zink-tools/common/README.md:45, :22-25 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng on the only live runtime (Linux/WSL) a backslash path is one flat filename at the sandbox root, not a directory path, while callers — e.g trước khi sửa (nội quy mục 3).
- Acceptance criteria: the returned value is separator-normalized and the README table matches actual output for backslash forms.
- Related findings: nguồn: E07 — Zink Tools shared layer (7 findings; the shared…

### F-173 — computeEmbeddingInputHash pins a digest for an envelope carrying fabricated general metadata, so the index and its audit trail silently encode the wrong classification

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R5-E07-07`
- Affected modules: Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: computeEmbeddingInputHash pins a digest for an envelope carrying fabricated general metadata, so the index and its audit trail silently encode the wrong classification. The MAX_SECONDARY_TOPIC_BYTES ceiling is enforced only in deriveSemanticMetadata, never here.
- Evidence: Where: semantic-contract.mjs:280-323 (renderEmbeddingEnvelope), :281-288, :291-292, :313 · Evidence: destructuring-with-defaults const { domain = "general", primary_topic = "general", … } = params; and const sanitize = (v) => typeof v === "string" ? … : ""; — unrecognised params are dropped silently and absent/null metadata renders as Domain: or defaults to general, so a caller passing metadata under other key names exactly as tests/m10-t2-r21-skill-chunking-and-text-budgets.test.mjs:46-50 does (skillId, headingPath) gets a well-formed, hashable envelope whose header lines are pure defaults. Non-string content instead crashes at :313 (null/number have no .trim).
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc semantic-contract.mjs:280-323 (renderEmbeddingEnvelope), :281-288, :291-292, :313 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng computeEmbeddingInputHash pins a digest for an envelope carrying fabricated general metadata, so the index and its audit trail silently encode the wrong… trước khi sửa (nội quy mục 3).
- Acceptance criteria: an envelope request with no taxonomy either raises or carries an explicit unclassified marker — never general.
- Related findings: nguồn: E07 — Zink Tools shared layer (7 findings; the shared…

### F-174 — AGENTS.md §5 routes architecture/ownership/overengineering review to this artifact, which states expired milestone facts and gives nothing executable

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R5-E12-05`
- Affected modules: Zink Knowledgebase, Governance records
- Severity: Medium
- Status: OPEN
- Root cause: AGENTS.md §5 routes architecture/ownership/overengineering review to this artifact, which states expired milestone facts and gives nothing executable; an agent performing that review applies an M5 constraint, and the two divergent copies of the §9 invariants drift silently — the premise class that produced earlier overturned claims. Contradicts AGENTS.md §1 ("Do not duplicate whole responsibilities across files").
- Evidence: Where: architecture-review/SKILL.md:1-52, esp. :46-47 · Evidence: "the accepted apps/knowledge/ implementation is not moved during M5; structural migration requires its own approved task and regression gate." — the repository is at M12. The file contains no procedure, no review inputs, no output vocabulary and no gate: only a priority list (:3-13, duplicating planning:32-42) and an invariants list (:21-47, duplicating AGENTS.md §9) that omits §9's canonical peer-module path rule and its "target directory trees are architecture, not implementation evidence" clause.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc architecture-review/SKILL.md:1-52, esp. :46-47 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng AGENTS.md §5 routes architecture/ownership/overengineering review to this artifact, which states expired milestone facts and gives nothing executable trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "AGENTS.md §5 routes architecture/ownership/overengineering review to this artifact, which states expired milestone facts and gives nothing executable", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: nguồn: E12 — skills procedure vs practice (7 findings; the two…

### F-175 — cost scales with total accumulated knowledge history rather than the incremental batch — a growing publish/verify stall

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R5-E16-05`
- Affected modules: Zink Knowledgebase
- Severity: Medium
- Status: HYPOTHESIS
- Root cause: no sidecar→digest index; the digest is recomputed from bytes instead of compared to a stored one — structurally identical to the unused embedding_input_sha256 in R5-E05-01 (admitted as 4A.13), which makes this the second instance of "a digest was written but never read back". — Hệ quả: cost scales with total accumulated knowledge history rather than the incremental batch — a growing publish/verify stall. Frequency is unverified (per run, per publish, or per request), so its hotness is asserted by shape, not measurement.
- Evidence: Where: apps/knowledge/app/pdf_foundation.py:245, :253, :229 (sidecar cap comment at :166-171) · Evidence: for sidecar in sorted(root.rglob("*.md")): then raw = sidecar.read_bytes() and sidecar_digest = hashlib.sha256(raw).hexdigest(). · Expected/Actual: verifying/publishing one build should touch that build's rows; this enumerates and re-hashes every published sidecar on disk each time it runs.
- Reproduction: read-only — grep callers of the rglob function and check whether a stored digest is ever compared.
- Acceptance criteria: publishing N sources hashes O(N) files, not every sidecar on disk.
- Related findings: bug mở: R5-E05-01 · nguồn: E16 — performance and resource ceilings (5 findings; one…

### F-176 — a valid skillsRoot that points at a different empty store still tombstones the intended store

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R6-A05-01`
- Affected modules: Zink Skill Store, Gates + CI
- Severity: Medium
- Status: OPEN — Confirmed (code path); no live instance recorded
- Root cause: store identity is not part of the sync contract; only the caller/config boundary knows which root is which, and nothing pins it.
- Evidence: Where: zink-skill-store/src/catalog.mjs:718-742 (scanCatalog refusals), zink-skill-store/src/vector-sync.mjs:564-573 (CATALOG_INVALID returns before any statement) · Evidence: the R5-E05-03 refutation proved the unsafe-root cases are already refused before any SQL runs, and tests/m11-t1-postgres-sql-gate.test.mjs:200-213 requires the empty-catalog tombstone for a genuinely empty store. The residual is that no in-function signal distinguishes "this store is empty" from "this root is the wrong store", so a mis-pointed skillsRoot tombstones the intended index.
- Reproduction: re-read both call sites, then run a sync against a scratch empty root while the target schema still holds rows, and confirm the tombstone fires (read-only against a scratch database, never the live one).
- Acceptance criteria: a control at the caller/config boundary names the expected store (identity or expected namespace) before a zero-catalog tombstone may run. Needs its own owner decision; not scheduled.
- Related findings: bug mở: R5-E05-03 · nguồn: Vòng 6 bổ sung — `A-5` note (2026-10-16)

### F-177 — lock hold time scales with manifest count up to the module's own 1,000-manifest ceiling (:480-487), which is enforced only by emitting an error after the walk

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R5-E04-09`
- Affected modules: OpenClaw runtime libs, OpenClaw integration
- Severity: Low
- Status: REFUTED — refuted at the pre-freeze read of `M12/T2.2-R3`: `DEFAULT_LOCK_TIMEOUT_MS` is an acquisition timeout for contenders, not a hold limit, and the 1,000-manifest ceiling only appends an error. Wrong in both halves.
- Root cause: lock hold time scales with manifest count up to the module's own 1,000-manifest ceiling (:480-487), which is enforced only by emitting an error after the walk. On the live WSL/drvfs working-tree root a second concurrent promotion or approval can hit FILE_LOCK_TIMEOUT and lose the governed transaction. This is the Skill Store's instance of the R1-A08-06 class (cost scaling with total history while a lock is held) — third instance across three modules, which is a pattern, not three accidents.
- Evidence: Where: catalog.mjs:776-777, :1160, :1250, :1078-1248; integrations/openclaw/lib/file-lock.mjs:42 · Evidence: getActiveSkill() calls scanCatalog(skillsRoot) — a full walk on every read; promotion runs scanCatalog before writing and again after rename, plus healWriterResidue, staging writes, two sync()s and fsyncDirectoryBestEffort, all inside withSkillStoreWriterLock, whose DEFAULT_LOCK_TIMEOUT_MS = 5000.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc catalog.mjs:776-777, :1160, :1250, :1078-1248; integrations/openclaw/lib/file-lock.mjs:42 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng lock hold time scales with manifest count up to the module's own 1,000-manifest ceiling (:480-487), which is enforced only by emitting an error after the walk trước khi sửa (nội quy mục 3).
- Acceptance criteria: lock hold time and read cost do not grow with unrelated records.
- Related findings: bug mở: R1-A08-06 · disposition: refuted at the pre-freeze read of `M12/T2.2-R3`: `DEFAULT_LOCK_TIMEOUT_MS` is an acquisition timeout for contenders, not a hold limit, and the 1,000-manifest ceiling only appends an error. Wrong in both halves. · nguồn: E04 — Skill Store catalog internals (9 findings; the store…

### F-178 — the "no extra state files" rule is unverifiable as written (a set of three described as four), and a retired artifact stays referenced as if live

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R5-E12-07`
- Affected modules: README, Governance records
- Severity: Low
- Status: OPEN
- Root cause: the "no extra state files" rule is unverifiable as written (a set of three described as four), and a retired artifact stays referenced as if live.
- Evidence: Where: .agents/states/README.md:33-34 vs :27-31; planning/SKILL.md:211 · Evidence: README's table defines three state files (:29-:31) but :33-34 reads "…cannot fit these four", and planning:211 still prohibits .agents/states/active-task.md, a file the protocol no longer defines.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc .agents/states/README.md:33-34 vs :27-31; planning/SKILL.md:211 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng the "no extra state files" rule is unverifiable as written (a set of three described as four), and a retired artifact stays referenced as if live trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "the "no extra state files" rule is unverifiable as written (a set of three described as four), and a retired artifact stays referenced as if live", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: nguồn: E12 — skills procedure vs practice (7 findings; the two…

### F-179 — preflight installs an ExecStartPre boot dependency it never checks, so apply-then-start can leave the gateway permanently failed

- Category: F6 — Reliability & Performance
- Legacy register id: `R1-A05-03`
- Affected modules: OpenClaw runtime libs, README, Repo tooling + deploy scripts
- Severity: High
- Status: OPEN
- Root cause: after an openclaw package update or a --revert, --apply + start gives five failed ExecStartPre attempts in 60 s → start-limit-hit; the assistant is down with no automatic recovery, and the drop-in cannot be rolled back (R1-A05-02).
- Evidence: Where: lib/policy.mjs:1347 (ExecStartPre=${nodeBinary} ${hotfix} --check), configure.mjs:1499-1505/1767-1773, templates/openclaw-gemini-stream-hotfix.mjs:395-428, README.md:139-148, 262-276 · Evidence: the renderer always emits --check; configure.mjs never references a runtime root; README's own flow is stop → --apply → start with hotfix --apply a separate manual step. Live unit: Restart=always, StartLimitBurst=5, StartLimitIntervalSec=60.
- Reproduction: Static chain, then one new assertion. renderSystemdDropIn (policy.mjs:1349) always emits ExecStartPre with `--check`; the hotfix `--check` exits 1 unless runtime state is 'patched' (:390-392); README:144-148 is stop → configure --apply → start, with hotfix --apply a separate manual step (README:263-268), and configure.mjs never touches the runtime root. Add to tests/m7-t1-openclaw.test.mjs a case asserting a freshly applied, unpatched profile survives apply-then-start.
- Acceptance criteria: After configure.mjs --apply the generated ExecStartPre check passes so the service starts, or the drop-in carries no unmet ExecStartPre boot dependency; a fresh apply-then-start never enters a Restart=always / StartLimitBurst loop.
- Related findings: adjudication Vòng 2: Verified with correction, re-graded High → Medium · bug mở: R1-A05-02 · nguồn: A05 — runtime, entrypoints and startup behaviour

### F-180 — approval_thread_id is set once and never cleared — no re-drive after a failed component delivery, and none after REQUEST_REVISION

- Category: F6 — Reliability & Performance
- Legacy register id: `R1-A07-02`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: High
- Status: OPEN — _(third confirmation of R1-A09-02, plus the revision cycle)_
- Root cause: once the thread exists the failed card is permanent — every later spawn attempt logs "already surfaced" and returns; REQUEST_REVISION sets REVISING but leaves the id, so a re-presented plan can never get a fresh card.
- Evidence: Where: index.mjs:6633, :5435 (early returns on the stored id); workflow.mjs:826-834 ("a different thread for one recorded request" fails), :750-753; SURFACED recorded at :5491 before the button send at :5511
- Reproduction: `git grep 'approval_thread_id ='` returns exactly one assignment (workflow.mjs:842) and zero clears. index.mjs records SURFACED (:5491) BEFORE the component send (:5511), so a failed send leaves the id set while no card was ever posted, and the :5435 early-return then refuses any re-surface. Add a governed-surface case that fails delivery and re-drives.
- Acceptance criteria: A failed approval delivery leaves the task re-drivable: the retry re-surfaces in the same thread, or after a bounded number of failures approval_thread_id is cleared so a fresh thread can open, and the ledger never permanently refuses re-drive.
- Related findings: bug mở: R1-A09-02 · nguồn: A07 — governance and the approval workflow

### F-181 — leaked onto the Windows drive root, and a guard that assumes it cannot exist there is already false

- Category: F6 — Reliability & Performance
- Legacy register id: `R6-I01-03`
- Affected modules: Gates + CI, Repo tooling + deploy scripts
- Severity: High
- Status: PARTIAL — the platform-first refusal CLOSED by `703fec4` (DRIVER-05 pins it); the writer of `C:\home\hoang_vinh\.openclaw-zink\operator` is still unidentified.
- Root cause: some Windows-side code path (2026-09-29) passed the live WSL path into a filesystem call without the WSL translation, and mkdir-with-recursive created the mirror. — Hệ quả: any control whose safety rests on "that path cannot exist on this host" is currently resting on nothing — including the guard that stands between npm run rehearse:r16 and touching the live runtime shape. Combined with the new confirmation gate the risk is bounded by the operator typing the token, but the _reason_ the tool believes it is on WSL is wrong. Nothing was deleted or changed: removing an unowned tree under C:\home is destructive and §10 requires…
- Evidence: Where: observed C:\home\hoang_vinh\.openclaw-zink\operator (mtime 2026-09-29, empty); consumed by r16-rehearsal.mjs:62 (if (!existsSync(R16_ROOTS.stateDir)) … "R16 runs in WSL only") via tests/helpers/r16-fingerprint.mjs R16_ROOTS.stateDir = /home/hoang_vinh/.openclaw-zink · Evidence: on this host fs.existsSync("/home/hoang_vinh/.openclaw-zink") returns true and R16_ROOTS.runtimeRoot (/home/hoang_vinh/.local/lib/node_modules/openclaw) returns false — i.e. the check is discriminating on real state, and the .openclaw-zink half of it exists _on Windows_ because Node resolved a POSIX absolute path against the current drive. Three directories, no files. · Expected/Actual: the driver's only host-safety guard assumes a POSIX home cannot exist on Windows; it does.
- Reproduction: node -e "console.log(require('fs').existsSync('/home/hoang_vinh/.openclaw-zink'))" on Windows, and ls -la /c/home/hoang_vinh — read-only.
- Acceptance criteria: r16-rehearsal.mjs refuses to run on a non-WSL host for a stated reason that does not depend on whether a directory happens to exist, and no repository code creates C:\home\….
- Related findings: disposition: the platform-first refusal CLOSED by `703fec4` (DRIVER-05 pins it); the writer of `C:\home\hoang_vinh\.openclaw-zink\operator` is still unidentified. · nguồn: Disposition of the register entries M12/T2.1-R3 executed…

### F-182 — the apply sequence restarts the unit without daemon-reload and never verifies the loaded unit

- Category: F6 — Reliability & Performance
- Legacy register id: `R1-A05-05`
- Affected modules: Workflow topology, README
- Severity: Medium
- Status: OPEN
- Root cause: an apply that changes MemoryMax or adds the ExecStartPre gate can report PASS / stage: applied while the running unit still carries the previous definition.
- Evidence: Where: topology/fixtures/runtime-regression/operator-apply.mjs:91-105, apply-orchestration.mjs:193-227, README.md:289; transaction-snapshot.mjs:338-361 · Evidence: systemctl --user restart then is-active; repo-wide grep for daemon-reload returns exactly one hit, in README as a manual step. Verification is byte comparison of files.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc topology/fixtures/runtime-regression/operator-apply.mjs:91-105, apply-orchestration.mjs:193-227, README.md:289; transaction-snapshot.mjs:338-361 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng the apply sequence restarts the unit without daemon-reload and never verifies the loaded unit trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "the apply sequence restarts the unit without daemon-reload and never verifies the loaded unit", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: adjudication Vòng 2: Verified with correction, re-graded Medium → Low · nguồn: A05 — runtime, entrypoints and startup behaviour

### F-183 — Discord native adapter sends are unbounded — REST got deadlines, the announce seam did not

- Category: F6 — Reliability & Performance
- Legacy register id: `R1-A09-06`
- Affected modules: OpenClaw integration
- Severity: Medium
- Status: OPEN
- Root cause: a stalled Discord socket (the recorded code=1006) can pin the announce hook — the exact class M11/T3-R1 removed for REST; a 429 during a card burst loses the card with no retry.
- Evidence: Where: discord-native-send.mjs:532 (await adapter.sendPayload(context)) awaited at index.mjs:5511 inside beforeAnnounce (:7241-7252) and at :8357; DISCORD_REST_DEADLINE_MS = 10_000 covers five fetch sites only · Evidence: no Retry-After/X-RateLimit read exists anywhere in integrations/; 429 surfaces only as `DISCORD_THREAD_POST_FAILED_<status>` (discord-forum-tags.mjs:664-669).
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc discord-native-send.mjs:532 (await adapter.sendPayload(context)) awaited at index.mjs:5511 inside beforeAnnounce (:7241-7252) and at :8357; DISCORD_REST_DEADLINE_MS = 10_000 covers five fetch sites only ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng Discord native adapter sends are unbounded — REST got deadlines, the announce seam did not trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "Discord native adapter sends are unbounded — REST got deadlines, the announce seam did not", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: adjudication Vòng 2: Verified with correction · nguồn: A09 — Discord and external integrations

### F-184 — the knowledge adapter deadline is per-attempt, not per-call: 3 × 120 s + backoff exceeds runTimeoutSeconds: 300, and transport errors get no retry

- Category: F6 — Reliability & Performance
- Legacy register id: `R1-A14-07`
- Affected modules: OpenClaw runtime libs, Zink Tools
- Severity: Medium
- Status: OPEN
- Root cause: the most frequent transient failure is unhandled while the rarest is retried 3×; worst case ≈364 s so the run is killed mid-attempt and the host reports GOVERNANCE_COMPLETION_UNAVAILABLE.
- Evidence: Where: zink-tools/adapters/knowledge/knowledge-adapter.mjs:239-335, :91-92, :298-302; lib/policy.mjs:549 · Evidence: maxAttempts = 3; reqTimeout = input?.timeout || context?.timeout || this.timeout || 120000 applied per attempt; retry only on 429|503|504; req.on("error") (ECONNREFUSED/ECONNRESET — the common container-restart case) rejects with no retry; the 2-slot sharedSearchSemaphore is held throughout; a caller/model-supplied timeout is unbounded.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc zink-tools/adapters/knowledge/knowledge-adapter.mjs:239-335, :91-92, :298-302; lib/policy.mjs:549 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng the knowledge adapter deadline is per-attempt, not per-call: 3 × 120 s + backoff exceeds runTimeoutSeconds: 300, and transport errors get no retry trước khi sửa (nội quy mục 3).
- Acceptance criteria: no zink_knowledge_search call can exceed the configured run deadline.
- Related findings: nguồn: A14 — failure handling and reliability

### F-185 — every runtime backup and native-patch manifest stamps a frozen governance_version literal that no longer exists, and validation demands that same literal

- Category: F6 — Reliability & Performance
- Legacy register id: `R2-B07-01`
- Affected modules: OpenClaw host install (npm)
- Severity: Medium
- Status: OPEN
- Root cause: Register kết luận: every runtime backup and native-patch manifest stamps a frozen governance_version literal that no longer exists, and validation demands that same literal. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: Evidence: runtime-backup.mjs:177 writes "m7-t2-r12", :217 refuses anything else; native-patch.mjs:949 stamps it, :1002 asserts it. Consequence: restore evidence cannot attribute bytes to a governance revision, and the moment the literal is bumped every previously written manifest fails validation — recovery-authorization would fail closed on real evidence.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc entry không còn `Where:` — dựng lại locator từ `PLAN.md` §8 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng every runtime backup and native-patch manifest stamps a frozen governance_version literal that no longer exists, and validation demands that same literal trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "every runtime backup and native-patch manifest stamps a frozen governance_version literal that no longer exists, and validation demands that same literal", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: nguồn: B07 — end-to-end: dedup decisions, one refutation, and a…

### F-186 — the ceiling is a post-hoc .slice() on an already materialized full result with no LIMIT pushed to the engine and no maxBuffer set, so the only real bound is Node's 1 MiB default stdio buffer

- Category: F6 — Reliability & Performance
- Legacy register id: `R5-E06-06`
- Affected modules: Zink Tools
- Severity: Medium
- Status: OPEN
- Root cause: the ceiling is a post-hoc .slice() on an already materialized full result with no LIMIT pushed to the engine and no maxBuffer set, so the only real bound is Node's 1 MiB default stdio buffer. Two failure modes: a wide result overruns the buffer and is reported as DUCKDB_EXECUTION_ERROR (the engine blamed for a plumbing limit), and a normal large result is silently cut to 100 rows so the model asserts "there are 100 matching records". Also unresolved: the ETIMEDOUT branch at :273 keys on err.code string equality while err.killed/err.signal are never…
- Evidence: Where: duckdb-bridge.mjs:203-206, :263-267, :293-319 · Evidence: const maxRows = Math.min(Math.max(Number(input.max_rows) || DUCKDB_DEFAULT_MAX_ROWS, 1), DUCKDB_MAX_ROWS_CEILING); … execFileSync("duckdb", ["-json","-c", initSql], { timeout: timeoutMs, … }) … const sliced = parsedRows.slice(0, maxRows); with row_count: rows.length.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc duckdb-bridge.mjs:203-206, :263-267, :293-319 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng the ceiling is a post-hoc .slice() on an already materialized full result with no LIMIT pushed to the engine and no maxBuffer set, so the only real bound is… trước khi sửa (nội quy mục 3).
- Acceptance criteria: a caller can always distinguish "N rows total" from "showing N of unknown".
- Related findings: nguồn: E06 — Zink Tools adapters (9 findings; two High, and they…

### F-187 — an absent, unmounted or unreadable skills root is reported as a successful discovery of zero skills

- Category: F6 — Reliability & Performance
- Legacy register id: `R5-E06-08`
- Affected modules: Zink Tools
- Severity: Medium
- Status: OPEN
- Root cause: an absent, unmounted or unreadable skills root is reported as a successful discovery of zero skills; the model concludes no governed skill exists and proceeds without the Skill Store. The store-availability check and the "which skills are ACTIVE" answer share one code path, and only the catalog-_error_ case (:255-264) fails closed — a missing root produces no catalog error at all. Same trust inversion as R1-A14-08, at the Skill Store seam.
- Evidence: Where: skill-adapter.mjs:234-316 · Evidence: if (fs.existsSync(skillsDir)) { … } with no else, terminating in return { action:"discover", namespace: namespace ?? "all", skills: [], governed_status:"SUCCESS" }.
- Reproduction: Register chưa có bước tái hiện riêng; bước gần nhất suy từ acceptance/remediation: discover cannot return SUCCESS when the skills root does not exist.
- Acceptance criteria: discover cannot return SUCCESS when the skills root does not exist.
- Related findings: bug mở: R1-A14-08 · nguồn: E06 — Zink Tools adapters (9 findings; two High, and they…

### F-188 — a permanently red gate cannot say "and this branch added one" — it returns the same word for the recorded 5-high baseline as for a new high-severity dependency

- Category: F6 — Reliability & Performance
- Legacy register id: `R5-E09-06`
- Affected modules: Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: a permanently red gate cannot say "and this branch added one" — it returns the same word for the recorded 5-high baseline as for a new high-severity dependency. Extends known item 10 with the missing-baseline mechanism rather than the baseline itself.
- Evidence: Where: security.yml:42-43 — npm audit --audit-level=high, with no allowlist/baseline file in the repo. · Evidence: scheduled main runs continuously red — 38222922937 (10-12), 37280863207 (10-05), 36394881558 (09-28); last green 35573028058 (09-21).
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc security.yml:42-43 — npm audit --audit-level=high, with no allowlist/baseline file in the repo. ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng a permanently red gate cannot say "and this branch added one" — it returns the same word for the recorded 5-high baseline as for a new high-severity dependency trước khi sửa (nội quy mục 3).
- Acceptance criteria: CI reports green while the 5-high baseline persists and red the moment it grows.
- Related findings: nguồn: E09 — CI: the gate tier that can print green without…

### F-189 — up to ten blocking file operations per second for ten minutes run on the same event loop that serves /search

- Category: F6 — Reliability & Performance
- Legacy register id: `R5-E16-04`
- Affected modules: Zink Knowledgebase
- Severity: Medium
- Status: HYPOTHESIS — (caller unverified — the lane says so)
- Root cause: ≈10 blocking file operations per second for up to 10 minutes on the single event loop that also serves /search. With MAX_FUSED_CANDIDATES = 80 (retrieval.py:12) and the two-slot, no-queue SearchCapacityLimiter (retrieval.py:51), a 600 s barrier withholds the only two search slots for its whole duration. Severity is Medium only because reachability is unproven — if it is reachable from a request, it is a host-wide stall, not a background inefficiency.
- Evidence: Where: apps/knowledge/app/database.py:252, :246-247, :268, :322-333, :336-356 · Evidence: async def _acceptance_backup_barrier performs request_path.read_text(encoding="ascii"), os.open(…) / os.fdopen(descriptor, "w", …) — synchronous fs inside an async def — with deadline = asyncio.get_running_loop().time() + 600 and await asyncio.sleep(0.1) re-reading continue_path synchronously each iteration.
- Reproduction: read-only — locate callers of _acceptance_backup_barrier (HTTP route vs lifespan startup). That is the single missing fact and the lane names it as its top gap.
- Acceptance criteria: an in-flight barrier leaves the event loop able to serve a search request within its own deadline.
- Related findings: nguồn: E16 — performance and resource ceilings (5 findings; one…

### F-190 — every tag-filtered or PDF/MARKDOWN-mixed search heap-filters the entire index's segments

- Category: F6 — Reliability & Performance
- Legacy register id: `R5-E03-06`
- Affected modules: Zink Knowledgebase
- Severity: Low
- Status: OPEN
- Root cause: every tag-filtered or PDF/MARKDOWN-mixed search heap-filters the entire index's segments; latency and buffer churn scale linearly with corpus, and because the /search limiter (capacity 2, main.py:164) turns that into queueing rather than failure, the owner experiences slow, silently degrading answers instead of an error — the worst class for attribution (see cluster C-C).
- Evidence: Where: 001_initial.sql:149-150 (knowledge_segments_filter_idx (index_id, primary_topic, source_path)), :108 (tags text[]); database.py:1040-1047, :997-1001 · Evidence: the filter fragment requires segment_type = ANY($6::text[]) and tags @> $4::text[], but no index with an applicable operator class exists for either anywhere in 001/002/003, and the composite index's leading column index_id matches essentially the whole corpus of an ACTIVE index.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc 001_initial.sql:149-150 (knowledge_segments_filter_idx (index_id, primary_topic, source_path)), :108 (tags text[]); database.py:1040-1047, :997-1001 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng every tag-filtered or PDF/MARKDOWN-mixed search heap-filters the entire index's segments trước khi sửa (nội quy mục 3).
- Acceptance criteria: a tag-filtered query plans to an index scan with heap-filter rows removed by an order of magnitude.
- Related findings: nguồn: E03 — Knowledgebase persistence: schema, SQL, migrations…

### F-191 — the runtime-backup/snapshot machinery writing under a module path (e.g

- Category: F6 — Reliability & Performance
- Legacy register id: `R5-E14-06`
- Affected modules: Repo tooling + deploy scripts, Local artifacts
- Severity: Low
- Status: OPEN
- Root cause: the runtime-backup/snapshot machinery writing under a module path (e.g. integrations/openclaw//backups/) produces files that stage into a commit, which is how a live-state capture — potentially containing credential-derived material — enters git history. Directly relevant to §10 and to R5-E13-01/H4.
- Evidence: Where: .gitignore:20-27 (`/backups/_, /logs/_, /temp/*, /infrastructure/...`) · Evidence: backups/, logs/, temp/ are all root-anchored with a leading slash, unlike node_modules/ and **pycache**/ which are unanchored; `*.log` covers flat files only. Current state is otherwise clean — git ls-files -i -c --exclude-standard returns nothing and git status --porcelain shows zero untracked-not-ignored files.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc .gitignore:20-27 (/backups/_, /logs/_, /temp/*, /infrastructure/...) ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng the runtime-backup/snapshot machinery writing under a module path (e.g trước khi sửa (nội quy mục 3).
- Acceptance criteria: a nested generated tree cannot appear in git status.
- Related findings: bug mở: R5-E13-01 · quyết định chủ: H4 · nguồn: E14 — repository hygiene: tracked junk, stale artifacts…

### F-192 — the live-runtime digest cross-checks report PASS (not skip) when the live tree is unreachable, contradicting their own stated contract

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R1-A12-01`
- Affected modules: Gates + CI
- Severity: High
- Status: OPEN
- Root cause: the two suites that tie committed digests to the deployed extension pass on Windows and CI having compared nothing; a broken pin is visible only if someone happens to run WSL. This is the executable form of the gate-lane divergence.
- Evidence: Where: tests/m10-t2-r3-asset-predecessor.test.mjs:310-330 ("R3 P2"), tests/m11-t1-r2-file-lock-asset-predecessor.test.mjs:311-331 ("R2 P2") · Evidence: } catch (error) { if (checked > 0) throw error; } wrapping a hardcoded /home/hoang_vinh/.openclaw-zink/… read, beside comments asserting "this is a skip, never a pass".
- Reproduction: This host has no live tree (`/home/hoang_vinh/.openclaw-zink` is absent), yet both P2 cross-checks report a pass instead of a skip because the first readFileSync throws with checked == 0 and the catch swallows it. Run: `node --test --test-name-pattern='R3 P2' tests/m10-t2-r3-asset-predecessor.test.mjs` and `node --test --test-name-pattern='R2 P2' tests/m11-t1-r2-file-lock-asset-predecessor.test.mjs`.
- Acceptance criteria: With an unreadable live runtime root the P2 cases report SKIPPED (t.skip or { skip: reason }), never a pass, so a green suite cannot imply that the live digest cross-check actually executed.
- Related findings: adjudication Vòng 2: Verified, High kept, mechanism sharpened · nguồn: A12 — test validity and regression coverage

### F-193 — the failing production seam for approval buttons has no test, and the try-block conflates "post failed" with "registration failed"

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R1-A12-04`
- Affected modules: OpenClaw runtime libs, Gates + CI
- Severity: High
- Status: OPEN — _(pairs with R1-A05-01 / R1-A09-01)_
- Root cause: buttons can be unregistered (every click "expired") while the ledger asserts the approval was surfaced, and no suite turns red.
- Evidence: Where: lib/discord-native-send.mjs:383 (registerPostedNativeComponents), call site index.mjs:6813 inside the delivery try :6790-6857; WORKFLOW_APPROVAL_SURFACED recorded earlier at :6775 · Evidence: grep registerPostedNativeComponents tests/*.mjs = 0 hits; the comment at :6789 claims the raw-REST exception is "marked and test-enforced"; tests/m12-t1-discord-component-registry.test.mjs:249-268 only stubs resolveSdk: () => { throw … }.
- Reproduction: Register chưa có bước tái hiện riêng; bước gần nhất suy từ acceptance/remediation: a test fails if registration is skipped or throws after a successful post.
- Acceptance criteria: a test fails if registration is skipped or throws after a successful post.
- Related findings: adjudication Vòng 2: Verified, High kept, partially self-refuted · bug mở: R1-A09-01 · đã sửa/xóa khỏi file: R1-A05-01 · nguồn: A12 — test validity and regression coverage

### F-194 — the only apply-rehearsal instrument is skipped by an env var in all three lanes and its isolation proof is blind to the governed Discord channel root

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R1-A12-05`
- Affected modules: Gates + CI, Repo tooling + deploy scripts
- Severity: High
- Status: OPEN — _(sharpens R1-A13-07 and the open D1 decision)_ · premise changed 2026-10-17: Locators drifted: the script is rehearse:r16 (package.json:27), not test:r16; it stays outside verify (:29) and CI, and every behavioural case is env-skipped.
- Root cause: no apply has ever been validated pre-deployment, and "live tree unchanged" is provable only for a set that excludes the currently-deployed change.
- Evidence: Where: tests/m8-t2.13-r16-apply-rehearsal.test.mjs:108-111 (skip predicate), :120-123 (OVERLAYS), :335 (applyNativePatch(RUNTIME_ROOT, …)); tests/helpers/r16-fingerprint.mjs:17-21 (R16_ROOTS), :24-56 · Evidence: R16_ROOTS lists only stateDir/runtimeRoot/systemdDir and no npm/projects/openclaw-discord-* component; npm run test:r16 is not part of verify (package.json:22 vs :27) and no CI job calls it; the native patch receives a single root so discordChannelRoot resolves null.
- Reproduction: The skip gate is process.env.R16_REHEARSAL_ROOT; unset, the file yields 16/22 skipped, and no CI workflow mentions rehearsal or the driver. Helper R16_ROOTS/COMPONENTS (r16-fingerprint.mjs:15-56) enumerate only state/runtime/systemd — no Discord-channel root — while native-patch.mjs:55 pins a discordChannel-scoped source that the rehearsal invokes with RUNTIME_ROOT (:336), so nativeRoots sets discordChannelRoot = null (:145).
- Acceptance criteria: The apply-rehearsal runs in an automated lane (CI sets R16_REHEARSAL_ROOT or runs the driver) and its fingerprint scope enumerates the Discord-channel root, so a green rehearsal covers every root the real patcher writes.
- Related findings: adjudication Vòng 2: Verified, High kept · bug mở: R1-A13-07 · nguồn: A12 — test validity and regression coverage

### F-195 — the live-rehearsal probe writes the PRODUCTION ledger and seeds its own precondition, so its PASS says nothing about ingress or delivery

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R1-A12-08`
- Affected modules: Workflow topology, OpenClaw integration, Repo tooling + deploy scripts
- Severity: High
- Status: OPEN — _(safety-relevant: a "read-only" instrument mutating live state)_
- Root cause: it fabricates fresh synthetic message ids so DUPLICATE_DISCORD_EVENT/re-entry can never fire, posts nothing to Discord so approval-component delivery is unobservable, and mutates production durable state while claiming to be a probe. An "8 stages PASS" record can coexist with 4 re-entries per run, undelivered buttons and missing terminal records.
- Evidence: Where: integrations/openclaw/topology/fixtures/runtime-regression/live-governance-probe.mjs:25, 39, 94-101, 139-141, 161 · Evidence: stateDir = "/home/hoang_vinh/.openclaw-zink"; recordWorkflowEvent(paths, "WORKFLOW_OPENED", …) with origin_message_id: String(900000000000000000n + BigInt(Date.now())), origin_principal_ref: "a".repeat(64), deliver: false; prose references governance_version m7-t2-r12 while GOVERNANCE_VERSION is m8-t2.3-r5.
- Reproduction: Register chưa có bước tái hiện riêng; bước gần nhất suy từ acceptance/remediation: the probe cannot report PASS for a path whose precondition it created itself.
- Acceptance criteria: the probe cannot report PASS for a path whose precondition it created itself.
- Related findings: nguồn: A12 — test validity and regression coverage

### F-196 — gh run list --branch codex/m11-t1-audit-remediation --json event,headSha vs git rev-parse HEAD

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R5-E09-01`
- Affected modules: Gates + CI
- Severity: High
- Status: EXCLUDED — excluded pending decision `H1` (CI triggers).
- Root cause: a push nobody re-dispatches is ungated, yet PLAN.md keeps citing a green run for an older SHA (38365272022 @ 219ac1d, PLAN.md:244). REMOTE-BACKED cannot be distinguished from "never tested" from the recorded evidence — this is the mechanism behind the evidence-honesty problem V01 raised for packaged:37.
- Evidence: Where: .github/workflows/ci.yml:3-8 and security.yml:3-10 · Evidence: on: pull_request: branches: [main] / push: branches: [main] / workflow_dispatch. gh run list: 20/20 runs on codex/m11-t1-audit-remediation are event workflow_dispatch; not one is push. The last push run on main is 36862429565 (2026-10-01).
- Reproduction: gh run list --branch codex/m11-t1-audit-remediation --json event,headSha vs git rev-parse HEAD.
- Acceptance criteria: HEAD of the task branch has a completed CI run for its exact SHA without human action.
- Related findings: quyết định chủ: H1 · disposition: excluded pending decision `H1` (CI triggers). · nguồn: E09 — CI: the gate tier that can print green without…

### F-197 — an entire gate tier can go inert and CI still prints green — the SQL statement gate and every WSL-dependent control never executed in the runs PLAN.md cites

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R5-E09-03`
- Affected modules: Gates + CI, Governance records
- Severity: High
- Status: EXCLUDED — excluded pending decision `H3` (skip policy — needs a per-family expectation, not a global number).
- Root cause: an entire gate tier can go inert and CI still prints green — the SQL statement gate and every WSL-dependent control never executed in the runs PLAN.md cites. AGENTS.md §11 requires an unavailable required gate to remain NOT RUN; here it is folded into "fail 0".
- Evidence: Where: ci.yml:42-43 + tests/m11-t1-postgres-sql-gate.test.mjs:43, :100, :130 · Evidence: - run: npm run verify; the Postgres gate does t.skip(docker container ${CONTAINER} unavailable). Its header comment claims the skip "is never converted into a pass", but node --test exits 0 with skips, so the job conclusion is SUCCESS. CI evidence records skipped 51 (PLAN.md:245) against 45 skipped on Windows (PLAN.md:40) and no gate names those 51.
- Reproduction: Register chưa có bước tái hiện riêng; bước gần nhất suy từ acceptance/remediation: fail CI on an unexplained increase in the skip tier, or run the Postgres container as a service so the gate is executable there. (The second is a CI-infrastructure change, so it is a gate change under §7 → owner decision.)
- Acceptance criteria: fail CI on an unexplained increase in the skip tier, or run the Postgres container as a service so the gate is executable there. (The second is a CI-infrastructure change, so it is a gate change under §7 → owner decision.)
- Related findings: quyết định chủ: H3 · disposition: excluded pending decision `H3` (skip policy — needs a per-family expectation, not a global number). · nguồn: E09 — CI: the gate tier that can print green without…

### F-198 — the branch tip carrying the M11/M12 work had never been gated by CI and no gate could refuse a merge into main, so every REMOTE-BACKED claim rested on a hand-dispatched run against an older SHA

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R5-E09-08`
- Affected modules: Gates + CI
- Severity: High
- Status: EXCLUDED — excluded pending decision `H1`; half its premise was refuted (HEAD did get runs once one was dispatched).
- Root cause: the branch tip carrying the M11/M12 work had never been gated by CI and no gate could refuse a merge into main, so every REMOTE-BACKED claim rested on a hand-dispatched run against an older SHA. Correction (PLAN.md §11 H1 row, 2026-10-15): "HEAD has zero runs" became false once runs were dispatched at 7ed0b28/d8c221a, and the "a human dispatched" attribution is unsupportable because gh api user returns the same login the runs list as actor. What survives is the decision: the evidence exists only when someone remembers to dispatch it.
- Evidence: Where: .github/workflows/ci.yml:3-8, security.yml:3-10, plus gh run list --branch codex/m11-t1-audit-remediation · Evidence: measured by the orchestrator and stated in this file's "One new fact … no lane stated" note, but never given an entry: 23 runs on the task branch, every one event: "workflow_dispatch" across 12 distinct SHAs, and 0 runs for the then-HEAD 6ffb858; combined with ci.yml:3-8 scoping pull_request/push to [main] and the 403 from gh api …/branches/main/protection. Those run/SHA counts are date-stamped readings: §11's H1 row re-derived 26 runs across 14 SHAs on 2026-10-15, and both readings agree on the part that matters — every branch run is workflow_dispatch. · Detail: created by M12/T4-R1 T4-3 on 2026-10-17; the finding existed only in narrative before that, and PLAN.md §4.17 carries its disposition.
- Reproduction: Static read of the two trigger blocks: both workflows start automatic runs only for pull_request and push to main, so a non-main task-branch tip is gated solely by a manual workflow_dispatch. The merge-refusal half needs `gh api repos/…/branches/main/protection` and per-SHA run counts, which cannot be measured on this host without network.
- Acceptance criteria: A push to any non-main task branch triggers both CI and Security, and main carries branch protection naming those checks as required, so a REMOTE-BACKED claim can name a run for the exact head SHA that a required check could refuse.
- Related findings: quyết định chủ: H1 · disposition: excluded pending decision `H1`; half its premise was refuted (HEAD did get runs once one was dispatched). · nguồn: E09 — CI: the gate tier that can print green without…

### F-200 — I recorded what I had just measured instead of grepping the register first, which is the exact step AGENTS.md §4 and the audit's own anti-duplication rule require

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R6-V07-01`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: High
- Status: OPEN — Confirmed (orchestrator re-derived it from source)
- Root cause: I recorded what I had just measured instead of grepping the register first, which is the exact step AGENTS.md §4 and the audit's own anti-duplication rule require. — Hệ quả: with four IDs standing for two decisions plus one deployment note, the next contract would have counted one naming fix as three, and would have tiered R5-E11-01 as T2.3 "documents" — which drops R1-A04-01 (High, an enforcement bug that kills a legal brief with UNAUTHORIZED_TARGET) and R1-A04-05 (Medium, a denial that names the wrong subsystem) out of scope entirely.
- Evidence: Where: this file's R6-CFG-01…03 block vs R5-E11-01 (:3805-3819), R1-A04-01 (:139-144), R1-A04-05 (:148-153) · Evidence: R5-E11-01's own Where already includes policy.mjs:566-572 and its Verify-by says to diff "AGENT_SPAWN_POLICY + AGENT_DEFINITIONS display names" — i.e. the naming defect I filed as new under R6-CFG-01/-02 was recorded three weeks ago. R6-CFG-03's STACK_IDS half is verbatim R1-A04-05, and its guard.mjs half is verbatim R1-A04-01.
- Reproduction: Register inspection reproduces the duplication: R6-CFG-01/-02 have no rows of their own, the R6-CFG-03 row (merged into R1-A04-01 in §2) lists R1-A04-01 as already fixed, and R5-E11-01 already carries the AGENT_SPAWN_POLICY display-name diff at policy.mjs:566-572 — the same naming defect re-filed as new. The line cites inside the Evidence field (:3805-3819, :139-153) are stale for a 3 068-line file.
- Acceptance criteria: One defect holds one register id: the R6-CFG-01/-02/-03 claims are merged into R5-E11-01, R1-A04-01 and R1-A04-05, so a later contract counts one naming decision as one item instead of three.
- Related findings: bug mở: R6-CFG-01, R5-E11-01, R6-CFG-03 · đã sửa/xóa khỏi file: R1-A04-01, R1-A04-05 · nguồn: The two refutations that hit the orchestrator's own…

### F-201 — the packaging whitelist and its rewrite engine have no completeness gate; the deployed entrypoint's module graph is never imported by any test

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R1-A02-06`
- Affected modules: OpenClaw runtime libs, Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: adding one module imported from index.mjs ships green through CI and then dies at gateway start with ERR_MODULE_NOT_FOUND, taking all seven bots; removing a name leaves the old deployed copy on disk forever (no GC).
- Evidence: Where: lib/policy.mjs:1182-1240 (two explicit filename arrays), :717-742 (PACKAGE_REWRITES); tests/m7-t2-plugin-packaging.test.mjs:79,105,178,205,234 (only ever imports lib/policy.mjs)
- Reproduction: Register chưa có bước tái hiện riêng; bước gần nhất suy từ acceptance/remediation: the packaging suite imports the deployed entrypoint and fails on any unresolved specifier.
- Acceptance criteria: the packaging suite imports the deployed entrypoint and fails on any unresolved specifier.
- Related findings: nguồn: A02 — module dependencies, shared components and duplication

### F-202 — the MemoryMax ceiling is asserted against one filename; any sibling drop-in overrides it and no gate notices

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R1-A05-04`
- Affected modules: OpenClaw runtime libs, Repo tooling + deploy scripts
- Severity: Medium
- Status: OPEN
- Root cause: a stray or hand-added fragment raises or removes MemoryMax and injects extra ExecStart while preflight, apply and verify.mjs all PASS. Agent's live check: currently clean (only 10-zink.conf, MemoryMax=805306368).
- Evidence: Where: configure.mjs:1499-1505, 1767-1773; verify.mjs:512-514; lib/policy.mjs:1347 · Evidence: all three compare only …/openclaw-gateway-zink.service.d/10-zink.conf; readdirSync never enumerates the drop-in directory, and a later-alphabet 20-x.conf wins in systemd.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc configure.mjs:1499-1505, 1767-1773; verify.mjs:512-514; lib/policy.mjs:1347 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng the MemoryMax ceiling is asserted against one filename; any sibling drop-in overrides it and no gate notices trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "the MemoryMax ceiling is asserted against one filename; any sibling drop-in overrides it and no gate notices", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: nguồn: A05 — runtime, entrypoints and startup behaviour

### F-203 — Windows and WSL entrypoints disagree on permission assertions and on which state tree they inspect

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R1-A05-06`
- Affected modules: OpenClaw runtime libs, Repo tooling + deploy scripts
- Severity: Medium
- Status: OPEN — _(concrete instance of the gate-lane divergence)_
- Root cause: a green Windows/CI preflight is read as deployment evidence while it checked a copy that is not evidence; the mode gate silently exists on only one lane; operator-* scripts hardcode /home/hoang_vinh/… and run only in WSL.
- Evidence: Where: configure.mjs:985-995 (if (process.platform === "win32") return; skipping every mode check) + :1067-1078; lib/policy.mjs:758-760; verify.mjs:130-139, 470-495; operator-preflight.mjs:13, operator-apply.mjs:39-40 · Evidence: main() pins stateDir to ~/.openclaw-zink (the STALE Windows tree on this host); measured statSync("C:/Users/HOANG VINH/.openclaw-zink").mode & 0o777 = 666, and verify.mjs's requireMode has no platform guard.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc configure.mjs:985-995 (if (process.platform === "win32") return; skipping every mode check) + :1067-1078; lib/policy.mjs:758-760; verify.mjs:130-139, 470-495; operator-preflight.mjs:13, operator-apply.mjs:39-40 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng Windows and WSL entrypoints disagree on permission assertions and on which state tree they inspect trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "Windows and WSL entrypoints disagree on permission assertions and on which state tree they inspect", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: adjudication Vòng 2: Verified, Medium kept · nguồn: A05 — runtime, entrypoints and startup behaviour

### F-204 — the zink-tools/ lint/format gap hides four real defects, not style noise

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R1-A10-07`
- Affected modules: Zink Tools, Gates + CI, Governance records
- Severity: Medium
- Status: PARTIAL — the coverage half CLOSED at `9c7af0f`; the three defects it hid stay open.
- Root cause: Register kết luận: the zink-tools/ lint/format gap hides four real defects, not style noise. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: Where: zink-tools/adapters/skill-store/skill-adapter.mjs:210, :416, :976-979; zink-tools/common/semantic-contract.mjs:394 · Evidence: :210 destructures an unused version (the missing ACTIVE selector of R1-A10-01); :416 stamps apply results lifecycle_state:"active" lowercase while read uses "ACTIVE"; :976 throw … Unsupported action is unreachable (all six ALLOWED_ACTIONS are handled); :394 is a dead void expression. npm run lint never reads the tree (PLAN.md:268).
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc zink-tools/adapters/skill-store/skill-adapter.mjs:210, :416, :976-979; zink-tools/common/semantic-contract.mjs:394 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng the zink-tools/ lint/format gap hides four real defects, not style noise trước khi sửa (nội quy mục 3).
- Acceptance criteria: lint covers zink-tools/ and reports zero errors on the current tree.
- Related findings: adjudication Vòng 2: Verified with correction · bug mở: R1-A10-01 · disposition: the coverage half CLOSED at `9c7af0f`; the three defects it hid stay open. · nguồn: A10 — Zink Tools, adapters and execution contracts

### F-205 — a "test that cannot fail on Windows": the platform guard returns from the test body instead of skipping

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R1-A12-02`
- Affected modules: Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: Windows pass counts are inflated and the junction case never runs in CI (ubuntu), so per-lane coverage differs while every lane reports the same green number.
- Evidence: Where: tests/m6-t1-skill-store.test.mjs:519 (SKILL.md symlink → UNSAFE_PATH), :533-543 · Evidence: if (process.platform === "win32") return; before any assertion, while a sibling test uses { skip: process.platform !== "win32" }. · R7 (nạp vị trí mới từ hàng `F-270` bị rút vì trùng root cause): the two platform halves are mutually exclusive and CI satisfies neither — `tests/m6-t1-skill-store.test.mjs:533-544` guards the junction case with `{ skip: process.platform !== "win32" }` (its `:541` assertion is `assert.notEqual((await catalog(root)).errors.length, 0)`), while `tests/m12-t2.2-a3-queue-writer-lock.test.mjs:391-396` returns early with `if (process.platform === "win32") { t.skip("… the WSL lane runs this"); return; }`. `.github/workflows/ci.yml:20` and `:50` are both `runs-on: ubuntu-24.04`, so the junction half executes in no enforced lane; the same split repeats at `tests/m11-t3-durable-state-integrity.test.mjs:997-1000`, `tests/m7-t1-openclaw.test.mjs:1441` and `tests/m11-t1-openclaw-outbound-and-caches.test.mjs:166`.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc tests/m6-t1-skill-store.test.mjs:519 (SKILL.md symlink → UNSAFE_PATH), :533-543 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng a "test that cannot fail on Windows": the platform guard returns from the test body instead of skipping trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "a "test that cannot fail on Windows": the platform guard returns from the test body instead of skipping", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: adjudication Vòng 2: Verified with correction · nguồn: A12 — test validity and regression coverage · R7 delta audit: `F-270` withdrawn as a duplicate of this row, its locations merged here

### F-206 — MODEL_ALLOWLIST_VIOLATION is an unreachable guard whose "coverage" is a tautology

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R1-A12-06`
- Affected modules: Gates + CI
- Severity: Medium
- Status: OPEN — _(pairs with K06)_
- Root cause: the gate reports coverage of a security invariant that is untested, and readers keep believing indices 2–4 are unreachable.
- Evidence: Where: lib/quota-telemetry.mjs:262-264 guard, stale comments :203, :214-219; tests/m7-t2-quota-telemetry.test.mjs:465-471 (TEST M), :474-493 (TEST M2) · Evidence: the resolver only assigns allowlist[0]/allowlist[1], so membership cannot fail; TEST M2's own comment says the guard "is unreachable by construction" then re-asserts membership. MODEL_ALLOWLIST now has 5 entries (policy.mjs:534-543).
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc lib/quota-telemetry.mjs:262-264 guard, stale comments :203, :214-219; tests/m7-t2-quota-telemetry.test.mjs:465-471 (TEST M), :474-493 (TEST M2) ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng MODEL_ALLOWLIST_VIOLATION is an unreachable guard whose "coverage" is a tautology trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "MODEL_ALLOWLIST_VIOLATION is an unreachable guard whose "coverage" is a tautology", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: adjudication Vòng 2: Verified, corrected · nguồn: A12 — test validity and regression coverage

### F-207 — the verdict-matrix suite counts any thrown error as the specified policy DENY, and three cases require no diagnostic at all

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R1-A12-09`
- Affected modules: Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: Register kết luận: the verdict-matrix suite counts any thrown error as the specified policy DENY, and three cases require no diagnostic at all. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: Where: tests/m10-t2-r8-ingress-verdict-matrix.test.mjs:271-300, expectedLogs null at :245-252 · Evidence: try { await enterNativeRun(…); verdict="ALLOW" } catch { verdict="DENY" } — a harness fault, a malformed fixture, or GOVERNANCE_CONTEXT_MISSING/GOVERNANCE_RUN_UNAVAILABLE from any cause is recorded as the designed verdict; one test() wraps a loop so the first failure hides the rest.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc tests/m10-t2-r8-ingress-verdict-matrix.test.mjs:271-300, expectedLogs null at :245-252 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng the verdict-matrix suite counts any thrown error as the specified policy DENY, and three cases require no diagnostic at all trước khi sửa (nội quy mục 3).
- Acceptance criteria: each DENY case names an expected reason string, with no catch-to-verdict conversion.
- Related findings: adjudication Vòng 2: Verified, exposure narrowed · nguồn: A12 — test validity and regression coverage

### F-208 — deferred/OPEN historical defects are still present at HEAD, and the R16 rehearsal gate is permanently self-skipping

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R1-A13-07`
- Affected modules: OpenClaw runtime libs, OpenClaw integration, Zink Knowledgebase, Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: every "CLOSED / DEPLOYED AND VERIFIED" for M11/T3 and M12 rests on operator self-report, never on the repository's own rehearsal instrument.
- Evidence: Where: tests/m8-t2.13-r16-apply-rehearsal.test.mjs:111, 326, 452; lib/policy.mjs:569; lib/quota-telemetry.mjs:214-219 · Evidence: skip = REHEARSAL ? false : "requires the R16 rehearsal mount namespace"; no integrations/openclaw//AGENTS.md exists (deferred cluster C); no quarantine code in apps/knowledge; the quota comments still describe the removed execute combo.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc tests/m8-t2.13-r16-apply-rehearsal.test.mjs:111, 326, 452; lib/policy.mjs:569; lib/quota-telemetry.mjs:214-219 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng deferred/OPEN historical defects are still present at HEAD, and the R16 rehearsal gate is permanently self-skipping trước khi sửa (nội quy mục 3).
- Acceptance criteria: D1 delivered, or R16 is recorded NOT RUN everywhere it is cited.
- Related findings: nguồn: A13 — Git history and cross-milestone regressions (21…

### F-209 — the probe's failure classifier cannot attribute a state/assertion failure

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R2-B03-03`
- Affected modules: Chưa xác định — đọc lại Where khi re-verify
- Severity: Medium
- Status: OPEN
- Root cause: Register kết luận: the probe's failure classifier cannot attribute a state/assertion failure.. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: Evidence: :254-269 matches String(error?.code ?? error?.message ?? "") against a fixed code list; an AssertionError carries no code, so assert.equal(workflow_status,"COMPLETE") (:146-149) yields none of the known tokens and a real completion/lineage regression logs identically to a harness hiccup. Also stage is one label for 6 children of the nested matrix.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc entry không còn `Where:` — dựng lại locator từ `PLAN.md` §8 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng the probe's failure classifier cannot attribute a state/assertion failure. trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "the probe's failure classifier cannot attribute a state/assertion failure.", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: nguồn: B03 — governance / ledger / audit integrity (10 claims…

### F-210 — the digest-derivation pins freeze the denial path's literal source text, penalising the very fix K01 needs

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R2-B06-01`
- Affected modules: Chưa xác định — đọc lại Where khi re-verify
- Severity: Medium
- Status: OPEN
- Root cause: Register kết luận: the digest-derivation pins freeze the denial path's literal source text, penalising the very fix K01 needs. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: Evidence: m8-t2.6-r8-asset-provenance.test.mjs:398-467 asserts verbatim catch-block inclusion (comments included) and then string-replaces to reach a hardcoded SHA-256. The natural place to propagate decision.reason is exactly the pinned region, so a provenance gate quietly resists the remediation it claims to protect. Fix: replace text-inclusion pins with behavioural assertions.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc entry không còn `Where:` — dựng lại locator từ `PLAN.md` §8 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng the digest-derivation pins freeze the denial path's literal source text, penalising the very fix K01 needs trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "the digest-derivation pins freeze the denial path's literal source text, penalising the very fix K01 needs", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: nguồn: B06 — test validity (9 claims; several sharpened or…

### F-211 — read-only — grep -rn "verify.mjs" --include=_.mjs --include=_.yml --include=_.sh --include=_.ps1

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R5-E08-05`
- Affected modules: OpenClaw integration, Repo tooling + deploy scripts
- Severity: Medium
- Status: REFUTED — refuted by the `B-4` re-read; a content pin landed instead (`33f0971`).
- Root cause: opt-in runtime tier + a failure predicate that only fires on a non-empty array — the same validator-shape defect as R5-E08-03, R5-E07-02, R4-V01-01. — Hệ quả: a deployment can be declared "verified" from a {"static":"PASS","live":[]} JSON that carries no runtime evidence, and a log scrape of that output cannot tell the owner the gateway was never probed. Combined with R5-E08-04, the tool has no path that both runs and reports honestly.
- Evidence: Where: integrations/openclaw/verify.mjs:545, :559-585, :634-638 (parseArguments at :88) · Evidence: const result = { static: "PASS", live: [] }; … if (options.live) { … } … if (result.live.some( (entry) => entry.status === "FAIL")) { process.exitCode = 1; } then stdout.write(stableJson(result)), with parseArguments defaulting { live: false }. [].some(…) is trivially false. · Expected/Actual: a successful verification should record which checks ran; the default invocation performs 14 runtime checks zero (config validate, doctor, gateway status --deep, per-agent Discord capabilities, router reachability) and emits exit 0 with a live field indistinguishable from "none configured".
- Reproduction: read-only — grep -rn "verify.mjs" --include=_.mjs --include=_.yml --include=_.sh --include=_.ps1 . (excluding node_modules/scratch) to confirm nothing anywhere constructs the --live argv.
- Acceptance criteria: the output distinguishes executed / failed / not-run, and exit 0 requires the checks the caller believes ran.
- Related findings: bug mở: R4-V01-01 · đã sửa/xóa khỏi file: R5-E08-03, R5-E07-02, R5-E08-04 · disposition: refuted by the `B-4` re-read; a content pin landed instead (`33f0971`). · nguồn: E08 — repository tooling: `package.json` scripts…

### F-212 — the recorded evidence is a bare pass count (188 passed, 27 subtests, PLAN.md:246) with no skipped or deselected count, so a shrinking collected set reads as an unchanged green

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R5-E09-04`
- Affected modules: Zink Knowledgebase, Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: the recorded evidence is a bare pass count (188 passed, 27 subtests, PLAN.md:246) with no skipped or deselected count, so a shrinking collected set reads as an unchanged green.
- Evidence: Where: ci.yml:97-100 + package.json test:knowledge + apps/knowledge/pyproject.toml:4 · Evidence: npm run test:knowledge → uv run --directory apps/knowledge --locked python -m pytest tests -q; pyproject.toml has only requires-python = ">=3.13,<3.14" — no [tool.pytest.ini_options], no addopts, no coverage floor, no --strict-markers; ci.yml:94-96 states pdf-runtime is "deliberately not installed" while apps/knowledge/tests/test_pdf_runtime.py:295 carries posix-conditional tests.
- Reproduction: Chưa có bước tái hiện ghi sẵn. Điểm khởi đầu bắt buộc: đọc ci.yml:97-100 + package.json test:knowledge + apps/knowledge/pyproject.toml:4 ở HEAD hiện tại, rồi dựng test đỏ mô tả đúng the recorded evidence is a bare pass count (188 passed, 27 subtests, PLAN.md:246) with no skipped or deselected count, so a shrinking collected set reads as… trước khi sửa (nội quy mục 3).
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "the recorded evidence is a bare pass count (188 passed, 27 subtests, PLAN.md:246) with no skipped or deselected count, so a shrinking collected set reads as an unchanged green", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: nguồn: E09 — CI: the gate tier that can print green without…

### F-213 — three suites require historical git objects and the external tar binary

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R5-E10-01`
- Affected modules: OpenClaw integration, Gates + CI
- Severity: Medium
- Status: LATENT
- Root cause: three suites require historical git objects and the external tar binary. On a shallow clone, after a squash-merge to main, or after git gc prunes now-unreachable SHAs, npm test goes red for a non-code cause — and ci.yml:54/security.yml:27 use default (shallow) checkouts, so any job built on them inherits it. Pairs with R5-E09-03: a red that nobody can explain is as bad as a green that proves nothing.
- Evidence: Where: tests/m11-t1-r2-file-lock-asset-predecessor.test.mjs:47, :160-181; tests/m8-t2.10-r13-r7-predecessor-allowlist.test.mjs:288-310; tests/m12-t2-governed-surface.test.mjs:644-661 · Evidence: const LIVE_SOURCE_COMMIT = "ea84a5a"; then spawnSync("git", ["archive", LIVE_SOURCE_COMMIT, …]) asserted with assert.equal(archive.status, 0, …) plus spawnSync("tar", ["-x", …]); m12-t2 uses execFileSync("git", ["show", "b6d04e8:integrations/…"]). No skip guard.
- Reproduction: Static — all three suites shell out to pinned historical SHAs and the external `tar` binary with no skip guard on that dependency: `tests/m11-t1-r2-file-lock-asset-predecessor.test.mjs:47` sets `LIVE_SOURCE_COMMIT = "ea84a5a"` and `liveExtension()` runs `spawnSync("git", ["archive", LIVE_SOURCE_COMMIT, …])` plus `spawnSync("tar", ["-x", …])` under `assert.equal(archive.status, 0, …)` (`:170`) and `assert.equal(tar.status, 0, …)` (`:179`), repeated for `d773856` at `:492-505`; `tests/m8-t2.10-r13-r7-predecessor-allowlist.test.mjs:310` defines `gitShow` over `execFileSync("git", ["show", …])` and calls it at module top level (`:318-325`) for `4f5cc6d`; `tests/m12-t2-governed-surface.test.mjs:652` runs `execFileSync("git", ["show", "b6d04e8:…"])`. The skip guards these files do carry protect only the live-WSL-tree reads (`m11-t1-r2:320-341`, `m8-t2.10:434-440`), never the git-object or `tar` path. Probe on this host: `git cat-file -t` returns `commit` for all seven pinned SHAs, `tar --version` is GNU tar 1.35, and the `quality-gate` job that runs `npm test` checks out with `fetch-depth: 0` (`.github/workflows/ci.yml:26`), so the suites are green today (LATENT); only the shallow `python-quality` checkout at `ci.yml:54` is depth-limited. Reproduce the latent red non-destructively with `git clone --depth 1 <repo> <tmp>` then `node --test tests/m11-t1-r2-file-lock-asset-predecessor.test.mjs` inside it: the pinned SHAs are absent, `git archive` exits non-zero and the status-0 assertion fails for a non-code cause. Fix gates in those same three suites: replace the unconditional status-0 assertions with a reachability precondition that skips when `git cat-file -e <sha>` fails or `tar` is unavailable.
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "three suites require historical git objects and the external tar binary", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: bug mở: R5-E09-03 · nguồn: E10 — test infrastructure: the source-text assertion…

### F-214 — the gate is decorative for ~90 % of the surface it names — a tag id introduced in lib/discord-forum-tags.mjs, configure.mjs, templates/, topology/fixtures/ or an env file keeps it green

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R5-E10-02`
- Affected modules: OpenClaw governance plugin (Discord), OpenClaw integration, Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: the gate is decorative for ~90 % of the surface it names — a tag id introduced in lib/discord-forum-tags.mjs, configure.mjs, templates/, topology/fixtures/ or an env file keeps it green. Same class as R5-E13-05 (guard aimed at the wrong files) and R4-V01-01 (verification over a set it silently shrank). A real repo-wide walk precedent already exists at tests/m7-lane-g-policy.test.mjs:731.
- Evidence: Where: tests/m12-t2-governed-surface.test.mjs:489-505 · Evidence: the test is titled "no Discord tag id is hardcoded anywhere in the repository" but reads exactly one file (readFileSync("integrations/openclaw/plugins/zink-governance/index.mjs")) and checks only two things: /applied_tags:\s*\[\s*"\d{15,25}"/u and pluginSource.includes("1545697161985921064").
- Reproduction: Static — the gate `M12/T2 P1: no Discord tag id is hardcoded anywhere in the repository` (`tests/m12-t2-governed-surface.test.mjs:494`) reads exactly one file, `pluginSource = readFileSync("integrations/openclaw/plugins/zink-governance/index.mjs")` (`:489-492`), and asserts only `/applied_tags:\s*\[\s*"\d{15,25}"/u.test(pluginSource) === false` (`:496`) and `pluginSource.includes("1545697161985921064") === false` (`:501`). Every other surface the title names is real and unread — `integrations/openclaw/lib/discord-forum-tags.mjs`, `integrations/openclaw/configure.mjs`, `integrations/openclaw/templates/`, `integrations/openclaw/topology/fixtures/` and the env files — so a 15-25 digit tag literal introduced in any of them keeps the assertion green. Reproduce by adding an `applied_tags: ["1234567890123456789"]` literal to `lib/discord-forum-tags.mjs` and confirming `node --test tests/m12-t2-governed-surface.test.mjs` still passes. Fix gates in this same test: widen P1 to walk the tracked tree — the multi-file precedent is `tests/m7-lane-g-policy.test.mjs:725-733`, and `tests/repository-policy.test.mjs` already enumerates the repo via `execFileSync("git", …)` — asserting both patterns are absent from every tracked `.mjs`, `.env` and template, not from `index.mjs` alone.
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "the gate is decorative for ~90 % of the surface it names — a tag id introduced in lib/discord-forum-tags.mjs, configure.mjs, templates/, topology/fixtures/ or an env file keeps it green", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: bug mở: R5-E13-05, R4-V01-01 · nguồn: E10 — test infrastructure: the source-text assertion…

### F-215 — one boolean conflates "unreadable" with "readable but drifted"

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R5-E10-04`
- Affected modules: Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: one boolean conflates "unreadable" with "readable but drifted". If the installed @openclaw/discord preflight chunk changes upstream — the exact regression these pins exist to catch — both tests SKIP and the suite stays green while the runtime pin is stale. Distinct from R1-A12-01 (unreachable→PASS): here it is drift→silent SKIP.
- Evidence: Where: tests/m10-t2-r8-preflight-lineage.test.mjs:52-59, 66-74, 124, 150 · Evidence: readLive() swallows everything (`catch { /* try the next path form */ } return null;`), then reachable = live !== null && sha256(live) === CHANNEL_BASELINE_SHA256, and both tests use { skip: skip("live runtime not reachable") }.
- Reproduction: Static — `tests/m10-t2-r8-preflight-lineage.test.mjs:54-63` defines `readLive()` to swallow every error (`catch { /* try the next path form */ }` at `:58-60`, then `return null;` at `:62`), and `reachable` at `:69-72` collapses two distinct states into one boolean: `return live !== null && sha256(live) === CHANNEL_BASELINE_SHA256;` (`:71`). Because `skip = (message) => (reachable ? false : message)` (`:74`) drives `{ skip: skip("live runtime not reachable") }` on both live tests (`:124` and `:150`), a readable artifact whose digest has DRIFTED from the pin drives `reachable` false and both tests SKIP green — the exact regression the pin exists to catch. Reproduce statically by pointing `CHANNEL_BASELINE_SHA256` (`:66-67`) at a wrong digest while a readable file is present, or on the WSL host by editing the live `message-handler.preflight-CbD0u7U7.js`; either way the suite reports two skips, not a failure. Fix gates in this same file: split the boolean so `readLive() !== null` (readable) is separated from digest-equality, and add an assertion that FAILS rather than skips when the artifact is readable but `sha256(live) !== CHANNEL_BASELINE_SHA256`.
- Acceptance criteria: a readable live artifact whose digest ≠ the pin makes the suite fail, not skip.
- Related findings: bug mở: R1-A12-01 · nguồn: E10 — test infrastructure: the source-text assertion…

### F-216 — assertions on a process-global singleton owned by the imported plugin, with no reset and no captured baseline

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R5-E10-05`
- Affected modules: Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: assertions on a process-global singleton owned by the imported plugin, with no reset and no captured baseline; the production code also registers by approval_id (:272-275). Any leftover entry flips 4.2 red or, worse, makes an eviction-order assertion pass for the wrong reason — the file cannot run concurrently and its result depends on which earlier tests ran.
- Evidence: Where: tests/m11-t1-openclaw-outbound-and-caches.test.mjs:52-55, 247-266, 327-372 (env mutation :79-93) · Evidence: const PENDING_CACHE = () => globalThis[Symbol.for("zink.governance.pending_skill_proposals")]; with absolute assertions assert.equal(cache.size, PENDING_PROPOSALS_LIMIT) / assert.equal(cache.has("evict-0"), false) after seeding LIMIT + 40 entries; cleanup deletes only the ids the test chose.
- Reproduction: Static — `tests/m11-t1-openclaw-outbound-and-caches.test.mjs:52-53` binds `PENDING_CACHE = () => globalThis[Symbol.for("zink.governance.pending_skill_proposals")]`, a process-global singleton the imported plugin creates once at module load (`integrations/openclaw/plugins/zink-governance/index.mjs:196-197`) and never resets; the file also mutates `process.env.HOME` and `USERPROFILE` (`:81-82`). The eviction test at `:247-265` seeds `PENDING_PROPOSALS_LIMIT + 40` entries then asserts absolute global state — `assert.equal(cache.size, PENDING_PROPOSALS_LIMIT)` (`:256`) and `assert.equal(cache.has("evict-0"), false)` (`:258`) — without capturing the pre-test size, and its `finally` deletes only the ids it chose (`:263`); the completed-execution test at `:327-374` repeats this against `COMPLETED_CACHE`. Because `registerPendingSkillProposal` can insert one record under two keys (`approval_id` and `proposal_id`, `index.mjs:378-387`), residue from any earlier test in the file shifts the eviction boundary, so the assertions pass or fail depending on test order and the suite cannot run concurrently. Reproduce by seeding one extra id into `PENDING_CACHE()` before the `:251` loop, or by running the file under `node --test --test-concurrency`, and watching `:256`/`:258` flip. Fix gates in this same file: capture `const baseline = cache.size` and the key set before seeding and assert the delta, or reset the singleton in a `beforeEach`.
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "assertions on a process-global singleton owned by the imported plugin, with no reset and no captured baseline", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: nguồn: E10 — test infrastructure: the source-text assertion…

### F-217 — the gate freezes one historical digest, its commit (b6d04e8), its occurrence count and the absence of the current build's digest from the allowlist — so the next legitimate lib/discord-forum-tags.mjs change cannot be admitted for…

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R5-E10-06`
- Affected modules: Gates + CI
- Severity: Medium
- Status: EXCLUDED — excluded with a recorded reason (a digest-pin re-base is its own objective, so it should not ride along); no `H` number names it — needs an owner decision that has no number yet.
- Root cause: the gate freezes one historical digest, its commit (b6d04e8), its occurrence count and the absence of the current build's digest from the allowlist — so the next legitimate lib/discord-forum-tags.mjs change cannot be admitted for deployment without editing this test. It is the re-base cost of any tag fix, including whatever R1-A13-01's surviving mechanism turns out to need.
- Evidence: Where: tests/m12-t2-governed-surface.test.mjs:644-645, 668-672, 693-707 · Evidence: const DEPLOYED_FORUM_TAGS_SHA256 = "e0a755bb..." plus assert.equal(configureSource.includes(sha256(packaged)), false, "the current build digest must not be allowlisted") and assert.equal(configureSource.split(DEPLOYED_FORUM_TAGS_SHA256).length - 1, 1, "the deployed digest must appear exactly once in the file").
- Reproduction: Static — `tests/m12-t2-governed-surface.test.mjs` freezes four facts about one historical asset: the digest `DEPLOYED_FORUM_TAGS_SHA256` (`:644-645`), its source commit via `execFileSync("git", ["show", "b6d04e8:integrations/openclaw/lib/discord-forum-tags.mjs"])` (`:652-654`), the occurrence count `assert.equal(configureSource.split(DEPLOYED_FORUM_TAGS_SHA256).length - 1, 1, …)` (`:707-711`), and the absence of the current build's digest `assert.equal(configureSource.includes(sha256(packaged)), false, …)` (`:713-717`). Together these mean admitting a newly deployed `lib/discord-forum-tags.mjs` digest forces an edit to this test: the occurrence-count assertion breaks once the digest appears twice, and the `b6d04e8` commit pin no longer reproduces the new bytes. Reproduce by adding a second allowlisted digest for the asset in `integrations/openclaw/configure.mjs` and confirming `node --test tests/m12-t2-governed-surface.test.mjs` fails at `:707-711` even though the deployment is legitimate. Fix gates in this same test: derive the admitted digest and commit from a data file or from the allowlist table itself instead of hardcoding one digest, one commit and an exact occurrence count. The row is EXCLUDED because a digest-pin re-base is its own objective; this documents the mechanism only.
- Acceptance criteria: adding a newly deployed asset digest to the allowlist does not require rewriting this test.
- Related findings: bug mở: R1-A13-01 · disposition: excluded with a recorded reason (a digest-pin re-base is its own objective, so it should not ride along); no `H` number names it — needs an owner decision that has no number yet. · nguồn: E10 — test infrastructure: the source-text assertion…

### F-218 — a comment reword, an import reorder, or a units rename turns suites red while nothing behavioural changed — and the converse is worse: a code change can keep the comment, drop the enforcement, and stay green. The real guarantee ("the…

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R5-E10-08`
- Affected modules: Chưa xác định — đọc lại Where khi re-verify
- Severity: Medium
- Status: OPEN — — the inventory's headline pattern
- Root cause: a comment reword, an import reorder, or a units rename turns suites red while nothing behavioural changed — and the converse is worse: a code change can keep the comment, drop the enforcement, and stay green. The real guarantee ("the deadline is enforced") is never executed anywhere.
- Evidence: Where: m10-t2-coordinator-binding:1208-1209; m8-t2-governed-runtime-audit:2283, :2344, :2300, :2304; m9-t1-functional-truth-remediation:956; m11-t3-openclaw-runtime-bounds:99-122 · Evidence: assertions on prose and spelling rather than behaviour — assert.ok(source.includes("never a server-echoed field")), source.includes("construction-derived"), pluginSrc.includes("E09: Unified request digest"), pluginSrc.includes("E20: Validate outbound attachments/files linkage"), source.includes("NOT A PROVIDER INTEGRATION"), source.includes("export const DISCORD_REST_DEADLINE_MS = 10_000;"), source.includes('import { execSync } from "node:child_process";'), and assert.ok(!configureSource.includes("setTimeout(abort, 300000)")) beside assert.ok(configureSource.includes("setTimeout(abort, 10000)")).
- Reproduction: Register chưa có bước tái hiện riêng; bước gần nhất suy từ acceptance/remediation: no test fails when a comment, import line or section heading is reworded with identical behaviour.
- Acceptance criteria: no test fails when a comment, import line or section heading is reworded with identical behaviour.
- Related findings: nguồn: E10 — test infrastructure: the source-text assertion…

### F-219 — undetected drift, plus a false premise for later lanes — six tracked executables read like supported probes but can never fail in CI

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R5-E14-02`
- Affected modules: Workflow topology, OpenClaw integration, Gates + CI, Governance records
- Severity: Medium
- Status: OPEN
- Root cause: undetected drift, plus a false premise for later lanes — six tracked executables read like supported probes but can never fail in CI. They are also further instances of the machine-specific state root that decision H4/R5-E13-01 and R5-E13-05 are about.
- Evidence: Where: integrations/openclaw/topology/fixtures/runtime-regression/{finalization-boundary-probe, operator-token-probe, r11-workspace-probe, runtime-preflight, live-governance-probe, native-patch-probe}.mjs · Evidence: a repo-wide grep returns zero inbound files for the first four; live-governance-probe and native-patch-probe appear only in PLAN.md prose. package.json wires only r16-rehearsal.mjs. Two of them re-encode the machine path — operator-token-probe.mjs:8 and runtime-preflight.mjs:7 hardcode /home/hoang_vinh/.openclaw-zink.
- Reproduction: Static — all six probes are tracked executables (`git ls-files integrations/openclaw/topology/fixtures/runtime-regression/*.mjs` lists `finalization-boundary-probe.mjs`, `operator-token-probe.mjs`, `r11-workspace-probe.mjs`, `runtime-preflight.mjs`, `live-governance-probe.mjs` and `native-patch-probe.mjs`), but nothing invokes them: `package.json` references `runtime-regression` exactly once (`rehearse:r16` → `r16-rehearsal.mjs`), no `npm test` suite imports them, and no `.github/workflows` step runs them, so they can never fail in CI and their drift goes undetected. A repo-wide grep for the six names returns only prose and comment hits — `PLAN.md`, `docs/execution/findings.md`, `docs/contracts/execution/archive/2026-10-16-M12-T2.2-R2.md` and a comment at `integrations/openclaw/topology/lib/runtime-backup.mjs:125` — never an invocation. Two also re-encode the machine state root: `operator-token-probe.mjs:8` and `runtime-preflight.mjs:7` both hardcode `/home/hoang_vinh/.openclaw-zink`. Reproduce with `grep -rn "finalization-boundary-probe|operator-token-probe|r11-workspace-probe|runtime-preflight" package.json .github tests` and observe zero wiring. Fix gates in `tests/repository-policy.test.mjs`: assert every tracked `.mjs` under `integrations/openclaw/topology/fixtures/` is referenced by a `package.json` script or a workflow step, or is deleted.
- Acceptance criteria: every tracked .mjs under fixtures/ is invoked by a named gate.
- Related findings: bug mở: R5-E13-01, R5-E13-05 · quyết định chủ: H4 · nguồn: E14 — repository hygiene: tracked junk, stale artifacts…

### F-220 — a speculative target tree committed ahead of implementation — AGENTS.md §8 forbids exactly this

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R5-E14-03`
- Affected modules: Workflow topology, OpenClaw integration, README
- Severity: Medium
- Status: OPEN
- Root cause: a speculative target tree committed ahead of implementation — AGENTS.md §8 forbids exactly this. — Hệ quả: a reviewer or executor concludes canonical hashing, lifecycle and routing are fixture-tested when there are zero vectors and zero loaders. Each directory is a future false premise.
- Evidence: Where: integrations/openclaw/topology/fixtures/{canonical-hash,lifecycle,routing}/README.md · Evidence: each README is its directory's only tracked content, reading "Reserved for synthetic canonicalization / workflow, brief, run and result-acceptance / admission and DAG routing vectors." The parent fixtures/README.md claims the tree holds "Synthetic-only fixtures for canonical hashing, routing, lifecycle". A repo-wide grep for those three paths returns no hits.
- Reproduction: Static — `git ls-files integrations/openclaw/topology/fixtures/{canonical-hash,lifecycle,routing}` returns exactly one tracked file per directory, its `README.md`, and each is only a reservation note: `canonical-hash/README.md:3` "Reserved for synthetic canonicalization vectors.", `lifecycle/README.md:3` "Reserved for synthetic workflow, brief, run and result-acceptance vectors.", `routing/README.md:3` "Reserved for synthetic admission and DAG routing vectors." The parent `integrations/openclaw/topology/fixtures/README.md:3-4` nonetheless advertises "Synthetic-only fixtures for canonical hashing, routing, lifecycle and exact OpenClaw 2026.6.34 runtime regressions", so a reviewer concludes those three areas are fixture-tested when there are zero vectors and zero loaders (a repo-wide grep for the three paths returns no importing file). This is the speculative-target-tree pattern `AGENTS.md` §9 forbids ("Target directory trees are architecture, not implementation evidence"). Reproduce with `git ls-files integrations/openclaw/topology/fixtures/canonical-hash` and the other two, and confirm the only tracked entry is `README.md`. Fix gates in `tests/repository-policy.test.mjs`: assert no tracked fixture directory contains only a reservation README — either the vectors and loaders exist, or the directory is removed and the parent README's claim corrected.
- Acceptance criteria: no tracked fixture directory contains only a reservation note.
- Related findings: nguồn: E14 — repository hygiene: tracked junk, stale artifacts…

### F-221 — the real-PostgreSQL SQL gate exercises only one of the three tracked migrations

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R6-R3-NEW-01`
- Affected modules: Gates + CI
- Severity: Medium
- Status: OPEN — Confirmed (read at 04cdbd6)
- Root cause: the gate was written for the vector-schema family and never widened when the other two files gained DDL.
- Evidence: Where: tests/m11-t1-postgres-sql-gate.test.mjs:107-111 · Evidence: the lane applies 003_skills_vector_schema.sql only, so 001_initial.sql and 002_pdf_ingestion_foundation.sql never execute against a real PostgreSQL in any gate; their replay and idempotence defects (R5-E03-01, R5-E03-02) stay undetectable by CI, and the lane the owner granted under n1 cannot catch them either.
- Reproduction: run node --test tests/m11-t1-postgres-sql-gate.test.mjs against the local PostgreSQL container and list which files it applies.
- Acceptance criteria: the gate applies every tracked migration in order against a scratch database, or the gate output names the set it skips. Routed to M12/T8.
- Related findings: bug mở: R5-E03-01, R5-E03-02 · nguồn: M12/T2.2-R3 close (2026-10-17)

### F-222 — the invariant's code is dead vocabulary for sanctioned writers, while the state it guards can only be created by editing files outside the lock — with no digest recompute, no decision binding and no tooling. The owner gets no signal from…

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R5-E04-06`
- Affected modules: Zink Skill Store
- Severity: Low
- Status: LATENT · premise changed 2026-10-18: Both cited locators drifted: detection :756-764 → :791-799 (the cited range now holds `SKILLS_ROOT_MISSING`), clash check :1161-1182 → :1322-1333 (the cited range now holds provenance-reference validation). Mechanism otherwise intact; the s
- Root cause: the invariant's code is dead vocabulary for sanctioned writers, while the state it guards can only be created by editing files outside the lock — with no digest recompute, no decision binding and no tooling. The owner gets no signal from the store when the invariant was violated by hand; detection arrives as a store-wide records: [] outage rather than a named repair.
- Evidence: Where: catalog.mjs:756-764 (detection) vs :1161-1182 (clash check) · Evidence: MULTIPLE_ACTIVE_VERSIONS is detected in the reader, but promotion already refuses with SKILL_ACTIVE_CONFLICT on the same namespace+capability predicate, and (per R5-E04-05) no writer can create a second ACTIVE without deleting the first.
- Reproduction: Static — the reader-side invariant `MULTIPLE_ACTIVE_VERSIONS` (`zink-skill-store/src/catalog.mjs:791-799`, keyed on `namespace.join("/")` plus `capability` at `:790`) fires only when two ACTIVE records share a namespace and capability, but the sanctioned promotion writer already refuses that exact predicate first: `catalog.mjs:1322-1333` computes `clash` on the same `namespace.join("/")`, `capability` and `lifecycle.at(-1).status === "ACTIVE"` and calls `writerError("SKILL_ACTIVE_CONFLICT", …)` (`:1329-1332`). So no writer can create the two-ACTIVE state the reader detects; it is reachable only by hand-editing manifest files outside the lock, with no digest recompute and no decision binding — and the existing gate `tests/m6-t1-skill-store.test.mjs:301-309` proves this by writing two versions directly to disk rather than through the writer. When it does trigger, `scanCatalog` returns `records: sortedErrors.length === 0 ? sortedRecords : []` (`:807`), so the owner sees a store-wide empty-records outage rather than a named repair. Reproduce by extending `tests/m6-t1-skill-store.test.mjs:280-310` to also assert the catalog's `records` array is empty when the hand-written clash exists, and asserting the promotion writer throws `SKILL_ACTIVE_CONFLICT` before any second ACTIVE can be created. Fix gates in `tests/m6-t1-skill-store.test.mjs`: assert the reader emits a targeted diagnostic naming both offending versions for the hand-edited state instead of blanking the whole catalog.
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "the invariant's code is dead vocabulary for sanctioned writers, while the state it guards can only be created by editing files outside the lock — with no digest recompute, no decision binding and no tooling. The owner…", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: bug mở: R5-E04-05 · nguồn: E04 — Skill Store catalog internals (9 findings; the store…

### F-223 — npm run verify says nothing about the PowerShell the runbooks tell the owner to execute, including a backup script

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R5-E08-06`
- Affected modules: Gates + CI, Architecture + contracts docs, README, Repo tooling + deploy scripts
- Severity: Low
- Status: OPEN
- Root cause: target directory trees were committed as architecture (AGENTS.md §9 "Target directory trees are architecture, not implementation evidence") while the real operator entry points stayed where the Docker work put them. — Hệ quả: npm run verify says nothing about the PowerShell the runbooks tell the owner to execute, including a backup script. Any future doc pointing at `scripts/verification/<x>.mjs` cites a path that does not exist even on this host. One negative recorded honestly: no phantom-script defect in the reverse direction — every infrastructure/docker/scripts/*.ps1 cited by docs does exist.
- Evidence: Where: package.json:21-23; scripts/{bootstrap,development,maintenance,verification}/; infrastructure/docker/scripts/ · Evidence: git ls-files scripts/ returns 2 files (repository-check.mjs, repository-policy.mjs); the four advertised category directories are empty on disk and untrackable by git, so a fresh clone has none of them. Meanwhile infrastructure/docker/scripts/ holds ~15 scripts (backup.ps1, build.ps1, preflight.ps1, start.ps1, stop.ps1, knowledge-t1..t5*.ps1, bootstrap-postgres.sh) referenced by README.md:428, :434, :570, :910 and docs/runbooks/knowledge-platform.md:20-29, :55 — and matched by no prettier pattern, no eslint target, and no REQUIRED_SCRIPTS/MAKE_TARGETS entry.
- Reproduction: Register chưa có bước tái hiện riêng; bước gần nhất suy từ acceptance/remediation: every script a doc or runbook tells a human to run is covered by at least one verify stage, and no advertised scripts/ category is empty.
- Acceptance criteria: every script a doc or runbook tells a human to run is covered by at least one verify stage, and no advertised scripts/ category is empty.
- Related findings: nguồn: E08 — repository tooling: `package.json` scripts…

### F-224 — the failure is injected by SQL source text, so any rewording of the tombstone statement silently moves the injected failure to a different call site while the same assertions still pass — the "not swallowed" guarantee can stop covering…

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R5-E10-07`
- Affected modules: Gates + CI
- Severity: Low
- Status: OPEN
- Root cause: the failure is injected by SQL source text, so any rewording of the tombstone statement silently moves the injected failure to a different call site while the same assertions still pass — the "not swallowed" guarantee can stop covering the intended statement with no red signal. (It is also the only test-side coverage of the R5-E05-02/03 tombstone, which is why those findings went unnoticed.) Leaked temp trees accumulate invisibly on constrained /tmp.
- Evidence: Where: tests/m11-t1-skill-vector-sql.test.mjs:160-176; tests/m7-t3-tools-contract.test.mjs:143-147 · Evidence: dbExecutor: async (sql) => { if (sql.includes("DELETE FROM skills.catalog_index")) return ""; throw new Error("PSQL_REJECTED_SIMULATION"); } for a test named "failure escalation — a failed failSql is surfaced, not swallowed"; and cleanup try { fs.rmSync(tempDir, …) } catch { void 0; }.
- Reproduction: Static — the fault is injected by matching SQL source text, not by targeting the tombstone call: `tests/m11-t1-skill-vector-sql.test.mjs:165-168` uses a `dbExecutor` that returns an empty string when `sql.includes("DELETE FROM skills.catalog_index")` and otherwise throws `PSQL_REJECTED_SIMULATION`, inside the test `M11-04: failure escalation — a failed failSql is surfaced, not swallowed` (`:153`), then asserts `report.status === "FAILED"` (`:170`), `report.failed_count === 1` (`:171`) and `report.error_code === "VECTOR_FAILURE_WRITE_FAILED"` (`:172`). The matched substring is the production tombstone at `zink-skill-store/src/vector-sync.mjs:626-631`, so rewording that statement makes the `includes()` miss it and the injected throw silently migrates to whichever statement runs first — the same three assertions still pass while the "not swallowed" guarantee stops covering the tombstone. Reproduce by rewording the `vector-sync.mjs` DELETE (rename the table or prepend a comment) and confirming `node --test tests/m11-t1-skill-vector-sql.test.mjs` stays green. The companion leak is `tests/m7-t3-tools-contract.test.mjs:142-146`, whose cleanup swallows removal failures so temp trees accumulate. Fix gates in `tests/m11-t1-skill-vector-sql.test.mjs`: inject the failure by statement role or call ordinal, or assert the exact SQL the failing executor received, rather than by a substring that can drift.
- Acceptance criteria: Register chưa có acceptance line. Khi sửa phải viết acceptance từ trạng thái đúng ngược lại tiêu đề "the failure is injected by SQL source text, so any rewording of the tombstone statement silently moves the injected failure to a different call site while the same assertions still pass — the "not swallowed" guarantee…", và acceptance đó là điều kiện duy nhất được phép xóa bug này khỏi file (nội quy mục 6).
- Related findings: bug mở: R5-E05-02 · nguồn: E10 — test infrastructure: the source-text assertion…

### F-225 — the historical-recovery refusal prints FAIL and then performs the destructive recovery anyway

- Category: F2 — Security & Authorization
- Legacy register id: `R7-D4-01`
- Affected modules: OpenClaw runtime libs, Workflow topology
- Severity: Critical
- Status: OPEN
- Root cause: `refuse()` only writes a FAIL line and sets `process.exitCode = 1`; it never throws, returns or exits, and both of its call sites fall straight through to the mutation block. Every refusal in `recovery-authorization.mjs` is therefore advisory output, not a gate.
- Evidence: Where: integrations/openclaw/topology/fixtures/runtime-regression/operator-rollback.mjs:77-89 (`function refuse(...)` body is `process.stdout.write(...)` + `process.exitCode = 1`), :101 `if (refusal) refuse(refusal);`, :111 `if (!verdict.proceed) refuse(verdict.refusal, { ...verdict });` · Evidence: immediately after :111 the script does `restoreNativePatch(nativeRoots, nativeBackup)` (:117), `await restoreT1RuntimeFiles(...)` (:118), `execFileSync("systemctl", ["--user","restart","openclaw-gateway-zink.service"])` (:119-127) and then prints `{status:"PASS"}` (:131-139). The refusal line already asserted `installed_mutation: false` (:84). Gate itself is sound: recovery-authorization.mjs:133-185 returns `proceed:false`, :195 returns null when the file is absent.
- Reproduction: run the probe with no `recovery-authorization.json` and both backups present: stdout carries a FAIL `installed_mutation:false` line, the native tree is un-patched, the gateway restarts, and a second PASS line follows. A red test can assert "exactly one JSON line and no `restoreNativePatch` call" by stubbing the two restore functions.
- Acceptance criteria: any of the eight `RECOVERY_REFUSALS` terminates execution before the first mutating call; the no-authorization probe leaves the native tree PATCHED and emits exactly one JSON line.
- Related findings: adjacent to F-069 (recovery tool discoverability, different cause) · nguồn: R7 delta audit D4 — topology policy/contract enforcement

### F-226 — an owner ACCEPT stamps `workflow_status: COMPLETE` without reading the outcome it accepted

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R7-D4-02`
- Affected modules: Workflow topology + ledger
- Severity: High
- Status: OPEN
- Root cause: `WORKFLOW_ROOT_RESULT_RECORDED` keeps the real outcome only in `root_result.pending_outcome_status`, and `WORKFLOW_USER_RESULT_ACCEPTED` sets `COMPLETE`/`CLOSED` from the verdict alone. No runtime code reads `pending_outcome_status`, so a FAILED or PARTIAL run becomes a COMPLETE task the moment the owner clicks accept.
- Evidence: Where: integrations/openclaw/topology/lib/workflow.mjs:531 opens the `WORKFLOW_ROOT_RESULT_RECORDED` branch, :612-619 is its live arm (`task.root_result = { ...payload, pending_outcome_status: payload.outcome_status }`, status set to `RESULT_PENDING_REVIEW`) and :621-638 (ACCEPT branch → `task.workflow_status = "COMPLETE"; task.brief_state = "CLOSED"`) · Evidence: `grep -rn pending_outcome_status --include=*.mjs` yields one writer (workflow.mjs:614) plus test readers only (tests/m7-lane-a-workflow.test.mjs:97, tests/m8-t2.3-writer-semantics.test.mjs:143/257/593); `outcome_compatibility` in reason-code-matrix.json declares PARTIAL and FAILED as legal recorded outcomes.
- Reproduction: apply `WORKFLOW_ROOT_RESULT_RECORDED` with `outcome_status:"FAILED", reason_code:"RUN_TIMEOUT"` (matrix-legal), then `WORKFLOW_USER_RESULT_ACCEPTED` with a matching digest; the resulting snapshot task is `COMPLETE` while `root_result.outcome_status` is still `FAILED`.
- Acceptance criteria: the post-ACCEPT status is derived from the accepted outcome (or a distinct `ACCEPTED_AS_DELIVERED` marker), and a regression test asserts `workflow_status` never contradicts `root_result.outcome_status`.
- Related findings: F-077 (same symptom, mechanism newly identified here), F-085, F-248 · nguồn: R7 delta audit D4

### F-227 — the 12-character task code is minted from `Math.random()` over a 21^4 space and is now the ledger identity the approval is keyed to

- Category: F2 — Security & Authorization
- Legacy register id: `R7-D4-03`
- Affected modules: Workflow topology + ledger, OpenClaw governance plugin (Discord)
- Severity: High
- Status: OPEN
- Root cause: M12/T1-R1 promoted the owner-visible code from display alias to task identity, but the integrity re-derivation only runs for legacy 64-hex ids, uniqueness is checked against the in-memory snapshot only, and the mint uses a non-cryptographic PRNG — the exact condition `canonical.mjs` documents as forbidden.
- Evidence: Where: integrations/openclaw/topology/lib/canonical.mjs:22-30 ("The code is a DISPLAY ALIAS, never an identity … 21^4 is under 195k, so it must never be trusted to prove which task is being approved") vs :41-64 `buildTaskCode({date, random})` · Evidence: integrations/openclaw/plugins/zink-governance/index.mjs:7650-7660 mints with `random: () => Math.floor(Math.random() * TASK_CODE_ALPHABET.length)` and `isTaken` scanning only `currentSnapshot.tasks`; workflow.mjs:99-107 accepts either identity shape, :320-330 re-derives lineage only when `/^[a-f0-9]{64}$/u.test(payload.task_id)`, :334-350 checks code collision against the current snapshot; WORKFLOW_USER_APPROVAL_DECIDED compares no principal.
- Reproduction: static — a code-form `task_id` reaches `taskIdentity()` (workflow.mjs:102-107) and skips re-derivation entirely, so nothing proves which task an approval names; 195k candidates per date prefix make the target enumerable. A red test can assert the mint uses a cryptographic byte source and that the identity is re-derivable from its origin record.
- Acceptance criteria: identity minted from `randomBytes` and/or widened beyond 21^4, uniqueness asserted against the event journal rather than the live snapshot, and a reducer check that binds a code-form task to its origin record.
- Related findings: F-023, F-032, F-043 (approval not bound to the plan) · nguồn: R7 delta audit D4

### F-228 — `workflow-policy.json` and `role-capability-manifest.json` are read by no runtime code; every governed value exists as a duplicate literal

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R7-D4-04`
- Affected modules: Workflow topology + ledger
- Severity: Medium
- Status: OPEN
- Root cause: the two policy files are loaded only by test suites, while runtime reads the same values from frozen literals in code, so the published policy is documentation that no behaviour consults and the two copies can drift apart silently.
- Evidence: Where: integrations/openclaw/topology/policy/workflow-policy.json:4-8 (`budgets`: 16/10/72) vs topology/lib/ledger.mjs:39-43 (`export const BUDGETS = Object.freeze({ maxBriefRevisionsPerTask: 16, maxStackTransitionsPerTask: 10, maxTotalDelegatedRunsPerTask: 72 })`) · Evidence: a repo-wide grep for `workflow-policy`, `role-capability-manifest` and `state-transitions` outside `tests/` returns nothing; readers are tests/m7-lane-g-policy.test.mjs:630/651/674 and tests/m7-t1-session-authority.test.mjs:267. Only `reason-code-matrix.json` has runtime readers (configure.mjs, lib/policy.mjs, topology/lib/runtime.mjs).
- Reproduction: static — set the `workflow-policy.json` budgets to 0: every runtime ceiling is unchanged and only `m7-lane-g-policy` reddens, proving the file is inert for behaviour.
- Acceptance criteria: the file is loaded at the single authoritative site with a behaviour test showing an edit changes observed ceilings, or the owner rules that the literals are the single source, in which case the file and the tests that read it are withdrawn together — an agent may not delete a published policy file to close this row.
- Related findings: F-127, F-065 · nguồn: R7 delta audit D4 — topology policy and contract enforcement

### F-229 — the declared transition projection omits the state the replay arm writes, and its only checker has zero call sites

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R7-D4-05`
- Affected modules: Workflow topology + ledger
- Severity: Low
- Status: LATENT
- Root cause: `state-transitions.json` gives `PARTIAL` no inbound edge, while the reducer's anchored-replay arm assigns `task.workflow_status = payload.outcome_status`, and PARTIAL is a contract-legal outcome there; the live arm leaves the task in `RESULT_PENDING_REVIEW`, so no current writer produces the edge; the exported helper that would enforce the projection is never called, and the lane that claims to check the file compares key sets, not edges.
- Evidence: Where: integrations/openclaw/topology/policy/state-transitions.json — `grep -n PARTIAL` hits only line 54 `"PARTIAL": []`, so no array lists it as a transition target · Evidence: topology/lib/workflow.mjs:605-607 — the write sits inside `if (replayAnchored && preVerdictRootResult)`, i.e. replay of pre-verdict history, not the live path; topology/policy/reason-code-matrix.json declares `outcome_compatibility.PARTIAL = ["OPTIONAL_BRANCH_FAILED"]`; topology/lib/runtime.mjs:295 `export function transitionAllowed(...)` has no call site (`grep -rn transitionAllowed --include=*.mjs` returns the definition only); tests/m7-lane-g-policy.test.mjs:700-723 pins key names, not transitions.
- Reproduction: static — replaying a pre-verdict root result with `outcome_status:"PARTIAL"` performs a transition the projection forbids, and `transitionAllowed("workflow_status", "EXECUTING", "PARTIAL", transitions)` returns false for it; no runtime call site exists to notice either way. A red test can enumerate every `(from, to)` the reducer can produce and assert each appears in the projection.
- Acceptance criteria: the projection is enforced at the write seam and enumerated edge-by-edge by a test, or the owner retires the projection together with the dead helper and the tests that read it — an agent may not delete the projection to make the check pass.
- Related findings: F-061, F-127, F-226 · nguồn: R7 delta audit D4

### F-230 — the transaction preimage hashes raw bytes but stores and re-hashes them as UTF-8 text, so one non-UTF-8 asset makes capture throw

- Category: F6 — Reliability & Performance
- Legacy register id: `R7-D4-06`
- Affected modules: Workflow topology, Repo tooling + deploy scripts
- Severity: Medium
- Status: OPEN
- Root cause: `createTransactionSnapshot` digests the `readFileSync` Buffer but persists `body: body.toString("utf8")`, and `verifyTransactionSnapshot` re-hashes that string, so any file whose bytes are not valid UTF-8 cannot round-trip — and the exhaustive extension walk makes such a file reachable.
- Evidence: Where: integrations/openclaw/topology/lib/transaction-snapshot.mjs:92 (`const digest = (body) => createHash("sha256").update(body).digest("hex")`), :201-207 (`const body = readFileSync(absolute); files[relative] = { …, sha256: digest(body), body: body.toString("utf8") }`), :240 (`if (digest(entry.body) !== entry.sha256) throw new Error("TRANSACTION_SNAPSHOT_INCONSISTENT")`) · Evidence: the same helper is reused for restore verification at :358 and :370, so the lossy round-trip is the preimage check itself.
- Reproduction: static — a one-byte `\xff` file under `extensions/zink-governance/` makes capture throw `TRANSACTION_SNAPSHOT_INCONSISTENT`, leaving no rollback target and blocking apply with an unnamed cause.
- Acceptance criteria: bodies stored as base64 (or Buffers) with a capture/restore round-trip test over a deliberately binary asset proving byte identity.
- Related findings: F-131 (same "enumerator meets unseen plugin-tree content" class, different cause) · nguồn: R7 delta audit D4

### F-234 — the enforced Knowledge input schema is a hand-built registry object, so the published `$defs.input` never gates a call

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R7-D1-04`
- Affected modules: Zink Tools, OpenClaw governance plugin (Discord)
- Severity: Medium
- Status: OPEN
- Root cause: registration prefers `def.parameters` over the contract, and that object is assembled from contract lookups that cannot resolve (`limit`, `primary_topic` are absent from `$defs.input`), so the live seam accepts seven properties the contract forbids and drops the `action` it requires.
- Evidence: Where: integrations/openclaw/plugins/zink-governance/index.mjs:4258 (`const paramSchema = def.parameters || toolContracts[toolId]?.parameters;`) · Evidence: the registry block :3485-3519 declares `query, limit, primary_topic, action, namespace, path_prefix, rerank, task_id, session_key, run_id` with `required: ["query","namespace"]` and no `additionalProperties`, while zink-tools/contracts/tools/zink-knowledge.schema.json `$defs.input` declares exactly `action, namespace, query, chunk_id, top_k` with `required: ["action","namespace"]` and `additionalProperties: false` (both sets read programmatically). `loadToolContractSchemas`:3169 does set `parameters: rawSchema.$defs?.input`, so the unresolved lookups fall through to the `|| { type: "…" }` defaults instead of failing.
- Reproduction: static — a knowledge call carrying `path_prefix` or `rerank` satisfies `def.parameters` and is rejected by `$defs.input`; the two schemas disagree, which proves the contract is not the authority.
- Acceptance criteria: the registration seam validates the published `$defs.input`, or the contract is amended to the accepted surface and a test asserts contract and registry shapes are equal.
- Related findings: F-024 (two resolvers for one dependency disagree), F-231 · nguồn: R7 delta audit D1

### F-235 — `zink_n8n` reports tool success the moment a workflow is accepted, so a queued run reads as completed work

- Category: F1 — Logic & Functional Bugs
- Legacy register id: `R7-D5-01`
- Affected modules: Zink Tools
- Severity: High
- Status: OPEN
- Root cause: for `data_plant_ingest` and `data_plant_sync`, `validateWorkflowOutputData` only requires `data.status` to be a non-empty string, and the success envelope is returned unconditionally afterwards, so the workflow's own state is never mapped to terminal-versus-pending.
- Evidence: Where: zink-tools/n8n/trigger.mjs:16-27 (`data_plant_ingest`) and :29-40 (`data_plant_sync`), each ending `if (typeof data.status !== "string" || data.status.length === 0) return false;` … `return true;`, and :300-318 (`return { … status: "success", output: { workflow_id, data: parsed.data }, artifacts: [] }`) · Evidence: the path is live, not test-only — integrations/openclaw/topology/lib/guard.mjs:230-234 binds `invokeN8n` from the adapter and :1900 dispatches it. `pipeline_notify` is the one workflow whose check demands a boolean `data.delivered` (trigger.mjs:42-50), which shows the intended completion pattern.
- Reproduction: static — a loopback 200 with `{ data: { ingest_id: "i", status: "accepted" } }` passes :300 and is returned as `status: "success"`; the owner's result report then reads a queued workflow as completed work.
- Acceptance criteria: a non-terminal `data.status` yields a pending/accepted outcome and never `success`; a test asserts `{ status: "PENDING" }` cannot produce tool success.
- Related findings: F-144, F-231 · nguồn: R7 delta audit D5 — provider adapters and tool truth

### F-236 — `python-validator.mjs` enforces no invariant yet README and CHANGELOG publish it as the AST safety gate for `zink_python`

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R7-D5-02`
- Affected modules: Zink Tools
- Severity: Medium
- Status: LATENT
- Root cause: `validatePythonFileContent` is a regex line/classifier that counts defs, classes and imports and tags pandas/sqlite/openpyxl; it has no deny rule and returns no violation field, so nothing it observes can be refused — while the documentation attributes AST parsing and import control to it.
- Evidence: Where: zink-tools/python/python-validator.mjs:77-132 — the only throw is :79 (`content must be a string`); the object returned at :119-131 carries `lineCount, importCount, functionCount, classCount, asyncFunctionCount, dataModules, dbModules, fileIoModules, hasMainBlock, firstLines` and no pass/fail or violation field · Evidence: README.md:753 states "**Python (`.py`):** Phân tích AST, đếm hàm/class, phân loại import thư viện … preview 30 dòng đầu (`python/python-validator.mjs`)" and CHANGELOG.md:432-433 lists the file as the "real preview engine … AST parsing". :130 emits `firstLines: nonEmpty.slice(0, 10)`, so even the preview size claim is wrong. The invariants named in zink-tools/python/contract.md:19-22 (entrypoint pattern, `validateArtifactLogicalPath`, stack binding) live elsewhere. The only importer is tests/m8-t2-governed-runtime-audit.test.mjs:52.
- Reproduction: static — input `import os` + `os.system("rm -rf /")` reaches :111-114 and returns a normal summary; no rejection is expressible. LATENT because the dispatch is honest today: index.mjs:4039-4062 returns `status: "BLOCKED"`, `error: "ENGINE_NOT_IMPLEMENTED"`, "No script was executed."
- Acceptance criteria: either the file is documented as a non-authoritative preview summarizer (README and CHANGELOG corrected), or it returns a violation set with tests proving `exec`, `eval`, `os.system`, `subprocess` and `open` are flagged before any sandbox ships.
- Related findings: F-235, F-231 · nguồn: R7 delta audit D5

### F-237 — the `pdf-runtime` child package and its only test suite are executed by no lane: CI, the Docker build and the .mjs contracts all stop at the parent

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-D2-01`
- Affected modules: Zink Knowledgebase
- Severity: High
- Status: OPEN
- Root cause: the blocking Python lane runs `pytest tests` over the parent suite and deliberately never installs the child venv; the Docker test stage copies only the parent `tests/`; and the child's own suite imports docling, so it cannot run in the parent environment. The extraction, OCR and provenance logic that actually produces indexed content therefore has no executing gate.
- Evidence: Where: .github/workflows/ci.yml:94-100 ("pdf-runtime is deliberately not installed here … That suite stays an explicit NOT RUN in CI rather than an assumed pass", then `run: npm run test:knowledge`); package.json:25 (`"test:knowledge": "uv run --directory apps/knowledge --locked python -m pytest tests -q"`); apps/knowledge/Dockerfile:69-77 (the `test` stage copies `app`, `migrations`, `pdf-runtime/src`, `tests` and runs `python -m unittest discover -s tests -v`); apps/knowledge/pdf-runtime/tests/test_range_contract.py:11-12 (`from docling.backend.pypdfium2_backend import PyPdfiumDocumentBackend`, `from docling_core.types.doc import PictureItem, TableItem, TextItem`) · Evidence: a repo-wide grep for `pdf-runtime/tests` matches nothing outside this register, so no lane names the child suite; the parent boundary tests stub the child (`apps/knowledge/tests/test_pdf_runtime.py` patches `create_subprocess_exec`).
- Reproduction: static — regress `zink_pdf_runtime.runner._page_local_content` or the hyphen-merge path and `python-quality`, `npm run verify` and the Docker build test stage all stay green, because none imports or executes the child.
- Acceptance criteria: a lane installs the `pdf-runtime` venv and runs `apps/knowledge/pdf-runtime/tests`, recorded as PASS with its own counts; or the package is declared out of verification scope in `PLAN.md` §3 and here.
- Related findings: F-212 (pass-count-only evidence), F-221 (one of three migrations exercised) · nguồn: R7 delta audit D2 — Knowledgebase ingestion and PDF runtime

### F-238 — the operator backup never dumps the Knowledge database while the runbook advertises a PostgreSQL backup

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R7-D3-01`
- Affected modules: Zink Knowledgebase, Repo tooling + deploy scripts
- Severity: High
- Status: OPEN
- Root cause: `backup.ps1` defaults `$Databases` to `@("n8n")` and dumps exactly one database per entry, while the Knowledge schema lives in the `postgres` database; the runbook's documented command omits `-Databases`, so the operator-facing artifact silently excludes every indexed source, segment and provenance row.
- Evidence: Where: infrastructure/docker/scripts/backup.ps1:7 (`[string[]]$Databases = @("n8n")`) and :80-90 (one `pg_dump … --file=/backup/postgres/$database.dump $database` per entry, followed by a `Test-Path` and size check per entry) · Evidence: infrastructure/docker/compose/compose.core.yml:14 `POSTGRES_DB: postgres` and :145 `KNOWLEDGE_DATABASE_NAME: postgres`; docs/runbooks/knowledge-platform.md:51-56 promises "The retained backup script creates a non-overwriting PostgreSQL/n8n backup only after n8n has been stopped" and prints the command with no `-Databases`; :58 states "Restore automation is not implemented in the current runtime contract." The only Knowledge dump in the repo sits in the acceptance harness (knowledge-t5-live.ps1 `pg_dump --dbname=postgres --schema=knowledge`), not the operator path.
- Reproduction: static — follow the runbook command: the loop iterates once for `n8n` and the resulting manifest lists no `postgres` dump, so the Knowledge schema is absent from the artifact.
- Acceptance criteria: the runbook command produces a manifest containing a Knowledge (`postgres`) dump, or the runbook states explicitly that Knowledge is re-derivable-only and out of backup scope — script and runbook must agree either way.
- Related findings: F-223 (no gate executes these scripts — different cause; this defect survives a gate), F-239 · nguồn: R7 delta audit D3 — infrastructure and operations

### F-239 — `compose.m4-t5.live.yml` carries the only writable host bind and the live privilege block, and no gate parses it

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-D3-02`
- Affected modules: Zink Knowledgebase, Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: every other compose file has a structural contract test, but the live overlay — the one that adds `read_only: false` plus the hardening keys — is referenced only by a manual acceptance script, so boundary drift is caught only when a human runs the live lane.
- Evidence: Where: infrastructure/docker/compose/compose.m4-t5.live.yml:9 (`read_only: false`) — `grep -rn "read_only: false" infrastructure/docker/compose/` matches this single line across all six compose files · Evidence: `grep -rn "m4-t5.live" tests/` returns 0 hits; the only consumers are infrastructure/docker/scripts/knowledge-t5-live.ps1:22 and :38 (`-f $composeFile -f $knowledgeComposeFile -f $liveComposeFile`). Other files are pinned: tests/m5-docker-contract.test.mjs and tests/m3-t5-contract.test.mjs parse compose.core/knowledge/m3-t5, and tests/m12-t2.2-b15-compose-equivalence.test.mjs byte-compares the acceptance overlays. Equivalent assertions exist only inside the live script (`Assert-T5PrivilegeBoundary` in knowledge-t5-common.ps1).
- Reproduction: static — delete `cap_drop: ALL` from the live overlay: `npm run verify` and `npm test` stay green; only a live `knowledge-t5-live.ps1` run notices.
- Acceptance criteria: a verify-lane test parses `compose.m4-t5.live.yml` and asserts the privilege hardening plus that the only writable bind targets the backup-barrier path, never `/vault`.
- Related findings: F-223, F-238 · nguồn: R7 delta audit D3

### F-240 — three remediation assertions can only be reddened by editing a literal, never by breaking the behaviour they claim to cover

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-D6-01`
- Affected modules: Gates + CI, Workflow topology, Zink Skill Store
- Severity: Medium
- Status: OPEN
- Root cause: the assertions compare a value to a literal the test itself writes, or check only a JS type, so no runtime condition can falsify them — and they are the recorded evidence that three remediation items landed.
- Evidence: Where: tests/m12-t2.2-b7-ceiling-single-read.test.mjs:52-56 (`assert.deepEqual(BUDGETS, { maxBriefRevisionsPerTask: 16, … })`) and :63 (`assert.equal(typeof workflow.applyWorkflowEvent, "function")`); tests/m12-t2.3-c9-semantic-report-version.test.mjs:74 (`assert.notEqual(SEMANTIC_CONTRACT_VERSION, "v1")`) · Evidence: :63 passes for any function-valued export; :74 fails only if the version literal is reset to `v1`; :52 mirrors ledger.mjs:39-43 (see F-228), so the ceiling is pinned twice and enforced zero times.
- Reproduction: static — replace `applyWorkflowEvent`'s body with a throw and :63 still passes; set `SEMANTIC_CONTRACT_VERSION` to any string other than `v1` and :74 passes regardless of what the report emits.
- Acceptance criteria: each assertion is driven by a call whose result depends on the behaviour — invoke the reducer and assert the transition, assert the version string actually present in the report row.
- Related findings: F-102 (green contract test pins dead schema), F-224 (failure injected by SQL source text), F-228 · nguồn: R7 delta audit D6 — test fidelity

### F-241 — `infrastructure/networking/networks.yml` is a placeholder whose own premise is already false and which nothing reads

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R7-D7-01`
- Affected modules: chưa có mục sở hữu trong `AGENTS.md` §1 (subtree `infrastructure/`)
- Severity: Low
- Status: OPEN
- Root cause: the file states that shared network definitions "will be added with the Compose implementation", but the Compose implementation already exists and defines its networks inline, so the placeholder was superseded before it was ever populated and no loader references it.
- Evidence: Where: infrastructure/networking/networks.yml — the whole file is one comment line, "# Shared Docker network definitions will be added with the Compose implementation." · Evidence: a repo-wide grep for `networks.yml` and `infrastructure/networking` returns no consumer; compose.core.yml:208-210 declares `networks:` with `driver: bridge` inline, and no compose file under `infrastructure/docker/compose/` uses `external: true`.
- Reproduction: static — the grep proves no code, doc or CI step opens the file, so deleting it changes nothing.
- Acceptance criteria: the file is removed, or it declares a network that a compose file consumes via `external` or a shared name plus a documented step that creates it.
- Related findings: F-217, F-220 (stale and target-tree family) · nguồn: R7 delta audit D7 — orphaned config and ownership

### F-242 — the live tool-call branch is selected by model-supplied parameter shape, and for `zink_excel`/`zink_power_bi` it never consumes the approval those operations require

- Category: F2 — Security & Authorization
- Legacy register id: `R7-D8-01`
- Affected modules: Zink Tools, OpenClaw governance plugin (Discord)
- Severity: High
- Status: OPEN
- Root cause: which authorization path runs is chosen from the shape of the model's own parameters, and only the n8n sub-branch was given the M7-006 delegation+approval re-entry. The excel branch validates the file path and returns allow, so an operation the policy marks `requiresApproval: true` executes without an approval record, without a delegation binding and without an `AuthorizationDecisionContext`.
- Evidence: Where: integrations/openclaw/plugins/zink-governance/index.mjs:6327-6348 (`const isSynthetic = Boolean(event.params?.call_id && event.params?.specialist && event.params?.tool_id && event.params?.input);` → only this branch calls `guard.beforeToolCall`), :6350-6360 ("Live OpenClaw agent tool call" → `evaluateToolAccess(context.agentId, event.toolName)` — note `params` defaults to `{}` at :3066), :6365-6381 (the `zink_excel` branch performs path validation only; :6382-6401 is the `zink_sql` sibling), :6607 (`return { allow: true };`) · Evidence: the fix exists for the sibling tool only — :6402-6406 comment "M7-006: the live n8n path uses the SAME canonical registry, delegation scope and approval binding as the guarded path. The live branch previously performed none of them", then :6509-6534 `bindInvocationApproval` and :6543 `guard.beforeToolCall`. Policy declares the requirement: integrations/openclaw/lib/policy.mjs:1648-1653 (`zink_excel: "delegated"`) and :1661-1672 (`populate`/`generate` → `requiresApproval: true`).
- Reproduction: static — an agent with static capability calls `zink_excel` `{operation:"populate", file_path:…}` with no `call_id` → live branch → path check passes → `allow:true` → `executeExcelOperation` writes the workbook. No approval is read, so nothing can be recorded or replayed-checked. A red test asserts that a `requiresApproval` operation executed with no consumed approval is refused.
- Acceptance criteria: a tool whose `AUTHORIZATION_MODE_BY_TOOL` entry is `delegated` is refused at the live seam unless `guard.beforeToolCall` produced the decision context; the synthetic/live fork is no longer decided by model-supplied fields.
- Related findings: F-023, F-025, F-037, F-051 · nguồn: R7 delta audit D8 — adversarial authorization review

### F-243 — no production code ever mints a tool-invocation approval record, so `bindInvocationApproval` is an inert control that only tests can satisfy

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-D8-02`
- Affected modules: Zink Tools, OpenClaw governance plugin (Discord)
- Severity: High
- Status: OPEN
- Root cause: the approval resolver reads four stores and nothing in the shipped code writes any of them; the only writers are test fixtures that create the file themselves. The control therefore has no production-reachable pass path, and its failure path (every governed call denied) is the only real behaviour — which is exactly why the ungoverned live branch in F-242 is the effective policy.
- Evidence: Where: integrations/openclaw/topology/lib/guard.mjs:507 (`const memKey = Symbol.for("zink.governance.approvals");` — the only occurrence in `integrations/`), :558 (`path.join(paths.root, "approvals.json")`), :660 (`consumed-approvals.json`) · Evidence: a repo-wide grep for writers of those stores returns only tests/m11-t3-durable-state-integrity.test.mjs:507 and tests/m7-lane-c-queue.test.mjs:198, i.e. tests fabricate the file the guard reads.
- Reproduction: static — any `requiresApproval:true` call resolved through the guard fails `AUTH_APPROVAL_REQUIRED`/`AUTH_APPROVAL_INVALID` for every `approvalId`, because no durable record can exist; a mutation probe that adds a writer must make the same call pass.
- Acceptance criteria: a durable minter produces one consumable record per surfaced approval card, and a test proves `AUTH_APPROVAL_REPLAYED` fires on the second consume.
- Related findings: F-242, F-030, F-032 · nguồn: R7 delta audit D8

### F-244 — the free-text approval ingress fabricates the channel and actor it then validates, so "approval must occur in #approvals" can never fail

- Category: F2 — Security & Authorization
- Legacy register id: `R7-D8-03`
- Affected modules: Zink Tools, OpenClaw governance plugin (Discord)
- Severity: High
- Status: OPEN
- Root cause: the handler is called with constants derived from the action word rather than from the inbound event, and no guild/channel/thread check is performed on the free-text path. The authority rule that follows compares the event against the value the caller invented, and the durable event records that invented channel.
- Evidence: Where: integrations/openclaw/plugins/zink-governance/index.mjs:8641-8652 (`const isResult = normAction === ACTIONS.ACCEPT_RESULT; const targetChannel = isResult ? "results" : "approvals";` then `handleDiscordAction({ actor: "user", channel: targetChannel, … })`) · Evidence: the only gate on this path is the owner-id equality at :8590, with task correlation by substring at :8609 (`content.includes(taskId)`); `validateActionAuthority` receives no sender id (integrations/openclaw/lib/authority.mjs:217-245).
- Reproduction: static — the owner typing `APPROVE <task>` in a bot DM or any other channel is admitted and journalled as `channel:"approvals"`; `executeApprovedTask` then fires. A red test asserts that a verdict observed outside the recorded approval surface is denied and writes no event.
- Acceptance criteria: channel, guild and thread come from the inbound event and are denied unless they equal the recorded approval surface; the ledger can no longer assert a channel that was never observed.
- Related findings: F-043 (button path's missing thread check — same rule, different mechanism), F-030, F-032 · nguồn: R7 delta audit D8

### F-245 — `bindInvocationApproval` drops the owner-principal equality check whenever the task carries no principal reference

- Category: F2 — Security & Authorization
- Legacy register id: `R7-D8-04`
- Affected modules: Zink Tools
- Severity: Medium
- Status: LATENT
- Root cause: the principal assertion is wrapped in `if (originPrincipalRef)`, and the caller derives that value from a three-deep fallback chain, so an absent reference silently removes the "who approved this" binding while every other check still passes.
- Evidence: Where: integrations/openclaw/topology/lib/guard.mjs:355-361 (`const record = resolveAuthenticatedApproval(…); if (!record …) fail("AUTH_APPROVAL_INVALID"); if (originPrincipalRef) { assert(record.owner_principal_ref === originPrincipalRef, …`) · Evidence: the caller's value is `owner.task?.origin_principal_ref ?? owner.task?.origin?.origin_principal_ref ?? owner.task?.root_principal_ref` (plugins/zink-governance/index.mjs:6516-6519).
- Reproduction: static — a task snapshot lacking all three fields plus any structurally valid approval record for that task is consumed for any principal. LATENT because no minter exists yet (F-243); it becomes reachable the moment one does.
- Acceptance criteria: the equality assert is unconditional and a task without a resolvable principal reference fails `AUTH_APPROVAL_INVALID`.
- Related findings: F-243, F-023, F-031 · nguồn: R7 delta audit D8

### F-247 — `task.accepted_reference_digests` is declared and read but has no writer, so any delegation carrying `input_refs` is refused forever

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R7-D11B-01`
- Affected modules: Zink Tools, Zink Knowledgebase (provenance duty)
- Severity: High
- Status: OPEN
- Root cause: the guard requires every handoff reference to match a canonical digest stored on the task projection, but no event type carries reference digests and no reducer branch writes that slot, so the comparison is always `undefined === <hex>`.
- Evidence: Where: integrations/openclaw/topology/lib/guard.mjs:1487-1492 (`assert(task.accepted_reference_digests?.[ref.ref_id] === canonicalHash("zink-reference-v1", ref), "REFERENCE_INVALID")`) · Evidence: the slot is declared at topology/contracts/ledger-snapshot.schema.json:501-508 and a repo-wide grep for `accepted_reference_digests` returns exactly those two places plus the schema — no writer in `workflow.mjs`, none in `tests/`, none in `docs/`.
- Reproduction: static — a proposal carrying one governed reference (populated from the model proposal at index.mjs:7140) reaches guard.mjs:1489 and fails `REFERENCE_INVALID`; no committed state can satisfy it.
- Acceptance criteria: an event type plus a reducer write populate the slot, and a test commits a reference-bearing handoff, reads it back, and asserts both the pass and the REFERENCE_INVALID case.
- Related findings: F-071, F-144, F-248 · nguồn: R7 delta audit D11B — event contract vs reducer

### F-248 — a result recorded without a payload digest wedges the task in `RESULT_PENDING_REVIEW`: every owner verdict demands a digest that was never stored

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R7-D11B-02`
- Affected modules: Zink Tools (workflow topology)
- Severity: High
- Status: LATENT
- Root cause: the event contract makes `payload_digest` optional and the reducer stores it only when present, while every verdict path begins by requiring that stored digest to be a string. The task has no exit except cancellation, and the failure looks like an owner decision problem rather than a missing field.
- Evidence: Where: integrations/openclaw/topology/lib/workflow.mjs:1207-1210 (`task.workflow_status = "RESULT_PENDING_REVIEW"; … if (payload.payload_digest) task.execution_payload_digest = payload.payload_digest;`) vs :1580-1583 (`const currentDigest = task.root_result?.payload_digest ?? task.execution_payload_digest; requireCondition(typeof currentDigest === "string", "RESULT_MISMATCH");`) · Evidence: the comment at :1584-1587 records that a previous null-versus-undefined bug "made EVERY verdict fail and wedged the task in review" — the same wedge remains for the absent-digest case.
- Reproduction: static — contract-legal but not reachable from the current emitter, so the row stays `LATENT`: `index.mjs:2424-2428` always names the key, and when it computes `payloadDigest = null` (no artifact set and no artifact file, :2313-2319) the append is rejected outright by `validateContract("ledger-event", …)` at `topology/lib/ledger.mjs:543` — verified by handing a synthetic event with a null `payload_digest` to that validator, which throws `SCHEMA_INVALID: SCHEMA_VALIDATION_FAILED`. The live digest-less case is F-077's; the absent-key wedge here fires only for a new emitter or a hand-written event. `WORKFLOW_RESULT_RECORDED {task_id}` with no digest from EXECUTING leaves the status set and no digest; ACCEPT, REJECT, BLOCK and REQUEST_REVISION all throw `RESULT_MISMATCH`, and APPROVAL_DECIDED refuses the status.
- Acceptance criteria: either `payload_digest` is required in that contract branch, or verdict binding tolerates an unbound result; a test drives ACCEPT after a digest-less record.
- Related findings: successor to F-077 (that row records the wedge, this one names the mechanism), F-226, F-113, F-249 · nguồn: R7 delta audit D11B

### F-249 — the verdict binds `result_id` against a field the contract forbids, so id-only verdicts always fail

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R7-D11B-03`
- Affected modules: Zink Tools (workflow topology)
- Severity: Medium
- Status: OPEN
- Root cause: verdicts may carry `result_id` and the reducer compares it against `task.root_result.result_id`, but `root_result` is stored as `{...payload}` under a closed contract that declares no `result_id`, so the compared value can never exist.
- Evidence: Where: integrations/openclaw/topology/lib/workflow.mjs:1601-1606 (`if (payload.result_id === undefined) fail("RESULT_MISMATCH"); requireCondition(task.root_result?.result_id !== undefined && payload.result_id === task.root_result.result_id, "RESULT_MISMATCH")`) · Evidence: `$defs.root_result` in topology/contracts/ledger-event.schema.json declares exactly `task_id, brief_revision, native_run_id, agent_id, payload_digest, outcome_status, reason_code, governance_hash, pending_outcome_status` with `"additionalProperties": false` (read programmatically from the file).
- Reproduction: static — a verdict carrying `result_id` and no `result_digest` reaches :1602 and fails in strict mode; :1600 returns early for anchored replay, so only new strict-mode verdicts are affected.
- Acceptance criteria: `result_id` is declared in the root-result contract and written by a reducer branch, or the owner declares id-only verdicts unsupported and the branch is withdrawn together with the contract field that admits them; a test drives the id-only verdict either way.
- Related findings: F-248, F-108 · nguồn: R7 delta audit D11B

### F-250 — the event contract accepts artifact objects the snapshot contract rejects, and the event is fsynced before the projection is validated

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R7-D11B-04`
- Affected modules: Zink Tools (workflow topology), Gates + CI
- Severity: High
- Status: OPEN
- Root cause: `artifacts.items` in the event contract is an unconstrained object, the reducer copies items verbatim, and the append-to-journal happens before the resulting snapshot is validated. A result whose artifact item lacks `sha256` therefore becomes durable history that the next read cannot project, which the ledger reports as corruption.
- Evidence: Where: topology/contracts/ledger-event.schema.json — `"artifacts": { "type": ["array","null"], "maxItems": 10, "items": { "type": "object" } }` vs ledger-snapshot.schema.json `"result_artifacts": { … "items": { "type":"object", "additionalProperties": false, "required": ["logical_path","sha256"], … } }` (both quoted from the files) · Evidence: workflow.mjs:1187-1204 checks only "is an array, length <= 10" and `task.result_artifacts = payload.artifacts.map(a => ({...a}))`; the set digest at :1192-1197 hashes `logical_path`/`sha256` pairs, so a missing `sha256` still matches itself; topology/lib/ledger.mjs:543-552 validates the incoming event and pre-image snapshot, then `appendFileSync` + `fsyncSync`, and only :559 `writeSnapshotAtomic(paths, next)` validates the projection.
- Reproduction: static — `WORKFLOW_RESULT_RECORDED` with `artifacts:[{logical_path:"a"}]` and a self-consistent `artifact_set_digest` → the event line is durable → snapshot write fails schema validation → the next read meets an unprojectable tail and raises ledger corruption / `EXECUTION_STATE_UNKNOWN`.
- Acceptance criteria: the event contract declares the artifact item shape identically to the snapshot, or the projection is validated before the append; a test asserts no event becomes durable ahead of a validatable snapshot.
- Related findings: F-143, F-063, F-248 · nguồn: R7 delta audit D11B

### F-251 — the reason-code reader consults only two of the three matrix sections, and the reducer's suspension write consults none

- Category: F1 — Logic & Functional Bugs
- Legacy register id: `R7-D11B-05`
- Affected modules: Workflow topology + ledger
- Severity: Low
- Status: OPEN
- Root cause: `isDeclaredReasonCode` is built from the agent-claim and runtime-reason lists only, so the matrix's third vocabulary section is invisible to every check; and the suspension path assigns `task.reason_code` directly without calling the check at all, unlike its sibling verdict. A declared code can therefore reach durable state through a route no validator covers, and a rename of the matrix section would not be noticed.
- Evidence: Where: integrations/openclaw/topology/lib/runtime.mjs:70-75 (`AGENT_REASON_CODES.includes(code) || RUNTIME_REASON_CODES.includes(code)`) · Evidence: topology/policy/reason-code-matrix.json carries a third vocabulary section, and read programmatically it is exactly `task_suspension_reasons = ["BLOCKED","DUPLICATE_RESULT_CONFLICT"]`; a repo-wide grep finds no reader for it (only `agent_claims` and `runtime_reasons` are consumed); workflow.mjs:469 assigns `task.reason_code = "BLOCKED"` with no check while :697 demands `isDeclaredReasonCode` for the sibling `WORKFLOW_USER_RESULT_BLOCKED` path; ledger-snapshot.schema.json types reason_code as a free string (maxLength 128), so nothing downstream notices.
- Reproduction: static — `WORKFLOW_NATIVE_ENDED` with an error outcome yields `task.reason_code === "BLOCKED"` and `isDeclaredReasonCode("BLOCKED") === false` even though the code is declared in the matrix. A red test asserts the validator covers every declared section and that every durable reason passes it.
- Acceptance criteria: `isDeclaredReasonCode` reads all matrix sections, every `task.reason_code` write is checked against it, and a test asserts each declared suspension reason is reachable or removed.
- Related findings: F-127, F-229 · nguồn: R7 delta audit D11B — event contract vs reducer

### F-252 — three canonical contracts are hash-pinned but never applied, and a contract edit reports no version change

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R7-D11B-06`
- Affected modules: Zink Tools (workflow topology), Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: `incident`, `result` and `governance-manifest` appear only in the canonical list that pins hashes; no code or test names them in a validation call. Separately none of the twelve topology contracts declares the version key the manifest reads, so all twelve report the same version forever while only the checksum moves.
- Evidence: Where: integrations/openclaw/topology/lib/schema.mjs:22-35 (`CANONICAL_CONTRACTS`) and :371-387 (`generateSchemaManifest` reading `x-zink-contract-version` then falling back to `"1.0.0"`) · Evidence: a grep for `validateContract("incident"|"result"|"governance-manifest")` across the repo returns 0 hits; `canonical.mjs:12` sets `SCHEMA_VERSION = "1.0.0"`, pinned as a const in both ledger contracts.
- Reproduction: static — edit `ledger-event.schema.json`: the next read re-governs all history under new bytes with the same reported version, failing closed as `EXECUTION_STATE_UNKNOWN` (ledger.mjs validates before the version check) and indistinguishable from corruption.
- Acceptance criteria: every canonical contract has a named validation call site or the owner declares the contract non-canonical and it leaves the pinned list together with the schema file; each topology contract carries its own version key; a deploy or boot gate calls `verifySchemaManifestChecksums`.
- Related findings: F-022, F-065, F-250 · nguồn: R7 delta audit D11B

### F-253 — cancelling an index run leaves a permanent `RUNNING` row, and the unique-running constraint turns that into a self-block reported as a database outage

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R7-D10A-01`
- Affected modules: Zink Knowledgebase
- Severity: High
- Status: OPEN
- Root cause: the lifecycle records a terminal state only inside `except LifecycleError` and `except Exception`, but the owner-connection termination handler cancels the task, and `asyncio.CancelledError` derives from `BaseException`. The only writer of `INTERRUPTED` runs at startup, so within the same process the row stays `RUNNING` and the one-running partial index blocks every later run.
- Evidence: Where: apps/knowledge/app/index_lifecycle.py:360-372 (`except LifecycleError as error:` … `except Exception:` → `self._fail(run, "INDEXING_UNEXPECTED_FAILURE", …)`; no `BaseException` arm) · Evidence: apps/knowledge/app/index_runner.py:107-114 (`def on_termination(_): … current_task.cancel()`) and :119-125 (the `finally` releases the lock and unbinds the connection but never marks the run); apps/knowledge/migrations/001_initial.sql:63-65 (`CREATE UNIQUE INDEX … knowledge_index_runs_one_running_idx … WHERE status = 'RUNNING';`)
- Reproduction: static — owner connection terminates → task cancelled → `CancelledError` escapes `execute()` → row still `RUNNING`; the next `POST /v1/index-runs` INSERT violates the partial unique index, and the `PostgresError` surfaces as a 503 `DATABASE_UNAVAILABLE` until the process restarts.
- Acceptance criteria: after cancelling a run mid-flight, `SELECT count(*) FROM knowledge.index_runs WHERE status='RUNNING'` is 0 within the same process and a subsequent run request returns 202.
- Related findings: F-164, F-017, F-101 · nguồn: R7 delta audit D10A — Knowledgebase persistence

### F-254 — `acquire_advisory_lock` leaks a pooled connection whenever the lock query raises, and four leaks make the whole service report a database outage

- Category: F6 — Reliability & Performance
- Legacy register id: `R7-D10A-02`
- Affected modules: Zink Knowledgebase
- Severity: High
- Status: OPEN
- Root cause: the connection is acquired before any `try`, and only the negative lock result releases it. Any error from the lock query (a dead backend handed out by the pool, a server restart, a statement timeout) leaves the connection checked out forever.
- Evidence: Where: apps/knowledge/app/database.py:1567-1574 — `connection = await self._pool.acquire()` / `if await connection.fetchval("SELECT pg_try_advisory_lock($1)", lock_key): return connection` / `await self._pool.release(connection)` / `return None`; no `except` and no `finally` · Evidence: the pool is created with a small `max_size` (database.py around :188-190), and callers are index_runner.py:38 and the reservation path, so the leak is per run attempt.
- Reproduction: static — one failed reservation per dead connection; once the pool is exhausted every `pool.acquire()` (including search) blocks until the pool timeout and returns 503 `DATABASE_UNAVAILABLE`, with no restart-free recovery.
- Acceptance criteria: a fake pool whose `fetchval` raises shows `pool.release` called exactly once, and N failed reservations leave the pool's idle count unchanged.
- Related findings: F-165, F-253 · nguồn: R7 delta audit D10A

### F-255 — mutation transactions resolve the owner connection from a mutable global slot, so a stale run can write inside a newer session's ownership

- Category: F6 — Reliability & Performance
- Legacy register id: `R7-D10A-03`
- Affected modules: Zink Knowledgebase
- Severity: Medium
- Status: OPEN
- Root cause: every lifecycle mutation reads `self._owner_connection` at call time instead of using the connection the run was scheduled with, and the liveness check tests whoever currently holds the slot. The unbind path is identity-guarded, which shows the aliasing is known, but the write path is not.
- Evidence: Where: apps/knowledge/app/database.py:373-381 (`connection = self._owner_connection` … `if connection.is_closed(): raise StateTransitionError("Index ownership connection was lost.")` … `async with connection.transaction():`) · Evidence: index_runner.py:100-102 receives `connection` as a parameter and uses it only for the listener and for `unbind_owner_connection(connection)` at :122.
- Reproduction: static — session A dies (PostgreSQL auto-releases its advisory lock), session B reserves and binds a new connection, and A's still-scheduled run calls a mutation: `is_closed()` checks B's live connection, so A opens a transaction on B's session and interleaves with B's writes.
- Acceptance criteria: a run whose bound owner no longer equals `self._owner_connection` raises before executing any statement, proved by a test with two overlapping owner generations.
- Related findings: F-254, F-253, F-002 (different store, same "live in-memory slot used as authority" shape) · nguồn: R7 delta audit D10A

### F-257 — the PDF publish path inserts one statement per segment while its markdown sibling uses `executemany`, so a large build aborts inside its own transaction

- Category: F6 — Reliability & Performance
- Legacy register id: `R7-D10A-05`
- Affected modules: Zink Knowledgebase
- Severity: Medium
- Status: OPEN
- Root cause: the PDF path loops `await connection.execute(INSERT INTO knowledge.segments …)` per segment inside the publish transaction, whereas the markdown path and three other bulk sites already use a single prepared `executemany`. Round trips scale with segment count and consume the command timeout budget of the enclosing transaction.
- Evidence: Where: apps/knowledge/app/database.py:1275-1281 (`for segment, embedding in zip(segments, embeddings, strict=True): … await connection.execute("""INSERT INTO knowledge.segments (`) · Evidence: the same file uses `await connection.executemany(` at :473, :669 and :1198, the last being the markdown sibling the comment records as "one prepared statement for the whole document".
- Reproduction: static — a build whose segment count needs more round trips than the command timeout allows aborts `replace_pdf_source`, so incremental runs take `DOCUMENT_INDEXING_FAILED` while the READY build and its extracted text remain on disk.
- Acceptance criteria: the PDF publish uses one batched statement and a paged read for publication segments, asserted by a synthetic large-build test that completes under the timeout.
- Related findings: F-092 (unbatched bulk delete, same class different site), F-093, F-175 · nguồn: R7 delta audit D10A

### F-258 — artifact "validation" is extension plus size plus substring: the excel branch checks nothing structural and the ZIP helper is not a ZIP parser

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R7-D11A-01`
- Affected modules: Zink Tools, OpenClaw governance plugin (Discord)
- Severity: High
- Status: OPEN
- Root cause: the type comes from the file extension, then the excel branch fails only files under 100 bytes, and the helper named `inspectZipContainsEntries` reads the whole file as latin1 and does `str.includes(keyword)`, so a keyword appearing anywhere in arbitrary payload bytes counts as a container entry. A garbage file with the right name therefore reaches a PASS verdict and feeds the governed result card and artifact digest.
- Evidence: Where: integrations/openclaw/lib/artifact-validator.mjs:565-573 (`} else if (inferredType === "excel") { result.checks.format = "EXCEL"; if (fileSizeBytes < 100) { … CORRUPT_EXCEL … } }` — no magic-byte, entry or sheet check) and :112-121 (`// J02 & J03: Inspect ZIP central directory / local headers …` then `const str = buf.toString("latin1"); return requiredKeywords.some((kw) => str.includes(kw));`) · Evidence: the type decision is `deriveType` at :293-324 (extension-driven), and the validation status is consumed by `evaluateResultGate` which the formatter renders into the #results card.
- Reproduction: static — a 200-byte text file named `report.xlsx` returns `status: PASS` with readability and hash true; so does a truncated real workbook. A red test feeds a truncated `.xlsx` and asserts FAIL.
- Acceptance criteria: the office/document branches parse the container (central directory plus required entry names, `xl/worksheets/*` and `[Content_Types].xml` for xlsx) and truncated or garbage inputs FAIL.
- Related findings: F-126, F-144, F-259 · nguồn: R7 delta audit D11A — artifact validator and rendering surfaces

### F-259 — the result card sanitizes every sibling field but emits `preview` raw, so untrusted file bytes reach Discord unredacted

- Category: F2 — Security & Authorization
- Legacy register id: `R7-D11A-02`
- Affected modules: Zink Tools, OpenClaw governance plugin (Discord)
- Severity: High
- Status: OPEN
- Root cause: the formatter's own contract is to redact paths, secrets and mentions, and it does so for artifact, findings and header fields — but the preview block is interpolated straight from the validator, where it is the file's own lines, with no sanitisation and no message-length ceiling on this renderer.
- Evidence: Where: integrations/openclaw/lib/discord-formatter.mjs:880-891 (`sanitizeDiscordIdentifier` for task/status/validation, `sanitizeDiscordText` for `keyFindings` and `artifact`) vs :924 (`preview || "*(Không có dữ liệu trích xuất)*",` — raw) · Evidence: `preview` is `gateResult.preview.previewText`, produced by artifact-validator from the file's own content, and the card is returned as `resultCard` at plugins/zink-governance/index.mjs:2405/2475.
- Reproduction: static — an artifact whose CSV/SQL/markdown bytes contain a Windows path or a token appear verbatim on the #results card; large row sets exceed the 2000-character message ceiling because no chunking is applied on this path.
- Acceptance criteria: the preview passes through `sanitizeDiscordText` and the assembled card is chunked/capped before send, with a test asserting a path/secret in file bytes never appears in the card.
- Related findings: F-064 (upstream bytes as adapter message), F-258 · nguồn: R7 delta audit D11A

### F-260 — a directory-fsync failure after a committed rename rolls the in-memory ledger back, so the next successful save erases the owner's decision

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R7-D11A-03`
- Affected modules: Zink Tools (decision ledger)
- Severity: Medium
- Status: OPEN
- Root cause: `save()` fsyncs the parent directory inside the same try as the rename and rethrows any error the platform tolerates do not; the caller's catch then restores the pre-write in-memory state, which is now behind a disk that already holds the record. A later successful save serialises the stale map over it.
- Evidence: Where: integrations/openclaw/lib/decision-ledger.mjs:287-293 (write temp, `fsyncSync(fd)`, `renameSync(tempPath, this.storagePath)`) then :302-316 (open dir, `fsyncSync(directoryFd)`, `catch (error) { if (process.platform !== "win32" || !/^(EPERM|EISDIR|EINVAL|ENOTSUP)$/u.test(error?.code ?? "")) { throw error; } }`) · Evidence: the caller rollback at :440-447 (`this.decisions.set(id, record); try { this.save(); } catch (err) { this.decisions.delete(id); if (existing) this.decisions.set(id, existing); throw err; }`) — the same shape the queue's `_mutateWithRollback` uses (queue-manager.mjs:505-520), while the enqueue/claim paths reload from disk on failure.
- Reproduction: static — inject an fsync error after a successful rename: the owner sees `LEDGER_WRITE_FAILED`, memory drops the decision, the disk keeps it, and the next `save()` deletes it. This is the inverse of "recorded when the write failed".
- Acceptance criteria: a post-rename durability error is classified as committed-uncertain and the writer reloads from disk (as the queue's claim path already does) instead of restoring the snapshot; a test injects the error and asserts the record survives and memory equals disk.
- Related findings: F-002, F-154, F-056, F-061 · nguồn: R7 delta audit D11A

### F-261 — a stale git worktree inside `scratch/` carries its own AGENTS.md and PLAN.md that assert owner-level authority, and every gate excludes it

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R7-D12B-01`
- Affected modules: governance records, repository hygiene
- Severity: High
- Status: OPEN
- Root cause: an earlier agent session left a registered worktree five days behind HEAD inside the gitignored `scratch/`; `git ls-files`, `repo:check`, prettier, eslint and markdownlint all skip it, yet its documents declare themselves the durable source of truth, so a cold resume that globs for PLAN.md or AGENTS.md can read a second, contradictory authority.
- Evidence: Where: `git worktree list` returns the primary plus `…/personal-tool/scratch/wt-discord-idle-reset  f94c858 [codex/discord-idle-session-reset]` · Evidence: that tree's `PLAN.md` states "`PLAN.md` is the durable source of truth for milestone/task lifecycle state" and its `.git` file contains `gitdir: C:/…/.git/worktrees/wt-discord-idle-reset`; HEAD here is `6e601ae`/`ea3eaa1`, so the copy is stale. Correction to the audit note: that worktree holds no `findings.md` — the register post-dates the branch.
- Reproduction: static — from the repo root, glob `**/PLAN.md` without gitignore awareness and two authority documents with different task states are returned.
- Acceptance criteria: no registered worktree under the repo root other than the primary, or a gate asserting `git worktree list` has exactly one entry; the audit charter's "working tree is authoritative" rule is enforced mechanically.
- Related findings: F-038 (same directory, token-in-script cause), F-097 (worktree loss), F-191 · nguồn: R7 delta audit D12B — repo tooling reach

### F-262 — no tracked lane parses `compose.m4-t5.live.yml`; the operator script that hands it to Docker is its only reader

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-D12B-02`
- Affected modules: Gates + CI, deployment topology
- Severity: Low
- Status: OPEN
- Root cause: the live acceptance overlay is the one compose file in the tree that no test or repository gate opens, so a syntactically invalid edit to it is first reported by the live Docker host, in the lane that is already `NOT TESTED`.
- Evidence: Where: `infrastructure/docker/scripts/knowledge-t5-live.ps1:22` builds the path and `:38` passes it to `docker compose` — a repo-wide grep of `tests/`, `scripts/`, `.github/` and `docs/runbooks/` returns no other reader · Evidence: the siblings are covered, which is why this row was narrowed after the D9 challenge: `tests/m3-t1-contract.test.mjs:59-64` and `tests/m5-docker-contract.test.mjs:27-34` YAML-parse `compose.core.yml` with `parseDocument`, `tests/m5-docker-contract.test.mjs:34` parses `compose.knowledge.yml`, `tests/m12-t2.2-b15-compose-equivalence.test.mjs:33` pins the two other acceptance files byte-identical, `tests/m8-t2.3-blocked-verdict.test.mjs:20` imports `state-transitions.json` as a JSON module, and `integrations/openclaw/topology/lib/runtime.mjs:35-41` fails closed on a malformed `reason-code-matrix.json`.
- Reproduction: static — the first draft of this row claimed High and that nothing in the gate set parses the behaviour-bearing YAML/JSON artifacts; both halves were refuted by the locators above, and its own reproduction (corrupt `compose.core.yml`, `npm run verify` stays green) does not reproduce: that file is parsed by two tracked suites. What does reproduce is the narrower claim: corrupt `compose.m4-t5.live.yml` into invalid YAML and no lane in `npm run verify` opens it.
- Acceptance criteria: a tracked lane validates `compose.m4-t5.live.yml` the way the siblings are validated (parse-and-assert, or a gate that YAML-parses every tracked compose file), or the owner records in `PLAN.md` §3 that this file is deliberately gated only by the live run; deleting the overlay or dropping the sibling assertions is not an acceptable fix.
- Related findings: F-134, F-148, F-239, F-223 · nguồn: R7 delta audit D12B, rewritten by the D9 challenge

### F-263 — each `/v1/search` pays three provider round-trips because identity verification resolves the model with a real embedding call, twice

- Category: F6 — Reliability & Performance
- Legacy register id: `R7-D10B-01`
- Affected modules: Zink Knowledgebase
- Severity: Medium
- Status: OPEN
- Root cause: `require_identity` is implemented by calling `model_probe.resolve`, and `resolve` always issues `/api/tags` plus an actual `/api/embed` preflight to learn the dimensions. The search handler calls it before and after the query embedding, so one query costs two tags calls and three embed calls.
- Evidence: Where: apps/knowledge/app/main.py:382 (`await lifecycle.require_identity(active_index)`), :383 (`query_embedding = await model_probe.embed(…)`), :387 (`await lifecycle.require_identity(active_index)` — the comment records it as an intentional drift check) · Evidence: apps/knowledge/app/index_lifecycle.py:103-109 (`actual = await self._model_probe.resolve(…)`) and model_probe.py `resolve` issuing the embedding preflight purely to derive dimensions.
- Reproduction: static — one `/v1/search` request reaches main.py:382 → :383 → :387, and each 382/387 performs a full resolve including an embed round trip; provider latency and cost are paid three times per query.
- Acceptance criteria: a search performs at most two model calls (identity check without a redundant embedding, or a cached dimensions probe), asserted by a provider-call-count stub.
- Related findings: F-165 (90 s slot arithmetic on the same path), F-190 · nguồn: R7 delta audit D10B — service and model runtime

### F-264 — the n8n Postgres role password is passed on the `psql` command line, where it is visible in the process list

- Category: F2 — Security & Authorization
- Legacy register id: `R7-D13-01`
- Affected modules: deployment topology (infrastructure), external automation host
- Severity: Low
- Status: OPEN
- Root cause: the bootstrap script expands the secret into a psql `--set` argument, so the value appears in argv and `/proc/*/cmdline` for the duration of the call, unlike the env-based `PGPASSWORD` pattern the compose file already uses.
- Evidence: Where: infrastructure/docker/scripts/bootstrap-postgres.sh:10 (`psql --set=ON_ERROR_STOP=1 --set=n8n_password="$N8N_POSTGRES_PASSWORD" <<'SQL'`) with the role password consumed by the following `ALTER ROLE … PASSWORD :'n8n_password'` · Evidence: the value class is the n8n PostgreSQL role password; compose.core.yml:44 shows the env-based alternative already in use in this stack. (Value never quoted.)
- Reproduction: static — the literal reaches argv at :10; any process observer inside the container during bootstrap reads it.
- Acceptance criteria: the secret is passed only via `PGPASSWORD` or a file with mode 0600, never via argv.
- Related findings: F-265, F-064 · nguồn: R7 delta audit D13 — infrastructure scripts

### F-265 — the backup manifest asserts `secrets_included = $false` as a constant over an archive it never inspects

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R7-D13-02`
- Affected modules: deployment topology, external automation host
- Severity: Medium
- Status: OPEN
- Root cause: the manifest field is a literal, while the payload is a full `pg_dump` of the automation database (which contains its credential table) plus a tar of the home directory excluding only `config`. The console line hedges to "plaintext"; the machine-readable field does not, so any consumer trusting it is wrong.
- Evidence: Where: infrastructure/docker/scripts/backup.ps1:113 (`secrets_included = $false`) · Evidence: :84-85 dumps the whole database (`--format=custom`) and :95 excludes only the `config` path from the tar; the Knowledge database is not dumped at all (F-238, different cause).
- Reproduction: static — dump any populated automation DB: the manifest records `secrets_included=false` regardless of the credential rows inside it.
- Acceptance criteria: the field is renamed to what is actually known (e.g. `plaintext_secrets_excluded`) and computed by inspecting the archive, or an inspection step proves no credential-bearing object is present.
- Related findings: F-238, F-264, F-064 · nguồn: R7 delta audit D13

### F-266 — preflight validates an embedding model variable that no runtime component consumes

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-D13-03`
- Affected modules: Zink Knowledgebase, deployment topology
- Severity: Medium
- Status: OPEN
- Root cause: the preflight requires and probes `OLLAMA_SMOKE_MODEL`, while the service reads `KNOWLEDGE_EMBEDDING_MODEL`; the two are independent variables with no equality check, and the shipped env example sets both to the same string, so drift is invisible until an operator changes one.
- Evidence: Where: infrastructure/docker/scripts/preflight.ps1:22 (`$requiredVariables += @("KNOWLEDGE_VAULT_ROOT", "OLLAMA_SMOKE_MODEL")`) and :82 (`Where-Object { $_.name -eq $values.OLLAMA_SMOKE_MODEL }`) · Evidence: infrastructure/docker/compose/compose.core.yml:150 (`KNOWLEDGE_EMBEDDING_MODEL: ${KNOWLEDGE_EMBEDDING_MODEL:-bge-m3:latest}`) and apps/knowledge/app/config.py:50 (same variable read by the service).
- Reproduction: static — set `KNOWLEDGE_EMBEDDING_MODEL` to an uninstalled tag and leave `OLLAMA_SMOKE_MODEL` valid: preflight prints success, then knowledge readiness fails at index/embed time.
- Acceptance criteria: preflight asserts the model the runtime will actually use (or refuses when the two variables differ), with the check visible in its output.
- Related findings: F-070, F-239 · nguồn: R7 delta audit D13

### F-267 — the memory acceptance gate compares against a hardcoded 80% of 4 GiB without reading the container's real ceiling

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-D13-04`
- Affected modules: Zink Knowledgebase, Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: the t4 gate throws when cgroup peak reaches the literal 3435973837 bytes, assuming a 4 GiB limit; the sibling t5 harness does read and assert `HostConfig.Memory == 4294967296`. An overlay that lowers the limit therefore makes the gate unreachably lenient while the run still reports PASS.
- Evidence: Where: infrastructure/docker/scripts/knowledge-t4.ps1:116 (`if ($peak -ge 3435973837) { throw "Knowledge cgroup peak memory exceeded 80% of its 4 GiB ceiling: $peak bytes." }`) · Evidence: knowledge-t5-common.ps1:446-448 reads `{{.HostConfig.Memory}}` and throws unless it equals 4294967296, and :364 records `knowledge_memory_limit_bytes = 4294967296` — the same invariant asserted two ways in one script family.
- Reproduction: static — set the knowledge service `mem_limit: 1g` in an overlay and t4's peak gate can never trip; the acceptance still passes while proving nothing about the real ceiling.
- Acceptance criteria: the gate reads the configured limit before applying the percentage and fails when the limit differs from the documented ceiling.
- Related findings: F-202 (systemd MemoryMax sibling), F-239 · nguồn: R7 delta audit D13

### F-268 — the live acceptance restore container escapes the label sweeper and its removal exit code is unchecked, so a leak still reports PASS

- Category: F6 — Reliability & Performance
- Legacy register id: `R7-D13-05`
- Affected modules: Zink Knowledgebase, deployment topology
- Severity: Medium
- Status: OPEN
- Root cause: the sweeper selects containers by three labels, and the restore container is started with only two of them, so cleanup depends on a single `docker rm -f` whose failure is swallowed; the run then prints its success line with the container still present.
- Evidence: Where: infrastructure/docker/scripts/knowledge-t5-live.ps1:331 (`--label com.personal-tool.acceptance=t5 --label com.personal-tool.acceptance-run=$runId` — no `persistence` label) and :515 (`if ($script:restoreContainerStarted) { & docker rm -f $restoreContainer 2>$null | Out-Null }` — `$LASTEXITCODE` never checked) · Evidence: knowledge-t5-common.ps1:594 builds the sweep filters including `label=com.personal-tool.persistence=temporary`, which the restore container never carries.
- Reproduction: static — make the `docker rm -f` fail (container busy or daemon error): evidence still records `PASS`, the script writes its "passed" line and exits 0, and the container persists on the host.
- Acceptance criteria: either the restore container carries the sweeper's third label or its removal exit code is checked and a failure downgrades the run's result.
- Related findings: F-239, F-238 · nguồn: R7 delta audit D13

### F-269 — repository policy hardcodes that the pdf-runtime suite stays NOT RUN inside the only Python job CI admits, so F-237's fix needs a new job rather than a step

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-D12A-01`
- Affected modules: Zink Knowledgebase, Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: the `repo:check` workflow rule rejects any `run` step of the `python-quality` job whose text names the child package, and the suite command is scoped to the parent directory — so the two tracked contract suites for the PDF runtime cannot be executed by adding a step to the job that exists. The prohibition is job-scoped, not absolute: the remediation is a second job, which is an owner decision about the required-gate shape rather than a routine fix.
- Evidence: Where: scripts/repository-policy.mjs:415-419 (`const steps = workflowSteps(workflowPath, workflow, PYTHON_QUALITY_JOB)`) and :458-475 (`if (step.run.includes("pdf-runtime") || step.run.includes("zink_pdf_runtime")) { failures.push(`job ${PYTHON_QUALITY_JOB} must not install the pdf-runtime closure.`) }`), with the intent stated at :458-459 ("It must stay an explicit NOT RUN in CI rather than being installed here or implied.") · Evidence: package.json:25 scopes the suite to pytest over the parent tests directory of apps/knowledge; the suites with no invocation are apps/knowledge/pdf-runtime/tests/test_ocr_contract.py and test_range_contract.py; tests/repository-policy.test.mjs:345-359 asserts the python-quality job must exist, so the job cannot be repurposed silently.
- Reproduction: static — add a step to the python-quality job that runs the child suite: `npm run repo:check` reports the closure-install failure and `npm run verify` goes red, while a new job is not blocked by this rule. Correction recorded here after the D9 challenge: an earlier draft of this row claimed the route was closed entirely; it is closed only inside the pinned job.
- Acceptance criteria: the two child suites execute in an enforced gate through a lane that policy permits, or the permanent NOT RUN is recorded as an owner decision in `PLAN.md` §3 with a named compensating control — either way F-237 stops being silently closable.
- Related findings: F-237, F-197, F-074 · nguồn: R7 delta audit D12A — CI skip census
