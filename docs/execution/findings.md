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

Tổng **320** bug đang mở/đang chờ, chia theo nhóm:

| Nhóm     | Nội dung                                                              | Bug     | Critical | High | Medium | Low | Ungraded |
| -------- | --------------------------------------------------------------------- | ------- | -------- | ---- | ------ | --- | -------- |
| F1       | Logic & Functional Bugs — Lỗi logic, sai chức năng                    | 26      | 0        | 7    | 12     | 5   | 2        |
| F2       | Security & Authorization — Lỗi bảo mật và phân quyền                  | 49      | 3        | 21   | 18     | 7   | 0        |
| F3       | State & Lifecycle Integrity — Lỗi trạng thái và vòng đời              | 57      | 2        | 21   | 27     | 5   | 2        |
| F4       | Integration & Contract Violations — Lỗi tích hợp và vi phạm hợp đồng  | 52      | 0        | 20   | 26     | 6   | 0        |
| F5       | Data Integrity & Result Correctness — Lỗi toàn vẹn dữ liệu và kết quả | 47      | 1        | 18   | 24     | 4   | 0        |
| F6       | Reliability & Performance — Lỗi độ tin cậy và hiệu năng               | 21      | 0        | 4    | 14     | 3   | 0        |
| F7       | Testing & Verification Gaps — Thiếu kiểm thử và xác minh              | 68      | 0        | 13   | 45     | 10  | 0        |
| **Tổng** |                                                                       | **320** | 6        | 104  | 166    | 40  | 4        |

Theo trạng thái: OPEN 258 · EXCLUDED 12 · LATENT 26 · REFUTED 10 · PARTIAL 5 · HYPOTHESIS 8 · BLOCKED 1.

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
nào. Mọi hàng của cả hai đợt đều được Lead tự mở lại locator ở HEAD trước khi ghi; các claim không tự kiểm chứng được thì
không ghi.

Vòng **R7-C** (2026-10-18, delta tiếp theo trên đúng phần còn trống) thêm **35** hàng `F-271`–`F-305` từ sáu assignment
read-only (`R7-C1` schemas của `zink-tools/contracts`, `R7-C2` tám provider adapter, `R7-C3` `pdf-runtime` cùng các module
Knowledgebase chưa trích, `R7-C4` compose overlay và script `.ps1` của `infrastructure/docker`, `R7-C5`/`R7-C5B` validity
của 69 file test chưa hàng nào naming, `R7-C6` các file mồ côi còn lại), và gộp vị trí mới vào **8** hàng đã tồn tại thay
vì ghi hàng trùng (`F-240`, `F-218`, `F-207`, `F-105`, `F-252`, `F-055`, `F-223`, `F-243`). Số đo phủ sau vòng này là
**213/300** (từ 162/300 trước khi ghi): `tests` 73/122, `zink-tools/adapters` 11/12, `infrastructure/docker` 19/21,
`zink-tools/contracts` 10/13, `integrations/openclaw` 57/59, `apps/knowledge` 23/48. Kết luận của vòng vẫn là **chưa
complete**: 87 file nguồn chưa hàng nào trích path, và `apps/knowledge` là vùng trống lớn nhất còn lại (25 file).
Mười một hàng của R7-C mang `Status: LATENT` (8) hoặc `HYPOTHESIS` (3) vì chính measurement của vòng này: tám adapter provider
không có importer production nào ngoài `tests/m7-t4-orchestration.test.mjs` (đo ở F-105), nên defect trong chúng chỉ chạy
được qua test; còn ba hypothesis cần một phép đo trước khi sửa (F-287, F-293, F-305).

`R7-D*` là id **của vòng delta 2026-10-17**, không tra được về register sáu vòng (id `R7-` duy nhất ở đó là `R7-GATE-01`,
đã đóng ở §2). Xuất xứ, phán quyết của chủ cho vòng đó, và kết quả đọc lại cả 17 locator ở HEAD: `PLAN.md` §8, record
`the 17 rows this record under-counted`. Cả 17 hàng đều đã được phiên này tự kiểm tra lại path và khoảng dòng trước khi giữ.

Vòng **R7-E** (2026-10-18, delta thứ ba liên tiếp, đối tượng đúng là 87 file chưa hàng nào trích path) thêm **20** hàng `F-306`–`F-325` từ năm assignment read-only: `R7-E1` `apps/knowledge/app` (markdown adapter, `run_errors`, reranker, config), `R7-E2` `apps/knowledge/tests` cùng `pdf-runtime`, `R7-E3` các lane Node chưa từng được naming ở `tests/`, `R7-E4` các lane `m7-lane-*`/`m8-t2.*` chưa được đọc, `R7-E5` `zink-tools/contracts` và `zink-tools/adapters`. Lead tự mở lại từng locator ở HEAD trước khi ghi; claim không tự kiểm chứng thì không ghi.

Dedupe theo root cause: **8** hàng đã tồn tại nhận thêm vị trí thay vì mở hàng trùng — `F-240` (bốn chỗ literal tự đối chiếu: timeout do chính test truyền vào `httpx.AsyncClient` rồi được so với "client thật", bảng spawn chép tay thay vì đọc từ guard, `isDeclaredReasonCode` kiểm đúng vocabulary mà nó import, fixture prompt-build do test tự dựng), `F-218` (19 file, khoảng hai chục pin text), `F-207` (tám file, mười tám vị trí matcher rộng hơn diagnostic mà ca đặt tên), `F-275` (ba schema-only contract còn lại), `F-279` (streamlit là phong bì thứ sáu), `F-055` (hai lookup nữa ở `markdown_adapter.py`), `F-213` (ba chỗ `git archive`/`git show` cộng `tar`), `F-300` (hai chỗ "lane báo phủ một thứ mà body không chạy").

Ba claim của vòng này bị chính phép đo chặn trước khi ghi, ghi lại ở đây vì chúng là lỗi của Lead chứ không của hàng đợi: `tests/m11-t1-skill-governance.test.mjs:612-626` có **sáu** `assert.doesNotMatch` chứ không phải bảy; `apps/knowledge/app/reranker.py` raise **mười** code qua một exception type chứ không phải tám; và "19 điểm nối cause" là số bịa — `apps/knowledge/app` có 59 chỗ `raise … from` trong 11 module, còn `apps/knowledge/tests/test_b14_cause_attribution.py:62-70` chỉ gọi tên hai file, và cả module bị `pytest.skip(allow_module_level=True)` ở `:29-35` chặn khi `KNOWLEDGE_TOKENIZER_PATH` chưa được cấp, biến mà chỉ `.github/workflows/ci.yml:99` đặt. Cùng loại: `tests/m8-t2-file-lock.test.mjs:161-167` (tên hứa "repository filesystem (Windows/OneDrive)" nhưng `tempRoot()` ở `:17-18` là `mkdtempSync(path.join(os.tmpdir(), …))`) ban đầu được gộp vào `F-298`; root cause của `F-298` là phân loại retry, nên location đó chuyển sang `F-300` thay vì dán vào hàng sai chủ đề. Claim sai duy nhất đã trót vào file — `F-275` từng ghi "xóa cả bốn file vẫn xanh" — đã bị lượt đối chiếu trước sửa tại HEAD; vòng này chỉ bổ sung phần đo mới: `zink-forecast.schema.json:31-34` mở `parameters` thật, `zink-simulation.schema.json:27` là `additionalProperties` kiểu `number` (vẫn trái `zink-tools/contracts/README.md:12` nhưng hẹp hơn forecast), còn `zink-optimization.schema.json:22-47` hỏng ở nửa thiếu `minItems` chứ không có `parameters` gì cả.

Id legacy của vòng này ban đầu ghi `R7-D1-01`…`R7-D5-05` và **đập vào namespace của vòng 2026-10-17**: phép kiểm tự động tìm thấy bảy va chạm một-một (`R7-D1-04`, `R7-D2-01`, `R7-D4-01`, `R7-D4-02`, `R7-D4-03`, `R7-D4-04`, `R7-D5-02`, mỗi id mang hai hàng). Toàn bộ 20 hàng được đánh số lại thành `R7-E1-01`…`R7-E5-05`, kèm 8 marker gộp và 28 chuỗi nguồn vòng; đo lại, 312 hàng mang đúng 312 `Legacy register id` distinct, nên đoạn trên (`R7-D*` là id của vòng 2026-10-17) vẫn đúng nguyên văn.

Số đo phủ, bằng đúng predicate `temp/coverage-probe3.mjs` trên `git ls-files`: **213/300 → 272/300** (+59 file; `tests` 110/122, `apps/knowledge` 39/48, `zink-tools/contracts` 13/13, `zink-tools/adapters` 12/12, `tests/helpers` 3/3, `integrations/openclaw` 58/59). Còn **28** file chưa hàng nào trích path: 12 ở `tests`, 10 ở `apps/knowledge` (gồm `app/reranker_contract.py`, `tests/test_pdf_foundation.py`, `tests/test_pdf_pipeline.py`, `tests/test_run_errors.py`, `tests/fixture_acceptance.py` và bốn file `pdf-runtime`/`__init__`), 2 compose overlay ở `infrastructure/docker/compose`, cộng `package-lock.json`, `eslint.config.mjs`, `.vscode/settings.json`, `docs/contracts/knowledgebase-migration-digests.json`, `integrations/openclaw/topology/contracts/delegation-proposal.schema.json`. Vòng R7-E vì vậy **chưa complete** theo chính tiêu chí của nó.

Vòng **R7-F** (2026-10-18, hai assignment read-only trên đúng 28 file còn trống) thêm **8** hàng `F-326`–`F-333` và gộp vị trí mới vào bốn hàng đã tồn tại (`F-218`, `F-207`, `F-223`, `F-312`). Lead từ chối ghi năm finding mà mình chưa tự mở lại locator ở HEAD — `m10-t2-r8-ingress-source-diagnostics`, `m10-t2-r12-task-code`, `m10-t2-r18-file-lock`, `m10-t2-r9-duplicate-runid-observability`, `m7-lane-m-spawn-approval` — nên chúng nằm lại `temp/r7f-findings-f1.json` thay vì vào hàng đợi; một lane (`m12-t1-governed-presentation`) được đọc và báo không có gì. Số đo phủ: **272/300 → 291/300**; 9 file chưa hàng nào trích path gồm ba file `__init__`/`__main__` đã đọc và sạch, một lane honest-zero, và năm file chưa được Lead kiểm chứng ở trên.

Vòng đối chiếu (challenge) trên chính 20 hàng R7-E chạy sau đó và **Lead tự áp**, vì chủ grant `e1`: 7 field bị ghi lại (`F-306`/`F-307`/`F-309` sửa `Reproduction`, `F-308` đổi sang `HYPOTHESIS`, `F-318` Medium→Low, `F-324` đổi sang `REFUTED`, `F-291` viết lại `Root cause`), 19 annotation sửa locator/count. Hai hàng có lỗi do chính phiên này ghi: `F-320` trích file **không tồn tại** (`tests/m8-t2.6-r11-boundary-diagnostics.test.mjs`) và `F-324` premise chết (`buildConfig` chạy 0 lần trong cả six suite). Năm hàng khác mang locator sai đã sửa: `F-317` (hai window `configure.mjs`), `F-319` (`guard.mjs:772-776`, không phải `native-boundary.mjs` 637 dòng), `F-313` (`Dockerfile:77` là RUN, `:76` là ENV), `F-323` (bốn occurrence của `KNOWLEDGE_EMBEDDING_MODEL` đều ở `knowledge-t3.ps1`), `F-314` (consumer ở `main.py:262`). Lead **không** áp ba con số của challenger mà mình không đo lại được (`F-316` 14-assert, `F-321` 49-pair/18-ALLOWED, `F-322` site list) — challenger cũng sai số của chính mình ở `F-308` (12 literal, đo lại là 13) và `F-312` (đếm thiếu `ONNX_RUNTIME_UNAVAILABLE`).

`F-291` được đo lại từ đầu theo grant `c2`: population là **sáu driver** — bốn chỗ raise từ trong `finally` (`knowledge-t1.ps1:263-265`, `knowledge-t2.ps1:90-97`, `knowledge-t3.ps1:168-177` với helper throw ở `:22-26`, `knowledge-t4.ps1:249-256` với helper ở `:21-25`) và hai chỗ gate `-not $script:bodyFailed` (`knowledge-t5.ps1:287`, `knowledge-t5-live.ps1:535`); `knowledge-t5-common.ps1` là helper chung, không phải driver thứ bảy, và `knowledge-t2-windows.ps1:84-90` được ghi là hàng xóm chưa phân loại vì chưa đo được path throw thật.

Hai con số 40/73 và 23 vẫn còn trong file nhưng đã bị đánh dấu là không tái hiện được ở đoạn đếm queue. Một sửa đổi quy trình của chính phiên này, ghi lại để sau đừng lặp: commit `ec770b3` tuyên bố đã sửa shape `Severity:` nhưng **không chứa** sửa đó — write cả-file của phiên bên kia (bản tiền-`b1`) chen vào giữa lúc kiểm chứng và lúc `git add`, nên staged content là bản bị revert; phép đo "non-bare Severity = 0" đã chạy trên nội dung trước khi bị đè, tức là bằng chứng cũ. `ec770b3` vẫn được giữ trong history (không rewrite), còn sửa đổi thật nằm ở commit kế tiếp, và sau đó toàn bộ gate được chạy lại trên chính file sẽ commit.

Còn **40** bug chưa có `Acceptance criteria` (32 Medium, 6 Low, 2 Ungraded) và **73** bug chưa có bước tái hiện (62
Medium, 10 Low, 1 Ungraded) đo lại trên 294 hàng hiện tại; bản trước ghi 91 bug thiếu bước tái hiện, số đó giảm vì mọi
hàng R7 và R7-C đều mang hai field này. Toàn bộ nằm ở nhóm Medium/Low/Ungraded, tức phần `b2` chưa chạy tới. Ngoặc "(47/110 trước
lượt `b2-m1…m3`)" của bản trước bị rút: 110 là số hàng còn thiếu ở một thời điểm đo, 47 là số hàng một lượt khác báo đã
điền, hai con số không cùng một phép đo nên không đặt cạnh nhau được. **92** hàng lấy root cause từ chính tiêu đề (đo lại 2026-10-18 trên 312 hàng; predicate: `Root cause` chứa 60 ký tự đầu của tiêu đề hoặc ngược lại), trong đó đúng 23 hàng mở đầu bằng `Register kết luận:` — con số của lượt `b2` là một tập con của phép đo này, không phải hai lần đếm cùng một đại lượng, và nó chưa từng được đo lại cho tới câu này. Hai con số 40 và 73 ở đầu đoạn **không tái hiện được**: với quy tắc 'field trống, là placeholder, hoặc ngắn dưới 40 ký tự' thì chỉ 3 hàng thiếu một trong hai field, và cả ba là hàng REFUTED tự ghi "Not reproducible — premise measured dead" (`F-015`, `F-017`, `F-020`). Lead không xóa 40/73 vì không biết predicate của lượt đã sinh ra chúng, nhưng cũng không thể bảo vệ hai con số đó trước phép đo hiện tại. Đó là
nợ quy trình của vòng audit (audit chỉ đọc, không chạy tái hiện), không phải lỗi của hàng đợi: bug nào thiếu thì bước 1 và
bước 2 của nội quy mục 0.2 là bắt buộc.

File này được tái cấu trúc ngày 2026-10-17 từ register audit sáu vòng. Mỗi hàng giữ `Legacy register id` để
`PLAN.md` §4.17/§11 và các contract archive vẫn tra được về id cũ.

## 2. Bug đã sửa xong + đã kiểm chứng bằng test — đã xóa khỏi danh sách này

50 entry được xóa vì đủ ba điều kiện ở nội quy mục 0.2, khoản 6 — 43 ở lượt tái cấu trúc 2026-10-17 và thêm 5 ở lượt
duyệt lại `b2` cùng ngày (4 hàng đóng bằng commit + test chạy lại tận mắt, 1 hàng trùng id). Mỗi commit trong bảng đã được
đối chiếu bằng `git rev-parse --verify <hash>^{commit}` (39 hash, 0 lỗi) và `git merge-base --is-ancestor <hash> HEAD`.
Mức bằng chứng test không đồng đều, ghi rõ ở đây
để anh không phải đoán: các item `T2.1-*`, `A-*`, `B-*`, `R3-*`, `C-4`, `C-9`, `C-13`, `B-19` có test đỏ-trước/xanh-sau
và mutation probe ghi trong `PLAN.md` §8; sáu item tài liệu của Wave C (`C-1`, `C-2`, `C-3`, `C-5`, `C-6`, `C-7`)
đóng bằng "full gate xanh tại commit của chính item" (`npm run verify` + `repo:check` + re-measure §6.7) chứ không có
probe riêng. Lane live Discord vẫn `NOT TESTED` với mọi hàng ở đây, theo `PLAN.md` §2.

| Legacy id         | Đóng bởi — bằng chứng                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `R1-A04-01`       | M12/T2.2-R1 A-1 (ccf2ad7) — test-first 9/9, adjacent 66/66, WSL lane run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `R1-A04-05`       | M12/T2.2-R1 A-2 (09aa698)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `R1-A04-06`       | M12/T2.2-R2 B-8 (a21c610)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `R1-A05-01`       | M12/T2.2-R2 B-10 (46852f3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `R1-A02-04`       | M12/T2.2-R2 B-10 (46852f3) — same defect as `R1-A05-01`, filed twice; closed by the shipped test 'delivers the card as text when the component build itself throws' (re-run 2026-10-17: suite 12 pass / 0 fail)                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `R1-A09-01`       | M12/T2.2-R2 B-10 (46852f3) — the by-elimination confirmation of `R1-A05-01`; same commit, same test, re-run green 2026-10-17                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `R1-A13-03`       | M12/T2.2-R2 B-16 (5c156d4) — that commit message names `R1-A13-03`; tests/m12-t2.2-b16-denial-reason re-run 2026-10-17, combined with the registry suite: 19 tests / 19 pass / 0 fail                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `R1-A08-08`       | M12/T2.2-R2 B-7 (6f3c970)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `R1-A12-07`       | M12/T2.2-R2 B-16 (5c156d4) — red-before 6/7, green-after 7/7, three mutation probes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `R1-A14-01`       | M12/T2.1 T2.1-6 (b3affc2) — B7-1/B7-2/B7-3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `R1-A14-02`       | M12/T2.1 T2.1-6 (b3affc2) — B7-1/B7-2/B7-3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `R5-E01-03`       | M12/T2.2-R2 B-13 (7bc3e5d)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `R5-E02-05`       | M12/T2.1 T2.1-7 (b7497ca) — test_retrieval.py, PDF row with a NULL page pair                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `R5-E04-03`       | M12/T2.1 T2.1-2 (2e7da50) — R22-08/R22-09, stat-based                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `R5-E04-02`       | M12/T2.2-R3 R3-2 (812b8ec) — that commit says 'Closes R5-E04-02'; tests/m8-t3-governed-memory-learning re-run 2026-10-17 → 47 tests / 47 pass / 0 fail incl. T2h                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `R5-E05-04`       | M12/T2.2-R3 R3-7 (1bab75d) — shape test + scratch real-PostgreSQL run; two of its clauses were refuted at the pre-freeze read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `R5-E05-06`       | M12/T2.3-R1 C-9 (8bde65f, re-scoped) — red-before, 2/2 after, WSL lane 2/2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `R5-E06-03`       | M12/T2.1 T2.1-3 (c4833e6) — stub HTTP service + marker scan; acceptance divergence recorded in PLAN.md §8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `R5-E06-04`       | M12/T2.1 T2.1-4 (710f650) — real engine, marker scan, ETIMEDOUT shape observed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `R5-E06-07`       | M12/T2.1 T2.1-1 (96a6dd2) — B6-4 + mutation probe                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `R5-E07-02`       | M12/T2.2-R2 B-6 (3701804)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `R5-E07-03`       | M12/T2.2-R2 B-5 (b7d9d36)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `R5-E08-01`       | M12/T2.2-R2 B-2 (c449cd0)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `R5-E08-02`       | M12/T2.1 T2.1-8 (ba5ff08) — four driver gates; the residual host-evidence half stays open as R6-I01-03                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `R5-E08-03`       | M12/T2.2-R2 B-1 (a108cde)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `R5-E08-04`       | M12/T2.2-R2 B-3 (d34c666)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `R5-E10-03`       | M12/T2.2-R2 B-17 (0dddea4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `R5-E11-02`       | M12/T2.3-R1 C-3 (e47e660, narrowed scope)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `R5-E11-03`       | M12/T2.3-R1 C-1 (3685548)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `R5-E11-04`       | M12/T2.3-R1 C-4 (68fe25b + review fix cd1b541) — three mutation probes, WSL 12/12 twice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `R5-E11-05`       | M12/T2.3-R1 C-5 (0ccdd81)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `R5-E11-06`       | M12/T2.3-R1 C-6 (5e798aa)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `R5-E11-07`       | M12/T2.3-R1 C-2 (3248f60)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `R5-E12-04`       | M12/T2.3-R1 C-13 (d9e1bcc) — 35/35 policy tests + two real-tree probes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `R5-E13-06`       | M12/T2.1-R3 owner answer A (91d788d) — the recovery report now states presence only; verified in tree at integrations/openclaw/topology/fixtures/runtime-regression/operator-lock-recovery.mjs:147                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `R5-E14-01`       | M12/T2.3-R1 C-7 (a4ed77d, re-scoped by location)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `R5-E14-05`       | M12/T2.2-R2 B-15 (7aebc39)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `R5-E16-01`       | M12/T2.2-R1 A-3 (d1378ba) + M12/T2.2-R2 B-12 (f93068e) — new lock/temp test file 203 lines                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `R5-E16-02`       | M12/T2.2-R1 A-3 (d1378ba) + M12/T2.2-R2 B-12 (f93068e)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `R5-E16-03`       | M12/T2.2-R2 B-11 (937521c)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `R6-I01-01`       | M12/T2.1-R3 (ad4a8d6) — the skip that this defect caused now runs; Python lane 142 passed / 6 skipped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `R6-I01-02`       | M12/T2.1-R3 owner answer A (91d788d) — assertion re-valued to a presence constant; disabling the omission reddens it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `R7-GATE-01`      | M12/T2.2-R2 B-19 (9fa6505) — gate now asserts heartbeats >= 1 (liveness) instead of tick rate; verified in tree                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `R1-A12-07-BLOCK` | narrative blocker for R1-A12-07; resolved when B-16 landed (5c156d4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `R5-E01-01`       | duplicate of R5-E02-01 (canonical row kept as the R5-E02-01 successor)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `R1-A13-05`       | duplicate of R1-A12-03 (canonical row kept)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `R1-A16-04`       | duplicate of R1-A09-02 and R1-A05-01                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `R6-CFG-03`       | duplicate of `R1-A04-01` (closed by A-1 ccf2ad7; tests/m12-t2.2-a1-stack-authority re-run 2026-10-17 → 9 pass / 0 fail)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `R5-E07-06`       | CLOSED by `M12/T2.2-R3` `R3-10` (`e7aee21`) — red-before measured 2026-10-18 by replaying `git show e7aee21^:zink-tools/common/path-safety.mjs`: the pre-fix validator returned `data\sub\f.csv` verbatim where the shipped assertion demands `data/sub/f.csv`, and the `segments.length === 0` branch was unreachable. Green at HEAD: `tests/m7-t3-tools-contract.test.mjs` case `AC 36` passed on the re-run of 2026-10-18 (32 tests / 0 fail / 0 skipped), and `zink-tools/common/README.md:74-75` now documents the normalized return for both backslash forms, which is exactly this row's `Acceptance criteria`.                                           |
| `R5-E07-07`       | CLOSED by `M12/T2.2-R3` `R3-9` (`04e128f`, owner grant `q1`) — red-before measured 2026-10-18 by replaying `git show 04e128f^:zink-tools/common/semantic-contract.mjs`: a taxonomy-less `renderEmbeddingEnvelope` call did NOT throw and rendered `Domain: general` / `Primary Topic: general`; at HEAD the same call raises `EMBEDDING_ENVELOPE_METADATA_REQUIRED`. Green at HEAD: `tests/m8-t1-skill-vector-memory.test.mjs` case `R3-9` passed on the re-run of 2026-10-18 (15 tests / 0 fail / 0 skipped). Stated limit of the closure: an EXPLICIT `domain: "general"` still renders, because what the fix removed was the invented default, not the value. |

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
- Acceptance criteria: Either `vector-sync.mjs` writes real `secondary_topics` for canonical skills so a `secondary_topics` filter can match, or the filter is withdrawn from `semantic-contract.mjs:388-396` and from the SQL builder at `skill-adapter.mjs:548-556` together so no caller can send a predicate that can only remove rows; and an unrecognized `primary_topic` is rejected with a named error code at the contract layer instead of being forwarded to SQL, with both behaviours pinned by tests in `tests/m8-t1-skill-vector-memory.test.mjs`.
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
- Acceptance criteria: The durable proposal's `requesting_agent` is read only from the trusted context key the plugin actually supplies (`requestingAgent`, built at `index.mjs:3687-3693`), a model-supplied `requesting_agent` can never override it, no code path substitutes a constant such as `specialist` or `unknown`, and the canonical provenance stamp at `index.mjs:1113` carries that same identity, all pinned by a test in `tests/m7-t5-remediation.test.mjs` that drives `executeGovernedSkillQuery` with a payload identity differing from the context identity and with the field omitted.
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
- Reproduction: Add a case beside `test_min_score_does_not_filter_the_rrf_path` in `apps/knowledge/tests/test_m11_api_attribution.py:184-201`, reusing that class's `self.request(method, url, json=...)` ASGI helper, the module-level `candidate(identifier)` factory and the `AsyncMock` seams on `app.state.database.get_active_index` and `search_candidates`; run `uv run --directory apps/knowledge --locked python -m pytest tests/test_m11_api_attribution.py -q` and read the printed skip count, because the module self-skips at import unless `KNOWLEDGE_TOKENIZER_PATH` points at the pinned tokenizer that `.github/workflows/ci.yml:99` provisions. POST `/v1/search` with a body of `query: topic`, `rerank: false`, `min_score: 0.5` and assert either a refusal code or that no response field named `rerank_score` carries an RRF-magnitude number; measured at HEAD it returns 200 with both hits present and every `rerank_score` below the threshold the caller asked to enforce.
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
- Severity: Low
- Status: OPEN
- Root cause: Register kết luận: incident dedupe ignores Discord's truncation flag. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: Evidence: (code): discord-forum-tags.mjs:157 consumes body.threads and never reads has_more, so a first-page-only listing is treated as complete truth → a duplicate #incidents thread is posted for an incident the guard was written to dedupe.
- Reproduction: Static, and gate it in `tests/m12-t2-forum-tags.test.mjs`, which already drives `readActiveForumThreads` against a stubbed `fetch`. Measured at HEAD: `integrations/openclaw/lib/discord-forum-tags.mjs:154-161` throws on a non-ok response, then returns `(Array.isArray(body?.threads) ? body.threads : []).map(...)` at `:157` and never reads `body.has_more` or `body.next_cursor`; a repo-wide `grep -rn "has_more" --include="*.mjs" integrations/` returns zero hits, so nothing in the plugin paginates. Discord's `GET /channels/{id}/threads/active` caps the response, so once a forum holds more active threads than one page carries, the listing is silently partial and the dedupe at `index.mjs:5140-5146` (`threads.some((thread) => thread.name.includes(token))`) answers false for an incident that is already open. Return a stub body with `has_more: true` and one unrelated thread, then assert the caller refuses to conclude "not already surfaced" rather than posting a duplicate `#incidents` thread.
- Acceptance criteria: `readActiveForumThreads` either follows Discord's pagination until the response reports no further page or reports truncation to its caller, and the incident dedupe at `index.mjs:5146` treats a partial listing as unable-to-conclude by taking the existing `INCIDENT_SURFACE_SKIPPED` return-null path instead of posting a second `#incidents` thread for an incident that is already open, pinned by a stub body carrying `has_more: true` in `tests/m12-t2-forum-tags.test.mjs`.
- Related findings: nguồn: B07 — end-to-end: dedup decisions, one refutation, and a… · severity note: giá trị cũ là `Low (/Latent)`; `(/Latent)` là ghi chú reachability của lượt đo cũ trong khi `Status` vẫn `OPEN` — giữ nguyên phán quyết, chỉ dời chữ ra khỏi field grade.

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
- Acceptance criteria: No code change is licensed by this row: it may be deleted only once the refutation is recorded as a disposition in `PLAN.md` section 4.17 so no later band re-admits the unbounded-thread-body claim, and the surviving UTF-16 code-unit slicing at `discord-forum-tags.mjs:657-658` and `index.mjs:1684` has been filed as its own `F-xxx` row rather than folded into this one.
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
- Severity: High
- Status: OPEN
- Root cause: consent bound to the admitted brief. Actual: the plan the owner reads is model output while the plan executed is the ledger brief.
- Evidence: Where: integrations/openclaw/plugins/zink-governance/index.mjs:5291-5319 (maybePublishDiscordCard), buttons 5366-5379 · Evidence: payload = JSON.parse(findingsText) from the child's findings; bodyContent = card.content; the custom id carries only buildComponentCustomId(…, APPROVE, taskId, String(briefRevision)) — no digest over the displayed text. · Expected/Actual: consent bound to the admitted brief. Actual: the plan the owner reads is model output while the plan executed is the ledger brief.
- Reproduction: craft child findings JSON differing from the snapshot brief; confirm card body ≠ admitted plan.
- Acceptance criteria: approved text is derived from and cryptographically bound to the admitted brief.
- Related findings: nguồn: A03 — security and trust boundaries · severity note: High là orchestrator escalation từ mức Medium mà agent đề xuất.

### F-026 — completeTask verifies no principal and self-satisfies its own result digest

- Category: F2 — Security & Authorization
- Legacy register id: `R1-A03-04`
- Affected modules: OpenClaw governance plugin (Discord), OpenClaw runtime libs, OpenClaw integration
- Severity: High
- Status: OPEN
- Root cause: completion bound to the ledger-authoritative owner + result digest. Actual: any non-empty principal is accepted and the digest check is trivially self-satisfying.
- Evidence: Where: integrations/openclaw/lib/queue-manager.mjs:739-759 (completeTask); plugins/zink-governance/index.mjs:5777-5782 (applyOwnerDecisionEffect) · Evidence: the identity check runs only when item.ownerPrincipalRef is non-empty; the caller passes resultDigest: getTask(taskId)?.resultDigest read back from the same queue object; the origin ref can fall back to the literal "owner" (index.mjs:7620). · Expected/Actual: completion bound to the ledger-authoritative owner + result digest. Actual: any non-empty principal is accepted and the digest check is trivially self-satisfying.
- Reproduction: drive completeTask with ownerPrincipalRef=null and a self-supplied digest.
- Acceptance criteria: completion without the authoritative owner+digest pair is refused.
- Related findings: adjudication Vòng 2: Verified, worse than stated · nguồn: A03 — security and trust boundaries · severity note: High là orchestrator escalation, không phải grade của agent.

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
- Reproduction: Extend `M7-072: cancellation requires authorized actor provenance` in `tests/m7-lane-a-workflow.test.mjs:192-245`, reusing its `openOne()` helper, `applyWorkflowEvent(snapshot, type, payload)` call form and its `assert.throws(..., { code: SCHEMA_INVALID })` idiom; run `node --test tests/m7-lane-a-workflow.test.mjs`, whose baseline today is tests 9, pass 9, fail 0. Assert that a cancel payload carrying `channel: fabricated-channel` and `message_id: not-a-snowflake` alongside a valid `task_id`, `reason_code: OWNER_CANCELLED` and `actor: user` throws `SCHEMA_INVALID`; measured at HEAD it succeeds and the task reaches `workflow_status: CANCELLED`. For the schema half, assert that `validateContract` imported from `integrations/openclaw/topology/lib/schema.mjs` rejects the same event as a `ledger-event`; measured at HEAD it returns `true` for both the clean and the fabricated payload.
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
- Severity: High
- Status: HYPOTHESIS — Strongly Supported (pattern list), HYPOTHESIS (reachability)
- Root cause: a positive allow-list of read-only statement/function forms / a fail-open blocklist.
- Evidence: Where: zink-tools/sql/duckdb-bridge.mjs:23-44 (ESCAPE_PATTERNS), :102-138, executed at :263 execFileSync("duckdb", ["-json", "-c", initSql]) · Evidence: the deny-list covers ATTACH|DETACH|COPY|read_csv*|read_parquet*|read_json*|parquet_scan|INSTALL|LOAD| PRAGMA|CALL|EXECUTE|IMPORT|EXPORT plus host words. glob, read_text, read_blob, CREATE SECRET and SET are absent. Every denial lives inside for (const pattern of ESCAPE_PATTERNS) if (pattern.test(query)), so a query matching no listed pattern is accepted by construction. · Expected/Actual: a positive allow-list of read-only statement/function forms / a fail-open blocklist.
- Reproduction: read zink-tools/sql/validator.mjs (validateSqlQuery, imported at duckdb-bridge.mjs:4) and establish whether it independently allow-lists statement/function forms, and whether executeGovernedDuckDbQuery calls it before :263. If it does, this degrades to defence-in-depth. Not read within budget — this is the lane's top unresolved item.
- Acceptance criteria: a query using an unlisted table function is refused.
- Related findings: bug mở: R5-E06-05 · đã sửa/xóa khỏi file: R5-E06-04 · nguồn: E15 — untrusted-input security paths (5 findings; the… · severity note: grade gốc có điều kiện (`High ((if reachable))`); điều kiện đó nằm ở `Status: HYPOTHESIS` (reachability chưa đo), không thuộc field grade.

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
- Reproduction: Add a case to the `attachment confinement` describe block in `tests/m12-t1-result-preview-and-ownership.test.mjs:90-118`, which already imports `assertMediaInsideRoots` and drives it against `tempRoot("media")` with `assert.throws(..., /MEDIA_PATH_OUTSIDE_ROOTS/u)` and an `rmSync` cleanup in `finally`; run `node --test tests/m12-t1-result-preview-and-ownership.test.mjs`, whose baseline today is tests 8, pass 8, fail 0. Create a directory outside the declared root holding a PNG, link it into the root with `symlinkSync(outsideDir, path.join(root, "j"), "junction")` rather than the file-symlink form at `tests/m11-t1-openclaw-outbound-and-caches.test.mjs:164-167` which skips on this platform, then assert that `assertMediaInsideRoots(path.join(root, "j", "host-secret.png"), [root])` throws; measured at HEAD it returns the lexical path inside the root while `realpathSync` on that same argument resolves to the directory outside it.
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
- Severity: High
- Status: OPEN
- Root cause: a link/junction inside the agent sandbox redirects the writes outside while the tool returns only path.basename values and status:"success" — recreating the M10/T2-R19 class. Same two-idioms root cause as R1-A03-01.
- Evidence: Where: lib/excel-writer.mjs:203-210 (path.relative only), :277-288 (mkdirSync + three writeFileSync) vs index.mjs:3046-3055 (realpathSync) · Measured on this host 2026-10-18 (owner grant `e`/`E2`, agent run b01): a directory junction placed inside the sandbox made `executeExcelOperation` write `proof.xlsx`, `proof_preview.svg` and `proof_preview.png` OUTSIDE the sandbox base and still return `status: success` with `file_path: proof.xlsx`. Neither end of the write path resolves links: `resolveAgentSandboxDir` (`integrations/openclaw/plugins/zink-governance/index.mjs:2985-3001`) builds a purely lexical `path.join(os.homedir(), ".openclaw-zink", "sandboxes")` filtered by `startsWith` with no `realpathSync` anywhere in it, the `zink_excel` branch takes it at `:3847`, and `:3862` hands the model-supplied `params` straight to `executeExcelOperation`. A directory junction needs no elevated privilege on this host, unlike a file symlink, which raises `EPERM`.
- Reproduction: Add an R19 sibling to `tests/m10-t2-r19-artifact-and-message-limits.test.mjs:49-88`, reusing its `root()` and `cleanup(dirs)` temp helpers, its `spec(file_path)` payload factory, the top-level `excel` import at `:34` and its `assert.throws(() => excel.executeExcelOperation(spec(...), sandbox), /ARTIFACT_PATH_ESCAPE/u)` shape; run `node --test tests/m10-t2-r19-artifact-and-message-limits.test.mjs`, whose baseline today is tests 7, pass 7, fail 0. Create the `sandbox` directory plus a sibling outside directory, join them with `symlinkSync(outside, path.join(sandbox, "link"), "junction")`, then call `executeExcelOperation(spec("link/proof.xlsx"), sandbox)` and assert it throws and that the outside directory is still empty; measured at HEAD it returns `status: success` with `file_path: proof.xlsx` while `proof.xlsx`, `proof_preview.svg` and `proof_preview.png` are all written outside the sandbox.
- Acceptance criteria: `executeExcelOperation` resolves both the target path and the workspace base through `realpathSync` before its containment test, so a link or junction inside the sandbox makes the call raise `ARTIFACT_PATH_ESCAPE` before `mkdirSync` at `excel-writer.mjs:277` or any of the three writes at `:278`, `:283` and `:287` runs and nothing is created outside the base, with the junction case above green and `R19-01`, `R19-02` and `R19-03` still green.
- Related findings: adjudication Vòng 2: Verified · bug mở: R1-A03-01 · nguồn: A10 — Zink Tools, adapters and execution contracts · severity note: re-graded 2026-10-18 under owner letter `E2` — the escape is measured, not hypothesized, and the path that escapes is chosen by the model.

### F-045 — a canonical skill can carry an owner-attributed ACTIVE event no decision backs — §9 makes provenance the store's own responsibility

- Category: F2 — Security & Authorization
- Legacy register id: `R5-E04-07`
- Affected modules: Zink Skill Store
- Severity: Medium
- Status: EXCLUDED — excluded by owner letter `p1` (packaged entrypoint) — belongs to the `M12/T5` A2 band, which is scheduled and not authorized.
- Root cause: index.mjs:1117-1118 states "provenance is derived from the ref this approval actually carries — never a constant" / the store re-introduces a constant default at its entry point (promoteApprovedSkill), which any future caller can omit, producing a record that asserts owner approval and an unrelated plan provenance.
- Evidence: Where: catalog.mjs:992-997 and :1186-1200 · Evidence: default parameters requestingActor = "unknown", ownerActor = "owner", … references = [{ type:"plan", ref:"M8/T3-R1" }], written verbatim into lifecycle:[{status:"ACTIVE", actor:String(ownerActor), decision_ref: decisionRef}] and provenance:{source_type: sourceType, references} with sourceType = "demonstration". · Expected/Actual: index.mjs:1117-1118 states "provenance is derived from the ref this approval actually carries — never a constant" / the store re-introduces a constant default at its entry point (promoteApprovedSkill), which any future caller can omit, producing a record that asserts owner approval and an unrelated plan provenance.
- Reproduction: Add a case to `tests/m11-t1-skill-governance.test.mjs`, which already imports `promoteApprovedSkill` from `CATALOG_PATH` (`:32-34` and `:50`) and provides the `freshRoots()` helper (`:79-82`) plus the manifest read-back idiom inside `M11-07` (`:427-442`); run `node --test tests/m11-t1-skill-governance.test.mjs`, whose baseline today is tests 11, pass 11, fail 0. Call `promoteApprovedSkill` with only `skillsRoot`, `namespace`, `capability`, `version`, `content` and `decisionRef: PLAN:M11/T1-R1`, read `manifest.json` back, and assert the omitted actor and provenance arguments are refused rather than defaulted; measured at HEAD the call returns `status: ACTIVE` and writes `lifecycle[0].actor: unknown`, `lifecycle.at(-1).actor: owner`, `provenance.source_type: demonstration` and `provenance.references: [{ type: plan, ref: M8/T3-R1 }]`. The static half can reuse the `code(readFileSync(CATALOG_PATH, "utf8"))` idiom at `:624` the way `M11-07` applies it to the plugin at `:399-404`.
- Acceptance criteria: `promoteApprovedSkillUnlocked` (`catalog.mjs:1105-1117`) carries no constant default for `requestingActor`, `ownerActor`, `sourceType` or `references`, each being a required input validated the way `decisionRef` already is at `:1150-1155`, so omitting any of them raises a named writer error instead of publishing a canonical ACTIVE manifest whose owner attribution and plan provenance are constants unrelated to the approval that produced it.
- Related findings: bug mở: R1-A16-08, R1-A04-08, R1-A10-04 · disposition: excluded by owner letter `p1` (packaged entrypoint) — belongs to the `M12/T5` A2 band, which is scheduled and not authorized. · nguồn: E04 — Skill Store catalog internals (9 findings; the store…

### F-046 — the 1024-d vectors in skills.segments — and therefore which skill an agent retrieves — can come from a swapped or unversioned model while the sync reports READY

- Category: F2 — Security & Authorization
- Legacy register id: `R5-E05-05`
- Affected modules: Zink Skill Store
- Severity: Medium
- Status: BLOCKED — awaits evidence: `M12/T2.2-R3` `R3-0` is `NOT RUN` (this host carries no `OLLAMA_URL`), owner letter `t1` produced no evidence yet.
- Root cause: the 1024-d vectors in skills.segments — and therefore which skill an agent retrieves — can come from a swapped or unversioned model while the sync reports READY. Important for Vòng 6: the register's own line records "P1-05 FIXED … model_version digest equality", so this was believed closed and will not be re-examined unless someone is told to. That is exactly the accepted-evidence-drift class.
- Evidence: Where: vector-sync.mjs:392-405 (guards), :13-15 (pins), :343-344 (embedFn bypass) · Evidence: if (data.model && data.model !== modelName) throw … and if (data.model_version && EXPECTED_MODEL_DIGEST && data.model_version !== EXPECTED_MODEL_DIGEST) throw … — both conditioned on the endpoint _volunteering_ the field, so omission is a pass and EXPECTED_MODEL_DIGEST is unenforceable against any producer that does not echo it.
- Reproduction: Extend `M11-05: embedding identity is exact, and a chunked oversized body is still capped` in `tests/m11-t1-skill-vector-sql.test.mjs:182-258`, reusing its local `jsonResponse(payload, headers)` stub factory (`:185-192`), its `EXPECTED_DIMENSIONS` vector fixture (`:193`), its `ollamaUrl: http://127.0.0.1:11434` option form and its `globalThis.fetch` swap restored in `finally` (`:255-257`); run `node --test tests/m11-t1-skill-vector-sql.test.mjs`, whose baseline today is tests 9, pass 9, fail 0. Serve a body that omits both `model` and `model_version` and assert `generateSkillEmbeddings(["t"], { ollamaUrl })` rejects; measured at HEAD it resolves with one 1024-d vector. Second half, same file: assert the same for the `embedFn` form `generateSkillEmbeddings(["t"], () => vectors)`, which reaches no model-identity check at all; measured at HEAD it also resolves with 1024 dimensions.
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
- Reproduction: Add a real-repo case to `tests/repository-policy.test.mjs` in the idiom of `the real npm test list matches the real tests directory` at `:748-761` (it reads the shipped file with `readFileSync(path.join(REPO_ROOT, ...))` instead of a fixture), asserting the shipped `.github/workflows/security.yml` runs `secret-scan` on task-branch pushes and leaves a report artifact; today `security.yml:6-7` scope `push` to `main` only and `:59` pins `GITLEAKS_ENABLE_UPLOAD_ARTIFACT` to `false`, so both assertions fail while `checkWorkflowDefinitions(REPO_ROOT)` itself still returns `[]` (lane is green at HEAD: `node --test tests/repository-policy.test.mjs` -> 35 tests, 0 fail).
- Acceptance criteria: A push of any branch, not only `main`, runs the pinned gitleaks job, and that job publishes a retained report artifact, so `scripts/repository-policy.mjs` plus `tests/repository-policy.test.mjs` can assert both and a `PLAN.md` zero-leak claim is re-inspectable from the artifact rather than from prose.
- Related findings: nguồn: E09 — CI: the gate tier that can print green without…

### F-048 — the repository — which lives under OneDrive, a synced third-party store, and is pushable to a remote — contains the complete server-scoped bot/role/channel identity map, enabling targeted impersonation of an agent mention surface, and the…

- Category: F2 — Security & Authorization
- Legacy register id: `R5-E13-03`
- Affected modules: OpenClaw runtime libs, README
- Severity: Medium
- Status: OPEN
- Root cause: the repository — which lives under OneDrive, a synced third-party store, and is pushable to a remote — contains the complete server-scoped bot/role/channel identity map, enabling targeted impersonation of an agent mention surface, and the 28 copies can silently diverge.
- Evidence: Where: README.md:46-52 plus :60/74/95/107/118/129/140 and :272-275; lib/authority.mjs:619-625, :628-636 · Evidence: README publishes seven 19-digit literals as agent Discord IDs plus seven more as channel/forum IDs; authority.mjs hardcodes the same set twice (DISCORD_BOT_IDS, DISCORD_ROLE_IDS). Values not echoed here. The registry comment at :610-617 correctly notes the owner's own id is deliberately absent.
- Reproduction: No runnable lane covers README identity literals today (`grep -l "README.md" tests/*.mjs` returns only `tests/m7-t4-orchestration.test.mjs`, `tests/m9-t1-functional-truth-remediation.test.mjs`, `tests/repository-policy.test.mjs`), so add a case to `tests/m12-t2-governed-surface.test.mjs` reusing the source-guard idiom of `M12/T2 P1: no Discord tag id is hardcoded anywhere in the repository` at `:494-505` (its `pluginSource` reader is `readFileSync(path.resolve(...))` at `:489-492`), pointed at `path.resolve("README.md")` and asserting no bare 17-19-digit snowflake survives; run `node --test tests/m12-t2-governed-surface.test.mjs` and the observable failing today is 14 registry-id hits at `README.md:46-52`, `:60`, `:74`, `:95`, `:107`, `:118`, `:129`, `:140`.
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
- Reproduction: Partly static: read `integrations/openclaw/plugins/zink-governance/index.mjs:6165-6171` and `integrations/openclaw/topology/contracts/ledger-event.schema.json:410-431`, `:502-517`, `:736-759`, `:785-810`. The red test to add goes in `tests/m11-t3-openclaw-runtime-bounds.test.mjs`, which already ships the `pluginSource()` reader at `:40-42` and the `callArguments()` balanced-paren scanner at `:48` for exactly this closure-bound case: assert the ingress sanitizer is not keyed to one principal, i.e. `pluginSource()` no longer contains `.split(config.ownerDiscordId)`, and that no `required` identity field in the ledger contract is documented as raw; run `node --test tests/m11-t3-openclaw-runtime-bounds.test.mjs`.
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
- Reproduction: Add `integrations/openclaw/plugins/zink-governance/index.mjs` to the file list iterated at `tests/m7-lane-g-policy.test.mjs:726-729` inside the existing `M7-063: no machine-specific paths in governance resolution` case at `:725`, reusing that case's own `readFileSync(path.join(REPO, rel))` + `assert.ok(!src.includes("/mnt/c/Users/HOANG VINH"))` pair at `:730-731`; run `node --test tests/m7-lane-g-policy.test.mjs` and the observable failing today is that assertion tripping on `index.mjs:511`, the one file the current two-entry list never reads.
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
- Reproduction: Add a case to `tests/m7-t5-remediation.test.mjs` next to `6. Direct adapter bypass without governance validation is denied` at `:726-731` (inside the mandatory negative-security `describe` at `:656`), reusing that test's `new KnowledgeAdapter(endpoint, options)` idiom at `:727`: construct `new KnowledgeAdapter("http://knowledge-bad.example.invalid:8000", { allowRemote: true })` and call `queryKnowledge({ action: "search", query: "x" })`; run `node --test tests/m7-t5-remediation.test.mjs` and the observable failing today is that `:223` short-circuits, so the call returns the swallowed transport failure `governed_status: "CONTROLLED_FAILURE"` / `error: "KNOWLEDGE_SERVICE_UNAVAILABLE"` at `:474-475` instead of refusing with `KNOWLEDGE_ENDPOINT_FORBIDDEN` (`:226`) or announcing the bypass.
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
- Evidence: Where: apps/knowledge/app/pdf_foundation.py:150-171 (helper at :110-111, :122-147; config at config.py:64) · Evidence: supplied_relative = sidecar_path.relative_to(vault_root), then canonical_vault_path(...) (:162) runs the link/reparse checks on a re-derived candidate root.joinpath(*posix.parts), while :169 sidecar_path.stat() and :171 sidecar_path.read_bytes() read the original, un-normalised object. · Expected/Actual: the validated candidate is the object subsequently opened / two path objects, one checked and one used. · R7-C (vị trí mới, gộp) — REJECTED by measurement 2026-10-18: `apps/knowledge/pdf-runtime/src/zink_pdf_runtime/runner.py:584-601` is NOT this defect. `_safe_source_path` returns the resolved object at `:601` and both callers open exactly that value (`:120-121` `_docling_extract(source, …)`, `:164-165` `pypdfium2.PdfDocument(source, …)`), re-checking `relative_to(root)` at `:598` and the suffix at `:599`, so the read handle does come from the validated candidate. What that site does carry is a check-then-resolve TOCTOU window (`:596` check, `:597` resolve) — a different mechanism, not a second instance of this row. · R7-E (vị trí mới, gộp): `apps/knowledge/app/markdown_adapter.py:370` đo bound kích thước trên `resolved.stat()` trong khi `:388` đọc `candidate.read_bytes()` — cùng topology hai lookup; và `:443-466`/`:321-336` cộng thêm nửa lỗi mới: cả hai helper trả `False` khi `lstat` raise (`except OSError: return False`), tức 'không đọc được metadata' được báo cáo là 'không có link'.
- Reproduction: static/code-read at HEAD — `pdf_foundation.py:436-450` (`_assert_no_link_or_reparse` lstats every relative component) and the discovery sweep at `:245-268`, which passes the rglob-discovered `sidecar` object straight into `parse_pdf_sidecar`, so `:169`/`:171` read an object that was never the validated candidate. Withdrawn by measurement 2026-10-18: the pointer to `database.py:235-266` was wrong — those lines are the fixed `/acceptance-backup-barrier` symlink gates and the string `vault` occurs 0 times in `apps/knowledge/app/database.py`.
- Acceptance criteria: the read handle comes from the validated candidate.
- Related findings: nguồn: E15 — untrusted-input security paths (5 findings; the… · R7-C delta audit C3: second live site merged here, then WITHDRAWN by measurement 2026-10-18 (see Evidence) · R7-E delta audit E1: hai vị trí nữa gộp vào đây; phần fail-open được ghi thành hàng riêng `F-325` vì cơ chế khác (chính sách fail-open, không phải hai lookup)

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
- Reproduction: An in-memory `node` probe of `applyWorkflowEvent` at HEAD (OPENED then APPROVE then CLAIMED then `WORKFLOW_RESULT_RECORDED` with `payload_digest` omitted) printed `RESULT_PENDING_REVIEW | has execution_payload_digest: false`, then `WORKFLOW_USER_RESULT_ACCEPTED`, `WORKFLOW_USER_RESULT_REJECTED` and `WORKFLOW_RESULT_REVISION_REQUESTED` each threw `RESULT_MISMATCH` — including when the verdict supplied its own `result_digest` — because `workflow.mjs:1583` runs before the `replayAnchored` escape at `:1600`. Gate in `tests/m7-lane-f-result-integrity.test.mjs` (owner of the M8-051/052/054 blocks) using the existing `makeGovernedTask` plus approval/claim sequence at `:393-417`: record `WORKFLOW_RESULT_RECORDED` without the `payload_digest` key, assert `readSnapshot(paths).tasks[taskId].workflow_status === "RESULT_PENDING_REVIEW"` with `execution_payload_digest` absent, then assert `recordWorkflowEvent(paths, "WORKFLOW_USER_RESULT_ACCEPTED", { task_id, actor: "user", channel: "results", decision: "ACCEPT" })` throws `{ code: "RESULT_MISMATCH" }` — the wedged review. Extend the M8-054 block (`:455-477`) to also assert the digest `finishExecution` mints at `queue-manager.mjs:720-723` appears in no journaled event, since `index.mjs:2428` records only the raw `payloadDigest`.
- Acceptance criteria: a task that entered `RESULT_PENDING_REVIEW` from a `WORKFLOW_RESULT_RECORDED` event whose `payload_digest` key was omitted is closed by one owner verdict - the probe's `WORKFLOW_USER_RESULT_ACCEPTED` commits instead of throwing `RESULT_MISMATCH` - and the queue projection and the ledger carry exactly one result digest for it, so the `queue-manager.mjs:720-723` fallback is either the digest journaled on that same event or removed.
- Related findings: adjudication Vòng 2: Verified, Medium kept · nguồn: A06 — task, run and session lifecycle · R7 delta audit: `F-248` kept as the `LATENT` successor of this row

### F-078 — a spawn reservation stuck in SPAWN_UNKNOWN has no timeout, no terminal event and no reconciler

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A06-08`
- Affected modules: Workflow topology + ledger, Workflow topology
- Severity: Medium
- Status: OPEN
- Root cause: one lost spawn receipt wedges a task (WORKFLOW_ROOT_RESULT_RECORDED → MISSING_PREREQUISITE) with no operator path forward.
- Evidence: Where: topology/lib/workflow.mjs:35, :400-406, :1081, :1811, :561-564; index.mjs:4857 · Evidence: activeRun includes SPAWN_UNKNOWN; only WORKFLOW_SPAWN_RECEIVED clears it; WORKFLOW_NATIVE_ENDED needs a matching native_run_id, which is unset, so a late child report fails LINEAGE_MISMATCH; awaitSpawnReceipt gives up after 10 s and records nothing while the authorizing lease lives 10 min.
- Reproduction: Gate in `tests/m7-lane-e-spawn-boundary.test.mjs`, extending the committed-reservation harness at `:230-266` (`makeTask` plus `buildSpawnProposal` plus a genuine `WORKFLOW_SPAWN_RESERVED`): after the reservation commits, assert `recordWorkflowEvent(paths, "WORKFLOW_NATIVE_ENDED", { task_id, native_run_id: "child-native", child_session_key, parent_session_key, outcome: "error" })` throws `{ code: "LINEAGE_MISMATCH" }` because `workflow.mjs:408-414` finds zero delegations with a `native_run_id` — it is set only by `WORKFLOW_SPAWN_RECEIVED` at `:1088`; assert a second reservation for the same node at attempt 2 throws `{ code: "SPAWN_UNKNOWN" }` via the `activeRun` gate at `workflow.mjs:1757-1763` plus `:43`; and assert — the red assertion a fix must invert — that some bounded, journaled reconciliation eventually moves the abandoned delegation to a terminal `run_state` without an owner-driven whole-task `WORKFLOW_CANCELLED` (`workflow.mjs:505-528`) or a budgeted brief supersede (`:1505-1506`). The waiter side is static: `awaitSpawnReceipt` (`index.mjs:4808-4864`) rejects with `EXECUTION_STATE_UNKNOWN` at its 10 s abort (`:4858`) while recording nothing to the ledger, though the invocation lease that authorized the spawn lives 10 minutes (`:4783`).
- Acceptance criteria: a delegation abandoned in `SPAWN_UNKNOWN` reaches a terminal `run_state` through a bounded, journaled reconciliation that survives replay, so `WORKFLOW_ROOT_RESULT_RECORDED` no longer fails `MISSING_PREREQUISITE` and a late child report against the unset `native_run_id` gets a defined terminal outcome instead of `LINEAGE_MISMATCH` - with no owner-driven whole-task `WORKFLOW_CANCELLED` and no budgeted brief supersede required.
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
- Reproduction: A pure in-memory probe at HEAD confirmed a duplicate `WORKFLOW_OPENED` projects byte-identical (`canonicalHash(current) === canonicalHash(projected)` printed `true`), so `recordWorkflowEvent` takes the `return current` branch at `ledger.mjs:677-681`: the caller receives the unchanged snapshot as success, zero lines are appended to `events.jsonl`, and no discard signal exists anywhere in the return. Gate in `tests/m8-t2.3-writer-semantics.test.mjs` using its existing harness (`recordWorkflowEvent(paths, "WORKFLOW_OPENED", OPENED(taskId))` at `:113`): record any event twice and capture the events-file line count and return value around the second call, then assert the writer's outcome is explicitly distinguishable — either a journaled discard/duplicate row (line count increments) or a returned marker such as `discarded: true` — which is red at HEAD because the second call returns the identical state and appends nothing, leaving the ledger unable to tell "arrived and was ignored" from "never happened". The forensics consequence is checkable the same way: after a duplicate `WORKFLOW_NATIVE_ENDED` is swallowed (`workflow.mjs:424-431`), assert the journal still shows the receipt was seen.
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
- Reproduction: Refutation check at HEAD, no live host needed: run `sha256sum integrations/openclaw/lib/discord-forum-tags.mjs` and compare against the digest the §3 release-gate cell records as installed (`PLAN.md:619-621`, `18fbb077…`) and the Deployment B evidence (`PLAN.md:5702-5706`) — they match exactly (`18fbb0774c18d013f599f562810932cfb80c4071c0614376d16f46c30fc256b3`), so the cell records the post-deployment build and a reader concludes the deployment DID happen. Then `grep -n e0a755bb PLAN.md` and verify every hit is a historical record — `:635` (the failed R3b apply), `:5489` (Deployment A's install), `:5548` (the admitted predecessor pin), `:5602`, `:5706` (the rollback counterfactual) — and never a current installed-build claim. No `npm test` suite gates `PLAN.md` content (`scripts/repository-policy.mjs:11` requires only the file's existence), so the gate is this two-command documentation check; the original defect (live `18fbb077…` vs recorded `e0a755bb…`) is not reproducible against the HEAD record.
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
- Reproduction: A two-sided probe at HEAD settled it: feeding each enum member through both layers printed `APPROVE | schema: OK | reducer: OK`, but `REJECT_RESULT`, `ACCEPT` and `REQUEST_REVISION_RESULT` each `schema: OK | reducer: SCHEMA_INVALID`, and `BLOCK` `schema: REJECT | reducer: SCHEMA_INVALID` — so three of the six schema-admissible values are dead letters that pass `validateContract("ledger-event", …)` and die at `workflow.mjs:729-734`, while `BLOCK` exists only as another event's constant (`workflow.mjs:681`, `WORKFLOW_USER_RESULT_BLOCKED`; likewise `ACCEPT` is the `WORKFLOW_USER_RESULT_ACCEPTED` constant at `:629`). Gate in `tests/m7-lane-d-decision.test.mjs` (Lane D decision-ledger authority): add a matrix over the `ledger-event.schema.json:1148-1156` enum asserting that every value the schema admits for `WORKFLOW_USER_APPROVAL_DECIDED.decision` is either accepted by `applyWorkflowEvent` or removed from the schema — red at HEAD for the three result-verdict members — plus an assertion that the authority vocabulary (`authority.mjs:52-79`) maps to ledger decision strings in exactly one reviewed place rather than only inside `index.mjs:1904-1915` and `:1988-1993`.
- Acceptance criteria: no writer that trusts the published contract can mint a replay-proof event the reducer refuses: every value `ledger-event.schema.json:1149-1156` admits for `WORKFLOW_USER_APPROVAL_DECIDED.decision` either commits in `workflow.mjs:729-734` or is gone from the schema, and the `authority.mjs:52-79` action names resolve to ledger decision strings through one reviewed mapping instead of only the inline channel ternary at `index.mjs:1904-1915`.
- Related findings: nguồn: A11 — contracts, schemas and canonical definitions

### F-086 — two "byte-equal" deployment post-checks report different denominators (35 vs 37) for a packaged set that did not change

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A13-06`
- Affected modules: Workflow topology, OpenClaw runtime libs, OpenClaw integration, Governance records
- Severity: Medium
- Status: OPEN
- Root cause: Register kết luận: two "byte-equal" deployment post-checks report different denominators (35 vs 37) for a packaged set that did not change. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: Where: PLAN.md:40, :88-89 (35) vs PLAN.md:5009 (37) · Evidence: git diff --stat b6d04e8 HEAD -- integrations/ shows only configure.mjs, lib/discord-forum-tags.mjs, operator-lock-recovery.mjs, operator-preflight.mjs; governancePluginFiles() asset lists (lib/policy.mjs:1182-1277) unchanged. Not settleable without executing the packager (readdirSync(topology/contracts)).
- Reproduction: Execute the packager read-only (`node -e` importing `governancePluginFiles()` from `integrations/openclaw/lib/policy.mjs`): at HEAD it yields 34 assets (20 `lib/` plus 12 `contracts/*.schema.json` plus `policy/reason-code-matrix.json` plus `governance-manifests.json`) plus entrypoint plus `openclaw.plugin.json` plus `package.json` = 37 paths, and `git ls-tree b6d04e8 integrations/openclaw/topology/contracts/` counts the same 12 schemas with the same 22 static list entries in `policy.mjs`, while `git diff --stat b6d04e8 0b55dfa -- integrations/` shows only 3 modified files (`configure.mjs`, `lib/discord-forum-tags.mjs`, `operator-preflight.mjs`) and no path added or removed — the packaged denominator was 37 at BOTH deployments, with 35 = assets + entrypoint (Deployment A's record checks manifest and package separately at `PLAN.md:5469-5470`). The contradiction is therefore still recorded at HEAD: `PLAN.md:5486` (also `:651`, `:663`) says 35 while `PLAN.md:5703` (also `:620`) says 37 for the same derivation, and the closeout's reconciliation at `PLAN.md:6684-6686` ("two correct counts of two different deployments") is contradicted by that arithmetic. Gate in `tests/m7-t2-plugin-packaging.test.mjs` (already imports `governancePluginFiles` at `:27`): pin the full denominator (`Object.keys(assets).length + 3 === 37`) so every future post-check reports one counting convention, and require the two `PLAN.md` records to state the convention explicitly.
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
- Reproduction: A pure in-memory probe at HEAD (guard built with the supported `_snapshotOverride`, `guard.mjs:700`/`:712`, over an OPENED snapshot): `beforeRunEnd({ success: false, yielded: true }, { agentId: "main", sessionKey, runId })` returned `{ allow: true }`, `{ success: false, lastAssistant: { stopReason: "error" }, yielded: true }` also returned `{ allow: true }`, while the control `{ success: false, yielded: false }` threw `EXECUTION_STATE_UNKNOWN` — a failed run passes the run-end gate with no terminal record whenever the yield flag rides along. The plugin's compensator never fires because `index.mjs:7399-7400` calls `guard.beforeRunEnd` directly and the `isProviderFailureEvent` handling at `:7416-7425` sits in the catch for THROWN errors, while this path returns without throwing. Gate in `tests/m7-lane-e-spawn-boundary.test.mjs` inside the M7-047 block (`:273-331`), which already drives `finishNativeRun` with `{ success: true, yielded: true }` (`:319-323`) and `{ success: false, lastAssistant: { stopReason: "error" } }` (`:294-300`): add the `{ success: false, yielded: true }` row and assert refusal with an explicit non-completion reason (`await assert.rejects(finishNativeRun(config, { success: false, yielded: true }, …))`) — red at HEAD, where it is admitted.
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
- Reproduction: Run `wc -c PLAN.md`, `wc -l PLAN.md` and `wc -w PLAN.md` (HEAD: 601,977 bytes / 7,225 lines / 80,372 words — about 4 passes through the 2,000-line read limit) and `awk '{ if (length($0) > max) { max = length($0); ln = NR } } END { print ln, max }' PLAN.md` (HEAD: line 60, 3,060 chars / 408 words in a single table cell), then confirm no structural check reads the file: `package.json:21-22` prettier globs and `.markdownlint-cli2.mjs:6-9` markdownlint globs both exclude `PLAN.md` and `AGENTS.md` (the latter also in `ignores`), while `.agents/skills/execution/SKILL.md:75` and `.agents/states/README.md:55`/`:128` still require reading `PLAN.md` whole before any write — the exact tension `AGENTS.md:124` ("read only what is needed") names. Gate in `tests/repository-policy.test.mjs` (the suite owning `collectRepositoryFailures`, which today only requires `PLAN.md`'s existence per `scripts/repository-policy.mjs:11`): add a policy assertion that `PLAN.md` is covered by an enforced structural budget — inside the markdownlint globs or a hard per-physical-line cell budget in the collector — which is red at HEAD because line 60 carries a 408-word cell and no linter reads the file.
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
- Reproduction: Static — read `integrations/openclaw/topology/fixtures/runtime-regression/live-governance-probe.mjs`: the production binding at `:25`/`:39` is a hardcoded constant with no `--state-dir` or env override, `openFixture` journals `WORKFLOW_OPENED` into the live ledger at `:94`, and the nested rehearsal performs six real delegated spawns and one stack transition whose budget counters the probe then asserts (`:241-242`) — so the probe can only PASS by incrementing `delegated_runs_used`/`transitions_used` in production state, permanently: the journal is an append-only hash chain with no removal path (`topology/lib/ledger.mjs:526-561`) and the synthetic tasks carry no schema-level rehearsal marker, only conventions (`zink-r12-probe-` session keys `:87`, `"a".repeat(64)` principal `:90`, `900000000000000000n + BigInt(Date.now())` message ids `:91`). Gate in `tests/m12-t2.2-b4-live-probe-invariants.test.mjs` (the live-probe invariants suite) using the scratch-state harness pattern of `tests/m12-t2-r4-orphan-lock-recovery.test.mjs:49`/`:64-68` (`--state-dir` into a `mkdtempSync` root): assert the probe's ledger target is injectable and that it refuses to `recordWorkflowEvent` against the hardcoded production root — red at HEAD, where neither holds. The live-side count of `zink-r12-probe-` tasks in `/home/hoang_vinh/.openclaw-zink/operator/m7-t2/ledger/snapshot.json` requires the WSL host.
- Acceptance criteria: `live-governance-probe.mjs` runs its rehearsal against a caller-supplied scratch state tree and refuses to start when its ledger target resolves to the hardcoded production root, so `delegated_runs_used === 6` and `transitions_used === 1` at `:241-242` are asserted about a task that exists only in that scratch tree and the production snapshot and journal gain no probe task, no probe event and no probe-incremented counter.
- Related findings: nguồn: B03 — governance / ledger / audit integrity (10 claims…

### F-091 — the digest is computed once per process and nothing in its key can change at runtime, so after a PDF runtime/manifest/tokenizer change a long-lived /readyz probes forever against a stale expectation — permanent false not_ready (replica…

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R5-E01-02`
- Affected modules: Zink Knowledgebase
- Severity: Medium
- Status: LATENT
- Root cause: the digest is computed once per process and nothing in its key can change at runtime, so after a PDF runtime/manifest/tokenizer change a long-lived /readyz probes forever against a stale expectation — permanent false not_ready (replica marked unhealthy) or green readiness that no longer predicts the run path, which recomputes fresh each run (index_lifecycle.py:254-256). The P3-07 memo was keyed on configuration paths rather than on the content it hashes.
- Evidence: Where: main.py:238-297 (readyz_pdf_identity, cache_key) with pdf_runtime.py:81-91 · Evidence: the memo's comment at :236-237 promises "recomputed only if one of those inputs changes", but cache_key (:284-291) is 3 embedding fields plus str(lock_path), str(manifest_path), str(tokenizer_path) — all path strings — while the memoized value is content-derived (runtime_lock_digest = _sha256_file(runtime_lock_path), pdf_runtime.py:89-91, and sha256_file(configured_settings.tokenizer_path) at main.py:146).
- Reproduction: Gate in `apps/knowledge/tests/test_b20_readyz_attribution.py` reusing its `pdf_enabled_app()` harness (`:84-116`), its `readyz()` ASGI helper (`:77-82`) and its `patch("app.main.processing_identity_for_runtime", ...)` idiom (`:228-231`): wrap the helper in a counter that returns a different identity per call, patch `app.state.pdf_runtime.probe` (the same object `main.py:321` awaits, exposed at `main.py:221`) with an `AsyncMock` so the PDF branch completes, call `/readyz` twice on the same app after rewriting `pdf_runtime_lock_path` in place with different bytes at the unchanged path, and assert the identity helper ran twice and that `probe` was handed the second identity - red at HEAD, where `main.py:312` compares the `cache_key` of `main.py:303-310`, whose PDF terms are only `str()` of the three paths (`:307-309`) and cannot change at runtime, so the memo replays the pre-change digest and the probe is checked against an identity the run path (`index_lifecycle.py:254-256`) no longer computes; run it with `uv run --directory apps/knowledge --locked python -m pytest tests/test_b20_readyz_attribution.py -q` with `KNOWLEDGE_TOKENIZER_PATH` exported to the pinned tokenizer, because without it the module self-skips at `:30-36` and the gate is NOT RUN rather than passed.
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
- Reproduction: Static — `recover_interrupted_runs` (`database.py:1519-1565`) opens one `_mutation_transaction` (`:1522`), marks every `BUILDING` index `FAILED` (`:1547-1555`), then collects every `status='FAILED'` index id in the whole table into a single list (`:1559-1561`) and hands it to `_purge_index_content`, whose loop (`:1640-1646`) issues exactly one `DELETE FROM knowledge.segments WHERE index_id = ANY($1::uuid[])` (`:1641`) for that entire list under the pool's `command_timeout=30` (`:191`); `main.py:185` awaits it in the `lifespan` body with no `try`, so an `asyncpg` cancellation there escapes the context manager and startup never reaches `yield` (`:199`). Gate the red test in `apps/knowledge/tests/test_m11_index_hygiene.py` — run by `npm run test:knowledge`, not `npm test` — beside `test_startup_recovery_prunes_content_of_interrupted_shadows` (`:218-234`), reusing the `FakeConnection` recorder (`:51-85`) and `FAILED_INDEX_CONTENT` (`:122-126`): return 5,000 `{"id": ...}` rows from the `WHERE status = 'FAILED'` fetch and assert exactly one call carried `FAILED_INDEX_CONTENT[0]` with `len(args[0]) == 5000`, which fails the moment the sweep is chunked. Add a companion case whose `FakeConnection.execute` raises `asyncio.TimeoutError` on the first `DELETE` and assert `recover_interrupted_runs` neither retries nor leaves the transaction half-applied — today it propagates the first time and re-deletes the whole set on the next boot.
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
- Reproduction: Static — a repo-wide grep for `DEPRECATED`/`deprecate` across `zink-skill-store`, `zink-tools` and `integrations/openclaw` returns no writer at all: only the status set (`catalog.mjs:45`), the legal-sequence list (`:419-425`), the conflict message telling the caller to deprecate (`:1331`), the two refusal gates (`skill-adapter.mjs:43`, `integrations/openclaw/lib/policy.mjs:465-467` returning `SKILL_ACTION_DENIED`), and operator-facing prose promising the route exists (`index.mjs:3749-3750`, `discord-formatter.mjs:377`); the operator CLI implements only `validate` and `get` (`bin/skill-store.mjs:59`, `:69`). Gate in `tests/m11-t1-skill-governance.test.mjs` beside `M11-04: concurrent in-process promotions serialize; one ACTIVE, one conflict` (`:215-251`), which already reaches a real `SKILL_ACTIVE_CONFLICT` via `freshRoots()`. From that same conflicted store, assert that at least one supported route withdraws the wrong version: today re-promoting the ACTIVE version with different bytes throws `SKILL_VERSION_CONFLICT` (`catalog.mjs:1285-1288`), `executeCli(["deprecate", ...])` returns exit `4` `CLI_INPUT_INVALID`, `querySkillStore({ action: "deprecate" })` hits `FORBIDDEN_ACTIONS`, and `evaluateToolAccess` denies it — so an assertion that some call appends a third `{ status: "DEPRECATED" }` lifecycle event and lets the second version promote is red, and `scanCatalog(skillsRoot).records.length` stays pinned at `1` forever.
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
- Reproduction: Probe run this session: `node -e` against `promoteApprovedSkillUnlocked` with five distinct bad inputs (version `1.0`, empty `content`, `sourceType: 'nope'`, `references: [{ type: 'git', ref: 'not-a-sha' }]`, `requestingActor: ''`) printed `code: SKILL_IDENTITY_INVALID` for all five, separated only by `details` — `["IDENTITY_GRAMMAR"]`, `["CONTENT_EMPTY"]`, `["PROVENANCE_SOURCE_TYPE_INVALID"]`, `["PROVENANCE_REFERENCE_ITEM_INVALID"]`, `["LIFECYCLE_ACTOR_EMPTY"]`; a second probe, `executeCli(["validate"], null)`, printed `exitCode: 1` with `{"error":{"code":"OPERATIONAL_FAILURE","message":"Skill Store operation failed.","details":[]}}`, and the CLI's `catch` at `bin/skill-store.mjs:103` has no binding so `error.code`/`error.details` are unreachable by construction. Meanwhile `CATALOG_INVALID` covers three unrelated store states — pre-existing catalog errors (`catalog.mjs:1311-1320`), staged-record validation failure (`:1370-1378`) and post-publish re-validation with rollback (`:1413-1434`) — and `SKILL_ACTIVE_CONFLICT` carries `details: []`. Gate in `tests/m11-t1-skill-governance.test.mjs`: drive the promotion caller's `catch` (`index.mjs:1120-1141`) once with an invalid identity and once against a poisoned tree, and assert the two yield distinguishable host-visible outcomes and proposal states — today both fall through to the raw `throw error` at `:1140` with no `CONFLICTED`/retry signal. Add the CLI half to `tests/m6-t1-skill-store.test.mjs` inside `enforces CLI exit codes and output channels` (`:570-600`), asserting `JSON.parse(result.stderr).error.details` is non-empty and the code is not the blanket `OPERATIONAL_FAILURE` for a fault the writer already classified.
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
- Reproduction: Probe run this session: `git check-ignore -v docs/contracts/execution/ACTIVE.md` printed `.gitignore:61:/docs/contracts/execution/ACTIVE.md`, and `git status --ignored --short .agents` printed `!!` for `.agents/states/context.md`, `handoff.md`, `b8-pending-admission.md`, `b9-pending-admission.md`, `b16-pending-admission.md` and `wave-b-premises.md` — so no diff, no `npm run verify` stage and no CI job can ever observe an edit to the file `AGENTS.md:13`/`:65` names as the sole source of truth for frozen implementation details. Gate in `tests/repository-policy.test.mjs`, already in the `npm test` list and already the suite that pins repository policy through `scripts/repository-policy.mjs` (whose `REQUIRED_FILES` at `:6-15` only asserts `.gitignore` exists): add a test that fails while any path `AGENTS.md` §2 names as an authority source is `git check-ignore`-matched and no tracked artifact records its content or digest — red today on `/docs/contracts/execution/ACTIVE.md` — and a companion assertion that `docs/execution/findings.md` appears in `git ls-files`, which is green at HEAD and pins the half that was already fixed.
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
- Reproduction: Static — every `readSnapshot` takes the writer lock for the whole read (`ledger.mjs:192-194` then `:481-485`), slurps the entire event log into memory (`:286-289`) and re-runs `JSON.parse` plus `validateContract("ledger-event", event)` plus `canonicalHash` chain verification plus `applyWorkflowEvent` for every line including the anchored prefix the snapshot already sealed (`:340-394`, with `:386-387`), and a grep for `compact|checkpoint|truncate|archiv` in `ledger.mjs` returns only the unrelated path-suffix helper at `:65`, so cost is O(total history) with no compaction. The lock is fail-fast, not queued: `withFileLockSync` throws `FILE_LOCK_BUSY` immediately when `tryAcquire` fails (`integrations/openclaw/lib/file-lock.mjs:356-359`) and `withWriterLock` relabels it `EXECUTION_STATE_UNKNOWN` (`ledger.mjs:487-492`), so a longer replay widens the busy window directly. There are 33 `readSnapshot(paths)` call sites in `integrations/openclaw/plugins/zink-governance/index.mjs`, including the four cited (`:1864`, `:2229`, `:4809`, `:4971`), several of them per-interaction (`:4851`, `:5434`, `:6896`). Gate in `tests/m8-t2-anchored-replay.test.mjs`, which already imports `ensureLedger`, `ledgerPaths`, `readSnapshot` and `recordWorkflowEvent` (`:6-11`) and builds temp ledgers: journal N=500 then N=5,000 anchored `WORKFLOW_*` events, time one `readSnapshot` in each, and assert the 10x-larger journal costs less than 3x as long — red today, where the ratio tracks the line count.
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
- Reproduction: Static — the schema admits `TASK_CREATED` and `DELEGATION_RESERVED` (`ledger-event.schema.json:60-62`), but the anchored replay loop (`ledger.mjs:340-394`) has no branch for either, so below the snapshot head they pass chain verification and contribute nothing to `journalBudget` or `snapshot.tasks`, while the tail loop (`:420-450`) throws `unreconciled event after snapshot` for anything that is neither `WORKFLOW_*` (`:421`) nor `BUDGET_RESERVED` (`:435-436`) and the outer `catch` relabels it `EXECUTION_STATE_UNKNOWN` / `Ledger corruption: trusted state cannot be verified` (`:472-477`), permanently. That tail position is reachable, not hypothetical: `appendEventLocked` fsyncs the event (`:548-549`) before writing the snapshot (`:559`), so a crash in between leaves a schema-valid audit event that bricks every later read. Gate in `tests/m8-t2-anchored-replay.test.mjs` (it already builds temp ledgers and imports `ensureLedger`/`ledgerPaths`/`readSnapshot` at `:6-11`): append one `TASK_CREATED` via `appendEvent`, roll `paths.snapshot` back to `sequence: 0` / `last_event_digest: null` to reproduce the crash window, and assert `readSnapshot(paths).sequence === 1` rather than a throw — today it throws `/Ledger corruption/u`, while the identical test with a `WORKFLOW_*` or `BUDGET_RESERVED` tail event recovers at `:421-449`.
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
- Reproduction: Add a case to `apps/knowledge/tests/test_index_lifecycle.py` (lane `npm run test:knowledge`, or scoped `uv run --directory apps/knowledge --locked python -m pytest tests/test_index_lifecycle.py -q`; read the printed pass/fail counts, not the exit code) that reuses that file's `FakeDatabase` (:64) and its `fail_replace_for` fault-injection idiom (:68, :92) to make `cleanup_superseded` (:108) raise, then awaits `IndexLifecycle.cleanup` with the id `old-index` on an instance built by the `lifecycle()` helper (:112) and asserts one attributable record survives - a `fail_run` entry in `database.failures` (:69, :106) naming a code, or a preserved `__cause__`; it is red today because `index_lifecycle.py:435-440` swallows the fault and returns `None`, leaving `database.failures` empty with no other channel in `apps/knowledge/app/` able to record it.
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
- Reproduction: Probe run this session: `grep -rn source_sidecars` over the working tree (excluding `scratch/`, `backups/`, `temp/` and the register) returned exactly four hits — the DDL at `001_initial.sql:87`, the comment at `database.py:1643`, `PLAN.md:2010`, and the two source-text assertions in `tests/m3-t1-contract.test.mjs` (`:114-117` and the bare existence match at `:132`); no `INSERT`/`SELECT`/`UPDATE` in `apps/knowledge/app/*.py` names the table, and `accept_incremental` (`database.py:872-964`) clones `sources` (`:911-924`), `segments` (`:925-948`) and `pdf_source_details` (`:949-963`) but never `source_sidecars`, so any sidecar row a future writer adds is silently dropped from every shadow index. The same dead-pin shape covers the other two locators: `001_initial.sql:70` admits `'IMAGE'`/`'VIDEO'` while `database.py:1097-1099` only ever assigns `'MARKDOWN'`/`'PDF'` and `main.py:83` types the filter as a literal list of those two, and `time_start_ms`/`time_end_ms` (`:117-118`, CHECK at `:133-134`) appear in app code only inside `accept_incremental`'s verbatim copy list (`database.py:931`, `:938`), never as a written value. Gate in `tests/m3-t1-contract.test.mjs` (in the `npm test` list): replace the existence-only assertion at `:132` with one that reads `apps/knowledge/app/` and asserts that either an `INSERT INTO knowledge.source_sidecars` exists or `001_initial.sql` no longer declares the table — red today, and green under either resolution the owner picks.
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
- Reproduction: Probe run this session: a `node -e` script started a stub `http.createServer`, called `executeGovernedKnowledgeQuery({ action: 'search', namespace: 'core', query: 'q' }, ctx, { endpoint })` with the exact `ctx` the live plugin builds (`index.mjs:3560-3566`, i.e. `{ sessionKey: 'sess-1', runId: 'run-1', taskId: 'attacker-chosen-task', requestingAgent: 'o1' }`) and printed the received request headers — output was `x-task-id: attacker-chosen-task` with `x-agent-id: undefined`. So `if (context.agentId)` (`knowledge-adapter.mjs:305`) never fires because no caller sets that key — the trusted identity is computed at `index.mjs:731-733` and stored under `requestingAgent`, which the adapter never reads — while `X-Task-Id` (`:304`) forwards the model-supplied `params.task_id`, a declared tool parameter (`index.mjs:3549-3552`). Gate in `tests/m7-t5-remediation.test.mjs` inside the `T5.7 & T5.8 — Governed Runtime Adapters (BUG-07, BUG-08)` describe block (`:490`), reusing the stub-server pattern already at `:533-544`: capture `req.headers`, call `executeGovernedKnowledgeQuery` with the live `ctx` shape, and assert `headers["x-agent-id"] === "o1"` — red today. Add companion assertions that `X-Attempt-Token` (`knowledge-adapter.mjs:307-308`) is likewise never populated on this path and that a `task_id` the caller did not earn is not forwarded as bare correlation with no identity beside it.
- Acceptance criteria: Every live `zink_knowledge_search` call sends the identity the runtime derived instead of none: the plugin's context key and the adapter's read agree so `X-Agent-Id` carries `deriveTrustedRequester(_id)` on every governed call, `X-Task-Id` carries a task binding checked against the ledger or is omitted rather than the raw model-supplied `task_id`, and a test on that call path pins both header values for a payload that tries to name a different task and a different agent.
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
- Evidence: Where: integrations/openclaw/orchestration/patterns/index.mjs:33-421 (executePattern1_N8nToR2Landing … executePattern10_SyntheticComposition), integrations/openclaw/orchestration/README.md · Evidence: exports stitch landing/silver/gold tiers, MLflow/DagsHub, workflow_id: "data_plant_ingest"; the only consumer is tests/m7-t4-orchestration.test.mjs; no configure.mjs, plugin or lib/ import. · Expected/Actual: AGENTS.md §9 + docs/architecture/lsc-data-flow.md:60-69 forbid an in-repo ETL control plane, a Bronze/Silver/Gold lakehouse, and "a second orchestrator that duplicates OpenClaw/n8n". Actual: the repo ships exactly that, green-tested. · R7-C (đo lại phạm vi): the isolation is wider than the patterns file itself — `grep -rniE "bigquery|motherduck|streamlit|databricks|kaggle|dagshub|huggingface|mlflow" integrations/openclaw/plugins/` returns zero hits, the only importer of `zink-tools/adapters/index.mjs` repo-wide is `tests/m7-t4-orchestration.test.mjs:25`, and the only importer of `orchestration/patterns/index.mjs` is that same test at `:38`. All eight provider adapters under `zink-tools/adapters/{analytics,app,compute,mlops}` are therefore exercised only by that suite, which is why the C2 defects in those files are recorded as LATENT.
- Reproduction: `node --test tests/m7-t4-orchestration.test.mjs` → 12 pass / 0 fail today, which is the point: the forbidden surface is green-tested (it includes 'Gate G9/G10: Orchestration Patterns P6-P9, Synthetic Composition P10'). Measure the isolation: grep 'orchestration/patterns|executePattern' shows importers are only that test plus README.md:522, orchestration/README.md and zink-tools/python/README.md:33, and configure.mjs, plugins/ and lib/ import none. Pin the invariant in tests/repository-policy.test.mjs: no tracked, test-enforced module may export landing→silver→gold tiers or an MLflow/DagsHub sync chain.
- Acceptance criteria: No tracked, test-enforced module in this repository stitches landing/silver/gold tiers, a model-registry sync, or a composition function that sequences them; the data/compute flow exists only as the external contract in docs/architecture/lsc-data-flow.md.
- Related findings: nguồn: A01 — architecture and system boundaries · R7-C delta audit C2: measured no-production-importer for all eight adapters; their defect rows (F-276–F-281) are LATENT by this row's finding

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
- Reproduction: Add a case to `tests/duckdb-bridge.test.mjs` (lane `node --test tests/duckdb-bridge.test.mjs`, currently 17 pass / 0 fail / 0 skipped on this host) reusing that file's `validContext` and `validDatabase` constants (:10-12), the `{ skip: duckDbSkip() }` guard from `tests/helpers/duckdb-availability.mjs`, and the parameterized call shape of Gate 5.6 (:211-217) with a benign value - a SELECT on `knowledge` filtered by a `:category` placeholder plus a one-element `parameters` array naming `category` with value `silver` - asserting the Gate RC09.1 outcome (rows returned, `provider` equal to `duckdb`); it is red today because the call throws `DuckDbBridgeError` code `DUCKDB_EXECUTION_ERROR` (`duckdb-bridge.mjs:297-302`) after `validateParameterBinding` accepted the pair, since `initSql` (:251-258) interpolates only `input.query` and `parameters` is never read again.
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
- Reproduction: Static — `git ls-files platforms/` returns 8 files (`platforms/README.md`, `platforms/knowledge-platform/README.md`, `stores/README.md`, `stores/research-knowledge-store/README.md`, four `.gitkeep`) in a scaffold whose directory names include `knowledge-ai/`, `services/knowledge-api/`, `stores/research-knowledge-store/`, while a case-insensitive grep for `platforms/|Knowledge Platform|knowledge-platform` across `docs/architecture/` returns zero matches and `docs/architecture/README.md:6-12` still indexes exactly 7 docs, none owning the tree (the register's "7 files" is now 8). Gate it in `tests/repository-policy.test.mjs`, which already drives `collectRepositoryFailures`/`checkRequiredFiles` from `scripts/repository-policy.mjs`: add an assertion that every tracked top-level directory is named by at least one canonical doc under `docs/architecture/`, which today fails only for `platforms/`. For triage: `PLAN.md:2055` and `platforms/README.md:17-19` now annotate the tree as "canonical target-architecture spec, not a runtime", so what remains is the missing architecture-doc ownership, not a competing runtime claim.
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
- Reproduction: Static — all four silent defaults are in place at HEAD: a delegation with no recorded `stack_id` and no matching task node resolves to `data_plant` at `guard.mjs:1724-1728` and then passes the scope assert at `:1735-1738` instead of being denied, and an agent id absent from the plugin's private `CANONICAL_AGENT_PRIMARY_STACK` (`index.mjs:7014-7022`) silently receives `data_plant` nodes at `index.mjs:7040`, `:7061-7063` and `:7348-7357` (register cites `7023`/`7044-7046`/`7331-7340` — drifted). None of the four sites consults the canonical `AGENT_STACK_POLICY` (`lib/authority.mjs:573-587`, re-exported at `lib/policy.mjs:607`), so an unknown agent is granted `data_plant` scope rather than a named refusal. Gate it in `tests/m12-t2.2-a1-stack-authority.test.mjs`, which already drives the real guard over a real ledger and reads `AGENT_STACK_POLICY` through `lib/policy.mjs`: add a red assertion that a delegation missing both `stack_id` and a matching node fails with `AUTH_SCOPE_MISMATCH` (or `AUTH_DELEGATION_NOT_FOUND`) instead of resolving to `data_plant`, plus a source-level assertion that no `|| "data_plant"` or `?? "data_plant"` fallback remains outside the policy table; the brief-activation sites are reachable through `tests/m10-t2-coordinator-binding.test.mjs` (whose own `nodeDef` helper at `:310` mirrors the same default).
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
- Reproduction: Static — the published vocabulary declares a state nothing can produce: the owner's live #approvals tag set includes `STATUS: EXPIRED` (`PLAN.md:5369`, pinned as a real tag name at `tests/m12-t2-forum-tags.test.mjs:42`), but `approvalStatusTag` (`lib/discord-forum-tags.mjs:509-514`) can only return `WAITING/APPROVED/REJECTED/CHANGES`, `workflow_status` has no `EXPIRED` member (`ledger-snapshot.schema.json:138-153`), and approval requests written with `expires_at` (`index.mjs:3752`) are expiry-checked only when presented to `bindInvocationApproval` against the caller-injected `currentTime` (`guard.mjs:373-376`; `:1226` `const currentTime = nowFn();`). A grep for sweeper or timer logic over `plugins/zink-governance/index.mjs` and `topology/lib/*.mjs` finds none for approvals, so an unanswered approval stays `WAITING` forever and `EXPIRED` is producible only for skill candidates (`index.mjs:994-1004`). Gate it in `tests/m8-t2.4-approval-request.test.mjs` (which already owns the recorded-approval-request lifecycle): add a red test asserting that a recorded approval request whose `expires_at` has passed reaches a durable expired verdict without being presented, and in `tests/m12-t2-forum-tags.test.mjs` assert either that some governed path can transition a card to `STATUS: EXPIRED` or — if the owner decides to shrink the vocabulary instead — that the published approvals vocabulary no longer advertises `EXPIRED`.
- Acceptance criteria: An approval nobody answers stops being answerable: the workflow approval status vocabulary admits a terminal expired value, a named producer (a sweeper or a read-time derivation) writes it once the recorded `expires_at` has passed, the task leaves its pending state instead of waiting indefinitely, a decision presented against an expired card is refused with a code naming expiry rather than applied, and a test that moves the clock past `expires_at` asserts both the written status and the refusal.
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
- Reproduction: Static — the live implementation is below its published contract on all three counts: a repo-wide grep for `template_path` (with quoted `--include="*.mjs"` and `--include="*.json"`) finds only the schema (`zink-tools/contracts/tools/zink-excel.schema.json:25`) and the advertised parameter (`index.mjs:3814-3819`) — `executeExcelOperation` (`lib/excel-writer.mjs:167-315`) never mentions `template` and routes `populate` into the same generate branch at `:253`; `generate` reads only `specification.sheets[0]` (`:255-256`, `:273-274`) and `buildWorkbookBuffer` emits exactly one `worksheets/sheet1.xml` (`:148-161`), so `sheets[1..]` is dropped silently; `load` returns hardcoded `sheets: ["Sheet1"]` (`:233`) without opening the workbook; and `validate` is `valid: exists` from a bare `fs.existsSync` (`:240-247`) that echoes the caller's `rules` back as `rules_checked` (`:248`) without evaluating any. The tool is live, not a stub: `index.mjs:3844-3862` calls `executeExcelOperation` whenever `getExcelWriter()` resolves. Gate it in `tests/m8-t2-governed-runtime-audit.test.mjs`, which already imports `executeExcelOperation` (`:82`): add red assertions that a two-sheet `specification` round-trips through `load` reporting both sheet names, that `validate` on a zero-byte `.xlsx` reports `valid: false`, and that `populate` with a `template_path` either consumes it or is refused with a named error rather than ignoring it.
- Acceptance criteria: `zink_excel` matches its advertised contract or the contract is narrowed to what runs: `populate` with a `template_path` reads that template and preserves its sheets, formatting and formulas instead of regenerating from `data`, `generate` writes every sheet in `specification.sheets` rather than only the first, `load` reports the workbook's real sheet names instead of a hardcoded `Sheet1`, and `validate` evaluates each entry of `rules` and returns a per-rule verdict instead of `valid: exists` - with any capability left unimplemented refused by an explicit error code and never reported as a success.
- Related findings: nguồn: A10 — Zink Tools, adapters and execution contracts

### F-127 — outcome_status is copied six times and the reason-code matrix declares an outcome no schema can express

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R1-A11-03`
- Affected modules: Workflow topology + ledger, Workflow topology
- Severity: Medium
- Status: OPEN — _(same family as R1-A04-05; both are "matrix is de-facto authority")_
- Root cause: editing the matrix silently re-labels history or rejects writes for undeclared outcomes; agent-result-payload renames the same set to outcome_claim.
- Evidence: Where: topology/policy/reason-code-matrix.json:71-107 (COMPLETE|PARTIAL|BLOCKED|FAILED|CANCELLED) vs ledger-event.schema.json:1481,1492, ledger-snapshot.schema.json:306, execution-brief.schema.json:35-38, agent-result-payload.schema.json:23 (all 4 values), topology/lib/runtime.mjs:91,194-203 (re-declared as a regex); workflow.mjs:507 hardcodes ["OWNER_CANCELLED","PARENT_CANCELLED"] instead of reading the matrix row, dropping SUPERSEDED_REVISION; brief_state: SUPERSEDED (ledger-snapshot:136) has no writer
- Reproduction: Static — the outcome vocabulary is still re-declared independently in six places (`ledger-event.schema.json:1481` and `:1492`, `ledger-snapshot.schema.json:306`, `agent-result-payload.schema.json:23`, `execution-brief.schema.json:33-40`, `runtime.mjs:148` plus the array copy at `:286`), and the matrix's `CANCELLED` row (`reason-code-matrix.json:103-107`, including `SUPERSEDED_REVISION`) still names an outcome no `outcome_status`-family enum can hold. The reducer ignores that row: `workflow.mjs:514-517` hardcodes `["OWNER_CANCELLED", "PARENT_CANCELLED"]` for `WORKFLOW_CANCELLED` (register cited `:507`; drifted to `:515`), so a `SUPERSEDED_REVISION` cancellation is refused `POLICY_DENIED` even though the code is a live refusal elsewhere (`workflow.mjs:1264,1625,1647,1711`; `guard.mjs:1297,1982`), and `brief_state: SUPERSEDED` still has no writer — every `brief_state` assignment in `workflow.mjs` writes `"ACTIVE"` (`:380`) or `"CLOSED"` (`:526,609,636,654,757`). Gate it in `tests/m12-t2.2-b8-reason-policy.test.mjs` (which already asserts `outcome_compatibility` is an object but never cross-checks it against the schemas): add a red assertion that every outcome enum in `topology/contracts/` equals one shared vocabulary and that each `outcome_compatibility` key is expressible in some schema field, plus a case in `tests/m7-lane-a-workflow.test.mjs` (which already drives `WORKFLOW_CANCELLED` at `:194-238`) feeding `reason_code: "SUPERSEDED_REVISION"` with `actor: "main"` and asserting the reducer's verdict matches the matrix row.
- Acceptance criteria: One declaration owns the outcome vocabulary and every consumer derives from it: the four-value outcome set is declared once or generated instead of being re-listed in `ledger-event.schema.json:1481` and `:1492`, `ledger-snapshot.schema.json:306`, `trusted-result-envelope.schema.json:76`, `agent-result-payload.schema.json:23` and the `runtime.mjs:148` regex; every outcome `reason-code-matrix.json` declares under `outcome_compatibility`, including `CANCELLED` with `SUPERSEDED_REVISION`, is expressible by the schema that carries it; the `WORKFLOW_CANCELLED` handler reads the matrix row instead of a hardcoded pair; `brief_state: SUPERSEDED` either gains a writer or leaves the enum; and a test fails when the matrix and any schema enum disagree.
- Related findings: đã sửa/xóa khỏi file: R1-A04-05 · nguồn: A11 — contracts, schemas and canonical definitions

### F-128 — the published contract version is fabricated, and schema files resolve through process.cwd()

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R1-A11-05`
- Affected modules: Workflow topology + ledger, Workflow topology, Zink Tools
- Severity: Medium
- Status: OPEN
- Root cause: version-level drift is invisible to any consumer comparing manifest versions — only sha256 moves, and only when verifySchemaManifestChecksums runs; a missing repo-relative copy lets a different cwd supply a same-named schema (compounds R1-A02-01/02).
- Evidence: Where: topology/lib/schema.mjs:139-148 (candidates 7–8), :381, :394 · Evidence: version = parsed["x-zink-contract-version"] || parsed.version || "1.0.0" — no governance contract carries the marker, so all 12 report "1.0.0" regardless of content (only zink-tools/* sets it, and zink-skill is 1.1.0 while its peers are 1.0.0); the tools loop at :394 omits the parsed.version fallback used at :381; contract lookup can fall back to process.cwd()/zink-tools/contracts[/tools].
- Reproduction: Probe plus static — run `node -e "import('./integrations/openclaw/topology/lib/schema.mjs').then(m => console.log(JSON.stringify(m.generateSchemaManifest().contracts)))"` from the repo root: it prints `version: "1.0.0"` for all 12 governance contracts, because a per-file probe shows none of them carries `x-zink-contract-version` or a top-level `version`, so `schema.mjs:385` always falls through to the fabricated literal regardless of content (only `zink-tools/contracts/*` set the marker, where `zink-skill.schema.json:5` is `1.1.0` while all 12 peers are `1.0.0`). The tools loop is asymmetric — `schema.mjs:402` omits the `parsed.version` fallback that `:385` has (register cited `:381`/`:394`; drifted to `:385`/`:402`) — and `resolveContractFilePath` candidates 7-8 (`:139-148`) resolve through `process.cwd()/zink-tools/contracts[/tools]`, so a run whose cwd contains another `zink-tools/` tree (the repo even carries one at `scratch/wt-discord-idle-reset/zink-tools/`) silently validates against files outside the repository root. Gate it in `tests/m12-t2.2-b9-manifest-completeness.test.mjs`, which already drives `generateSchemaManifest()` and reads `schema.mjs` source: add a red assertion that every published contract `version` comes from a marker inside the schema file (a schema edited without its marker must fail, not publish `1.0.0`), that both loops use the same fallback chain, and that `resolveContractFilePath` returns an identical path when invoked with `process.cwd()` pointed at a temp directory containing a decoy `zink-tools/contracts/` tree.
- Acceptance criteria: The published manifest states a version that comes from the contract rather than from a default: every canonical governance contract and tool schema carries an explicit `x-zink-contract-version`, or the manifest reports the version as unknown instead of printing `1.0.0`, both manifest loops derive it identically, and schema resolution is repository-relative only so no `process.cwd()` candidate can supply a same-named file to `generateSchemaManifest` or `verifySchemaManifestChecksums` - proven by a test in which a version bump is visible in the manifest without any hash comparison and resolution from a foreign cwd finds nothing.
- Related findings: bug mở: R1-A02-01 · nguồn: A11 — contracts, schemas and canonical definitions

### F-129 — governance docs no longer describe reality: executor role, validation vocabulary, branch discipline

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R1-A15-07`
- Affected modules: Architecture + contracts docs, Governance records
- Severity: Medium
- Status: OPEN
- Root cause: "DEPLOYED AND VERIFIED" coexists with an undefined NOT TESTED for the acceptance behaviour that actually matters — M12/T2-R2 was declared verified while all three surfaces were untested, and they broke the next day. The branch drift is silent integration risk.
- Evidence: Where: AGENTS.md:98-116 (names "dsh — executor") vs .agents/skills/{execution:108,116-120, code-review:64, planning:176, validating:90} (all name "Cursor", which AGENTS.md never defines); AGENTS.md:287-291 statuses PASS|FAIL|NOT RUN vs NOT TESTED used 12× in PLAN, 6× in CHANGELOG; docs/development/conventions.md:12-16 ("merge vào main qua pull request") vs measured branch topology: HEAD is 144 commits ahead of local main (f03ee4a, 2026-09-17) and local main is 66 behind origin/main.
- Reproduction: Static plus read-only git — two legs reproduce exactly and one has changed shape. (1) Executor role: run `grep -rn "Cursor" .agents/skills/*/SKILL.md` — `execution:108,116,118`, `code-review:64`, `planning:176`, `validating:90` all route procedure through a `Cursor` role that `AGENTS.md` §3 never defines (it defines `dsh — executor` at `:98-115`; `Cursor` survives only in the audience line `:3`). (2) Branch discipline: `docs/development/conventions.md:10` (register cited `:12-16`; drifted up two lines) still mandates merging to `main` via pull request, while `git rev-list --count main..HEAD` prints 249 on branch `codex/m11-t1-audit-remediation`, local `main` sits at `f03ee4a` (2026-09-17) and is 66 behind `origin/main` (`c40aa71`, 2026-10-01), and `AGENTS.md` §12 forbids PR creation/merge without separate owner authorization — the two governance docs prescribe incompatible publication flows. (3) Vocabulary: `AGENTS.md:287-291` still lists exactly `PASS|FAIL|NOT RUN` while `NOT TESTED` now appears 25 times in `PLAN.md` and 7 times in `CHANGELOG.md`, but `PLAN.md:28-43` has since formally defined `NOT RUN`/`NOT TESTED`/`NOT DEPLOYED` as evidence verdicts distinct from gate validation statuses, so the residual defect is that `AGENTS.md` §11 owns only one of the two vocabularies its own plan file uses. Gate it in `tests/repository-policy.test.mjs` (whose `scripts/repository-policy.mjs:844-860` already reads `docs/development/conventions.md` for the gate registry): add a red assertion that every role name appearing in `.agents/skills/*/SKILL.md` is defined in `AGENTS.md` §3 and that every status token used as a gate or evidence verdict in `PLAN.md` is defined either in `AGENTS.md` §11 or in a vocabulary `AGENTS.md` explicitly delegates.
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
- Reproduction: Probe plus static — all four stale artifacts are in place at HEAD. (1) `node -e` importing `lib/policy.mjs` prints `MODEL_ALLOWLIST.length === 5` with no `execute` entry, and `tests/m7-t2-quota-telemetry.test.mjs:223-243` drives `resolveRuntimeModel` with production defaults into `PROACTIVE_FALLBACK` to `MODEL_ALLOWLIST[1]` — directly falsifying `quota-telemetry.mjs:203-206` ("single entry … fallback branches below are unreachable in production") and `:214-219` ("single `execute` combo entry"), which predate the M10/T2-R12 five-model chain recorded at `policy.mjs:513-517,625-637`. (2) `grep -rn "directMessages" --include="*.mjs"` over `integrations/` and `scripts/` returns zero matches, so the config key `channels.discord.directMessages.enabled` cited at `README.md:276,309` does not exist; `buildConfig` persists `dmPolicy: "disabled"` and `dm: { enabled: false, groupEnabled: false }` (`policy.mjs:1034-1035`). (3) The comment at `policy.mjs:1042-1048` rebuts a README statement of `inheritParent:true` that the README does not make — `README.md:273,304` say `inheritParent: false`, matching `policy.mjs:1049` — and `:1031-1033` rebuts a "DM allowlist" README statement that likewise does not exist. (4) `policy.mjs:565-573` (register cited `:569`) still calls the mention grammar a frozen hand transcription that stays unchanged, immediately above `:575-606` which derives it from `AGENT_ALIASES` precisely because the transcription was abandoned. Gate it in `tests/m7-t2-quota-telemetry.test.mjs` and `tests/m7-t1-openclaw.test.mjs` (which already pins `config.channels.discord.thread` at `:600`): add red source-text assertions that the `resolveRuntimeModel` comments state the current five-entry allowlist and reachable fallback branches, and that every config key quoted in `README.md` appears verbatim in the object `buildConfig` returns.
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
- Reproduction: Static — a `node -e` probe of the `:87` regex printed `PASS` only for `index.mjs`, `package.json`, `openclaw.plugin.json`, `governance-manifests.json`, `lib/policy.mjs`, `contracts/x.schema.json`, `policy/a.json`, and `DENY` for `README.md`, `lib/nested/deep.mjs`, `lib/camelCase.mjs`, `lib/a_b.mjs`, `contracts/x.json`, `policy/sub/a.json`, `.DS_Store`, `node_modules/foo/index.js`, `dist/index.mjs`, so any deployed-tree content outside that closed set aborts the apply. Gate it in `tests/m7-t2-openclaw.test.mjs` by extending the existing case `runtime backup contains verified T1 fallback and immutable scoped preimages` (`:259`), which already builds a temp `stateDir` and calls `createRuntimeBackup`/`restoreT1RuntimeFiles`: create `<stateDir>/extensions/zink-governance/README.md` (and separately `lib/nested/deep.mjs`) before the first call and assert the rejection message names the offending relative path — today both throws (`:82`, `:91`) carry no path, so an operator gets `BACKUP_UNEXPECTED_PLUGIN_CONTENT` with nothing to act on. Note the create-path guard only fires on the first backup because `:107` short-circuits to `verifyRuntimeBackup` once the backup root exists, while the restore-path guard at `:318` fires on every rollback and blocks it before the quarantine move at `:344`. Run `node --test tests/m7-t2-openclaw.test.mjs`.
- Acceptance criteria: The enumerator and the packager derive from one source of truth: `pluginFiles` admits exactly the asset set `governancePluginFiles()` deploys, so adding a governed directory or a `lib`, `contracts` or `policy` file whose name contains a digit, dot or underscore no longer fails `configure.mjs --apply` or the rollback in `restoreT1RuntimeFiles`, a refusal names the offending relative path instead of a bare code, symlinks and anything outside the deployed set are still denied, and a test materializes a plugin tree containing a newly governed asset and asserts both a successful backup and a successful restore.
- Related findings: nguồn: B08 — adversarial independent audit (attempted refutation…

### F-132 — total_count reports the page length, so a 20-candidate pool cut to limit=5 reads as "only 5 matches exist"

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R5-E02-04`
- Affected modules: Zink Knowledgebase
- Severity: Medium
- Status: OPEN
- Root cause: total_count reports the page length, so a 20-candidate pool cut to limit=5 reads as "only 5 matches exist". Silent truncation: an agent or the owner concludes the knowledge base holds nothing more on a topic and answers from an incomplete set — with no has_more or cursor anywhere, and both branches already capped at 40 rows (database.py:1060,1079).
- Evidence: Where: main.py:458-464; :395, :412; retrieval.py:12 · Evidence: bounded_results = results[:request.limit] then "total_count": len(bounded_results), while the pool feeding it is `fuse_candidates(dense, fts)[:candidate_limit]` and MAX_FUSED_CANDIDATES = 80 is unreachable dead truncation.
- Reproduction: Gate it in `apps/knowledge/tests/test_m11_api_attribution.py`, whose `ApiAttributionTests.setUp` (`:87-109`) already stubs `app.state.database`, whose `request()` helper (`:115-118`) drives `httpx.ASGITransport`, and whose `candidate()` factory (`:59-73`) builds a `SearchCandidate`. Add a case that sets `search_candidates` to return 20 candidates, POSTs `/v1/search` with `{"query": "topic", "rerank": false, "limit": 5}`, and asserts `response.json()["total_count"] == 20` — today it returns `5`, the page length, because `main.py:485` computes `bounded_results = results[:request.limit]` and `:490` reports `"total_count": len(bounded_results)`; so the case is red. `stub_search_route()` (`:285`) is the same idiom in miniature. `npm run test:knowledge` runs it, but on this host the module reports `1 skipped` unless `KNOWLEDGE_TOKENIZER_PATH` points at the pinned tokenizer (`:35-41`), i.e. `NOT RUN` rather than passed. A pure-Python static equivalent needs no app at all: `len(([0]*20)[:5])` is `5` while the pool held `20`, which is exactly what `:485` plus `:490` serialize. The pool feeding it is `:423` and `:440` `fused_candidates = fuse_candidates(dense, fts)[:candidate_limit]` with `candidate_limit = MAX_RERANK_CANDIDATES` (`:422`, `:439`), and `retrieval.py:13` sets `MAX_RERANK_CANDIDATES = 20`; `retrieval.py:12` `MAX_FUSED_CANDIDATES = 80` is dead truncation because `fuse_candidates` caps each branch at `MAX_BRANCH_CANDIDATES = 40` (`retrieval.py:11`, applied at `:128` and `:132`) and dedups into a dict, so `return fused[:MAX_FUSED_CANDIDATES]` (`retrieval.py:158`) can never drop a row.
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
- Reproduction: `tests/m11-t1-skill-governance.test.mjs` already has the seam: `proposedFixture()` (`:366-396`) injects `options.vectorSyncFn` at `:391` and `handleOwnerSkillApproval` is called at `:422`. Add a case whose `vectorSyncFn` returns `{ status: "PARTIAL", synced_count: 1, failed_count: 1, skills: [{ namespace: ["office"], capability: "bound-ref-skill", version: "1.0.0", sync_status: "READY" }, { namespace: ["office"], capability: "other-skill", version: "1.0.0", sync_status: "FAILED", error: "x" }] }`, then read `path.join(proposalStorageDir, proposal_id + ".json")` (the idiom at `tests/m11-t3-durable-state-integrity.test.mjs:635`) and assert `status === "READY"` for the skill that was actually approved and indexed. Today the durable file says `INDEX_FAILED` because `index.mjs:1170` reads only the aggregate (`status: report?.status === "READY" ? "READY" : "INDEX_FAILED"`) while the aggregate is a store-wide rollup — `zink-skill-store/src/vector-sync.mjs:840-849` sets `syncReport.status = "PARTIAL"` at `:843` whenever `failed_count > 0 && synced_count > 0`, and the approved skill's own verdict is `sync_status: "READY"` pushed at `:753-760`. So the case is red; add the mirror case where `skills` omits the approved skill while `status` is `"READY"` and assert the proposal is not stamped `READY`. The loop at `:654` iterates every ACTIVE record from the catalog scan, not the proposal, and the tombstone early-return at `:634-643` returns `status: "FAILED"` with `skills: []`, so a whole class of failures leaves no per-skill evidence at all. Gate with `node --test tests/m11-t1-skill-governance.test.mjs`.
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
- Reproduction: Static — the golden `VALID_CI_WORKFLOW` python-quality job (`tests/repository-policy.test.mjs:98-108`) has 5 steps, while the real job (`.github/workflows/ci.yml:52-100`) has 9 and adds `Set up Node.js` plus `Install npm 12.0.2` plus `Verify Node and npm versions` (`:69-80`), `Fetch pinned tokenizer` with `sha256sum --check --strict` (`:84-90`), `working-directory: apps/knowledge` (`:92`) and `KNOWLEDGE_TOKENIZER_PATH` (`:99`); since the fixture contains none of them, no `.replace()` mutation can even express their deletion — `scripts/repository-policy.mjs:359-366` calls `checkToolchainWorkflowJob` for `"quality-gate"` only, and `checkPythonQualityJob` (`:415-497`) requires just pinned `actions/setup-python` (`:436`), `uv sync --locked` ordered before `npm run test:knowledge` (`:445-455`), no `continue-on-error`, and no `pdf-runtime` install. `grep -n tokenizer scripts/repository-policy.mjs` returns nothing, and the only python-quality mutations exercised are job-missing, `continue-on-error` twice, suite-dropped, suite-reordered and pdf-runtime (`tests/repository-policy.test.mjs:345-447`). Add two cases to `tests/repository-policy.test.mjs`: one that feeds `checkWorkflowDefinitions` a python-quality job stripped of the Node toolchain and of the tokenizer fetch and asserts a failure, and one drift case asserting the shipped `.github/workflows/ci.yml` python-quality job still contains both (the `checkGateRegistry` precedent at `:309-318` already reads a shipped governance file directly); both are red today. The tokenizer half is provably CI-green if deleted: seven knowledge modules skip at import when `KNOWLEDGE_TOKENIZER_PATH` is unset (`apps/knowledge/tests/test_main_api.py:13-19`, plus `test_b14_cause_attribution.py:34`, `test_b18_index_run_attribution.py:41`, `test_b20_readyz_attribution.py:35`, `test_m11_api_attribution.py:40`, `test_markdown_adapter.py:30`, `test_r23_obsidian_ingestion.py:45`), so `pytest -q` exits 0, and the digest is bound only to `apps/knowledge/Dockerfile` (`tests/m3-t2-contract.test.mjs:32-39`), never to `ci.yml`.
- Acceptance criteria: `repo:check` fails when the `python-quality` job loses anything the suite depends on: the policy requires the pinned `actions/setup-node` step, the `npm@12.0.2` bootstrap from the runner temp directory and the Node/npm version assertion in that job, requires the pinned tokenizer fetch with its `sha256sum --check --strict` line and `KNOWLEDGE_TOKENIZER_PATH` on the suite step or records an explicit owner decision that the Python attribution gates may be NOT RUN, requires `working-directory: apps/knowledge` on `uv sync --locked`, and the golden `VALID_CI_WORKFLOW` fixture carries all of it, so deleting any of those steps from `ci.yml` turns `npm run repo:check` red.
- Related findings: nguồn: E09 — CI: the gate tier that can print green without…

### F-135 — LATENT is neither OPEN nor FIXED, so the code-review:128 "zero OPEN" precondition is satisfiable by re-labelling confirmed High findings, and CLOSED/Duplicate records bypass README:83's "FIXED requires validation" rule. The per-round…

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R5-E12-02`
- Affected modules: README, Governance records
- Severity: Medium
- Status: OPEN · 2026-10-17 partial repair, recorded not closed: the register moved to `docs/execution/findings.md` and `.agents/states/README.md` + `code-review/SKILL.md` were rewritten so the register's §0 vocabulary is now the only finding vocabulary and `QUALITY REVIEW PASS` is scoped to one review — the locators in `Evidence:` above therefore point at superseded line numbers. Unverified by any test, so it stays open under §0.2 rule 6.
- Root cause: the two vocabularies disagreed — the register carried LATENT/PARTIAL/EXCLUDED while `code-review/SKILL.md` gated review on "zero OPEN" and `.agents/states/README.md` demanded OPEN/FIXED/ACCEPTED-RISK/INVALID, so re-labelling a confirmed finding could satisfy the gate without any fix, and CLOSED/Duplicate records bypassed the "FIXED requires validation" rule. Residual after the 2026-10-17 rewrite: the register still accepts a status change on assertion alone — §0.2 rule 7 forbids re-grading but nothing checks it.
- Evidence: Where: .agents/states/README.md:68-84; code-review/SKILL.md:119-128; register lines 589, 608, 663, 698 · Evidence: README mandates Affected paths: / Required remediation: / Validation after remediation: — grep counts in the register: 0, 0, 0 — while Where: = 168 and Acceptance: = 130. Mandated vocabulary is OPEN | FIXED | ACCEPTED-RISK | INVALID; the register actually uses Status: LATENT (4 records, severities High/High/Medium/Low) plus Verified with correction 23×, Not reproduced 6×, CLOSED 5×, Duplicate 2×.
- Reproduction: Static — the surviving defect is the one the row's own `Root cause:` names: a status change is accepted on assertion alone. `grep -rn "findings.md" scripts/ tests/ --include="*.mjs"` returns no match (exit 1), so no executable gate reads the register, and `node scripts/repository-check.mjs` printed `Repository policy check passed.` with all rows present; only `markdownlint-cli2` and `prettier --check` touch it, via the `docs/**/*.md` glob the register itself notes at `:8-9`. The vocabulary repair is confirmed: `.agents/states/README.md:72-82` no longer mandates `Affected paths:` / `Required remediation:` / `Validation after remediation:` nor an `OPEN|FIXED|ACCEPTED-RISK|INVALID` vocabulary, and `:77-78` now reads that the register's §0 block is the authority for the status vocabulary and for the conditions required before a row is removed; `.agents/skills/code-review/SKILL.md:124-127` names the register's own vocabulary and states that `.agents/states/README.md` no longer defines a finding status set, and `:132` scopes the gate to zero `OPEN` actionable findings from this review, not a claim about the repository backlog. At HEAD every `- Status:` line uses one of the seven §0.3 words (`docs/execution/findings.md:44-46`). Add a `checkFindingsRegister(markdown)` beside `checkGateRegistry` in `scripts/repository-policy.mjs`, wire it into `collectRepositoryFailures` (`:937`), and add two cases to `tests/repository-policy.test.mjs`: a synthetic block carrying an 11th field or `- Status: CLOSED` must produce a failure, and `checkFindingsRegister` over the shipped `docs/execution/findings.md` must return `[]` (the `:309-318` shipped-file precedent). Mutation probe: after that gate exists, flipping any one `- Status: OPEN` to `- Status: LATENT` must turn `repo:check` red; today nothing notices.
- Acceptance criteria: A status or grade change on a register row is checked rather than asserted: an executable gate in the lane `npm run repo:check` runs parses every `### F-xxx` block of `docs/execution/findings.md`, requires the ten §0 fields and a `Status:` from the §0.3 vocabulary, and requires any change to `Status:`, `Severity:` or `Category:` - compared against that row's last committed text - to carry §0.2 rule 6 evidence in the same change, a `CLOSED by` line naming task, item and commit or the owner decision behind an `EXCLUDED` or `REFUTED`, so re-labelling a confirmed row to clear a review gate or deleting one without the three conditions fails the gate; `checkGateRegistry` (`scripts/repository-policy.mjs:854-880`) is the existing Markdown-table idiom to reuse.
- Related findings: nguồn: E12 — skills procedure vs practice (7 findings; the two…

### F-136 — no attributable writer discipline for the only finding register, no serialization (see R5-E12-03), and a "must" any agent can satisfy by declining to write

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R5-E12-06`
- Affected modules: README, Governance records
- Severity: Medium
- Status: OPEN
- Root cause: no attributable writer discipline for the only finding register, no serialization (see R5-E12-03), and a "must" any agent can satisfy by declining to write.
- Evidence: Where: execution/SKILL.md:120; code-review/SKILL.md:111-114; .agents/states/README.md:29-31 · Evidence: execution:120 says the register is "owned by Codex review/remediation; Cursor must not use it to broaden implementation scope"; code-review:111 makes it "must create/update … when useful" (a must with an opt-out in the same clause); README:30 assigns the typical writer as "reviewer/debugger/validator". The register's IDs are R1-A01..A16, R2-B.., R5-E01..E16 — delegated-lane records — while AGENTS.md §3 states "Delegation never expands authority."
- Reproduction: Static — no row records who wrote or last changed it, and nothing serializes writers: `grep -rn "findings.md" scripts/ tests/ --include="*.mjs"` returns no match (exit 1), and the repository's only writer lock (`withFileLock`, `integrations/openclaw/lib/file-lock.mjs:305`) is a runtime-plugin primitive no docs path uses, so two lanes editing the same `F-xxx` block are reconciled by hand at merge time with no attributable author. `grep -o "^- [A-Za-z][A-Za-z ]*:" docs/execution/findings.md | sort | uniq -c` returns exactly the same count for each of the ten fields (`Category`, `Legacy register id`, `Affected modules`, `Severity`, `Status`, `Root cause`, `Evidence`, `Reproduction`, `Acceptance criteria`, `Related findings`) and no writer, author or last-changed-by field. The opt-out is also still inside the same clause as the must: `.agents/skills/code-review/SKILL.md:109` "Any fix must:" followed by `:111` "create/update `docs/execution/findings.md` for actionable review findings when useful;", and `.agents/skills/execution/SKILL.md:120-122` still makes the register owned by Codex review/remediation and forbids dsh from using it to broaden scope. Add to `tests/repository-policy.test.mjs` — the suite that already gates tracked governance documents through `checkGateRegistry` (`:301-318`) — a case over the shipped `docs/execution/findings.md` asserting every `### F-` block carries a writer-attribution field, plus a synthetic block missing it that must fail; pair it with the `checkFindingsRegister` schema gate described in `F-135` so both are one check. Red today, because the field exists in no row. Second, independent assertion in the same case: `code-review/SKILL.md` must state the recording duty without the "when useful" qualifier at `:111`, which is also red today.
- Acceptance criteria: `code-review/SKILL.md:111` drops the `when useful` opt-out so every actionable review/debug/validation finding must be filed as a row, the three governance texts (`execution/SKILL.md`, `code-review/SKILL.md`, `.agents/states/README.md`) name one and the same accountable writer role for the register plus one serialization rule for concurrent writers, and `tests/repository-policy.test.mjs` pins that agreement so the files cannot drift apart again.
- Related findings: bug mở: R5-E12-03 · nguồn: E12 — skills procedure vs practice (7 findings; the two…

### F-137 — empty untracked models/ and shared/ are ownerless legacy scaffolding duplicating Zink Tools

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R1-A01-04`
- Affected modules: Legacy top-level trees
- Severity: Low
- Status: OPEN
- Root cause: duplicate top-level trees with no owner; agents write there expecting a real surface.
- Evidence: Where: models/{forecast,optimization,operations-research,simulation}, shared/{assets,constants,libraries,prompts,schemas,telemetry,templates,utilities} — git ls-files empty, 0 files
- Reproduction: Run `find models shared -type f | wc -l` (prints `0`), `find models shared -type d | wc -l` (prints `21`), `git ls-files models shared | wc -l` (prints `0`) and `git status --porcelain models shared` (prints nothing — Git cannot represent an empty directory), then `node scripts/repository-check.mjs`, which printed `Repository policy check passed.` with both trees present. The empty trees are `models/{forecast,operations-research,optimization,simulation}` and `shared/{assets,constants,libraries/{python,types},prompts,schemas/{ai,automation,common,knowledge,lsc},telemetry,templates,utilities}`, `.gitignore` has no `models` or `shared` entry, and `zink-tools/{forecast,optimization,operations-research,simulation}` already exist as the canonical capability paths. No gate can see them: `listTrackedFiles` (`scripts/repository-policy.mjs:905-916`) enumerates `git ls-files -z`, `REQUIRED_FILES` (`:6-15`) names neither directory, and a grep for `models/` across `docs/`, `README.md`, `AGENTS.md`, `PLAN.md` and `Makefile` returns only this register's own row, so no architecture document owns them. Gate the fix in `tests/repository-policy.test.mjs` with a case asserting every top-level directory is either tracked-with-content or named as target architecture in `docs/architecture/`; it is red today for `models/` and `shared/`.
- Acceptance criteria: The top-level `models/` and `shared/` trees are either removed from the working directory or listed in `docs/architecture/` with a named owner and a reserved purpose consistent with the three-module rule in `AGENTS.md` section 9, and a repository gate fails on any ownerless top-level tree that duplicates Zink Tools capability names.
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
- Reproduction: Static — the reachability arithmetic: each SQL branch returns at most 40 rows (`database.py:1060`, `:1079`), `fuse_candidates` dedups them to at most 80 (`retrieval.py:122-158`), `main.py:423`/`:440` keeps 20 (`MAX_RERANK_CANDIDATES`, `retrieval.py:13`), and `main.py:485` keeps `limit` (at most 20), so with `limit=5` ranks 6-20 of the rerank pool and all of ranks 21-80 of the fused pool are discarded, rows past 40 per branch never leave PostgreSQL, and the response at `main.py:486-492` reports none of it. An agent cannot ask for the rest either: `SearchRequest` (`main.py:75-89`) declares `limit: int = Field(default=10, ge=1, le=20)` at `:79` with `model_config = ConfigDict(extra="forbid")` at `:76` and no `offset`, `cursor` or continuation field, so `{"offset": 5}` becomes a 422 `INVALID_SEARCH_REQUEST` through the handler at `main.py:227-231` — continuation is refused by contract, not merely unimplemented. Add to `apps/knowledge/tests/test_m11_api_attribution.py` (harness `:87-118`, `candidate()` `:59-73`) a case stubbing `search_candidates` with 40 dense candidates, POSTing `{"query": "topic", "rerank": false, "limit": 5}`, and asserting the body lets a caller distinguish "exhausted" from "truncated" — red today, since the only keys are `index_id`, `query`, `semantic_contract_version`, `total_count`, `results`. Mirror it at the tool boundary in `tests/m7-t5-remediation.test.mjs`: `zink-tools/adapters/knowledge/knowledge-adapter.mjs:441` recomputes `total_count: formattedResults.length`, and `zink-tools/contracts/tools/zink-knowledge.schema.json:91-92` (`required` list plus `"additionalProperties": false`) would reject any new key, so surfacing the signal through Zink Tools is a contract change and RED under `AGENTS.md` §7.
- Acceptance criteria: The search response distinguishes truncation from completeness by reporting the fused candidate pool count or an explicit has-more/continuation signal separately from the page-sized `total_count` at `main.py:490`, so a caller can tell `2 matches total` from `2 of 40 or more`, with `MAX_RERANK_CANDIDATES = 20`, the per-branch `LIMIT 40` at `database.py:1060` and `:1079` and the `limit le=20` cap all left unchanged.
- Related findings: nguồn: E01 — Knowledgebase service internals (6 findings + a…

### F-142 — read-only — confirm nothing else populates the index, and the unnest('{}'::text[]) semantics

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R5-E05-03`
- Affected modules: Zink Skill Store
- Severity: Critical
- Status: REFUTED — refuted by the `A-5` re-read (`639fc47` stopped; the guard built from it was measured red on 35 of 87 Skill Store tests and reverted). Residual survives as `R6-A05-01`.
- Root cause: a sync run against the repo's real skills root — or any wrong-but-existing skillsRoot — deletes the entire derived vector index and reports READY with synced_count 0. The report is indistinguishable from a healthy no-op, and retrieval then fails closed as SKILL_INDEX_STALE, so the owner loses learned skills and sees a staleness error rather than a destruction event. Only caller: index.mjs:1158-1162.
- Evidence: Where: vector-sync.mjs:610 (activeKeys), :628-631, :806-814; toPostgresArrayLiteral :73 · Evidence: the tombstone is DELETE FROM skills.catalog_index WHERE status='ACTIVE' AND (…) NOT IN (SELECT unnest(${escapeSqlLiteral(toPostgresArrayLiteral(activeKeys))}::text[])), and toPostgresArrayLiteral returns "{}" when arr.length === 0. SQL semantics: x NOT IN (empty set) is TRUE, so every ACTIVE row is deleted (skills.segments cascades, 003:29). Rollup then sees failed_count > 0 false ⇒ status = "READY". · Detail: zink-skill-store/skills/ holds only README.md (0 SKILL.md tracked), and catalog.mjs:639 tolerates a root README, so scanCatalog returns {errors: [], records: []}.
- Reproduction: read-only — confirm nothing else populates the index, and the unnest('{}'::text[]) semantics.
- Acceptance criteria: an empty scan either leaves rows untouched or reports a distinct non-READY status.
- Related findings: bug mở: R6-A05-01 · disposition: refuted by the `A-5` re-read (`639fc47` stopped; the guard built from it was measured red on 35 of 87 Skill Store tests and reverted). Residual survives as `R6-A05-01`. · nguồn: E05 — Skill Store vector sync (8 findings; the derived… · severity note: giá trị gốc `Critical (High (→ Critical candidate))` — High là grade agent đề xuất, Critical là phán quyết; hàng hiện `REFUTED` nên grade không còn quyết định thứ tự sửa.

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
- Reproduction: Extend the green test `runtime backup contains verified T1 fallback and immutable scoped preimages` in `tests/m7-t2-openclaw.test.mjs:259` (runs on Windows via `node --test --test-name-pattern "runtime backup" tests/m7-t2-openclaw.test.mjs`, measured 1 pass 0 fail; it already builds a synthetic `stateDir` with `mkdtempSync`, writes `openclaw.json` and `workspaces/main/AGENTS.md`, then calls `createRuntimeBackup` and `restoreT1RuntimeFiles`) with an assertion that after restore every manifest entry with `existed:true` exists again at `stateDir/<relative>` with bytes hashing to its manifest preimage digest; red today because restore only writes the `t1-config.json` fallback into `openclaw.json` (`runtime-backup.mjs:347-351`) and `renameSync`s the current `AGENTS.md` and extension tree into `quarantined-t2/` (`:353-361`), so reading `workspaces/main/AGENTS.md` throws `ENOENT` while the call still returns `filesRestored:true`.
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
- Reproduction: No red observable survives on this host: run `node --test tests/m12-t2.2-m1-live-reachability.test.mjs` and read the counts, measured here as 3 pass 1 skip 0 fail; M1 2 (`:182`) proves `configure.mjs` admits all nine outgoing digests the row lists, M1 1 (`:162`) reproduces each from commits `6b0ea0a`/`c680a28`/`c1ad4b3`/`3cb8274`, and M1 4 (`:208`) is the sweep gate the acceptance demanded, skipping honestly on Windows because `/home/hoang_vinh/.openclaw-zink` is not mountable, leaving the WSL-lane M1 4 run plus a static read of `ALLOWED_GOVERNANCE_ASSET_SHA256` at `configure.mjs:99` as the residual verification.
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
- Reproduction: Add a reader-side case to `tests/m8-t3-governed-memory-learning.test.mjs` (green on Windows: `node --test tests/m8-t3-governed-memory-learning.test.mjs`, measured 47 pass 0 fail) reusing the T2g idiom at `:303`: `mkdtemp` a `skillsRoot`, promote a valid `1.0.0` skill via `promoteApprovedSkill`, then `mkdir` a sibling `2.0.0.pending-4242-1700000000000-deadbeef` and assert `getActiveSkill` still returns the `1.0.0` record; red today because the residue trips the walk grammar check at `catalog.mjs:714` (`DIRECTORY_GRAMMAR_INVALID`), `scanCatalog` nulls every record at `:807`, `getActiveSkill` returns `skill:null` at `:813` and `syncSkillsToVectorStore` answers `CATALOG_INVALID` (`vector-sync.mjs:564-574`) until some later promotion runs the heal at `catalog.mjs:1211`.
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
- Reproduction: Add a re-run case to `tests/m11-t1-skill-vector-sql.test.mjs` (green and Docker-free on Windows: `node --test tests/m11-t1-skill-vector-sql.test.mjs`, measured 9 pass 0 fail) reusing its `makeActiveSkill` helper at `:31` and the capturing `dbExecutor` idiom at `:59-70`: seed one ACTIVE skill with two headings, call `syncSkillsToVectorStore` twice over the unchanged tree with a counting `embedFn`, and assert the second run issues zero embedding calls and no `DELETE FROM skills.segments`; red today because every run re-embeds each segment one HTTP call at a time (`vector-sync.mjs:701-716`) and re-issues the full transaction including the delete (`:518-533`) while the stored `embedding_input_sha256` is never read back, with the caveat that owner decision A-7 (`fd302d4`, comment at `vector-sync.mjs:708-715`) refused the skip, so this red documents an accepted cost and may not be greened without the owner reopening that decision.
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
- Reproduction: Static — the code shape proves it without a runtime scenario. Read `integrations/openclaw/lib/policy.mjs:2113-2127`, which projects a fixed 7-field tuple (`task_id`, `brief_revision`, `tool_id`, `operation`, `exact_target`, `material_parameters ?? {}`, `expires_at`) before hashing, against `integrations/openclaw/topology/lib/canonical.mjs:347-349`, which hashes its argument verbatim under the identical `zink-approval-scope-v1` tag; `grep -rn "deriveApprovalScopeDigest" --include="*.mjs"` shows the only binder is `guard.mjs:156` (`deriveApprovalScopeDigest = policy.deriveApprovalScopeDigest ?? null;`, consumed at `:383`), so the canonical twin has no importer and silently disagrees with the bound one for any caller that ever adds it. `canonical.mjs:343-345` also exports `deriveReferenceId`, and a repo-wide grep returns exactly that one line while `guard.mjs:1488-1491` inlines `canonicalHash("zink-reference-v1", ref)`. A `node -e` probe over both modules printed `policy(b)===policy(a): true` but `canon(b)===canon(a): false` for the same spec with permuted outer keys plus an injected `extra` field, and printed `policy.stableJson({b:1,a:2})` as the pretty two-space form (`policy.mjs:1389-1391`, key-order-dependent) against `schema.stableJson`'s key-sorted compact form (`topology/lib/schema.mjs:106-111`) — two exported functions with one name and opposite normalization. Gate the fix in `tests/m7-t3-tools-contract.test.mjs`, which already imports the policy function at `:23` and pins digest stability in `AC 26: Single Canonical Digest Contract` at `:846-863`; extend that block to assert the `canonical.mjs` source no longer declares `deriveApprovalScopeDigest` or `deriveReferenceId`, and that `guard.mjs`'s reference check calls the single derivation instead of re-inlining `canonicalHash("zink-reference-v1", ref)` at `:1488-1491`.
- Acceptance criteria: Exactly one `deriveApprovalScopeDigest` remains in the repository, exported from a single module and bound by `guard.mjs:156` and every other caller with its payload shape pinned by a test; the verbatim-hash twin at `canonical.mjs:347-349` and the dead `deriveReferenceId` at `:343` are removed or reduced to re-exports; and one documented canonicalizer replaces the three (`stableJson` at `policy.mjs:1389` and `schema.mjs:106`, `canonicalJson` at `canonical.mjs:216`), so the flattened deployed `lib/` can never again carry two functions hashing the same approval scope differently under the `zink-approval-scope-v1` tag.
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
- Reproduction: Static — diff the two hand-maintained lists. `apply-orchestration.mjs:334-346` names 11 classes and `operator-preflight.mjs:59-87` names 27, yet `apply-orchestration.mjs:116` (`deps.runBuilder("--preflight", identifiers)`) and `operator-preflight.mjs:41` exec the same `integrations/openclaw/configure.mjs --preflight` child (`operator-preflight.mjs:29-46`; `operator-apply.mjs:69,82-83` execs the same builder), so every refusal that child can emit reaches both classifiers. Eighteen literals exist only in preflight — `Agent governance instructions drift`, `Governance plugin package`, `Gemini stream hotfix utility`, `Password-store resolver`, `Auth order plan`, `Auth SecretRef plan`, `Systemd drop-in`, `Governance identity key`, `T2 backup manifest`, `ROUTER_HOST_UNAVAILABLE`, `ROUTER_PORT_UNAVAILABLE`, `ROUTER_API_KEY_UNAVAILABLE`, `must be a numeric Discord snowflake`, `surface IDs must be distinct`, `Existing config must be canonical JSON`, `Ledger corruption`, `symlink`, `mode drift` — and each one degrades to the meaningless `APPLY_REJECTED` on the apply path (`apply-orchestration.mjs:351` `KNOWN_REASONS.find((reason) => output.includes(reason)) ?? "APPLY_REJECTED"`), exactly the failure K02 fixed for one instance. The lists have also drifted in the other direction: preflight's classifier reads only `error.stderr` (`:52`) and `error.code` (`:89`), so its own locally thrown `INVALID_IDENTIFIER_FILE` (`:20`, `:26`) — a static literal the apply list does carry at `:341` — still collapses to `PREFLIGHT_REJECTED` (`:88-90`). Gate in `tests/m10-t2-r3-asset-predecessor.test.mjs`, which already holds the K02-shaped assertion at `:520-555` (`assert.equal(classifyApplyReason(childError), "EXECUTION_STATE_UNKNOWN", ...)`); add a set-difference assertion that the two exported lists are the same set, or that both import one shared classifier.
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
- Reproduction: Static for the mechanism; the live stamp counts need the WSL ledger and are not reproducible here. Read `ledger.mjs:329-339`: `journalHasPreVerdictStamp` at `:329-331` is a `lines.some(...)` over the whole event file, and `preVerdictForEvent` returns `false` for the current version (`:336`), `true` for a pre-verdict stamp (`:337`), and otherwise falls through to `return journalHasPreVerdictStamp;` at `:338` — the decisive line, because an `m8-t2.2-r4` event's semantics are then decided by which other events exist in the same file. So deleting the pre-verdict-stamped lines anywhere in the journal — compaction, tail surgery, or a mixed backup restore — flips all r4 events from pre-verdict to verdict resolution without touching a single r4 event's own bytes or digest, and the verifier then dies at `snapshot workflow mismatch` (`:416`) or silently re-resolves root results in the unanchored tail (`:420-433`, which passes no options). Consumed at `:379-383` (`preVerdictRootResult: preVerdictForEvent(event)`). `GOVERNANCE_VERSION = "m8-t2.3-r5"` (`canonical.mjs:11`); `PRE_VERDICT_VERSIONS` at `:320-325` is `m7-t2-r12`, `m7-t5-r13`, `m8-t2-r9`, `m8-t2.1-r3`. Gate in `tests/m8-t2.3-writer-semantics.test.mjs`, which already has the `openedLedger`/`reseal` harness (`:108`, `:60`), `AMBIGUOUS_VERSION = "m8-t2.2-r4"` (`:27`), case 4 proving an r4-only journal takes verdict semantics (`:266-335`) and case 5 proving a snapshot-derived discriminator is rejected (`:337`). Add the missing case: build a journal carrying one `m7-t5-r13` line plus an r4-stamped `WORKFLOW_ROOT_RESULT_RECORDED` whose snapshot was written under pre-verdict resolution, assert `readSnapshot(paths).tasks[taskId].workflow_status === "BLOCKED"`, then rewrite the events file with only the r13 line removed and the chain resealed, and assert the read still resolves the same r4 event to `BLOCKED` rather than throwing `snapshot workflow mismatch` or returning `RESULT_PENDING_REVIEW`.
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
- Reproduction: Static — two of the row's three evidence legs no longer hold, so re-run them before treating this as open. `git log --all --oneline -- docs/contracts/execution/ACTIVE.md` prints 31 commits (the register recorded it as empty), and `git show be75437:docs/contracts/execution/ACTIVE.md | grep -n "^## R18 8"` resolves the `PLAN.md:968` citation (`Digests, ledger and runtime integrity are in ACTIVE.md R18 8.`) to `## R18 8. Deployed result`, so the R18/R19 forensic text is recoverable; `git ls-files docs/contracts/execution/` lists six tracked archived contracts covering `M12/T2.1-R3`, `M12/T2.2-R1..R3`, `M12/T2.3-R1` and `M12/T4-R1`, and `ls docs/contracts/execution/` returns `README.md` and `archive/`. `.gitignore:61` is still `/docs/contracts/execution/ACTIVE.md` and `PLAN.md` still carries 95 `ACTIVE.md` mentions including 13 numbered-section citations. What survives is the weaker defect: those 13 numbered `ACTIVE.md R18/R19 N` and `§N` citations name a Git-ignored file that has no tracked archive copy for bands before the archive mechanism began (2026-10-15, owner-authorized, decision `H10` / proposal `R3-P04-03`, per `archive/README.md:3-10`) and no recorded commit pointer, so resolving them requires unrecorded git archaeology — `PLAN.md:426-428` supplies such a pointer only for the current band. Gate in `tests/repository-policy.test.mjs` (the repo-hygiene suite backed by `scripts/repository-policy.mjs`, which today never mentions `ACTIVE.md`); add a check that every numbered `ACTIVE.md §N` / `ACTIVE.md Rnn N` citation in `PLAN.md` resolves to either a tracked file under `docs/contracts/execution/archive/` or an explicit commit-qualified pointer recorded in the same field.
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
- Reproduction: Static — both temps use a fixed, exclusive-create name and no path in the repository ever removes them: `grep -rn "zink-r12-tmp|zink-r12-restore" --include="*.mjs"` returns only `native-patch.mjs:838`, `runtime-backup.mjs:325` and the fault injector at `tests/m8-t2.13-r16-apply-rehearsal.test.mjs:379`. `replaceAtomic` (`native-patch.mjs:837-844`) writes `<file>.zink-r12-tmp` via `writeExclusive`, which is `openSync(file, "wx", mode)` (`:827-835`, `:828`), then `chmodSync`, `renameSync` and `syncDirectory` with no `try`/`finally`, so a throw from `:841`-`:843` — or a kill between `:840` and `:842` — leaves the temp behind, and every later `replaceAtomic` on that file dies with `EEXIST`, including the six rollback calls inside `restoreNativePatch` (`:1190-1195`, which unlinks only the bridge at `:1196`), so the residue of a failed apply blocks its own recovery. There are six call sites: `:1024`, `:1060`, `:1062`, `:1074`, `:1120`, `:1191`. Symmetrically, a kill between `runtime-backup.mjs:348` (`writeNew(temporary, fallback)`, also `openSync(file, "wx", 0o600)` at `:64`) and `:349` (`renameSync(temporary, config)`) leaves `openclaw.json.zink-r12-restore`, and `:327` then refuses every subsequent restore with `RESTORE_TEMP_CONFLICT` forever — the file contains no `unlinkSync` or `rmSync` at all. The existing green double-call at `tests/m7-t2-openclaw.test.mjs:311-314` does not cover this, because after a successful restore `current` equals `fallback` so the `:347` branch is false and no temp is created. Gate the native leg in `tests/m8-t2.11-r14-native-lineage.test.mjs`, which drives the real `applyNativePatch` on a `mkdtempSync` synthetic runtime with nothing stubbed (`:75-79`): pre-create `<runtime>/dist/<SELECTION>.zink-r12-tmp`, assert the apply fails, then assert a second `applyNativePatch` on the same tree succeeds rather than dying `EEXIST`; gate the restore leg in `tests/m7-t2-openclaw.test.mjs` beside `:291` by writing `<stateDir>/openclaw.json.zink-r12-restore` before a still-drifted config and asserting `restoreT1RuntimeFiles` completes instead of throwing `RESTORE_TEMP_CONFLICT`.
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
- Reproduction: Static — the ordinary "Postgres starts later" race is a sticky, process-lifetime flag. `database.py:210-219` swallows every startup exception into `startup_error_code = "DATABASE_UNAVAILABLE"` (`:211`) and nulls the pool (`:217-219`), `available` (`:177-178`) is purely `return self._pool is not None`, and `database.start()` is called once and only once at `main.py:178` inside `lifespan` (`grep -rn "\.start()" apps/knowledge/app/*.py`), so `if database.available:` at `:179` is false for the rest of the process: `_apply_migrations` never runs (it is reachable only from inside `start()`, `database.py:195`, `:203`), and neither `coordinator.recover_startup()` (`:182`) nor `database.recover_interrupted_runs()` (`:185`) is ever reached — even after PostgreSQL comes up, because no code path retries. The lost work is concrete: `recover_interrupted_runs` (`database.py:1519-1560`) is the only thing that flips `index_runs.status = 'RUNNING'` to `INTERRUPTED`/`PROCESS_RESTART` (`:1526-1534`), marks orphaned `indexes.status = 'BUILDING'` rows `FAILED` (`:1547-1555`) and purges their published shadow content (`:1556-1559`), so those rows stay `RUNNING`/`BUILDING` until a full process restart. The only observable is `503 DATABASE_UNAVAILABLE` from `/healthz` (`main.py:236-240`) and `/readyz` (`:252-253`). Gate in `apps/knowledge/tests/test_m11_index_hygiene.py`, which already has the `database_with(connection)` / `FakeConnection` harness and covers `recover_interrupted_runs` directly at `:218-234`; add a case that drives the real `lifespan` with `asyncpg.create_pool` patched to raise on the first call and succeed on the second, and assert both that the second call happens and that `recover_interrupted_runs` is invoked after the database becomes reachable — run via `npm run test:knowledge`.
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
- Reproduction: Static — read `main.py:351-353` against `:383` and `:502-503`: the two-slot lease is taken before the query-embedding round trip and released only in the route's `finally`, so a slot is held for the whole embedding call, and `retrieval.py:62-63` (`if self._held >= self._capacity: return None`) makes the third concurrent caller get `None` immediately, which `main.py:353` turns into a bare `429 SEARCH_CAPACITY_EXCEEDED` with no `Retry-After` (`grep -rn "Retry-After|retry_after|headers=" apps/knowledge/app/main.py` returns nothing, so the caller cannot even back off correctly). The limiter is `search_limiter = SearchCapacityLimiter(capacity=2)` at `main.py:174`, whose class docstring at `retrieval.py:50-51` reads "A two-slot, no-queue limiter with cancellation-safe leases." The hold is worse than the 90 s the row states: `_embed_batch` (`model_probe.py:107-136`) posts at `:114` with no timeout override, inheriting the client's `httpx.Timeout(90.0, connect=3.0)` from `:30`, and then retries once after `_EMBED_RETRY_DELAY_SECONDS = 1.0` (`:12`, loop at `:111`, sleep at `:134`), so one slow Ollama can pin a slot for roughly 181 s and two of them close `/v1/search` to every other caller for that whole window. Gate in `apps/knowledge/tests/test_retrieval.py`, which already pins the limiter in `RetrievalTests.test_capacity_is_immediate_and_release_is_idempotent` (`:37-46`) and `test_cancellation_style_finally_releases_capacity` (`:48-58`); add a case that acquires both leases and asserts the refusal carries a `Retry-After` value, plus a `main.py`-level case with `model_probe.embed` patched to sleep past a bounded deadline asserting the slot is released before that deadline rather than held for the full client timeout — run via `npm run test:knowledge`.
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
- Reproduction: Static plus one green run — the titled defect is gone, so the reproduction is now the regression pin that keeps it gone. Read `catalog.mjs:1243-1288`: the replay probe parses the existing manifest with the strict parser (`:1243-1245`), then requires `sameDecision` (`:1260`, `lastLifecycle?.decision_ref === decisionRef`) and `sameProvenance` (`:1261-1263`) in addition to the two content hashes and `lastStatus === "ACTIVE"` before returning `ALREADY_ACTIVE` (`:1271-1277`); any mismatch reaches `writerError("SKILL_VERSION_CONFLICT", "version already exists with different content or state.")` at `:1285-1288`. The in-code rationale at `:1254-1259` names this exact fix (R3-3: two owner decisions over the same bytes are not the same governed act), and the contract docstring at `:1082-1085` states it. Then run `node --test --test-name-pattern="T2i" tests/m8-t3-governed-memory-learning.test.mjs`, which printed `pass 1 / fail 0` (`T2i: the same bytes under a second owner decision are a conflict, not ALREADY_ACTIVE`, 161 ms) and already covers the exact scenario the row describes — same bytes, second `decision_ref` (`PLAN:M8/T3-R2` over bytes promoted under `PLAN:M8/T3-R1`), loud conflict, and the first record's `decision_ref` untouched on disk (`:463-467`). Keep that test as the gate and extend it in the same file for the two residuals: a repeat promotion with identical bytes, identical `decision_ref` and identical provenance but a different `requestingActor`/`ownerActor` (written at `:1343` and `:1347`, never compared) still returns `ALREADY_ACTIVE` and drops the new actors, and `sameProvenance` at `:1261-1263` is key-order-sensitive `JSON.stringify` over a manifest written as `JSON.stringify(manifest, null, 2)` at `:1363`, so there is still no canonical-JSON record digest — that ordering sensitivity fails closed to `SKILL_VERSION_CONFLICT` rather than silently, but it can refuse a genuinely identical governed act.
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
- Reproduction: No red test can be constructed at HEAD because the defect scenario is already reproduced and passing: `node --test tests/m11-t1-skill-vector-sql.test.mjs` (measured 9 pass 0 fail) runs R3-6 at `:473`, which feeds a NUL-bearing body through `syncSkillsToVectorStore` and asserts `CATALOG_INVALID` with an `INVALID_SKILL_CONTENT` detail and zero database statements, and R3-7 at `:393`, which asserts the FAILED-row statement clears the segments; static confirmation is `hasForbiddenControlByte` at `catalog.mjs:485-493` called from `validateVersion` at `:627`, rejecting every C0 byte except tab/LF/CR plus DEL at scan time.
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
- Reproduction: Static plus a probe at HEAD — the response accumulator in `zink-tools/adapters/knowledge/knowledge-adapter.mjs:319-332` does `let data = "";` then `:322` `data += chunk;` and `:323` `if (data.length > MAX_KNOWLEDGE_RESPONSE_BYTES)`, so every Buffer chunk is UTF-8-decoded independently (a multi-byte character straddling chunks becomes U+FFFD) and the byte-named ceiling from `:23` (`export const MAX_KNOWLEDGE_RESPONSE_BYTES = 50 * 1024 * 1024;`) is compared against UTF-16 code units. Probe at HEAD: `"ế".repeat(1000)` printed `.length = 1000` vs `Buffer.byteLength = 3000` (so ~150 MB is admitted under the 50M-unit cap), and a 2+1-byte split of `ế` concatenated via `data += chunk` printed two U+FFFD where whole-buffer decode printed `"ế"`. The corrupted body still parses at `:387` (`JSON.parse(response.data)`) and flows into `formattedResults` (`:391-432`) and `total_count` (`:441`). Gate: add a case to the BUG-07 stub-server harness in `tests/m7-t5-remediation.test.mjs` (`:533-544`, `http.createServer` on `127.0.0.1`, `executeGovernedKnowledgeQuery(..., { endpoint })`) serving a 2xx JSON body whose `results[0].text` holds a Vietnamese character split across two flushed writes (await `drain` between) and assert the returned `results[0].text` contains no U+FFFD — red today; the ceiling half is impractical to serve at 50 MB, so pin it with a source-shape assertion (the `readSource` pattern from `tests/m10-t2-r21-skill-chunking-and-text-budgets.test.mjs`) that the accumulation path measures bytes (`Buffer.concat` or `Buffer.byteLength`) and not `.length`. The same file already proves the correct pattern in `truncateUtf8Bytes` (`:39-53`) but applies it only to per-result text (`:404-407`), never to the accumulator.
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
- Reproduction: Static plus a probe at HEAD — in `zink-tools/adapters/storage/r2-adapter.mjs`, `artifact_id` passes only a truthiness test (`:61` `if (!task_id || !run_id || !artifact_id || data === undefined) {` in `putLandingArtifact`, likewise `!artifact_id` at `:123` in `promoteToSilver`) before being interpolated raw into storage keys at `:68` (`landing/${artifact_id}`), `:154` (`silver/${artifact_id}/v${version}`) and `:230-233` (`getArtifact`), while the adjacent `version` was hardened at `:137-152` beneath the file's own comment at `:132-136` that states the exact rationale — a value like `../../landing/orders` injects path syntax into the namespace. Probe at HEAD: `putLandingArtifact` with `artifact_id: "../../silver/orders/v1"` was ACCEPTED and stored under key `landing/../../silver/orders/v1` and round-tripped by `getArtifact`, and `promoteToSilver` accepted `"../escape"`, while `version: "../../landing/orders"` was refused `R2_INVALID_SILVER_VERSION`. Gate: `tests/m9-t1-functional-truth-remediation.test.mjs`, whose F3 (`:867-898`) already pins injected versions including `"../../landing/orders"` (`:878`) — add an F-domain case asserting all three entry points reject any `artifact_id` containing `/`, a backslash, or a `..` segment with a fail-closed `R2AdapterError` code; it is red today. The class is the in-process Map contract double (`:30-39`), so the injected path syntax lands in precisely the governed key namespace it models.
- Acceptance criteria: a traversal-shaped artifact_id is refused and no two keys can address the same object.
- Related findings: nguồn: E06 — Zink Tools adapters (9 findings; two High, and they…

### F-174 — AGENTS.md §5 routes architecture/ownership/overengineering review to this artifact, which states expired milestone facts and gives nothing executable

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R5-E12-05`
- Affected modules: Zink Knowledgebase, Governance records
- Severity: Medium
- Status: OPEN
- Root cause: AGENTS.md §5 routes architecture/ownership/overengineering review to this artifact, which states expired milestone facts and gives nothing executable; an agent performing that review applies an M5 constraint, and the two divergent copies of the §9 invariants drift silently — the premise class that produced earlier overturned claims. Contradicts AGENTS.md §1 ("Do not duplicate whole responsibilities across files").
- Evidence: Where: architecture-review/SKILL.md:1-52, esp. :46-47 · Evidence: "the accepted apps/knowledge/ implementation is not moved during M5; structural migration requires its own approved task and regression gate." — the repository is at M12. The file contains no procedure, no review inputs, no output vocabulary and no gate: only a priority list (:3-13, duplicating planning:32-42) and an invariants list (:21-47, duplicating AGENTS.md §9) that omits §9's canonical peer-module path rule and its "target directory trees are architecture, not implementation evidence" clause.
- Reproduction: Documentation review at HEAD — `.agents/skills/architecture-review/SKILL.md`, the artifact `AGENTS.md` §5 routes "architecture/ownership/overengineering review" to, is 52 lines containing no procedure, no review inputs, no output vocabulary and no gate: only a 9-item priority list (`:1-13`), an invariants list (`:15-47`) and a two-line fallback (`:49-51`). Its `:46-47` still states the expired milestone fact "the accepted `apps/knowledge/` implementation is not moved during M5; structural migration requires its own approved task and regression gate" while `PLAN.md:69` declares `Milestone: M12 — Governed Discord interaction lifecycle and governed presentation`. Its priority list is item-for-item identical to `planning/SKILL.md:32-42`, and its invariants list paraphrases `AGENTS.md` §9 while omitting two §9 rules — a grep at HEAD finds no `canonical peer` and no `directory trees` clause anywhere in the file, so neither the canonical peer-module path rule (`zink-skill-store/`/`zink-tools/` must not be nested) nor "target directory trees are architecture, not implementation evidence" appears. No suite in `tests/` reads `.agents/skills/` (the only `.agents/` occurrence under `tests/` is a comment at `tests/m8-t2.16-r19-promptbuild-liveness.test.mjs:508`, and `scripts/repository-policy.mjs:6-15` lists no `.agents/` path), so the red check is this review itself: the file fails the requirement that a §5-routed skill define an executable review procedure with current milestone facts.
- Acceptance criteria: `.agents/skills/architecture-review/SKILL.md` becomes executable by stating review inputs, ordered steps, a verdict/output vocabulary and a completion gate; it contains no milestone-dated facts (the M5 clause at `:46-47` is gone or reduced to the durable rule already in `AGENTS.md` section 9); and it points to `AGENTS.md` sections 8 and 9 and `planning/SKILL.md` as the single sources for the priority and invariants lists instead of carrying its own divergent copies at `:3-13` and `:21-47`.
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
- Reproduction: Static refutation at HEAD — `DEFAULT_LOCK_TIMEOUT_MS = 5000` (`integrations/openclaw/lib/file-lock.mjs:42`) is the contender's acquisition budget, not a hold limit: it is consumed only inside `acquire` (`:267-298`, deadline at `:277`, `FILE_LOCK_TIMEOUT` at `:291-298`), while `withFileLock` (`:305-330`) awaits `fn()` at `:318`, releases in `finally` at `:323` and holds until the callback settles — semantics pinned by `tests/m8-t2-file-lock.test.mjs` "acquire times out with explicit error instead of waiting forever" (`:102`) and "two-process contention: second process waits, never double-acquires" (`:42`). The 1,000-manifest ceiling (now `catalog.mjs:501-508`; register cites `:480-487`) appends `MANIFEST_LIMIT_EXCEEDED` during the walk and `scanCatalog` then returns `records: sortedErrors.length === 0 ? sortedRecords : []` (`:807`) — a deterministic fail-closed refusal (reads get `skill: null` at `:813`; promotion refuses `CATALOG_INVALID`/`PREEXISTING_CATALOG_ERRORS` at `:1311-1321`), not weak after-the-fact enforcement. The in-lock promotion walks (heal `:1211`, pre-scan `:1306`, staging writes and fsyncs `:1360-1392`, rename `:1393`, parent fsync `:1411`, re-verify scan `:1413`) and `getActiveSkill`'s full scan per read (`:811-822`) persist, but as the documented `M11/T1-R1 2.3` design (`:1091-1097`). Verify by reading the cited lines and running `node --test tests/m8-t2-file-lock.test.mjs` green; no red test is constructible because the premise misreads both mechanisms.
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
- Reproduction: Documentation review at HEAD — the row's first half is fixed and its second half stands. `.agents/states/README.md`'s table (`:27-30`) defines exactly two state files (`context.md` `:29`, `handoff.md` `:30`), and `:32-33` reads "Do not create extra state files unless a repeated need cannot fit these two without mixing responsibilities" — count and prose agree, as do `:143-144` and `:148` ("the two mutable … state files"), so the "a set of three described as four" mismatch no longer exists. The retired-artifact reference stands verbatim at the exact cited line: `.agents/skills/planning/SKILL.md:210-211` "Do not create or use `.agents/states/active-task.md`." — `grep -rn "active-task" .agents/` returns only this one hit, a prohibition naming a file no protocol document defines. No suite in `tests/` reads `.agents/` documents, so the check is this review itself: the grep must keep returning exactly one hit at `planning/SKILL.md:211` until the stale pointer is deleted or reworded to stop naming a retired artifact.
- Acceptance criteria: The 'no extra state files' rule states a count that matches the file set the protocol actually defines (two), and no live skill or doc references the retired `.agents/states/active-task.md` as a live or prohibited artifact, meaning the `planning/SKILL.md:211` prohibition is either removed or reframed as an explicitly historical note; satisfying that is the sole license to delete this row.
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
- Reproduction: Static/code-read plus one runnable pin: read `operator-apply.mjs:91-105` (`systemctl --user restart` then `is-active`, no `daemon-reload`), `apply-orchestration.mjs:193-227` (verification after restart is only `verifyLiveRestore`), and `transaction-snapshot.mjs:334-361` (sha256-compares on-disk file bytes, never the loaded systemd unit); then add to `tests/m8-t2.13-r16-apply-rehearsal.test.mjs` an assertion that the recorded `FULL_STAGE_TRACE` (`:412-428`) contains a `daemon-reload` or loaded-unit verify step before `verifyLiveRestore:postApply`, and run `node --test tests/m8-t2.13-r16-apply-rehearsal.test.mjs` - it is red today because the trace runs `restartScopedGateway` straight into the byte-comparison verify.
- Acceptance criteria: The apply issues `systemctl --user daemon-reload` (or an equivalent loaded-unit refresh) before any restart that is meant to reflect changed unit files, and post-apply verification confirms the loaded/active unit definition (for example `systemctl show` of the changed properties) rather than only on-disk file bytes, so an apply that changed `MemoryMax` or added the `ExecStartPre` gate cannot report `applied` while the running unit still carries the previous definition; satisfying that is the sole license to delete this row.
- Related findings: adjudication Vòng 2: Verified with correction, re-graded Medium → Low · nguồn: A05 — runtime, entrypoints and startup behaviour

### F-183 — Discord native adapter sends are unbounded — REST got deadlines, the announce seam did not

- Category: F6 — Reliability & Performance
- Legacy register id: `R1-A09-06`
- Affected modules: OpenClaw integration
- Severity: Medium
- Status: OPEN
- Root cause: a stalled Discord socket (the recorded code=1006) can pin the announce hook — the exact class M11/T3-R1 removed for REST; a 429 during a card burst loses the card with no retry.
- Evidence: Where: discord-native-send.mjs:532 (await adapter.sendPayload(context)) awaited at index.mjs:5511 inside beforeAnnounce (:7241-7252) and at :8357; DISCORD_REST_DEADLINE_MS = 10_000 covers five fetch sites only · Evidence: no Retry-After/X-RateLimit read exists anywhere in integrations/; 429 surfaces only as `DISCORD_THREAD_POST_FAILED_<status>` (discord-forum-tags.mjs:664-669).
- Reproduction: Add to `tests/m8-t2-native-outbound.test.mjs`, reusing its `mockApi(calls)` idiom (`:19-40`) whose `loadAdapter` returns a `sendPayload`, a case whose `sendPayload` returns a promise that never settles and assert `sendNativePayload` rejects or aborts within a bounded deadline; run `node --test tests/m8-t2-native-outbound.test.mjs`. Today `sendNativePayload` awaits `adapter.sendPayload` with no timeout or `AbortSignal` (`discord-native-send.mjs:546`), so the call hangs and the test times out instead of rejecting (red).
- Acceptance criteria: The native-adapter announce/send seam enforces a bounded deadline on `adapter.sendPayload` matching the `DISCORD_REST_DEADLINE_MS` treatment REST fetch already has, so a stalled Discord socket cannot pin `beforeAnnounce` indefinitely, and a `429` is surfaced with its `Retry-After`/`X-RateLimit` for bounded retry rather than silently losing the card; satisfying that is the sole license to delete this row.
- Related findings: adjudication Vòng 2: Verified with correction · nguồn: A09 — Discord and external integrations

### F-184 — the knowledge adapter deadline is per-attempt, not per-call: 3 × 120 s + backoff exceeds runTimeoutSeconds: 300, and transport errors get no retry

- Category: F6 — Reliability & Performance
- Legacy register id: `R1-A14-07`
- Affected modules: OpenClaw runtime libs, Zink Tools
- Severity: Medium
- Status: OPEN
- Root cause: the most frequent transient failure is unhandled while the rarest is retried 3×; worst case ≈364 s so the run is killed mid-attempt and the host reports GOVERNANCE_COMPLETION_UNAVAILABLE.
- Evidence: Where: zink-tools/adapters/knowledge/knowledge-adapter.mjs:239-335, :91-92, :298-302; lib/policy.mjs:549 · Evidence: maxAttempts = 3; reqTimeout = input?.timeout || context?.timeout || this.timeout || 120000 applied per attempt; retry only on 429|503|504; req.on("error") (ECONNREFUSED/ECONNRESET — the common container-restart case) rejects with no retry; the 2-slot sharedSearchSemaphore is held throughout; a caller/model-supplied timeout is unbounded.
- Reproduction: Reuse the `http.createServer`/`listen(0)` idiom in `tests/m7-t5-remediation.test.mjs` (`:533-554`, which already injects `{ endpoint }` into `executeGovernedKnowledgeQuery`) with a server that resets the socket on every request (a transport error), then count attempts and assert the transient failure is retried like a `503`; run `node --test tests/m7-t5-remediation.test.mjs`. Today `req.on('error')` (`knowledge-adapter.mjs:342`) rejects out of the `maxAttempts = 3` loop that retries only `429|503|504` (`:359-364`), so a transport error makes exactly one attempt and the attempt-count assertion is red.
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
- Reproduction: Reuse the runtime-backup idiom in `tests/m7-t2-openclaw.test.mjs` (`:260-334`, which builds a tmp state root and calls `createRuntimeBackup`/`verifyRuntimeBackup`) and add an assertion that the written manifest `governance_version` equals the authoritative `GOVERNANCE_VERSION` exported from `topology/lib/canonical.mjs` (`m8-t2.3-r5`); run `node --test tests/m7-t2-openclaw.test.mjs`. Today the manifest is stamped with the frozen literal `m7-t2-r12` (`runtime-backup.mjs:177`) and `verifyRuntimeBackup` rejects anything else (`:217`), so the equality assertion is red.
- Acceptance criteria: Runtime-backup and native-patch manifests derive their `governance_version`/`version` from one authoritative governance-revision source instead of a frozen literal, and their validation accepts every revision the machinery actually wrote, so restore evidence attributes bytes to the correct revision and bumping the authoritative constant never retroactively invalidates real written manifests; satisfying that is the sole license to delete this row.
- Related findings: nguồn: B07 — end-to-end: dedup decisions, one refutation, and a…

### F-186 — the ceiling is a post-hoc .slice() on an already materialized full result with no LIMIT pushed to the engine and no maxBuffer set, so the only real bound is Node's 1 MiB default stdio buffer

- Category: F6 — Reliability & Performance
- Legacy register id: `R5-E06-06`
- Affected modules: Zink Tools
- Severity: Medium
- Status: OPEN
- Root cause: the ceiling is a post-hoc .slice() on an already materialized full result with no LIMIT pushed to the engine and no maxBuffer set, so the only real bound is Node's 1 MiB default stdio buffer. Two failure modes: a wide result overruns the buffer and is reported as DUCKDB_EXECUTION_ERROR (the engine blamed for a plumbing limit), and a normal large result is silently cut to 100 rows so the model asserts "there are 100 matching records". Also unresolved: the ETIMEDOUT branch at :273 keys on err.code string equality while err.killed/err.signal are never…
- Evidence: Where: duckdb-bridge.mjs:203-206, :263-267, :293-319 · Evidence: const maxRows = Math.min(Math.max(Number(input.max_rows) || DUCKDB_DEFAULT_MAX_ROWS, 1), DUCKDB_MAX_ROWS_CEILING); … execFileSync("duckdb", ["-json","-c", initSql], { timeout: timeoutMs, … }) … const sliced = parsedRows.slice(0, maxRows); with row_count: rows.length.
- Reproduction: Add to `tests/duckdb-bridge.test.mjs`, reusing its `executeGovernedDuckDbQuery` import and `duckDbSkip()` engine gate (`:3-7` and `:20-37`), a case running a row-generating query above the 100-row default (for example `SELECT unnest(generate_series(1,5000)) AS n`) that asserts the result distinguishes the true total from the returned page (a `truncated`/`total_rows` field or `row_count` reflecting the total); run `node --test tests/duckdb-bridge.test.mjs`. Today the bridge silently slices to `maxRows` and returns `row_count: rows.length` equal to 100 with no total or truncation signal (`:319` and `:326`), so the assertion is red (NOT RUN if the DuckDB engine is absent).
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
- Reproduction: Add to `tests/m11-t1-skill-governance.test.mjs`, reusing its `freshRoots()` helper (`:79-82`) that returns a `skillsRoot` which is not yet created, a case that constructs `new SkillAdapter(skillsRoot, { skillsRoot })` on that missing root, calls `querySkillStore({ action: 'discover' })`, and asserts `governed_status !== 'SUCCESS'`; run `node --test tests/m11-t1-skill-governance.test.mjs`. Today the missing root skips the `existsSync` block and returns `governed_status: 'SUCCESS'` with `skills: []` (`skill-adapter.mjs:251` and `:328-333`), so the assertion is red.
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
- Reproduction: Static/code-read (a GitHub Actions workflow with no runnable test lane): read `.github/workflows/security.yml:42-43` and confirm `npm audit --audit-level=high` is the only dependency-audit step, then confirm no baseline/allowlist/diff mechanism exists anywhere (no `.npmrc`, no audit-ci config, no recorded advisory set). The observable failing today is that a recorded 5-high baseline and a newly added high-severity dependency both produce the same non-zero exit, because the workflow never compares against a baseline and so cannot say 'baseline persists' versus 'this branch added one'.
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
- Reproduction: Add to `tests/m11-t1-postgres-sql-gate.test.mjs`, reusing its `containerAvailable(t)`/`dockerExec` psql scratch-DB idiom (`:80-134`), a case that applies `001_initial.sql`, runs `EXPLAIN` on a tag-filtered segment query (`tags @> $4` plus `segment_type = ANY($6)`), and asserts an index scan on those predicates rather than a seq scan with heap filter; run `node --test tests/m11-t1-postgres-sql-gate.test.mjs`. Today no applicable index exists, so the plan seq-scans and heap-filters the whole ACTIVE-index corpus (NOT RUN if the postgres+pgvector container is absent); the missing index is also statically provable by reading `001_initial.sql:143-150`.
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
- Reproduction: Add to `tests/repository-policy.test.mjs`, reusing its `withTemporaryRepository` git-init idiom, a case that creates a nested `<module>/backups/capture.json` (and `<module>/logs/x`) inside the temp repo and asserts the generated tree is ignored and cannot be tracked; run `node --test tests/repository-policy.test.mjs`. Today `.gitignore` anchors `/backups/*`, `/logs/*`, `/temp/*` to the repo root (`:16/:18/:20`), so a nested module-path capture is not ignored and appears in `git status`/`listTrackedFiles` as stageable, making the assertion red; equivalently `git check-ignore -v integrations/openclaw/backups/x` exits 1 while `git check-ignore -v backups/x` exits 0.
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
- Reproduction: Add a case to `tests/m12-t1-discord-component-registry.test.mjs` (baseline green 12/12, measured) that imports `registerPostedNativeComponents` from `integrations/openclaw/lib/discord-native-send.mjs:397` - zero references anywhere under `tests/`, grep-verified - and calls it with the file's existing helpers `adapterHarness({ failRegister: true })` (`:71`), `buttonSpecs()` (`:37`) and `logHarness()` (`:125`) plus a posted message id, asserting a failure signal distinguishable from the no-buttons short-circuit's bare `false` (`:406`); it fails today because a registration failure returns that same bare `false` and the production caller `index.mjs:6830` discards it - run `node --test tests/m12-t1-discord-component-registry.test.mjs`.
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
- Reproduction: No runnable lane exists, so the reproduction is a static/code-read of `integrations/openclaw/topology/fixtures/runtime-regression/live-governance-probe.mjs`: `:25` and `:39` pin the production `stateDir` and `ledgerPaths(stateDir)`, `:90-91` fabricate a fresh `origin_message_id` and dummy 64-char principal per run so no duplicate/re-entry guard can fire, `:94-100` write `WORKFLOW_OPENED` into the production ledger (the precondition the probe later reads back), `:140` and `:221` set `deliver: false` so nothing reaches Discord and button delivery is unobservable, and `:146-149`/`:240-247` declare PASS from that self-seeded snapshot; for a red test, extend the source-invariant idiom of `tests/m12-t2.2-b4-live-probe-invariants.test.mjs:28-31` (`readFileSync` the instrument, assert on its text) to assert the probe records no ledger event against a hardcoded production `stateDir` - that assertion fails today.
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
- Reproduction: Runnable mechanism demo: `node --test tests/m8-t2.13-r16-apply-rehearsal.test.mjs` prints `tests 22 / pass 6 / fail 0 / skipped 16` and exits 0 (measured), and identically on any host without the `personal-tool-postgres-1` container - including the ubuntu-24.04 runner pinned at `.github/workflows/ci.yml:20` - `tests/m11-t1-postgres-sql-gate.test.mjs` reaches `t.skip` at `:43`/`:100`/`:130` and exits 0 while `ci.yml:42-43` prints SUCCESS; the red test belongs in `tests/repository-policy.test.mjs` beside its existing ci.yml/gate-registry parsing idiom (cases at `:285` and `:395`) as a case asserting the quality-gate lane declares a per-family skip expectation, which fails today because no gate consumes skip counts - the expectation's shape is owned by the pending `H3` decision.
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
- Reproduction: Add a case to `tests/m7-t2-plugin-packaging.test.mjs` reusing `deployShape` (`:41`) and case B's `pathToFileURL` import idiom (`:79-81`) to also write the returned `entrypoint` as `index.mjs` into the shape root (currently discarded - `void entrypoint;` at `:298`), then `await import()` it and assert every relative import specifier in the entrypoint source resolves to a packaged asset key, running `node --test tests/m7-t2-plugin-packaging.test.mjs`; the observable that fails today is the mutation half - because the suite never imports or enumerates the entrypoint graph (only substring asserts at `:132-137`/`:288-298`), adding one non-whitelisted `lib/` import to the entrypoint leaves 13/13 green, which is exactly the `ERR_MODULE_NOT_FOUND` class the gate must catch.
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
- Reproduction: Static — no gate ever enumerates the drop-in directory: `configure.mjs:1164-1168` builds `systemdDropInPath` as `path.join(systemdUserDir, "openclaw-gateway-zink.service.d", "10-zink.conf")` and `verify.mjs:411-415` composes the same single filename, `verify.mjs:528-530` byte-compares only that file (`if (readFileSync(dropInPath, "utf8") !== renderSystemdDropIn(stateDir)) throw new Error("Systemd drop-in drift detected")`), and `MemoryMax=768M` exists solely inside `renderSystemdDropIn` (`integrations/openclaw/lib/policy.mjs:1349`, legacy sibling `:1356`). Under systemd drop-in semantics a sibling `20-x.conf` setting `MemoryMax=infinity` is read after `10-zink.conf` and wins the single-valued assignment, yet `--preflight`, `--apply` and `verify` all stay green because `verify.mjs` contains no `readdirSync` (grep: 0 matches) and issues no `systemctl show` query either; `configure.mjs` touches only the single path (preflight compare `:1562-1568`, apply write `:1837-1844`). Gate in `tests/m7-t1-openclaw.test.mjs` beside the drop-in test at `:953`: after `--apply` into the temporary home, write a `20-override.conf` sibling into `openclaw-gateway-zink.service.d/`, re-run `configure.mjs --preflight` and `verify.mjs`, and assert both exit non-zero naming the unowned sibling drop-in — today both pass, which is the red observation.
- Acceptance criteria: Preflight, apply and verify enforce the ceiling against the effective drop-in set instead of one filename: they enumerate `openclaw-gateway-zink.service.d/` and fail or report drift on any fragment other than the rendered `10-zink.conf`, so no sibling `20-*.conf` can raise or remove `MemoryMax=768M` or inject `ExecStart` while the gates still print PASS.
- Related findings: nguồn: A05 — runtime, entrypoints and startup behaviour

### F-203 — Windows and WSL entrypoints disagree on permission assertions and on which state tree they inspect

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R1-A05-06`
- Affected modules: OpenClaw runtime libs, Repo tooling + deploy scripts
- Severity: Medium
- Status: OPEN — _(concrete instance of the gate-lane divergence)_
- Root cause: a green Windows/CI preflight is read as deployment evidence while it checked a copy that is not evidence; the mode gate silently exists on only one lane; operator-* scripts hardcode /home/hoang_vinh/… and run only in WSL.
- Evidence: Where: configure.mjs:985-995 (if (process.platform === "win32") return; skipping every mode check) + :1067-1078; lib/policy.mjs:758-760; verify.mjs:130-139, 470-495; operator-preflight.mjs:13, operator-apply.mjs:39-40 · Evidence: main() pins stateDir to ~/.openclaw-zink (the STALE Windows tree on this host); measured statSync("C:/Users/HOANG VINH/.openclaw-zink").mode & 0o777 = 666, and verify.mjs's requireMode has no platform guard.
- Reproduction: The two entrypoint families still inspect different trees under different permission rules: `configure.mjs:1120-1128` pins `stateDir` to `defaultStateDirectory()` and throws `"OpenClaw state directory must be ~/.openclaw-zink"` for anything else, `verify.mjs:370-380` does the same, and `lib/policy.mjs:760-762` resolves `path.join(homedir(), STATE_DIRECTORY_NAME)` (`:52` = `.openclaw-zink`) — which on this Windows host is the stale NTFS tree; a read-only `node -e` probe of `statSync(join(homedir(),".openclaw-zink")).mode & 0o777` printed `666`. Meanwhile `operator-preflight.mjs:13`, `operator-apply.mjs:39-40` and `live-governance-probe.mjs:25` pin the WSL tree `/home/hoang_vinh/.openclaw-zink`. On win32 every mode assertion evaporates: `requireFileMode` returns early at `configure.mjs:1038-1041` (`if (process.platform === "win32") { return; }`) and `requireMode` returns at `verify.mjs:142-145`, so the whole `0o600`/`0o700` battery in `verify.mjs:485-508` is vacuous while the gate still reads PASS, whereas `operator-preflight.mjs:19` asserts `(stat.mode & 0o777) !== 0o600` with no platform guard. Gate in `tests/m12-t2.2-b3-verify-mode-host.test.mjs` (which already pins `requireMode`'s host behaviour at `:26-40`): add an assertion that a win32 verify run surfaces the mode lane as explicitly NOT ENFORCED in its verdict output rather than skipping silently, and that the builder/verifier lane and the operator lane cannot resolve to different state trees on the same host without a loud refusal.
- Acceptance criteria: Every PASS emitted by `configure.mjs` and `verify.mjs` records which state tree it actually inspected and whether the host enforces POSIX modes, and a host where the governed WSL tree `/home/hoang_vinh/.openclaw-zink` is unreachable or modes are unenforced yields NOT RUN rather than PASS, so a green Windows preflight against the homedir copy can no longer be recorded as deployment evidence.
- Related findings: adjudication Vòng 2: Verified, Medium kept · nguồn: A05 — runtime, entrypoints and startup behaviour

### F-204 — the zink-tools/ lint/format gap hides four real defects, not style noise

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R1-A10-07`
- Affected modules: Zink Tools, Gates + CI, Governance records
- Severity: Medium
- Status: PARTIAL — the coverage half CLOSED at `9c7af0f`; the three defects it hid stay open.
- Root cause: Register kết luận: the zink-tools/ lint/format gap hides four real defects, not style noise. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: Where: zink-tools/adapters/skill-store/skill-adapter.mjs:210, :416, :976-979; zink-tools/common/semantic-contract.mjs:394 · Evidence: :210 destructures an unused version (the missing ACTIVE selector of R1-A10-01); :416 stamps apply results lifecycle_state:"active" lowercase while read uses "ACTIVE"; :976 throw … Unsupported action is unreachable (all six ALLOWED_ACTIONS are handled); :394 is a dead void expression. npm run lint never reads the tree (PLAN.md:268).
- Reproduction: Static — three of the four shapes survive at HEAD. (1) `apply` stamps `lifecycle_state: "active"` (`skill-adapter.mjs:432`) while `discover` stamps `"ACTIVE"` (`:312`) and `read` enforces `!== "ACTIVE"` (`:382`), so one store state carries two spellings across actions. (2) The `Unsupported action` throw at `:993-996` (`throw new SkillAdapterError(..., "SKILL_ACTION_INVALID")`) is unreachable: `:236-241` already rejects everything outside `ALLOWED_ACTIONS` (`:34-41`) and each of the six allowed branches returns unconditionally (`:328`, `:389`, `:448`, `:761`, `:986`). (3) `semantic-contract.mjs:424` discards the topic-membership result via `void knownTopics.includes(metadataFilters.primary_topic);`, whose own comment at `:420-423` says it is not a check at all, so an unknown `primary_topic` passes silently. Gate (1) and (2) in `tests/m10-t2-r25-skill-read-apply-integrity.test.mjs` (imports `SkillAdapter` at `:36-41`): assert `querySkillStore({action:"apply"}).skill_content.lifecycle_state === "ACTIVE"` byte-identical to the discover/read spelling (red today: `"active"`), and assert either a reachable input for `Unsupported action` or that `SKILL_ACTION_INVALID` at `:239` is the single invalid-action rejection; gate (3) in `tests/m8-t1-skill-vector-memory.test.mjs` (imports `prepareQueryEmbedding` at `:11-14`) with a case asserting an unregistered `primary_topic` throws or is reported — red today because `:424` returns normally.
- Acceptance criteria: lint covers zink-tools/ and reports zero errors on the current tree.
- Related findings: adjudication Vòng 2: Verified with correction · bug mở: R1-A10-01 · disposition: the coverage half CLOSED at `9c7af0f`; the three defects it hid stay open. · nguồn: A10 — Zink Tools, adapters and execution contracts

### F-205 — a "test that cannot fail on Windows": the platform guard returns from the test body instead of skipping

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R1-A12-02`
- Affected modules: Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: Windows pass counts are inflated and the junction case never runs in CI (ubuntu), so per-lane coverage differs while every lane reports the same green number.
- Evidence: Where: tests/m6-t1-skill-store.test.mjs:519 (SKILL.md symlink → UNSAFE_PATH), :533-543 · Evidence: if (process.platform === "win32") return; before any assertion, while a sibling test uses { skip: process.platform !== "win32" }. · R7 (nạp vị trí mới từ hàng `F-270` bị rút vì trùng root cause; thu hẹp lại sau khi Lead tự đo cả bốn site được dẫn): phần _junction_ của phép kiểm không chạy ở bất kỳ lane nào bị buộc — `tests/m6-t1-skill-store.test.mjs:533-544` chặn nó bằng `{ skip: process.platform !== "win32" }` (assertion ở `:541` là `assert.notEqual((await catalog(root)).errors.length, 0)`) trong khi `.github/workflows/ci.yml:20` và `:50` đều `runs-on: ubuntu-24.04`, nên trên lane bị buộc điều kiện chặn là đúng và nó được _báo cáo_ là skip, không phải pass. Đứng cạnh nó, `:519` mới là chỗ defect của hàng này: `if (process.platform === "win32") return;` không gọi `t.skip`, nên chỉ trên Windows phép kiểm mới in ra một kết quả pass không tồn tại; trên ubuntu thì điều kiện sai và assertion vẫn chạy. Bốn site mà bản nháp này gộp chung đã được đo lại và **không cùng defect**: `tests/m12-t2.2-a3-queue-writer-lock.test.mjs:391-396`, `tests/m11-t3-durable-state-integrity.test.mjs:997-1000`, `tests/m7-t1-openclaw.test.mjs:1438-1443` và `tests/m11-t1-openclaw-outbound-and-caches.test.mjs:163-168` đều gọi `t.skip(…)` trước khi return, tức báo cáo skip một cách trung thực; chúng chỉ cho thấy cùng điều kiện nền tảng để phép kiểm không chạy trên Windows, không phải bằng chứng lan rộng của lỗi khai báo ở `:519`. Census tự đo của vòng này (quét mọi `tests/*.test.mjs` lấy các dòng chặn bằng `process.platform === "win32"` rồi return không kèm `t.skip`): đúng **một** site trên toàn repo, tức chính `:519`; biến thể gần nhất là `tests/m12-t2.2-b3-verify-mode-host.test.mjs:32-36`, nơi nhánh win32 gọi `requireMode` để khẳng định _không_ có gì bị từ chối trong khi nhánh POSIX khẳng định `assert.throws`, nên mỗi host chỉ kiểm được một nửa của cùng một hợp đồng — cùng họ nhưng không phải cùng cơ chế, ghi ở đây thay vì mở hàng riêng.
- Reproduction: On this Windows host `node --test --test-name-pattern="rejects links at root and content-file boundaries|treats a Windows junction" tests/m6-t1-skill-store.test.mjs` printed `pass 2, fail 0, skipped 0` with the guarded test green in ~19 ms: the body returned at `tests/m6-t1-skill-store.test.mjs:519` (`if (process.platform === "win32") return;`, the first statement of the second `temporaryStore` callback inside the test at `:499`) before ever creating the file-symlinked `SKILL.md` (`:520-524`) or asserting `UNSAFE_PATH` (`:525-529`), so the scenario is silently unexercised while the reporter shows a plain pass — contrast the sibling at `:533-535` whose declarative `{ skip: process.platform !== "win32" }` is at least counted. Gate in `tests/m6-t1-skill-store.test.mjs` itself: restructure the second scenario as its own `test()` (or `t.test` subtest) carrying `{ skip: process.platform === "win32" }` and keep `assert.ok((await catalog(root)).errors.some((error) => error.code === "UNSAFE_PATH"))` in the body. The checkable red is that a Windows run reports `skipped 0` for a scenario it never executes; after the fix the same run must show a visible skip (or a real assertion on hosts where file symlinks are creatable).
- Acceptance criteria: No platform-conditional case silently passes and none executes in zero enforced lanes: the bare `return` at `tests/m6-t1-skill-store.test.mjs:519` becomes a recorded skip like its siblings, and CI gains an enforced lane (a windows runner or a lane-independent equivalent) that actually executes the `{ skip: process.platform !== "win32" }` junction case at `:533-544`, so Windows pass counts reflect only assertions that ran.
- Related findings: adjudication Vòng 2: Verified with correction · nguồn: A12 — test validity and regression coverage · R7 delta audit: `F-270` withdrawn as a duplicate of this row, its locations merged here

### F-206 — MODEL_ALLOWLIST_VIOLATION is an unreachable guard whose "coverage" is a tautology

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R1-A12-06`
- Affected modules: Gates + CI
- Severity: Medium
- Status: OPEN — _(pairs with K06)_
- Root cause: the gate reports coverage of a security invariant that is untested, and readers keep believing indices 2–4 are unreachable.
- Evidence: Where: lib/quota-telemetry.mjs:262-264 guard, stale comments :203, :214-219; tests/m7-t2-quota-telemetry.test.mjs:465-471 (TEST M), :474-493 (TEST M2) · Evidence: the resolver only assigns allowlist[0]/allowlist[1], so membership cannot fail; TEST M2's own comment says the guard "is unreachable by construction" then re-asserts membership. MODEL_ALLOWLIST now has 5 entries (policy.mjs:534-543).
- Reproduction: Static — no input can make `chosen` a non-member: the resolver reads only indices 0/1 of the same array (`quota-telemetry.mjs:212-213`, `primary = allowlist[0]` and `fallback = allowlist[1]`, assigned at `:225`/`:229`/`:232`/`:246` and `:249`/`:253` behind the `!fallback`/`latch` guards at `:236`/`:244`) and returns either `primary` or `fallback`, so the `MODEL_ALLOWLIST_VIOLATION` guard at `:262-264` (`if (!allowlist.includes(chosen)) { throw new Error("MODEL_ALLOWLIST_VIOLATION"); }`) is dead and its "coverage" — TEST M's `MODEL_ALLOWLIST.includes(result.model)` (`tests/m7-t2-quota-telemetry.test.mjs:467-470`) — is a tautology that TEST M2's own comment at `:475` ("unreachable by construction") admits before re-asserting membership at `:491`. The stale comments at `:203-206` ("governed set is a single entry under M10/T2-R9") and `:214-219` ("the router's single `execute` combo entry") still describe the removed single combo while `policy.mjs:625-628` records the five-model chain (`ROUTER_PROVIDER_MODEL_IDS`, `:534-540`, "`execute` (the combo) is no longer governed at all"). Gate in `tests/m7-t2-quota-telemetry.test.mjs`: replace TEST M/M2 with a falsifiable property — inject a stub `allowlist` whose `includes` returns `false` to demonstrate the guard can never fire through the real code path, or delete the dead guard and pin the reachable invariant that the resolver consults only `allowlist[0]`/`allowlist[1]` — and correct the two comment blocks to the five-model chain; the red observation today is that no resolution can produce `MODEL_ALLOWLIST_VIOLATION`.
- Acceptance criteria: The `MODEL_ALLOWLIST_VIOLATION` guard either becomes a reachable, tested invariant - a case actually triggers the throw and reddens if the guard is removed - or is deleted as dead code together with the stale single-entry comments at `quota-telemetry.mjs:203-206`/`:214-219`, and in either world the tautological membership re-assertions of TEST M/TEST M2 (`tests/m7-t2-quota-telemetry.test.mjs:462-493`) stop counting as coverage of that invariant.
- Related findings: adjudication Vòng 2: Verified, corrected · nguồn: A12 — test validity and regression coverage

### F-207 — the verdict-matrix suite counts any thrown error as the specified policy DENY, and three cases require no diagnostic at all

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R1-A12-09`
- Affected modules: Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: Register kết luận: the verdict-matrix suite counts any thrown error as the specified policy DENY, and three cases require no diagnostic at all. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: Where: tests/m10-t2-r8-ingress-verdict-matrix.test.mjs:271-300, expectedLogs null at :245-252 · Evidence: try { await enterNativeRun(…); verdict="ALLOW" } catch { verdict="DENY" } — a harness fault, a malformed fixture, or GOVERNANCE_CONTEXT_MISSING/GOVERNANCE_RUN_UNAVAILABLE from any cause is recorded as the designed verdict; one test() wraps a loop so the first failure hides the rest. · R7-C (vị trí mới, gộp; đã sửa theo phép đo 2026-10-18): the same indistinguishable-denial exposure in two distinct forms — (a) single-code catch-all matchers that cannot separate a designed DENY from any other cause, at `tests/m10-t2-r4-conversational-ingress.test.mjs:448,457,478,499,519,551,562` and `tests/m10-t2-r5-host-inbound-metadata.test.mjs:562,581,599,618,638,654`, each matching only `GOVERNANCE_RUN_UNAVAILABLE`; (b) genuinely ORed multi-code matchers that accept several distinct denials interchangeably, at `tests/m10-t2-coordinator-binding.test.mjs:557,579` and `tests/m10-t2-r2-coordinator-execution-authority.test.mjs:987`. Measured cause: `integrations/openclaw/topology/lib/native-boundary.mjs:510-531` collapses every non-allow outcome, thrown guard failure and malformed context into one `GOVERNANCE_RUN_UNAVAILABLE`, so the per-rule reason is reachable only through `error.cause.message` or the `logDecisionReason` line — which `tests/m12-t2.2-b16-denial-reason.test.mjs:109-113` AND `tests/m12-t2.2-k1-announce-discard-reason.test.mjs:435` both read, so b16 is not the only reader. Withdrawn by measurement: `r4:563` is a closing `);` and `r4:578` is past EOF (that file is 565 lines), and `integrations/openclaw/lib/native-boundary.mjs` is not a tracked path. · R7-E (vị trí mới, gộp): `tests/m7-lane-h2-queue-persistence-matrix.test.mjs:103-114`, `:136-218`, `:484-501`, `:578-581`, `:335-339`; `tests/m7-lane-h3-identity-tool-matrix.test.mjs:368-388`; `tests/m7-lane-j-attempt-semantics.test.mjs:220-230`; `tests/m8-t2.9-r12-durable-recovery.test.mjs:563`; `tests/m7-t2-openclaw.test.mjs:134-140`, `:696-702`, `:921-933`, `:1516-1523`; `tests/m12-t1-task-identity.test.mjs:292`; `tests/m8-t2-governed-runtime-audit.test.mjs:1901,1949`; `apps/knowledge/tests/test_reranker.py:117,124,170` — cùng cơ chế nhưng ở lane Python: `assertRaises(RerankerUnavailableError)` duy nhất bao trọn 10 code khác nhau mà `app/reranker.py` raise (đo bằng grep `RerankerUnavailableError("[A-Z_]*"`, sort -u = 10). · R7-F (vị trí mới, gộp): `apps/knowledge/tests/test_pdf_foundation.py:127-134` — một `assertRaisesRegex` chấp nhận OR hai code (`PDF_SIDECAR_EMBED_INVALID|PDF_SOURCE_PATH_INVALID`) cho cả vòng ba target ở `:131`, nên xóa một trong hai guard vẫn xanh.
- Reproduction: Static — any thrown error is booked as the specified policy DENY: the bare `catch { verdict = "DENY"; }` at `tests/m10-t2-r8-ingress-verdict-matrix.test.mjs:277-278` (inside `:273-279`, which binds nothing) discards the error identity, so a `GOVERNANCE_CONTEXT_MISSING`/`GOVERNANCE_RUN_UNAVAILABLE` infrastructure throw (`native-boundary.mjs:179`, `:321`, `:343`, `:469`, `:531`), a malformed fixture, or a harness IO fault all satisfy `assert.equal(verdict, expected)` at `:280` for every DENY case. The three `expectedLogs: null` cases (`:245` heartbeat, `:252-253` webchat-operator and cli-operator) additionally accept total silence (`:284-291` is their only log assertion, a token-absence check), which is exactly what a throw before any logging looks like, so they require no diagnostic at all. And because one `test("R8 matrix: every ingress class reaches its specified verdict")` at `:256` wraps the entire `for (const [name, shape, stash, expected] of cases)` loop at `:257`, the first failing case aborts the run and hides every later verdict. Gate in the same file: capture the error (`catch (error) { verdict = "DENY"; cause = error; }`) and assert for each DENY case that `cause.message` is the designed policy denial rather than `GOVERNANCE_CONTEXT_MISSING`/`GOVERNANCE_RUN_UNAVAILABLE`, and convert the loop body to per-case `t.test(name, …)` subtests so one failure cannot mask the rest; today an infrastructure fault passes as the specified verdict — that is the red.
- Acceptance criteria: each DENY case names an expected reason string, with no catch-to-verdict conversion.
- Related findings: adjudication Vòng 2: Verified, exposure narrowed · nguồn: A12 — test validity and regression coverage · R7-C delta audit C5: thirteen cited matcher locators merged here (sixteen live across those four files, counted 2026-10-18) · R7-E delta audit E4/D2: tám file, mười tám vị trí matcher-quá-rộng gộp vào đây; hàng F-312/F-320/F-321 giữ phần riêng của chúng

### F-208 — deferred/OPEN historical defects are still present at HEAD, and the R16 rehearsal gate is permanently self-skipping

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R1-A13-07`
- Affected modules: OpenClaw runtime libs, OpenClaw integration, Zink Knowledgebase, Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: every "CLOSED / DEPLOYED AND VERIFIED" for M11/T3 and M12 rests on operator self-report, never on the repository's own rehearsal instrument.
- Evidence: Where: tests/m8-t2.13-r16-apply-rehearsal.test.mjs:111, 326, 452; lib/policy.mjs:569; lib/quota-telemetry.mjs:214-219 · Evidence: skip = REHEARSAL ? false : "requires the R16 rehearsal mount namespace"; no integrations/openclaw//AGENTS.md exists (deferred cluster C); no quarantine code in apps/knowledge; the quota comments still describe the removed execute combo.
- Reproduction: Run `node --test tests/m8-t2.13-r16-apply-rehearsal.test.mjs` on this host: it printed `tests 22, pass 6, fail 0, skipped 16` — the entire R16 rehearsal lane self-skips because nothing in the `npm test` lane sets `R16_REHEARSAL_ROOT` (`:79` `const REHEARSAL = process.env.R16_REHEARSAL_ROOT ?? "";`) and the only route that sets it (`npm run rehearse:r16`) refuses non-WSL hosts at `r16-rehearsal.mjs:199` (`FATAL: this host is not WSL (platform ...). R16 runs in WSL only.`), so the skip string at `:112-114` is permanent on this host and on the Linux CI runner alike. The deferred clusters also remain at HEAD: no `integrations/openclaw/AGENTS.md` exists (a repo-wide find this session returns only the root `AGENTS.md` plus a temp fixture), no quarantine code exists under `apps/knowledge` (`grep -ri quarantine` over `apps/knowledge/**/*.py` returns zero matches), and the quota comments at `quota-telemetry.mjs:214-219` still describe the removed `execute` combo while `policy.mjs:628` says it is no longer governed at all. Gate in the every-host section of `tests/m8-t2.13-r16-apply-rehearsal.test.mjs` (the pattern established by R16-08 at `:1036-1083` and the R16-DRIVER tests from `:1085`): add static assertions that `integrations/openclaw/AGENTS.md` exists and that `quota-telemetry.mjs` no longer contains the `execute`-combo wording — both red today — and record the rehearsal lane's `16 skipped` as an explicit NOT RUN count in closeout evidence rather than folding it into a green total.
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
- Reproduction: A `node -e` probe pushed `assert.equal("ACTIVE","COMPLETE")` through the exact classifier logic of `live-governance-probe.mjs:254-269` and printed `name= AssertionError | code= ERR_ASSERTION | matched= LIVE_GATE_REJECTED` — identical to any unknown harness fault — so a real completion or lineage regression at `:146-149` (`assert.equal(readSnapshot(paths).tasks[fixture.task_id].workflow_status, "COMPLETE");`) or in the lineage/budget asserts at `:240-247` produces an unattributable FAIL line: `:254` reads `const detail = String(error?.code ?? error?.message ?? "");` against the fixed `known` list at `:255-267` with fallback `"LIVE_GATE_REJECTED"` at `:268-269`. `stage` is also one label for the whole nested matrix: it is set once to `"nested-seven-role-matrix"` at `:155` while the six delegated children are asserted in the loop at `:243-247` (`delegated_runs_used, 6` at `:241`), and the emitted report (`:270-272`) carries only `{ stage, status, reason }` with no run or child identity. Gate in `tests/m8-t2.13-r16-apply-rehearsal.test.mjs` beside R16-08 (`:1036-1083`), which already pins the sibling `operator-preflight.mjs` classifier as a static-source assertion: add a static test asserting `live-governance-probe.mjs` carries a distinct named class for assertion/state failures (mapping `ERR_ASSERTION` to something like `STATE_ASSERTION_FAILED` instead of the catch-all) and that a nested-matrix FAIL names the failing child in `stage` or `reason`; both assertions are red against the current source.
- Acceptance criteria: A probe FAIL record attributes the failing check: the classifier separates assertion/state failures from the enumerated RPC/runtime codes at `:255-267` instead of collapsing both into `LIVE_GATE_REJECTED`, and the emitted `stage` names the failing child (agent id or delegation node inside the `:243-247` loop) rather than one label for the whole nested matrix, so a real completion/lineage regression is distinguishable from a harness hiccup.
- Related findings: nguồn: B03 — governance / ledger / audit integrity (10 claims…

### F-210 — the digest-derivation pins freeze the denial path's literal source text, penalising the very fix K01 needs

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R2-B06-01`
- Affected modules: Chưa xác định — đọc lại Where khi re-verify
- Severity: Medium
- Status: OPEN
- Root cause: Register kết luận: the digest-derivation pins freeze the denial path's literal source text, penalising the very fix K01 needs. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: Evidence: m8-t2.6-r8-asset-provenance.test.mjs:398-467 asserts verbatim catch-block inclusion (comments included) and then string-replaces to reach a hardcoded SHA-256. The natural place to propagate decision.reason is exactly the pinned region, so a provenance gate quietly resists the remediation it claims to protect. Fix: replace text-inclusion pins with behavioural assertions.
- Reproduction: Static — the suite derives the R5 body by asserting every post-R5 hunk's literal text is present in `integrations/openclaw/topology/lib/native-boundary.mjs` and string-replacing it (`tests/m8-t2.6-r8-asset-provenance.test.mjs:547-553`, `for (const [after, before] of POST_R5_HUNKS) { assert.ok(derived.includes(after), ...); derived = derived.replace(after, before); }`), then pins `sha256(derived)` to the hardcoded `49352d47…` (`:39-40`, asserted at `:554-558`), and the denial-path catch blocks are among the pinned literals with their comments (`:426-467`, plus the B-16 `logDecisionReason` reason-propagation hunks at `:473-498`) — so any edit to the denial path, including propagating `decision.reason`, must add or amend a hunk pair or the test `R8: the R5 body is derivable and hashes to the packaged R5 digest` (`:625-627`) fails with "every post-R5 hunk must still be present" even when behaviour is unchanged. The tax already shapes production design: `native-boundary.mjs:359-361` records that threading run-end liveness through the pinned selection "would break the R7/R10 native lineage", so R18 added the `RUN_LIVENESS` side-map (`:366`) instead. Concretely reproducible: change one character inside the `gateNativeAnnounce` catch block mirrored at `:427-435` and run `node --test tests/m8-t2.6-r8-asset-provenance.test.mjs` — the derivability test reddens with no behavioural change. Gate in the same file: replace the text-inclusion pins with behavioural assertions — keep the digest check against a stored R5-body fixture rather than the current source's literals, and cover the current seams through verdict/code assertions (`GOVERNANCE_DENIED` at `native-boundary.mjs:512`, `GOVERNANCE_COMPLETION_UNAVAILABLE` at `:606`, `GOVERNANCE_INGRESS_UNAVAILABLE` at `:635`).
- Acceptance criteria: The R8 provenance gate proves the packaged R5 digest without freezing the denial path's current source text - the `POST_R5_HUNKS` verbatim-inclusion and string-replace pins (`tests/m8-t2.6-r8-asset-provenance.test.mjs:46-530`, `:547-558`) are replaced by a derivation from the committed R5-era bytes (`9713872`) or by behavioural assertions - so a K01 remediation propagating `decision.reason` through the `native-boundary.mjs` denial seams passes without hand-editing hunks, while tampering with the digest (`:39-40`) or its path binding still fails loudly.
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
- Reproduction: Static — the lane's entire reporting configuration is `pytest tests -q` (package.json `test:knowledge`, invoked at `.github/workflows/ci.yml:97-100` as the "Run Knowledgebase Python suite" step with `KNOWLEDGE_TOKENIZER_PATH` at `:99`, while `:94-96` states "pdf-runtime is deliberately not installed here … That suite stays an explicit NOT RUN in CI rather than an assumed pass"), and `apps/knowledge/pyproject.toml` carries no `[tool.pytest.ini_options]` (whole file read: 25 lines, `requires-python = ">=3.13,<3.14"` at `:4`, dev group `pytest==9.1.1`, `[tool.uv]`), with no `addopts`, no coverage floor, no `--strict-markers`, and no `pytest.ini`/`setup.cfg`/`conftest.py` anywhere in the tree — so nothing pins the collected denominator, surfaces skip or deselect reasons, or enforces strict markers. The recorded evidence is the bare pass count `188 passed, 27 subtests` (now at `PLAN.md:60`, `:667`, `:713-714`), while `PLAN.md:4841` records the same suite as `184 passed, 4 skipped, 27 subtests` — proof the pass/skip split moves per host (for example the posix-only test at `apps/knowledge/tests/test_pdf_runtime.py:295`, `@unittest.skipUnless(os.name == "posix", "process-group contract is Linux-only")`) without changing the green reading, and `ci.yml:94-96` keeps the whole pdf-runtime stack permanently NOT RUN. Gate in `tests/repository-policy.test.mjs`, which already asserts the ci.yml Python-lane shape (`:383-418`, including "must contain executable command `npm run test:knowledge`"): add an assertion that the knowledge-lane invocation (or a new `[tool.pytest.ini_options]`) carries skip-surfacing and strictness flags (for example `-rs --strict-markers`), and require closeout evidence to record the full summary (passed plus skipped plus deselected plus subtests) so a shrinking collected set cannot read as an unchanged `188 passed`; note that editing `pyproject.toml` must deliberately advance `EXPECTED_PARENT_PROJECT_SHA256` (`test_pdf_runtime.py:38-46`).
- Acceptance criteria: the Knowledgebase gate pins its collected set - pytest configured in `apps/knowledge/pyproject.toml` under `[tool.pytest.ini_options]` (for example `-rs`, `--strict-markers` and an expected collected/skipped floor or count assertion) so a shrinking collected set or an unreported skip turns `python-quality` red - and the PLAN.md evidence lines record passed/skipped/deselected counts instead of a bare pass total, so a shrinking suite can never again read as an unchanged green.
- Related findings: nguồn: E09 — CI: the gate tier that can print green without…

### F-213 — three suites require historical git objects and the external tar binary

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R5-E10-01`
- Affected modules: OpenClaw integration, Gates + CI
- Severity: Medium
- Status: LATENT
- Root cause: three suites require historical git objects and the external tar binary. On a shallow clone, after a squash-merge to main, or after git gc prunes now-unreachable SHAs, npm test goes red for a non-code cause — and ci.yml:54/security.yml:27 use default (shallow) checkouts, so any job built on them inherits it. Pairs with R5-E09-03: a red that nobody can explain is as bad as a green that proves nothing.
- Evidence: Where: tests/m11-t1-r2-file-lock-asset-predecessor.test.mjs:47, :160-181; tests/m8-t2.10-r13-r7-predecessor-allowlist.test.mjs:288-310; tests/m12-t2-governed-surface.test.mjs:644-661 · Evidence: const LIVE_SOURCE_COMMIT = "ea84a5a"; then spawnSync("git", ["archive", LIVE_SOURCE_COMMIT, …]) asserted with assert.equal(archive.status, 0, …) plus spawnSync("tar", ["-x", …]); m12-t2 uses execFileSync("git", ["show", "b6d04e8:integrations/…"]). No skip guard. · R7-E (vị trí mới, gộp): `tests/m10-t2-r8-observability-predecessor.test.mjs:51-61` và `tests/m10-t2-r6-boundary-predecessor.test.mjs:147-157` cần `git archive` một SHA lịch sử cộng `tar`; `tests/m8-t2.16-r19-promptbuild-liveness.test.mjs:455-514` kết hợp pin sha256 byte với `git show 980b36e:`.
- Reproduction: Static — all three suites shell out to pinned historical SHAs and the external `tar` binary with no skip guard on that dependency: `tests/m11-t1-r2-file-lock-asset-predecessor.test.mjs:47` sets `LIVE_SOURCE_COMMIT = "ea84a5a"` and `liveExtension()` runs `spawnSync("git", ["archive", LIVE_SOURCE_COMMIT, …])` plus `spawnSync("tar", ["-x", …])` under `assert.equal(archive.status, 0, …)` (`:170`) and `assert.equal(tar.status, 0, …)` (`:179`), repeated for `d773856` at `:492-505`; `tests/m8-t2.10-r13-r7-predecessor-allowlist.test.mjs:310` defines `gitShow` over `execFileSync("git", ["show", …])` and calls it at module top level (`:318-325`) for `4f5cc6d`; `tests/m12-t2-governed-surface.test.mjs:652` runs `execFileSync("git", ["show", "b6d04e8:…"])`. The skip guards these files do carry protect only the live-WSL-tree reads (`m11-t1-r2:320-341`, `m8-t2.10:434-440`), never the git-object or `tar` path. Probe on this host: `git cat-file -t` returns `commit` for all seven pinned SHAs, `tar --version` is GNU tar 1.35, and the `quality-gate` job that runs `npm test` checks out with `fetch-depth: 0` (`.github/workflows/ci.yml:26`), so the suites are green today (LATENT); only the shallow `python-quality` checkout at `ci.yml:54` is depth-limited. Reproduce the latent red non-destructively with `git clone --depth 1 <repo> <tmp>` then `node --test tests/m11-t1-r2-file-lock-asset-predecessor.test.mjs` inside it: the pinned SHAs are absent, `git archive` exits non-zero and the status-0 assertion fails for a non-code cause. Fix gates in those same three suites: replace the unconditional status-0 assertions with a reachability precondition that skips when `git cat-file -e <sha>` fails or `tar` is unavailable.
- Acceptance criteria: in `tests/m11-t1-r2-file-lock-asset-predecessor.test.mjs`, `tests/m8-t2.10-r13-r7-predecessor-allowlist.test.mjs` and `tests/m12-t2-governed-surface.test.mjs`, every pinned-SHA git read and every `tar` extraction sits behind a reachability precondition that produces a named skip when `git cat-file -e <sha>` fails or `tar` is unavailable, while a full-history checkout with `tar` present still executes every status-0 assertion against the pinned commits - so a shallow clone, a squash-merge or a gc-pruned SHA can never turn `npm test` red for a non-code cause.
- Related findings: bug mở: R5-E09-03 · nguồn: E10 — test infrastructure: the source-text assertion… · R7-E delta audit E3/D4: ba vị trí historical-object dependency gộp vào đây

### F-214 — the gate is decorative for ~90 % of the surface it names — a tag id introduced in lib/discord-forum-tags.mjs, configure.mjs, templates/, topology/fixtures/ or an env file keeps it green

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R5-E10-02`
- Affected modules: OpenClaw governance plugin (Discord), OpenClaw integration, Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: the gate is decorative for ~90 % of the surface it names — a tag id introduced in lib/discord-forum-tags.mjs, configure.mjs, templates/, topology/fixtures/ or an env file keeps it green. Same class as R5-E13-05 (guard aimed at the wrong files) and R4-V01-01 (verification over a set it silently shrank). A real repo-wide walk precedent already exists at tests/m7-lane-g-policy.test.mjs:731.
- Evidence: Where: tests/m12-t2-governed-surface.test.mjs:489-505 · Evidence: the test is titled "no Discord tag id is hardcoded anywhere in the repository" but reads exactly one file (readFileSync("integrations/openclaw/plugins/zink-governance/index.mjs")) and checks only two things: /applied_tags:\s*\[\s*"\d{15,25}"/u and pluginSource.includes("1545697161985921064").
- Reproduction: Static — the gate `M12/T2 P1: no Discord tag id is hardcoded anywhere in the repository` (`tests/m12-t2-governed-surface.test.mjs:494`) reads exactly one file, `pluginSource = readFileSync("integrations/openclaw/plugins/zink-governance/index.mjs")` (`:489-492`), and asserts only `/applied_tags:\s*\[\s*"\d{15,25}"/u.test(pluginSource) === false` (`:496`) and `pluginSource.includes("1545697161985921064") === false` (`:501`). Every other surface the title names is real and unread — `integrations/openclaw/lib/discord-forum-tags.mjs`, `integrations/openclaw/configure.mjs`, `integrations/openclaw/templates/`, `integrations/openclaw/topology/fixtures/` and the env files — so a 15-25 digit tag literal introduced in any of them keeps the assertion green. Reproduce by adding an `applied_tags: ["1234567890123456789"]` literal to `lib/discord-forum-tags.mjs` and confirming `node --test tests/m12-t2-governed-surface.test.mjs` still passes. Fix gates in this same test: widen P1 to walk the tracked tree — the multi-file precedent is `tests/m7-lane-g-policy.test.mjs:725-733`, and `tests/repository-policy.test.mjs` already enumerates the repo via `execFileSync("git", …)` — asserting both patterns are absent from every tracked `.mjs`, `.env` and template, not from `index.mjs` alone.
- Acceptance criteria: the `M12/T2 P1` gate asserts both patterns - the `/applied_tags:\s*\[\s*"\d{15,25}"/u` regex and the literal `1545697161985921064` - against every tracked source, template, fixture and env file in the repository (enumerated the way `scripts/repository-policy.mjs` `listTrackedFiles` walks the tree), so that introducing either literal in `integrations/openclaw/lib/discord-forum-tags.mjs`, `configure.mjs`, `templates/`, `topology/fixtures/` or any env file turns `node --test tests/m12-t2-governed-surface.test.mjs` red instead of staying green.
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
- Acceptance criteria: the cache tests in `tests/m11-t1-openclaw-outbound-and-caches.test.mjs` no longer assert absolute contents of the process-global `PENDING_CACHE()`/`COMPLETED_CACHE()` singletons - each test either captures the pre-seed baseline size and key set and asserts only deltas, or resets the singleton in a `beforeEach` - so leftover entries from earlier tests can neither flip M11-4.2 red nor make an eviction-order assertion pass for the wrong reason, and the file's outcome no longer depends on which earlier tests ran or on concurrency.
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

### F-218 — a comment reword, an import-line edit, or a units rename turns suites red while nothing behavioural changed — and the converse is worse: a code change can keep the comment, drop the enforcement, and stay green. The real guarantee ("the…

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R5-E10-08`
- Affected modules: Gates + CI (Knowledgebase contract suites m3-t2/t3/t4, orchestration and governance suites)
- Severity: Medium
- Status: OPEN
- Root cause: a comment reword, an import-line edit, or a units rename turns suites red while nothing behavioural changed — and the converse is worse: a code change can keep the comment, drop the enforcement, and stay green. The real guarantee ("the deadline is enforced") is never executed anywhere.
- Evidence: Where: m10-t2-coordinator-binding:1208-1209; m8-t2-governed-runtime-audit:2283, :2344, :2300, :2304; m9-t1-functional-truth-remediation:956; m11-t3-openclaw-runtime-bounds:99-122 · Evidence: assertions on prose and spelling rather than behaviour — assert.ok(source.includes("never a server-echoed field")), source.includes("construction-derived"), pluginSrc.includes("E09: Unified request digest"), pluginSrc.includes("E20: Validate outbound attachments/files linkage"), source.includes("NOT A PROVIDER INTEGRATION"), source.includes("export const DISCORD_REST_DEADLINE_MS = 10_000;"), source.includes('import { execSync } from "node:child_process";'), and assert.ok(!pluginSrc.includes("setTimeout(abort, 300000)")) beside assert.ok(pluginSrc.includes("setTimeout(abort, 10000)")) — the reader is `pluginSrc` over `plugins/zink-governance/index.mjs` (read at `:2289-2297`); no identifier `configureSource` exists in `tests/m8-t2-governed-runtime-audit.test.mjs` (grep count 0, measured 2026-10-18). · R7-C (vị trí mới, gộp): the whole of `tests/m3-t2-contract.test.mjs`, `tests/m3-t3-contract.test.mjs` and `tests/m3-t4-contract.test.mjs` is `assert.match(<source string>, /regex/)` over `main.py`, `database.py`, `retrieval.py`, the Dockerfile and the `knowledge-t*.ps1` drivers with nothing executed — they run on the ubuntu lane because they only read committed files, and they are the executable form of the Knowledgebase HNSW, RRF, token-budget and read-only-Vault invariants; Measured 2026-10-18: no suite anywhere pins import ORDER (a sweep of every `tests/*.test.mjs` for an `importOrder` helper, or for `indexOf` / `startsWith` applied to the literal text of an import statement, returns 0 files), and `tests/m11-t3-openclaw-runtime-bounds.test.mjs:99,:104` are presence/absence `includes` checks that no reorder can break — the breakage vector is a reword or reformat of the pinned line, and the only order-sensitive source pin found is `tests/m3-t3-contract.test.mjs:51` (statement position). Supporting instances at `tests/m12-t2.2-b6-relevance-rule.test.mjs:69-87`, `tests/m12-t2.2-b9-manifest-completeness.test.mjs:87-101`, `tests/m9-t1-functional-truth-remediation.test.mjs:928-949` (a substring scan for the simulation-contract comment), `tests/m10-t2-r15-critical-path-invariants.test.mjs:50,77,129,188,218`. · R7-E (vị trí mới, gộp): `apps/knowledge/tests/test_b14_cause_attribution.py:62-70` — phép kiểm duy nhất cho quy tắc 'nối cause' là tìm chuỗi `from None` trong đúng hai file (`main.py`, `model_probe.py`), trong khi `apps/knowledge/app` hiện có 59 chỗ `raise … from` thuộc 11 module; cả module còn bị `pytest.skip(allow_module_level=True)` ở `:29-35` chặn khi `KNOWLEDGE_TOKENIZER_PATH` chưa được cấp, và biến đó chỉ tồn tại trong `.github/workflows/ci.yml:99`, nên lane Windows không chạy ca này lần nào; `apps/knowledge/tests/test_pdf_migration_contract.py` (cả bốn ca là containment trên text của `migrations/002_pdf_ingestion_foundation.sql`); `tests/m11-t1-skill-governance.test.mjs:612-626` (cả ca "dead code removal" chỉ là sáu `assert.doesNotMatch`) và `:131-134`; `tests/m12-t2.2-b4-live-probe-invariants.test.mjs:33-42`; `tests/m10-t2-r19-artifact-and-message-limits.test.mjs:183-204`; `tests/m10-t2-r8-preflight-intake-seam.test.mjs:126-156`; `tests/m12-t2.2-a1-stack-authority.test.mjs:332-394`; `tests/m12-t2.2-a2-stack-registry.test.mjs:161-220,425-471`; `tests/m11-t3-durable-state-integrity.test.mjs:119-166`; `tests/m10-t2-r6-boundary-predecessor.test.mjs:72-75,179-203,232-237,291-302`; `tests/m12-t1-task-identity.test.mjs:357-405`; `tests/m8-t2-native-outbound.test.mjs:177-285`; `tests/m8-t2.16-r19-promptbuild-liveness.test.mjs:275-291,598-625`; `tests/m8-t2.15-r18-runend-liveness-propagation.test.mjs:574-578,581-602,604-628`; `tests/m8-t2.4-approval-request.test.mjs:504-547`; `tests/m8-t3-governed-memory-learning.test.mjs:1916-1953`; `tests/m7-r4-root-fix.test.mjs:53-66`; `tests/m7-lane-h6-quota-seam.test.mjs:274-279`; `tests/m8-t2.17-owner-identity-hygiene.test.mjs:173-193`. · R7-F (vị trí mới, gộp vì trùng root cause): `apps/knowledge/tests/test_r24_pdf_runtime_boundary.py:132-134` — pin bằng CHUỖI tên lớp exception nội bộ: `assertRaises(Exception)` rồi `assertEqual(type(caught.exception).__name__, "_OutputCapExceeded")`, nên đổi tên mà không đổi hành vi làm đỏ lane enforced, còn exception khác đổi tên thành `_OutputCapExceeded` thì đi qua.
- Reproduction: Red test to add: a behavioral deadline test in `tests/m11-t3-openclaw-runtime-bounds.test.mjs` reusing that file's A3/A4 real-seam idiom (temp-directory fixtures driving imported functions, `:215` and `:312`) that exercises the `DISCORD_REST_DEADLINE_MS` abort path against a stubbed never-resolving fetch, run with `node --test tests/m11-t3-openclaw-runtime-bounds.test.mjs`; the observable that fails today is that no importable seam reaches the abort path - it lives inside the undecomposed `register(api)` closure (`index.mjs:4744-4749`, documented at test-file lines `:1-9`) - so the deadline is asserted only as source text (`:122`, `:138`, `:163`) and never executed. The brittle-red direction needs no new test: reword the `E09: Unified request digest` comment at `integrations/openclaw/plugins/zink-governance/index.mjs:7481` with identical behaviour and `node --test tests/m8-t2-governed-runtime-audit.test.mjs` fails at `:2282-2285`, while removing the abort wiring around `setTimeout(abort, 10000)` (`index.mjs:4858`) yet keeping the literal leaves `:2299-2306` green.
- Acceptance criteria: no test fails when a comment, import line or section heading is reworded with identical behaviour.
- Related findings: nguồn: E10 — test infrastructure: the source-text assertion… · R7-C delta audit C5B/C2/C5: three whole suites and four further pins merged here · R7-E delta audit E2/D3/D4: 19 file, khoảng hai chục vị trí pin text gộp vào đây (thay vì mở hàng riêng)

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
- Acceptance criteria: when a hand-edited tree holds two ACTIVE manifests for one namespace+capability, `scanCatalog` returns a `MULTIPLE_ACTIVE_VERSIONS` diagnostic that names both offending records and still returns the healthy records instead of collapsing to `records: []` at `catalog.mjs:807`, and `tests/m6-t1-skill-store.test.mjs:280-310` is extended to assert that named diagnostic plus the surviving records, while the promotion writer still throws `SKILL_ACTIVE_CONFLICT` (`catalog.mjs:1329-1332`) before any second ACTIVE can be created through the sanctioned path.
- Related findings: bug mở: R5-E04-05 · nguồn: E04 — Skill Store catalog internals (9 findings; the store…

### F-223 — npm run verify says nothing about the PowerShell the runbooks tell the owner to execute, including a backup script

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R5-E08-06`
- Affected modules: Gates + CI, Architecture + contracts docs, README, Repo tooling + deploy scripts
- Severity: Low
- Status: OPEN
- Root cause: target directory trees were committed as architecture (AGENTS.md §9 "Target directory trees are architecture, not implementation evidence") while the real operator entry points stayed where the Docker work put them. — Hệ quả: npm run verify says nothing about the PowerShell the runbooks tell the owner to execute, including a backup script. Any future doc pointing at `scripts/verification/<x>.mjs` cites a path that does not exist even on this host. One negative recorded honestly: no phantom-script defect in the reverse direction — every infrastructure/docker/scripts/*.ps1 cited by docs does exist.
- Evidence: Where: package.json:21-23; scripts/{bootstrap,development,maintenance,verification}/; infrastructure/docker/scripts/ · Evidence: git ls-files scripts/ returns 2 files (repository-check.mjs, repository-policy.mjs); the four advertised category directories are empty on disk and untrackable by git, so a fresh clone has none of them. Meanwhile infrastructure/docker/scripts/ holds ~15 scripts (backup.ps1, build.ps1, preflight.ps1, start.ps1, stop.ps1, knowledge-t1..t5*.ps1, bootstrap-postgres.sh) referenced by README.md:428, :434, :570, :910 and docs/runbooks/knowledge-platform.md:20-29, :55 — and matched by no prettier pattern, no eslint target, and no REQUIRED_SCRIPTS/MAKE_TARGETS entry. · R7-C (mở rộng đo): the six drivers `knowledge-t1.ps1`, `knowledge-t2.ps1`, `knowledge-t2-windows.ps1`, `knowledge-t3.ps1`, `knowledge-t5.ps1` and `knowledge-t5-remote.ps1` are named by `tests/m3-*.test.mjs` only as text read from disk plus regex assertions, and a grep of `.github/`, `package.json`, `Makefile` and `docs/runbooks/` for those script names returns no hit at all — so no tracked lane executes any of them, which is what makes F-288 through F-293 unverifiable by any gate today. · R7-F (vị trí mới, gộp): `apps/knowledge/tests/fixture_acceptance.py:9-24` — consumer duy nhất là `infrastructure/docker/scripts/knowledge-t2.ps1:13,49,51`, và `git grep 'knowledge-t2'` trong `.github/`, `package.json`, `Makefile`, `scripts/` trả 0 hit (đo hai lần độc lập trong vòng R7-E và R7-F); `infrastructure/docker/compose/compose.m3-t3.acceptance.yml` và `compose.m3-t4.acceptance.yml` — byte-identical theo `tests/m12-t2.2-b15-compose-equivalence.test.mjs:24-30`, `!override` nhất quán với các driver (port khám phá qua `docker compose port nginx 8080` ở `knowledge-t3.ps1:107`), nhưng không lane nào chạy.
- Reproduction: Add a red test to `tests/repository-policy.test.mjs` - the existing suite that drives `scripts/repository-policy.mjs` - reusing its real-repo idiom (`the real npm test list matches the real tests directory` at `:748-761`, `the real format scripts quote every glob` at `:821-831`) and its `listTrackedFiles`/policy-check imports (`:16-28`), asserting that every script path cited in `README.md` and `docs/runbooks/knowledge-platform.md` matches at least one verify-stage surface (a prettier glob, an eslint target, or a `REQUIRED_SCRIPTS`/`MAKE_TARGETS` entry) and that no on-disk `scripts/` category directory is empty; run `node --test tests/repository-policy.test.mjs` and it fails today because all 15 files under `infrastructure/docker/scripts/` (including `backup.ps1` cited at `docs/runbooks/knowledge-platform.md:55`) match no gate surface and the four `scripts/` category dirs (`bootstrap`, `development`, `maintenance`, `verification`) are empty and untracked - `git ls-files scripts/` returns only `repository-check.mjs` and `repository-policy.mjs`.
- Acceptance criteria: every script a doc or runbook tells a human to run is covered by at least one verify stage, and no advertised scripts/ category is empty.
- Related findings: nguồn: E08 — repository tooling: `package.json` scripts… · R7-C delta audit C4: six further never-executed scripts merged here

### F-224 — the failure is injected by SQL source text, so any rewording of the tombstone statement silently moves the injected failure to a different call site while the same assertions still pass — the "not swallowed" guarantee can stop covering…

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R5-E10-07`
- Affected modules: Gates + CI
- Severity: Low
- Status: OPEN
- Root cause: the failure is injected by SQL source text, so any rewording of the tombstone statement silently moves the injected failure to a different call site while the same assertions still pass — the "not swallowed" guarantee can stop covering the intended statement with no red signal. (It is also the only test-side coverage of the R5-E05-02/03 tombstone, which is why those findings went unnoticed.) Leaked temp trees accumulate invisibly on constrained /tmp.
- Evidence: Where: tests/m11-t1-skill-vector-sql.test.mjs:160-176; tests/m7-t3-tools-contract.test.mjs:143-147 · Evidence: dbExecutor: async (sql) => { if (sql.includes("DELETE FROM skills.catalog_index")) return ""; throw new Error("PSQL_REJECTED_SIMULATION"); } for a test named "failure escalation — a failed failSql is surfaced, not swallowed"; and cleanup try { fs.rmSync(tempDir, …) } catch { void 0; }.
- Reproduction: Static — the fault is injected by matching SQL source text, not by targeting the tombstone call: `tests/m11-t1-skill-vector-sql.test.mjs:165-168` uses a `dbExecutor` that returns an empty string when `sql.includes("DELETE FROM skills.catalog_index")` and otherwise throws `PSQL_REJECTED_SIMULATION`, inside the test `M11-04: failure escalation — a failed failSql is surfaced, not swallowed` (`:153`), then asserts `report.status === "FAILED"` (`:170`), `report.failed_count === 1` (`:171`) and `report.error_code === "VECTOR_FAILURE_WRITE_FAILED"` (`:172`). The matched substring is the production tombstone at `zink-skill-store/src/vector-sync.mjs:626-631`, so rewording that statement makes the `includes()` miss it and the injected throw silently migrates to whichever statement runs first — the same three assertions still pass while the "not swallowed" guarantee stops covering the tombstone. Reproduce by rewording the `vector-sync.mjs` DELETE (rename the table or prepend a comment) and confirming `node --test tests/m11-t1-skill-vector-sql.test.mjs` stays green. The companion leak is `tests/m7-t3-tools-contract.test.mjs:142-146`, whose cleanup swallows removal failures so temp trees accumulate. Fix gates in `tests/m11-t1-skill-vector-sql.test.mjs`: inject the failure by statement role or call ordinal, or assert the exact SQL the failing executor received, rather than by a substring that can drift.
- Acceptance criteria: the `M11-04` executor in `tests/m11-t1-skill-vector-sql.test.mjs:153-180` binds the injected failure to the tombstone call by statement role or call ordinal, or asserts the exact SQL text the failing executor received, so rewording the DELETE at `zink-skill-store/src/vector-sync.mjs:626-634` turns the test red instead of silently moving `PSQL_REJECTED_SIMULATION` to a different statement while `:170-176` stay green - and the companion cleanup at `tests/m7-t3-tools-contract.test.mjs:141-147` no longer swallows `rmSync` failures.
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
- Evidence: Where: tests/m12-t2.2-b7-ceiling-single-read.test.mjs:52-56 (`assert.deepEqual(BUDGETS, { maxBriefRevisionsPerTask: 16, … })`) and :63 (`assert.equal(typeof workflow.applyWorkflowEvent, "function")`); tests/m12-t2.3-c9-semantic-report-version.test.mjs:74 (`assert.notEqual(SEMANTIC_CONTRACT_VERSION, "v1")`) · Evidence: :63 passes for any function-valued export; :74 fails only if the version literal is reset to `v1`; :52 mirrors ledger.mjs:39-43 (see F-228), so the ceiling is pinned twice and enforced zero times. · R7-C (vị trí mới, gộp vào đây vì trùng root cause với hàng đã ghi): `tests/m10-t2-r20-skill-catalog-and-sql.test.mjs:150-153`, `:160-164` — R20-05 builds `jsKey` and `sqlKey` as the same JS template literal, the SQL expression existing only in the comment at `:161`, and `:173-182` asserts a locally defined charset string does not contain the separator; `tests/m7-t4-orchestration.test.mjs:85-87` loops an eleven-entry literal provider list asserting `p.length > 0`. · R7-E (vị trí mới, gộp vì trùng root cause): `apps/knowledge/tests/test_model_probe.py:29-34,43-46` — ca embed so sánh timeout 90 giây của client thật với đúng hằng số mà chính test truyền vào `httpx.AsyncClient`, nên xóa dòng timeout trong `app/model_probe.py:30` vẫn xanh; `tests/m10-t2-r14-review-defects.test.mjs:116-138` — assert.deepEqual trên `AGENT_SPAWN_POLICY.main` là bản chép tay của hằng production, test không import guard nên không seam nào được đối chiếu; `tests/m12-t2.2-b8-reason-policy.test.mjs:32-37,81-88`; `tests/m8-t2.16-r19-promptbuild-liveness.test.mjs:189-191`.
- Reproduction: static — replace `applyWorkflowEvent`'s body with a throw and :63 still passes; set `SEMANTIC_CONTRACT_VERSION` to any string other than `v1` and :74 passes regardless of what the report emits.
- Acceptance criteria: each assertion is driven by a call whose result depends on the behaviour — invoke the reducer and assert the transition, assert the version string actually present in the report row.
- Related findings: F-102 (green contract test pins dead schema), F-224 (failure injected by SQL source text), F-228 · nguồn: R7 delta audit D6 — test fidelity · R7-C delta audit C5/C2: four more literal-only assertions merged here · R7-E delta audit E2/D3/D4: bốn vị trí literal-vs-literal gộp vào đây

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
- Evidence: Where: integrations/openclaw/topology/lib/guard.mjs:507 (`const memKey = Symbol.for("zink.governance.approvals");` — the only occurrence in `integrations/`), :558 (`path.join(paths.root, "approvals.json")`), :660 (`consumed-approvals.json`) · Evidence: a repo-wide grep for writers of those stores returns only tests/m11-t3-durable-state-integrity.test.mjs:507 and tests/m7-lane-c-queue.test.mjs:198, i.e. tests fabricate the file the guard reads. · R7-C (vị trí mới, gộp): the condition branch that depends on these stores is also the only branch of the published approval contract that has no producer — `integrations/openclaw/topology/contracts/approval-request.schema.json:82-112` is enforced at `topology/lib/guard.mjs:624` against `approvals.json` and `approvals/<id>.json` (`guard.mjs:558`, `:578`) which no repository code writes.
- Reproduction: static — any `requiresApproval:true` call resolved through the guard fails `AUTH_APPROVAL_REQUIRED`/`AUTH_APPROVAL_INVALID` for every `approvalId`, because no durable record can exist; a mutation probe that adds a writer must make the same call pass.
- Acceptance criteria: a durable minter produces one consumable record per surfaced approval card, and a test proves `AUTH_APPROVAL_REPLAYED` fires on the second consume.
- Related findings: F-242, F-030, F-032 · nguồn: R7 delta audit D8 · R7-C delta audit C6: contract branch with no producer merged here

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
- Evidence: Where: integrations/openclaw/topology/lib/schema.mjs:22-35 (`CANONICAL_CONTRACTS`) and :371-387 (`generateSchemaManifest` reading `x-zink-contract-version` then falling back to `"1.0.0"`) · Evidence: a grep for `validateContract("incident"|"result"|"governance-manifest")` across the repo returns 0 hits; `canonical.mjs:12` sets `SCHEMA_VERSION = "1.0.0"`, pinned as a const in both ledger contracts. · R7-C (vị trí mới, gộp): `integrations/openclaw/topology/contracts/governance-manifest.schema.json`, `incident.schema.json` and `result.schema.json` are the three canonical members with no PAYLOAD-VALIDATION call site — no `validateContract` or `validateContractSchema` names them. Measured correction 2026-10-18: `tests/m7-t5-remediation.test.mjs:286,:288,:291` do list all three by name and `:294` calls `loadContractSchema(contract)` on each (that lane ran green: 33 tests / 0 fail / 0 skipped), so the earlier absolute negative is withdrawn — the true statement is that the schema is loaded only to read the `governance_version` enum and no call validates a payload against it. Measured at HEAD the pinned constants still agree with the live producer, so these are drift-prone rather than wrong today: `max_spawn_depth` const 2 against `TOPOLOGY_POLICY.maxSpawnDepth` 2 (`lib/policy.mjs:546`, `:1115`), `runtime_version` const 2026.6.34 against `OPENCLAW_RELEASE` (`:53`), and `effective_tool_policy` `maxItems` 16 (`:44`) against the largest produced list of 4, and `spawn_target_allowlist` `maxItems` 4 (`:49`) against the largest produced list of 3 — not two bounds of 16 (`:1849-1861`, `:555-563`).
- Reproduction: static — edit `ledger-event.schema.json`: the next read re-governs all history under new bytes with the same reported version, failing closed as `EXECUTION_STATE_UNKNOWN` (ledger.mjs validates before the version check) and indistinguishable from corruption.
- Acceptance criteria: every canonical contract has a named validation call site or the owner declares the contract non-canonical and it leaves the pinned list together with the schema file; each topology contract carries its own version key; a deploy or boot gate calls `verifySchemaManifestChecksums`.
- Related findings: F-022, F-065, F-250 · nguồn: R7 delta audit D11B · R7-C delta audit C6: three never-loaded contracts merged here

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

### F-271 — the approval scope digest for `zink_power_bi bind` is derived from input keys its own closed contract forbids, so the approved datasource is not bound

- Category: F2 — Security & Authorization
- Legacy register id: `R7-C1-01`
- Affected modules: Zink Tools, OpenClaw governance plugin, governance records
- Severity: High
- Status: OPEN
- Root cause: the material-scope derivation reads two fields the published `bind` branch never declares, and every validated call has already passed the closed schema, so those fields are undefined by construction and the derived material set is always empty. The approval therefore binds the task, revision, tool, operation and model only: an owner who approved a bind against one datasource authorizes a bind against any datasource in the same model.
- Evidence: Where: `zink-tools/contracts/tools/zink-power-bi.schema.json:20-33` — the bind branch declares exactly operation, model, datasource and tables with `required: ["operation","model","datasource"]` and `additionalProperties: false` · Where: `integrations/openclaw/lib/policy.mjs:2077-2085` — for operation bind it copies `input.source_table` and `input.target_table`, neither of which exists in that branch · Where: `integrations/openclaw/topology/lib/guard.mjs:377-396` — `material_parameters: materialParameters` feeds `deriveApprovalScopeDigest` and then `assert(record.approval_scope_digest === expectedDigest, "AUTH_APPROVAL_INVALID")` · Where: `zink-tools/contracts/tool-call.schema.json:107` — the envelope's power-bi branch sets `input` to `$defs.input` of that same closed schema, and `guard.mjs:1571-1576` validates the call against it before the digest is derived, so the two keys cannot be present. Same mechanism on the sibling tool: `policy.mjs:2067-2076` reads `input.prompt` and `input.template` while `zink-excel.schema.json:44-53` declares only file_path and specification for the generate branch.
- Reproduction: static — `deriveApprovalMaterialParameters("zink_power_bi","bind",{operation:"bind",model:"M",datasource:"A"})` and the same call with datasource "B" both return an empty object, so `deriveApprovalScopeDigest` returns one digest for two different datasources. A red test mints an approval for one datasource and drives the guard with another, expecting AUTH_APPROVAL_INVALID; a second case asserts that every key `deriveApprovalMaterialParameters` reads for a tool-operation pair is declared in that tool's `$defs.input` branch.
- Acceptance criteria: two bind inputs differing only in datasource or tables produce different `approval_scope_digest` values, and a gate asserts that the material-parameter reader and the published input branch declare the same key set for every governed tool-operation pair. Widening the digest or deleting the assertion is not an acceptable fix.
- Related findings: F-126 (the writer ignoring the same contract's fields), F-113 · nguồn: R7-C delta audit C1 — zink-tools contract schemas

### F-272 — the result envelope is validated with a 64 KiB caller default while the reachable n8n path publishes budgets an order of magnitude larger, so a successful side-effected call is destroyed after the fact

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R7-C1-02`
- Affected modules: Zink Tools, Workflow topology + ledger, OpenClaw governance plugin
- Severity: High
- Status: OPEN
- Root cause: the envelope validator takes its byte budget from an optional parameter and the only production call site omits it, so the default applies; the n8n adapter's own response cap and the per-tool output contracts are written an order of magnitude larger. Two independently authored budgets therefore disagree, and the smaller one is enforced at the seam that runs after the work has already happened — the tool succeeded, its side effect is committed, and the governed caller reports a schema failure.
- Evidence: Where: `integrations/openclaw/topology/lib/schema.mjs:352-359` — `export function validateContractSchema(schemaName, value, maxBytes = 65536)` then `Buffer.byteLength(encoded,"utf8") > maxBytes` gives `invalid("Payload exceeds max bytes")` · Where: `integrations/openclaw/topology/lib/guard.mjs:1944-1949` — `validateContractSchema("tool-result", rawResult)` with no third argument, and the catch turns it into `fail("SCHEMA_VALIDATION_FAILED")` · Where: `zink-tools/contracts/tools/zink-python.schema.json:33-50` — stdout and stderr each allowed up to 1048576 characters, required and closed · Where: `zink-tools/contracts/tools/zink-n8n.schema.json` — the synced-tables list bounds each item at 128 characters and declares no maximum item count, and `schema.mjs:300-305` supplies the implicit ceiling `schema.maxItems ?? 1024`, which is roughly 131 KB of legal content · Where: `zink-tools/n8n/trigger.mjs:219-228` — the adapter itself admits up to 1048576 bytes before raising N8N_RESPONSE_TOO_LARGE · Where: reachability — `zink_n8n` is the only adapter-dispatched tool (`integrations/openclaw/lib/policy.mjs:1827-1833`) and reaches the seam through `invokeN8n` at `integrations/openclaw/topology/lib/guard.mjs:1899-1900`, with the envelope built at `zink-tools/n8n/trigger.mjs:307-317` and its sync branch bounding the table list only by element type (`:29-40`) · Where: `zink_python` dispatches to the contract seam (`policy.mjs:1827-1833`) and `contractOnlySeam` at `guard.mjs:486-492` returns the engine-not-implemented result built at `:424-437`, which carries no stdout and an empty artifact list, so the python half is a contract-layer contradiction with no reachable call site today.
- Reproduction: static — measured: an n8n sync envelope with about 900 table entries is legal under `zink-n8n.schema.json` (no item count is declared and the validator's implicit ceiling is 1024 at `integrations/openclaw/topology/lib/schema.mjs:300-305`) yet is rejected at `integrations/openclaw/topology/lib/guard.mjs:1946` with Payload exceeds max bytes, and the same payload passes when the caller passes an explicit larger budget; at a 2 MiB budget 1024 entries pass and 1025 fail on that implicit ceiling. The python case is contract-layer only, because the contract seam returns ENGINE_NOT_IMPLEMENTED before any stdout exists. A red test drives a contract-legal oversized payload through the real call site on the reachable path and asserts it passes. Deriving one budget from the contracts and deleting the validator's default argument are the only fixes.
- Acceptance criteria: every payload that satisfies a published per-tool `$defs.output` also satisfies the envelope validation at the budget the production call site uses, with the single budget expressed once; a test drives both tools at their contractual maximum.
- Related findings: F-128, F-125 · nguồn: R7-C delta audit C1 — zink-tools contract schemas

### F-273 — the envelope's artifact vocabulary has no producer anywhere in the repository, so results must ship an empty artifacts array

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R7-C1-03`
- Affected modules: Zink Tools, Workflow topology + ledger, OpenClaw governance plugin
- Severity: Medium
- Status: OPEN
- Root cause: the envelope pins an artifact to a three-key closed object, while every record the repository actually produces for an artifact carries a different key set — the ledger uses a content hash and the storage adapter uses its own identity and checksum fields. The shape the contract demands cannot be emitted by any existing producer. The size-ceiling half is weaker than it reads: the field name size_bytes is capped differently in two contracts, but they describe different classes, because governed-reference is the Knowledge reference record (its required list at `integrations/openclaw/topology/contracts/governed-reference.schema.json:8-23` names the reference id, the content digest and the classification) and no payload is ever validated against both ceilings, so a 20 MB artifact reference passes without contradiction.
- Evidence: Where: `zink-tools/contracts/tool-result.schema.json:11-32` — artifact_ref requires logical_path, type and size_bytes with `additionalProperties: false`, and size_bytes has `maximum: 1073741824` · Where: `integrations/openclaw/plugins/zink-governance/index.mjs:2306` — the repository's only artifact record, the ledger artifact-set entry `{ logical_path: logicalPath, sha256 }`, consumed for the set digest at `integrations/openclaw/topology/lib/workflow.mjs:1187-1198` · Where: `zink-tools/adapters/storage/r2-adapter.mjs:79-90` — the storage record is artifact_id, checksum, size_bytes, content_type with no logical_path, and that adapter sits in the layer F-105 records as having no production importer · Where: `integrations/openclaw/topology/contracts/governed-reference.schema.json:48` — a size_bytes ceiling of 16777216 on a different class, the Knowledge reference record, not the envelope artifact · Where: `integrations/openclaw/topology/lib/guard.mjs:1950-1959` — the guard iterates `rawResult.artifacts` and path-validates each `logical_path`, the only consumer of the field.
- Reproduction: static — validating the repo's real ledger record shape through `validateContractSchema("tool-result", …)` fails on the missing type key and the unexpected sha256 key, while the contract's own triple validates. A red test asserts that an artifact record produced by the plugin or the storage adapter validates against the envelope.
- Acceptance criteria: one canonical artifact-reference definition is the shape at least one production path actually emits, and that path's envelope passes validation with a non-empty artifact list. Deleting the artifacts member is not an acceptable fix.
- Related findings: F-051, F-242, F-148 · nguồn: R7-C delta audit C1 — zink-tools contract schemas

### F-274 — the call and result envelopes admit only five of the eight contract-registered tools, and their specialist rules disagree with each other

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R7-C1-04`
- Affected modules: Zink Tools, Zink Knowledgebase, Zink Skill Store, OpenClaw governance plugin
- Severity: Medium
- Status: LATENT
- Root cause: the envelope discriminator lists were written per execution tool and never extended when Knowledge and Skill became contract-backed tools, while the loader and the canonical-contract set treat all eight as one family. A governed call for the other three cannot be expressed at all. The two halves also disagree internally: the call side allows several specialists for every tool, while the result side pins a single specialist constant in most branches. As published contracts the two halves disagree, but at the guard seam that is unreachable: `integrations/openclaw/topology/lib/guard.mjs:1581-1583` binds the validated call's specialist to the caller's own agent id, and `TOOL_POLICY` at `integrations/openclaw/lib/policy.mjs:1835-1843` grants each tool only to the agent whose name is its pinned specialist, so every tool the guard can dispatch today has a matching result branch.
- Evidence: Where: `zink-tools/contracts/tool-call.schema.json:73,89,106,123,140` — exactly five tool_id consts (sql, excel, power_bi, python, n8n) · Where: `zink-tools/contracts/tool-result.schema.json:99-360` — the same five branches, with the four n8n result branches at `:313`, `:326`, `:339` and `:352` each widened to a two-specialist enum instead of a constant · Where: `integrations/openclaw/plugins/zink-governance/index.mjs:3151-3160` — the loader map registers eight tools including zink_skill_search, zink_knowledge_search and zink_skill_propose · Where: `integrations/openclaw/topology/lib/guard.mjs:1571-1576` — the envelope check that a knowledge or skill call would have to pass. Measured this round: no plugin or adapter path currently dispatches those three through the guard envelope seam, so the defect is reachable only for a call routed there; recorded as LATENT rather than OPEN on that measurement.
- Reproduction: static — `validateContractSchema("tool-call", …)` with tool_id zink_knowledge_search fails to match any branch; a red test asserts that every tool id the loader registers has a matching branch in both envelopes, and that each call branch's specialist set equals its result branch's specialist set.
- Acceptance criteria: the two envelopes cover every registered tool with matching specialist vocabularies, or the register records the owner's decision that Knowledge and Skill calls are formally outside the envelope contract and the loader stops treating them as members of the same family.
- Related findings: F-125, F-271, F-128 · nguồn: R7-C delta audit C1 — zink-tools contract schemas

### F-275 — the four schema-only capability contracts declare an open parameters object that contradicts their own directory rule, and no gate validates a payload against them

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-C1-05`
- Affected modules: Zink Tools, Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: the only loader is keyed by a map that omits these four capabilities, and the gates that do touch them check presence, identifier uniqueness and non-callability rather than payload validation, so nothing in the repository ever validates a payload against them. Because no payload is ever checked, these files carry two contradictions no machine check notices: an open parameters object that the same directory's published rule forbids, and a required list thin enough that an empty model is a conforming specification.
- Evidence: Where: `integrations/openclaw/plugins/zink-governance/index.mjs:3304-3309` — `SCHEMA_ONLY_CAPABILITIES` frozen to the four ids, consulted only by `isExecutableTool` at `:3311-3313`, whose result is published as the executable flag of every advertised tool at `:4192` · Where: `index.mjs:3151-3160` — the loader map contains none of them · Where: `zink-tools/contracts/tools/zink-operations-research.schema.json:41-46` — parameters is `{"type":"object","additionalProperties": true}` and required is only model_type, so a network-flow model with no nodes and no edges validates · Where: `zink-tools/contracts/README.md:12` — the directory's own invariant states that every object sets additionalProperties false · Where: `tests/m7-t3-tools-contract.test.mjs:350-375` — the gate body asserts file presence plus `$id` presence and uniqueness; no `validateContractSchema` call names any of the four · Where: the same four are asserted non-callable at `tests/m7-t3-tools-contract.test.mjs:191-208`, `tests/m7-t5-remediation.test.mjs:806-817` and `tests/m7-lane-b-ingress.test.mjs:318-327`, and each is registered with its schema file in the capability registry at `integrations/openclaw/lib/policy.mjs:1777-1814`. · R7-E (vị trí mới, gộp): hàng này đặt tên theo bốn schema-only capability nhưng Evidence chỉ điểm một; ba file còn lại đo ở HEAD — `zink-tools/contracts/tools/zink-forecast.schema.json:31-34` lặp đúng nửa `parameters` mở (`additionalProperties: true`) và `required` ở `:36` bỏ luôn field đó; `zink-simulation.schema.json:38` chỉ required `[simulation_type, iterations]`, còn `parameters` của nó ở `:27` là `additionalProperties: {"type":"number"}` — vẫn trái README:12 vì quy tắc ghi `false`, nhưng hẹp hơn forecast; `zink-optimization.schema.json:22-47` không có `parameters` mà hỏng ở nửa kia của hàng: `variables`/`constraints` không `minItems` nên `{problem_class, objective, variables: [], constraints: []}` là payload hợp lệ theo `required` ở `:49`. Registry nhất quán (`lib/policy.mjs:1777-1812`, `index.mjs:3304-3309`) và loader vẫn bỏ cả bốn.
- Reproduction: static — the four files cannot silently disappear: each is presence-pinned by an existsSync assertion at `tests/m7-t3-tools-contract.test.mjs:368` and digest-pinned through `generateSchemaManifest` at `integrations/openclaw/topology/lib/schema.mjs:387-395`, which throws SCHEMA_MANIFEST_INCOMPLETE for a canonical tool contract with no resolvable schema file and is exercised by `tests/m12-t2.2-b9-manifest-completeness.test.mjs:34` and `tests/m7-lane-h5-persistence-deps.test.mjs:158`. What no lane does is validate a payload against them. Turning the README's closed-object rule into a machine check reddens the tree well beyond these four files, because five other contracts carry the same open objects (three in zink-excel, three in zink-skill, two in zink-power-bi, one each in zink-n8n and zink-knowledge). A red test validates one passing and one failing fixture per capability through the contract validator, and asserts the closed-object rule across every file in the directory.
- Acceptance criteria: each schema-only capability has at least one validated positive and one rejected negative fixture in an enforced lane, and the closed-object rule in the directory README is checked mechanically against every tracked contract file. Removing the four contracts is acceptable only as an owner decision recorded with the capability registry that names them.
- Related findings: F-252, F-128, F-138 · nguồn: R7-C delta audit C1 — zink-tools contract schemas · R7-E delta audit E5: ba schema-only contract còn lại gộp vào đây, kèm đo đạc phân loại lại hai nửa defect theo từng file

### F-276 — the BigQuery read-only guard is a private seven-keyword regex instead of the shared SQL validator, so it admits statements the canonical gate refuses and rejects reads that contain none

- Category: F2 — Security & Authorization
- Legacy register id: `R7-C2-01`
- Affected modules: Zink Tools
- Severity: Medium
- Status: LATENT
- Root cause: the adapter re-implements the mutation check as an uppercased word-boundary regex, with no case-insensitivity flag, over the whole query string, instead of calling the repository's validator, which is a tokeniser with a larger keyword set that ignores string literals. The private list is both weaker and noisier: four mutating or privilege keywords from the canonical set are absent, and a read whose literal text merely mentions a blocked word is refused. Recorded as LATENT because the whole adapter layer is unreachable from governed dispatch, which F-105 already records, and because the header at `:14-21` marks the class SIMULATION_CONTRACT (canned rows, no provider connection), which is the second reason Medium is the right grade; `zink-tools/adapters/index.mjs` is imported only by `tests/m7-t4-orchestration.test.mjs:25`.
- Evidence: Where: `zink-tools/adapters/analytics/bigquery-adapter.mjs:61-67` — `const upper = input.query.toUpperCase(); if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/.test(upper))` throws BIGQUERY_MUTATION_NOT_PERMITTED · Where: `zink-tools/sql/validator.mjs:1-13` — MUTATION_KEYWORDS is an eleven-entry set adding MERGE, REPLACE, GRANT and REVOKE, and `:76` carries the comment that the check runs on tokens outside string literals · Where: the two gates diverge in both directions, measured: GRANT, REVOKE and REPLACE statements are accepted by the adapter and refused by the validator, while a projection aliased with a name containing the word keep is refused by the validator as SQL_UNSUPPORTED_SYNTAX and accepted by the adapter · Where: `zink-tools/adapters/analytics/motherduck-adapter.mjs:62-63` — the sibling does call `validateSqlQuery`, proving the intended shape · Where: `bigquery-adapter.mjs:1` — the adapter imports only the caller-authorization helper from the shared bridge.
- Reproduction: static — GRANT ALL ON t TO u passes the private regex and is returned as a frozen success envelope, while the shared validator throws; a read containing a string literal equal to DELETE is refused by the regex and accepted by the validator. A red test drives a table of statements through both paths and asserts identical verdicts.
- Acceptance criteria: the adapter delegates its statement gate to the shared validator, and a parameterized matrix over the eleven canonical keywords plus a literal-mention read yields the same verdict from the adapter as from the validator.
- Related findings: F-105 (this layer has no production importer), F-138, F-144 · nguồn: R7-C delta audit C2 — provider adapters

### F-277 — the DagsHub adapter ignores its configured repository, accepts a wildcard selection, and enforces only the comment that forbids it

- Category: F2 — Security & Authorization
- Legacy register id: `R7-C2-02`
- Affected modules: Zink Tools, governance records
- Severity: Medium
- Status: LATENT
- Root cause: the constructor stores an owner, a repository name and a token that no method reads; the sync destination comes entirely from caller parameters, and the guard standing in for "explicitly selected runs" is an array-and-non-empty test, which a wildcard entry satisfies. The file's own documented prohibition on blind or wildcard syncing is therefore unenforced, and the caller-supplied destination means a configured DagsHub credential can be pointed at any repository.
- Evidence: Where: `zink-tools/adapters/mlops/dagshub-adapter.mjs:22-26` — repoOwner, repoName and token assigned to the instance · Where: `:39-54` — syncSelectedRuns takes repo_owner and repo_name from params and rejects only a non-array or empty selection · Where: `:63-70` — the result echoes the caller's repository and the caller's selection with status SYNC_COMPLETED · Where: `:30` — the comment "Blind or automatic wildcard syncing is strictly forbidden." · Where: `integrations/openclaw/orchestration/patterns/index.mjs:338-341` — the caller hardcodes one owner and checks only the first selected run against MLflow.
- Reproduction: static — a call with repo_owner and repo_name pointing at another repository and a selection of a single wildcard entry returns SYNC_COMPLETED for that repository and echoes the wildcard as the synced set. A red test asserts a wildcard or unresolvable run id is refused, and that the destination cannot differ from the configured owner and repository.
- Acceptance criteria: syncSelectedRuns rejects a wildcard entry and any identifier it cannot resolve in the tracking store, and refuses a destination that differs from the configured repository; the configured credential is either actually used or removed from the constructor.
- Related findings: F-105, F-052, F-171 · nguồn: R7-C delta audit C2 — provider adapters

### F-278 — the MLflow adapter returns shallow-frozen aliases of its live store, so a consumer can rewrite artifact lists and metric history it was told is immutable

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R7-C2-03`
- Affected modules: Zink Tools
- Severity: Medium
- Status: LATENT
- Root cause: three methods wrap their return value in a shallow freeze over the stored record, which leaves the nested artifact array, the metric arrays and the parameter and tag objects as the same objects the adapter keeps in its map. One method deep-copies with a serialise-and-parse round trip, which shows the intended semantics and makes the other three the defect. A caller that mutates what it received silently corrupts the tracking store for every later reader.
- Evidence: Where: `zink-tools/adapters/mlops/mlflow-adapter.mjs:57` — createRun returns `Object.freeze({ ...runRecord })` while the record's artifacts, params, tags and metrics objects are still the stored ones · Where: `:90` — logMetrics returns `Object.freeze({ run_id: runId, metrics: { ...run.metrics } })`, whose per-key arrays are shared · Where: `:127` — endRun returns `Object.freeze({ ...run })` · Where: `:141` — getRun returns `Object.freeze(JSON.parse(JSON.stringify(run)))`, the deep copy the others lack · Where: `:86-89` — the store appends into those same arrays · Where: `:111` — logArtifact freezes the stored record itself, but that record carries only scalar fields, so it is outside this defect class and is not in the acceptance list.
- Reproduction: static — pushing a forged entry into the artifact array of a createRun result, then reading the run back through getRun, returns the forged entry; popping a metric history array empties the stored history. A red test mutates each returned shape and asserts the store is unchanged.
- Acceptance criteria: every method returning run state listed above yields a deep-immutable copy, and a test asserts that mutation attempts on the createRun, logMetrics and endRun results leave the subsequent getRun read byte-identical.
- Related findings: F-105, F-255 · nguồn: R7-C delta audit C2 — provider adapters

### F-279 — the simulation adapters emit no fidelity field, so canned provider results are structurally identical to real ones even though the shared bridge requires consumers to refuse them

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R7-C2-04`
- Affected modules: Zink Tools, OpenClaw governance plugin
- Severity: Medium
- Status: LATENT
- Root cause: the simulation contract is published only as a comment on each adapter class, while the result objects carry provider-shaped business fields with no fidelity marker; two of the five stamp a provider lifecycle status and state, but those values describe the fabricated job's own lifecycle, not whether a real provider ran. The shared DuckDB bridge in the same module does stamp a fidelity marker and its own comment states that a governed consumer must see it and refuse to treat the data as live — so the repository already knows the rule these five envelopes break. Nothing prevents a future governed route from presenting fabricated billing bytes, checksums or run identifiers as executed provider work.
- Evidence: Where: `zink-tools/adapters/analytics/bigquery-adapter.mjs:14-21` — the SIMULATION_CONTRACT block: "A governed path must treat its output as simulation and must never present it as provider execution." · Where: `:89-98` — the returned keys are provider, project_id, dataset, row_count, columns, rows, total_bytes_billed, execution_ms with `total_bytes_billed: 10485760, // 10 MB billed` and no state field · Where: `zink-tools/sql/duckdb-bridge.mjs:240-251` — the sibling comment requiring `FIXTURE_CONTRACT_EXECUTED` for a governed consumer · Where: `motherduck-adapter.mjs:94-101` — the same key shape with no state field · Where: `compute/databricks-adapter.mjs:74-75` and `compute/kaggle-adapter.mjs:74-75` — these two do stamp a success state alongside a terminated or completed status, but both values describe the simulated job's own lifecycle and carry no real-versus-simulated information · Where: `mlops/huggingface-adapter.mjs:81` — the only state-like key is the non-promotion candidate marker, which says nothing about execution fidelity. · R7-E (vị trí mới, gộp): `zink-tools/adapters/app/streamlit-adapter.mjs:52-62` là phong bì thứ sáu mà danh sách năm của hàng này bỏ sót — không field fidelity, comment ở `:10-16` là tín hiệu duy nhất, trả `endpoint: http://${this.host}:${this.port}/views/...` (`:57`) với `status: "READY"` shaped như một deployment thật, và `row_count: Number(row_count) || 0` (`:59`) echo luôn count của caller ("abc" thành 0, số âm đi qua).
- Reproduction: static — no envelope carries a key that distinguishes simulated output from real provider output, and a grep for the bridge's marker word in the adapter results returns nothing while the bridge path emits it. A red test asserts every adapter result carries an explicit fidelity field and that a governed consumer helper refuses the fixture value.
- Acceptance criteria: each adapter result carries an explicit execution-state field, and the governed consumer path that needs business data rejects every value other than a real execution marker; the comment remains as documentation, not as the only signal.
- Related findings: F-145, F-187, F-105 · nguồn: R7-C delta audit C2 — provider adapters · R7-E delta audit E5: streamlit merged here as the sixth envelope

### F-280 — the analytics adapters echo a target database of their own invention and never call the shared resource allowlist that the bridge enforces

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R7-C2-05`
- Affected modules: Zink Tools, OpenClaw governance plugin
- Severity: Medium
- Status: LATENT
- Root cause: both adapters import only the caller-authorization helper, so the resource-authorization helper the shared bridge calls is never consulted; and each one's fallback value for the target database is a name that the published contract does not even enumerate. A caller therefore gets back a resource identifier that no governed contract admits, presented as an authorised result.
- Evidence: Where: `zink-tools/adapters/analytics/bigquery-adapter.mjs:1` — the import line names only `assertDuckDbCallerAuthorized` · Where: `motherduck-adapter.mjs:1-2` — the same single helper import plus the validator · Where: `bigquery-adapter.mjs:92` — `dataset: input.target_database || "cloud_analytics_lake"` · Where: `motherduck-adapter.mjs:96` — `target_database: input.target_database || "gold"` · Where: `zink-tools/contracts/tools/zink-sql.schema.json:65-68` — the parameter is an enum of knowledge and analytics_read, so neither fallback is legal · Where: `zink-tools/sql/duckdb-bridge.mjs:81-94` and `:184` — the resource allowlist helper that the adapters do not use.
- Reproduction: static — a call with target_database set to gold returns gold in the envelope with no rejection; the same value fails the contract enum. A red table test drives each adapter with an out-of-enum resource and asserts the same refusal code the bridge raises.
- Acceptance criteria: both adapters reject a target database outside the contract enum with the shared resource-authorization code, and no adapter's own fallback value appears in a result that does not satisfy the published enum.
- Related findings: F-144, F-105, F-276 · nguồn: R7-C delta audit C2 — provider adapters

### F-281 — declared ceilings bind nothing in the analytics adapters: an exported timeout constant has no reader, and the row bound omits the sibling's lower clamp so a negative request reports a successful zero-row result

- Category: F6 — Reliability & Performance
- Legacy register id: `R7-C2-06`
- Affected modules: Zink Tools
- Severity: Low
- Status: LATENT
- Root cause: the adapters export ceiling constants that no code path consults, take the caller's own timeout option at face value, and clamp the row count only from above. Without the floor the shared bridge applies, a negative request value turns the row slice into an empty result that is still returned as a success envelope.
- Evidence: Where: `zink-tools/adapters/analytics/motherduck-adapter.mjs:13` — `export const MOTHERDUCK_MAX_TIMEOUT_MS = 60000;` and a repo-wide grep finds no other occurrence outside its own declaration · Where: `bigquery-adapter.mjs:69-74` and `motherduck-adapter.mjs:74-79` — the timeout appears only inside a simulateTimeout error string built from the caller's option · Where: `bigquery-adapter.mjs:77` — `const maxRows = Math.min(Number(input.max_rows) || 100, BIGQUERY_MAX_ROWS);` · Where: `motherduck-adapter.mjs:82-85` — the same shape · Where: `zink-tools/sql/duckdb-bridge.mjs:202-205` — the sibling clamps with `Math.max(Number(input.max_rows) || …, 1)` before the ceiling · Where: `bigquery-adapter.mjs:85-93` — rows are sliced with that value and `row_count: rows.length` is reported without any error.
- Reproduction: static — a request with max_rows of negative three computes a negative bound, slices the canned rows away and returns a success envelope with `row_count: 0`; the same input in the bridge clamps to one row. A red test asserts the clamp for negative and oversized values; zero is not among the defect inputs because the fallback-to-default conversion turns it into the 100-row default.
- Acceptance criteria: every declared ceiling constant is consulted by a real bounding site, and a non-positive row limit is either clamped to the sibling's floor or rejected with its own error code — never returned as a successful empty result.
- Related findings: F-184, F-105, F-280 · nguồn: R7-C delta audit C2 — provider adapters

### F-282 — the PDF extraction path reports success without reading the conversion result's status or proving that every requested page contributed content

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R7-C3-01`
- Affected modules: Zink Knowledgebase
- Severity: High
- Status: OPEN
- Root cause: the child asks the converter for a page range and materialises whatever items come back, never consulting the result's status or per-page error fields; its OCR stage explicitly yields pages that have no valid backend without recording anything; and the parent validates only each item's shape, ordering and containment inside the requested window, then fails the build solely when the total segment count is zero. A page that produced nothing therefore disappears from the index while the build is marked complete, and only a whole-document-empty case is detectable.
- Evidence: Where: `apps/knowledge/pdf-runtime/src/zink_pdf_runtime/runner.py:233-237` — `result = converter.convert(source, page_range=(start, end))` then `return _materialize_document_items(result.document, start, end)`, with no inspection of the conversion outcome; a repo-wide grep for the status field of that result returns no reader in the child · Where: `apps/knowledge/pdf-runtime/src/zink_pdf_runtime/docling_ocr.py:59-62` — for each page, if the backend is missing or invalid the page is yielded and the loop continues with zero cells · Where: `apps/knowledge/app/pdf_runtime.py:527-555` — the parent validator checks the key set, ordinal ordering, kind, non-empty content and `requested_start <= page_start <= page_end <= requested_end`, and nothing about coverage of the requested range · Where: `apps/knowledge/app/pdf_pipeline.py:190-195` and `:216-219` — segments are completed per batch and the build fails only `if segment_count == 0`.
- Reproduction: static — a batch requesting pages 5 to 8 where page 7 has an invalid backend returns items for 5, 6 and 8, completes the batch, and the build finishes READY with page 7 unindexed. A red test drives the extraction with one requested page producing no items and asserts either an error outcome or an explicit uncovered-page report; a second assertion requires the response to carry the set of pages actually covered.
- Acceptance criteria: the child fails closed unless the conversion outcome is fully successful, the response names the pages it covered, and the parent rejects a batch that omits any requested page that was not proven blank. Removing the parent's non-empty-content check is not an acceptable fix.
- Related findings: F-055 (the sibling path-check topology), F-257, F-017 · nguồn: R7-C delta audit C3 — pdf-runtime and Knowledgebase modules

### F-283 — the child rewrites every OCR timeout and output-cap breach into a generic runtime failure, so the parent's timeout handling is unreachable for the case it was written for

- Category: F1 — Logic & Functional Bugs
- Legacy register id: `R7-C3-02`
- Affected modules: Zink Knowledgebase
- Severity: Medium
- Status: OPEN
- Root cause: the runner's safe-code whitelist omits the two codes the OCR module raises, and its catch-all converts any exception into the generic failure code before the response leaves the process. The parent whitelist still admits both codes and remaps one of them to a build-level timeout reason, but that branch can never fire for work done inside the child, so a slow region and a genuine crash are indistinguishable in durable state.
- Evidence: Where: `apps/knowledge/pdf-runtime/src/zink_pdf_runtime/ocr.py:85-86` and `:90-91` — the cap raises the output-limit code and a subprocess timeout raises the timeout code · Where: `apps/knowledge/pdf-runtime/src/zink_pdf_runtime/runner.py:17-28` — the safe-code set lists ten codes (entries at `:18-27`) and contains neither of those two · Where: `:126-127` — `except Exception: return _error("PDF_RUNTIME_FAILED")` · Where: `apps/knowledge/app/pdf_runtime.py:33-40` — the parent whitelist does admit both codes · Where: `apps/knowledge/app/pdf_pipeline.py:196-198` — `code = timeout_code if error.code == "PDF_RUNTIME_TIMEOUT" else error.code`, the branch that the child cannot reach.
- Reproduction: static — driving the child's dispatch with a stubbed OCR stage that raises the timeout code yields a response carrying the generic failure code. A red test asserts the timeout code survives the child boundary and that the parent's remap executes against the real child, not a mock runtime; the existing parent suite injects the code from a mock and stays green for a path the child cannot produce.
- Acceptance criteria: the two codes are in the child's whitelist, the extraction arm propagates them instead of collapsing them, and one test proves an in-child timeout reaches the pipeline as the timeout classification.
- Related findings: F-237, F-269, F-282 · nguồn: R7-C delta audit C3 — pdf-runtime and Knowledgebase modules

### F-284 — the child's worst-case OCR budget is twelve times the parent's operation ceiling and the request schema carries no deadline, so the only real bound is a process-group kill

- Category: F6 — Reliability & Performance
- Legacy register id: `R7-C3-03`
- Affected modules: Zink Knowledgebase, deployment topology
- Severity: Medium
- Status: OPEN
- Root cause: each recognised region gets its own fresh deadline of ninety seconds, up to thirty-two regions pass the per-page guard, four pages make a batch, and the request's key set is closed with no deadline field, so the child cannot compose the parent's operation ceiling even if it wanted to. The legal child workload therefore exceeds the parent timeout by an order of magnitude, and the parent's containment is to kill the process group — turning slow-but-progressing extraction into a failed batch whose terminal code is a timeout classification, which says nothing about how far the extraction actually got.
- Evidence: Where: `apps/knowledge/pdf-runtime/src/zink_pdf_runtime/ocr.py:18` — the per-region constant of 90 seconds · Where: `apps/knowledge/pdf-runtime/src/zink_pdf_runtime/docling_ocr.py:64-65` and `:75` — more than thirty-two rects raises, and each region is given `deadline=time.monotonic() + 90` · Where: `apps/knowledge/app/pdf_pipeline.py:39-40` — four pages per batch and an operation ceiling of 15 minutes · Where: `apps/knowledge/pdf-runtime/src/zink_pdf_runtime/runner.py:93-101` — the request key set is exactly protocol_version, operation, source_path, page_start, page_end and the expected identity digest · Where: `apps/knowledge/pdf-runtime/src/zink_pdf_runtime/ocr.py:4-5` — the module docstring itself says the parent process-group contract remains the final containment layer · Where: `apps/knowledge/app/pdf_runtime.py:320-322` — on deadline expiry the parent terminates the child group and reports the runtime timeout code · Where: `apps/knowledge/app/pdf_pipeline.py:303-307` — the helper chooses the classification, runtime when the 900-second local ceiling binds and build when the cumulative deadline binds, and `:197` remaps the runtime timeout to it.
- Reproduction: static — measured: the arithmetic maximum for one legal batch is four pages times thirty-two regions times ninety seconds = 11520 seconds against the 900-second operation ceiling, about twelve times over, which is where the headline factor comes from; the smaller witness is twelve regions at eighty seconds each on one page, 960 seconds, which already crosses it. The parent then kills the process group and the batch fails with a timeout classification that does not distinguish slow from stuck. A red test asserts the child refuses or degrades a batch whose worst-case region arithmetic exceeds a deadline carried by the request.
- Acceptance criteria: either the request carries the parent's deadline and the child enforces it across the whole extraction, or the worst-case region-count times per-region budget is proven not to exceed the operation ceiling and a test pins that composition.
- Related findings: F-283, F-184, F-197 · nguồn: R7-C delta audit C3 — pdf-runtime and Knowledgebase modules

### F-285 — the child's only OCR runner test replaces the subprocess and the output reader, so the deadline, the output cap and the child reaping are asserted by nothing

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-C3-04`
- Affected modules: Zink Knowledgebase, Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: the suite patches the process constructor and the streaming reader wholesale and then asserts only the argument vector tail. Every statement that makes the module's bounded-execution contract real — the deadline comparison, the byte cap, the terminate-and-reap path, the return-code check and the decode guard — is inside the patched region or after it, so the suite would pass with those bodies deleted. This is a different defect from the lane never running: the suite stays vacuous even once it is executed.
- Evidence: Where: `apps/knowledge/pdf-runtime/tests/test_ocr_contract.py:31-42` — two patch calls supply a mock process and `return_value=b"tsv"` for the reader, then the assertions are the language constant and `command[3:]` · Where: `apps/knowledge/pdf-runtime/src/zink_pdf_runtime/ocr.py:50-61` — the return-code check, the deadline argument and the decode guard · Where: `:80-95` — the selector loop with the byte cap and the timeout reaping · Where: `:96-106` — the terminate-and-reap helper. A grep finds no other test naming the runner function.
- Reproduction: static mutation probe — replace the output-cap raise with a no-op, or delete the reaping call, and the suite stays green. A red test runs the module against a fake executable that overruns the deadline and exceeds the cap, asserting the typed error codes and that the child was reaped.
- Acceptance criteria: at least one executed test drives the real reader and process lifecycle against a fixture executable for both the timeout and the output-cap path, and each of those mutations turns the suite red.
- Related findings: F-237, F-269, F-240, F-218 · nguồn: R7-C delta audit C3 — pdf-runtime and Knowledgebase modules

### F-286 — the processing-identity probe is an echo: the child returns the value it was sent and two parent sites compare it back

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R7-C3-05`
- Affected modules: Zink Knowledgebase
- Severity: Low
- Status: OPEN
- Root cause: the child's probe response sets the identity digest field to the request's own expected value, and the parent then rejects the run when that field differs from the same value. The comparison cannot fail. The child does recompute four independent pieces of evidence and the parent checks those for real, so the protection exists — but two call sites read as identity verification while contributing nothing, which is how a future fixer comes to trust a guard that is not there.
- Evidence: Where: `apps/knowledge/pdf-runtime/src/zink_pdf_runtime/runner.py:70-89` — the recomputed identity is stored in a local and only its other fields are returned, while the response carries the echoed request value, with the comment at `:81-83` acknowledging the echo · Where: `apps/knowledge/app/pdf_runtime.py:499-500` — `if response.get("processing_identity_digest") != request.get("expected_processing_identity_digest"): raise PdfRuntimeError("PDF_RUNTIME_MISMATCH")` · Where: `apps/knowledge/app/pdf_runtime.py:120-130` — the same comparison inside the manifest verification, alongside the four checks that do measure · Where: `apps/knowledge/tests/test_pdf_runtime.py:343` — the suite that names this "recomputes and compares" builds the probe dictionary by hand.
- Reproduction: static — no child state can make either comparison fire on a well-formed value. A red test asserts that deleting each of the four recomputed comparisons turns the suite red, and either removes the echo-and-compare or renames the field so no code or document presents it as verification.
- Acceptance criteria: no comparison in the boundary is structurally incapable of failing — the identity claim is either dropped or backed by child-side state, and the surviving enforcement is the recomputed evidence with a mutation probe proving it.
- Related findings: F-219, F-252, F-282 · nguồn: R7-C delta audit C3 — pdf-runtime and Knowledgebase modules

### F-287 — the segment builder drops runtime items whose content normalises to empty with no counter, unlike its own fail-closed sibling for a wholly empty result

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R7-C3-06`
- Affected modules: Zink Knowledgebase
- Severity: Low
- Status: HYPOTHESIS
- Root cause: after the boundary has guaranteed non-empty content, the parent normalises each item and continues past any that normalise away, without recording the drop and without comparing accepted items against emitted segments. The mechanism is confirmed in code; the corpus impact is not, because no measured document yet shows a page whose only items normalise to empty, so this is filed as a hypothesis rather than an observed loss.
- Evidence: Where: `apps/knowledge/app/pdf_pipeline.py:336-338` — `content = _normalize_content(item["content"])` then `if not content: continue` · Where: `apps/knowledge/app/pdf_runtime.py:539-540` — the guarantee the item was checked against is only truthiness of the raw string · Where: `apps/knowledge/app/pdf_pipeline.py:216-218` — the only aggregate check is the zero-segment case with its dedicated failure code.
- Reproduction: unconfirmed for the corpus, measured for the mechanism — running the tracked boundary and normaliser on items whose content is three spaces, a newline plus tab, and a non-breaking space: all three are accepted by `_validate_items` (`apps/knowledge/app/pdf_runtime.py:539-540`) and all three normalise to empty (`_normalize_content` at `apps/knowledge/app/pdf_pipeline.py:557-558` strips), so the `:338` skip fires. Before fixing, measure: run the real corpus through the segmenter and count items in versus segments out, and only file this as OPEN if the count differs on a document that has visible content on the page.
- Acceptance criteria: either a dropped item raises the invalid-output code or the build records the dropped-item count and a test asserts the count is zero for a corpus page known to contain text. Deleting the skip is acceptable only with the fail-closed branch in place.
- Related findings: F-282, F-017 · nguồn: R7-C delta audit C3 — pdf-runtime and Knowledgebase modules

### F-288 — the acceptance overlay proves egress isolation on a topology the deployed stack does not implement, so its boundary evidence transfers to nothing that ships

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R7-C4-01`
- Affected modules: deployment topology, Zink Knowledgebase, governance records
- Severity: Medium
- Status: OPEN
- Root cause: the overlay rewrites the model-service URL to an allowlisted proxy route and resets the host-gateway mapping, but that route exists only in an acceptance-only nginx configuration, and the deployed composition keeps direct host-gateway egress. The isolation assertions in the acceptance driver therefore prove an egress posture no deployed stack has, while the privilege half of the overlay is genuinely shipped by the live overlay too, so only the egress divergence is real; two different contract suites each pin one side as correct and neither compares them.
- Evidence: Where: `infrastructure/docker/compose/compose.m3-t5.acceptance.yml:26-32` — `KNOWLEDGE_OLLAMA_URL: http://nginx:8080/ollama`, `extra_hosts: !reset []` · Where: `infrastructure/docker/compose/compose.m4-t5.live.yml:10-17` — the live overlay ships the same privilege block (read-only root, dropped capabilities, no-new-privileges, pids limit 256), merged by the live driver at `infrastructure/docker/scripts/knowledge-t5-live.ps1:38`, so the divergence is the egress half only: no shipped file resets the extra-host mapping, none rewrites the model-service URL to the gateway proxy, and `compose.core.yml:208-210` keeps the platform network a plain bridge · Where: `infrastructure/docker/compose/compose.core.yml:152` and `:156-157` — the deployed value is the direct host endpoint with the host-gateway mapping · Where: `infrastructure/nginx/conf.d/t5-acceptance.conf:20-33` — the only place the proxied locations exist; a grep for that path in `conf.d/default.conf` returns nothing · Where: `tests/m3-t1-contract.test.mjs:76-78` pins the deployed host-gateway posture and `tests/m3-t5-contract.test.mjs:144-148` pins the overlay posture · Where: `infrastructure/docker/scripts/knowledge-t5-common.ps1:524-553` — `Assert-T5RuntimeIsolation`, invoked only by the acceptance driver (`infrastructure/docker/scripts/knowledge-t5.ps1:164`) and self-labelled acceptance in every message; the live driver at `knowledge-t5-live.ps1:455-457` runs the weaker read-only-mount, network-boundary and privilege-boundary trio and never this one, so no shipped run ever proves zero extra hosts, an internal network, or the allowlisted gateway.
- Reproduction: static — starting the deployed core plus knowledge composition yields a container with direct egress and no proxy route, so the isolation checks cannot be run against it at all. A red test merges the deployed composition and asserts either the same allowlisted route and internal network, or fails with a message naming the divergence.
- Acceptance criteria: an enforced lane asserts the deployed merge satisfies the same boundary the acceptance overlay claims, or the owner records a test-visible waiver naming the divergence and the acceptance evidence states which topology it was proved against.
- Related findings: F-262, F-239, F-223 · nguồn: R7-C delta audit C4 — docker compose overlays and acceptance scripts

### F-289 — the acceptance helper treats any nonzero exit as proof that the database rejected the statement, so the one-ACTIVE-index invariant can go unexercised while the lane prints passed

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-C4-02`
- Affected modules: Gates + CI, Zink Knowledgebase
- Severity: High
- Status: OPEN
- Root cause: the negative-case helper sets error handling aside, runs a statement through the container exec path, discards the error stream, and asserts only that the exit code was not zero. Exec failure, malformed SQL, a missing column, an authentication problem and the intended unique-violation all produce the same green result, so the assertion is satisfied by the command not running.
- Evidence: Where: `infrastructure/docker/scripts/knowledge-t1.ps1:61-84` — the function body: `2>&1 | Out-Null` at `:73-74`, `$exitCode = $LASTEXITCODE` at `:75`, and `if ($exitCode -eq 0) { throw "Expected SQL command to fail but it succeeded." }` at `:81-83` · Where: `:161-177` — the single statement that relies on it, a second ACTIVE-status insert against a fresh identifier, expected to violate the partial unique index defined at `apps/knowledge/migrations/001_initial.sql:41-43` · Where: `:242` — the success message the script prints when nothing was actually demonstrated.
- Reproduction: static — any edit that breaks that statement's syntax, or a run against a restarting database container, exits nonzero, the helper returns normally and the acceptance reports passed. A red test requires exit code 3 together with captured error text naming the constraint, and asserts the helper fails when no error text was produced; the acceptance-script pin block at `tests/m3-t1-contract.test.mjs:183-197`, whose `:190-191` assertions today only pin that the helper and its message text exist, is where the fixer adds the constraint-signature assertion.
- Acceptance criteria: the helper asserts the specific constraint-violation signature and reddens on any other failure mode, and a mutation that makes the statement die for an unrelated reason turns the lane red.
- Related findings: F-219, F-221, F-205 · nguồn: R7-C delta audit C4 — docker compose overlays and acceptance scripts

### F-290 — the acceptance script fixes its compose project name and its fixture identifiers and resets nothing at entry, so a second run fails with an unrelated error and two overlapping runs destroy each other's database

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R7-C4-03`
- Affected modules: deployment topology, Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: the project name is a constant and the fixture row identifiers are hardcoded, while the only state purge sits in the outer `finally` block, guarded by a started flag, so nothing is reset at entry and an ungraceful kill — where PowerShell does not run `finally` at all — leaves the volume holding these exact identifiers. A rerun against that volume then fails on a precondition that has nothing to do with the stale state, and if the kill landed before the fixture insert it collides on the primary key instead; either way the reported error names nothing true. Two concurrent runs share the same volume and whichever finalises first deletes the other's data mid-flight.
- Evidence: Where: `infrastructure/docker/scripts/knowledge-t1.ps1:9` — the constant project name · Where: `:13-15` — three hardcoded UUIDs used as the fixture rows · Where: `:132-148` — the ACTIVE-index fixture insert using the first of the three identifiers, and `:201-217` — the interrupted-run pair using the other two · Where: `:244-266` — the teardown sits in the outer finally guarded by `if ($started)` at `:245`, so it also runs when the body throws, but never at entry and never on a kill · Where: `tests/m3-t1-contract.test.mjs:186` — the tracked assertion that pins the constant project name itself, so a per-run namespacing fix must update that pin · Where: `infrastructure/docker/scripts/knowledge-t5.ps1:18-19` — the sibling derives its project name from a per-run identifier, which is the pattern this script lacks.
- Reproduction: static — kill a run after the stack is up and rerun against the persisted volume: the first operator-visible failure is the readiness precondition at `:110-113`, which reports that readiness did not reject the missing active index because a stale ACTIVE row is still there; only a kill after the drift update at `:193`, or one that leaves the fixture row deleted, instead surfaces as a compose failure with exit code 3 from `Invoke-Compose` at `:26-28`. Neither message names the stale volume. A red test (or a documented precondition, pinned by a lane) asserts the script purges its own project state before building, or namespaces per run so two invocations cannot share a volume.
- Acceptance criteria: two consecutive invocations with no manual cleanup both report passed, and two overlapping invocations use disjoint state; the invariant is asserted in a tracked lane rather than assumed.
- Related findings: F-289, F-023, F-192 · nguồn: R7-C delta audit C4 — docker compose overlays and acceptance scripts

### F-291 — acceptance finalisation throws from inside the finally block in four drivers, so a cleanup failure replaces the real defect, and the two t5 drivers drop the resource-leak error whenever the body already failed

- Category: F1 — Logic & Functional Bugs
- Legacy register id: `R7-C4-04`
- Affected modules: deployment topology, Gates + CI
- Severity: High
- Status: OPEN
- Root cause: six drivers implement finalisation in one of two defective shapes. Shape A (four drivers) raises the cleanup error from inside the outer `finally` block, which in PowerShell discards whatever failure the body was propagating, so the operator sees only the teardown complaint: `knowledge-t1.ps1:263-265` throws on `$cleanupExitCode`, `knowledge-t2.ps1:90-97` throws when `docker rm --force` returns nonzero, and `knowledge-t3.ps1:168-177` / `knowledge-t4.ps1:249-256` call `Invoke-Compose` inside the finally while that helper throws on nonzero exit at `knowledge-t3.ps1:22-26` and `knowledge-t4.ps1:21-25`. Shape B (two drivers) records the finalisation error but rethrows it only when the body did not fail, so on exactly the run where both went wrong the leak is never reported: `knowledge-t5.ps1:287` and `knowledge-t5-live.ps1:535` both gate on `-not $script:bodyFailed`. The population was measured by scanning every `finally { … }` block under `infrastructure/docker/scripts/` at HEAD; `knowledge-t2-windows.ps1:84-90` is an adjacent candidate (a bare `Remove-Item -Recurse -Force` inside a finally) that was NOT counted because no throw or helper call in it has been measured.
- Evidence: Where: `infrastructure/docker/scripts/knowledge-t1.ps1:259-265` — inside the finally block, `if ($cleanupExitCode -ne 0) { throw "M3/T1 acceptance project cleanup failed with exit code …" }` · Where: `infrastructure/docker/scripts/knowledge-t2.ps1:90-96` — the same throw-from-finally shape around a forced container removal, and `infrastructure/docker/scripts/knowledge-t2-windows.ps1:84-90` — the adjacent case, which runs an unsilenced recursive remove inside its finally · Where: `infrastructure/docker/scripts/knowledge-t3.ps1:168-177` — `try { Invoke-Compose @("down","--volumes","--remove-orphans") } finally { … }` inside the outer finally, and the compose helper itself throws on nonzero exit at `:25` · Where: `infrastructure/docker/scripts/knowledge-t5.ps1:269-287` — the finalisation error is captured at `:273` and `:280-282`, then emitted only `if ($null -ne $finalizationError -and -not $script:bodyFailed)` at `:287` · Where: `infrastructure/docker/scripts/knowledge-t4.ps1:249-252` — byte-identical to the t3 shape, with its compose helper throwing at `:24` · Where: `infrastructure/docker/scripts/knowledge-t5-live.ps1:510-535` — byte-identical to the t5 conditional rethrow, ending at `:535` · Where: `infrastructure/docker/scripts/knowledge-t5-common.ps1:591-603` — the helper that raises the leak message the driver discards. · R7-E/F-291 repair (this session, owner letter c2, measured at HEAD): Shape A sites are `knowledge-t1.ps1:263-265`, `knowledge-t2.ps1:90-97` (throw at `:93`), `knowledge-t3.ps1:168-177` with the throwing helper at `:22-26`, `knowledge-t4.ps1:249-256` with the throwing helper at `:21-25`; Shape B sites are `knowledge-t5.ps1:287` and `knowledge-t5-live.ps1:535`, both gated on `-not $script:bodyFailed` (`$script:bodyFailed` set at `knowledge-t5.ps1:265` and `knowledge-t5-live.ps1:506`). `knowledge-t5-common.ps1` is a shared helper, not a seventh driver.
- Reproduction: static — with a failing teardown the four throw-from-finally drivers surface only the cleanup error and the primary defect is lost; with a body failure plus leftover containers the two t5 drivers name only the body error and the leak is never recorded. A red test asserts both conditions appear in the emitted evidence, and that the primary failure remains the thrown one.
- Acceptance criteria: one shared finalisation contract across all six drivers — cleanup and leak conditions are always written to the evidence and named in the output, never silently dropped, and never substituted for the body's own failure.
- Related findings: F-101, F-289, F-055 · nguồn: R7-C delta audit C4 — docker compose overlays and acceptance scripts · severity note: re-graded 2026-10-18 by owner ruling to High on a six-driver population; that population was re-measured at HEAD by this session under owner letter `c2` (four Shape-A raises from inside a finally: `knowledge-t1.ps1:263-265`, `knowledge-t2.ps1:90-97`, `knowledge-t3.ps1:168-177`, `knowledge-t4.ps1:249-256`; two Shape-B gates on `-not $script:bodyFailed`: `knowledge-t5.ps1:287`, `knowledge-t5-live.ps1:535`), and `Root cause`/`Evidence` were rewritten so all three fields now agree. The earlier 'three drivers' text was withdrawn.

### F-292 — the acceptance driver resolves the repository through git calls with no working-directory argument, so its attestation can describe a different tree than the files it packaged

- Category: F2 — Security & Authorization
- Legacy register id: `R7-C4-05`
- Affected modules: governance records, deployment topology
- Severity: Medium
- Status: OPEN
- Root cause: every consumed file is resolved from the script's own location, but the cleanliness check, the head revision and the blob object ids are read from whichever repository the invocation directory happens to be inside. This repository carries a registered stale worktree with full copies of these scripts, so the mismatch is reachable today: the candidate can be labelled with the other tree's revision and the self-check cannot notice, because the label comes from the same unqualified call.
- Evidence: Where: `infrastructure/docker/scripts/knowledge-t5-common.ps1:74-79` — `function Assert-T5CleanRepository { $changes = @(git status --porcelain) … }` with no directory argument · Where: `:81-84` — `Get-T5RepositorySha` runs `git rev-parse HEAD` the same way · Where: `:103-108` — blob ids resolved with `git rev-parse "${Treeish}:$relativePath"` while the paths come from the script's own tree · Where: `infrastructure/docker/scripts/knowledge-t5.ps1:119-121` — `Assert-T5CleanRepository`, then the resolved sha at `:120` feeding the image revision label at `:121`; the same unqualified call assigns the evidence field `repository_sha` at `knowledge-t5-common.ps1:351` and `:359`, and `implementation_candidate_sha` at `knowledge-t5-live.ps1:370` · Where: `knowledge-t5-common.ps1:353` — the self-check compares the image label against that same invocation-directory sha, so a foreign-directory build and a foreign-directory acceptance agree with each other and the guard cannot fire · Where: `knowledge-t5-common.ps1:93` — `git ls-tree -r --name-only` enumerates the very paths that get packaged, from the same unpinned call · Where: `infrastructure/docker/scripts/knowledge-t5-remote.ps1:26-32` — the remote comparison built from the same resolution · Where: `git worktree list` currently returns the main tree plus `scratch/wt-discord-idle-reset` at a divergent, chronologically older revision that is not an ancestor of HEAD (measured: `git merge-base --is-ancestor` fails, 135 commits on the HEAD side against 1 on the worktree side), and that worktree holds full copies of these same scripts.
- Reproduction: static — from the stale worktree as the current directory, invoking the main tree's script resolves HEAD to the worktree's commit while packaging the main tree's compose files and manifests, and the internal consistency check passes because both labels came from the same wrong call. A red test asserts every git probe is pinned to the script tree and that the recorded tree path and revision are compared against the checkout the evidence packaged.
- Acceptance criteria: all repository probes are invoked with an explicit directory argument bound to the script's own root, and the evidence records that root; a run started from a foreign tree fails with a message naming both revisions.
- Related findings: F-261 (the stale worktree this depends on), F-219, F-097 · nguồn: R7-C delta audit C4 — docker compose overlays and acceptance scripts

### F-293 — model-service response text is interpolated unescaped into the acceptance SQL literals, so a hostile or malformed tag response writes arbitrary statements

- Category: F2 — Security & Authorization
- Legacy register id: `R7-C4-06`
- Affected modules: deployment topology, Zink Knowledgebase
- Severity: Low
- Status: HYPOTHESIS
- Root cause: the acceptance scripts take fields straight out of the local model service's response and splice them into single-quoted SQL literals inside a here-string passed to the database client. The strongest validation anywhere on these paths is a truthiness test at one site, and the value's shape is never constrained. Impact is bounded because the target is an ephemeral acceptance database, but the pattern is exactly the one the repository's safety rules forbid: untrusted response data used as command text.
- Evidence: Where: `infrastructure/docker/scripts/knowledge-t1.ps1:119` — the guard is only `if (-not $model -or -not $model.digest)` · Where: `:137-147` — the insert with `'$($model.digest)'` at `:144` · Where: `:166-173` — the second statement repeating it · Where: `infrastructure/docker/scripts/knowledge-t3.ps1:157` and `knowledge-t5.ps1:174` — the same interpolation shape, and the t3 site is worse than the row allowed: `:154` assigns the model value from the tags endpoint with no guard at all, not even the truthiness test · Where: `knowledge-t1.ps1:212` — a third statement repeating the same interpolation · Where: the response is fetched from the local tags endpoint by `Invoke-RestMethod`, so its fields are provider-controlled.
- Reproduction: unconfirmed — a tags response carrying a digest containing a quote and a statement terminates inside the literal and produces two statements where one was intended. Before fixing, measure whether any lane or operator run feeds a non-validated endpoint; the intended assertion is a charset check plus parameter passing, exercised by a fixture whose digest contains a quote.
- Acceptance criteria: every provider-derived value is validated against its documented shape before use and passed to the database client as a parameter rather than interpolated, and a fixture with a quote-bearing value proves the statement cannot be split.
- Related findings: F-264, F-052, F-103 · nguồn: R7-C delta audit C4 — docker compose overlays and acceptance scripts

### F-294 — the DuckDB timeout gate drives a test-supplied failure flag, and the only path that exercises the real bound sits behind a skip and inside a conditional assertion

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-C5-02`
- Affected modules: Zink Tools, Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: the gate that is supposed to prove bounded execution passes a flag that makes the function throw before any subprocess is started, so the timeout plumbing is never touched. The single test that does reach the real bound is both skipped whenever the engine probe fails and wrapped in a conditional that asserts nothing when the query answers quickly, and the declared ceiling clamp is never driven by any test. The lane therefore reports green for a resource control that has no executed proof.
- Evidence: Where: `tests/duckdb-bridge.test.mjs:251-268` — the assertion is `assert.rejects(… { simulateTimeout: true, timeoutMs: 1000 })` · Where: `zink-tools/sql/duckdb-bridge.mjs:212-216` — that flag raises before any execution, while the real bound is the timeout option on the line after the `execFileSync` call opens at `:262`, i.e. `:263`, and the classified error at `:272` · Where: `tests/duckdb-bridge.test.mjs:270-272` and the later cases — `{ skip: duckDbSkip() }` · Where: the boundary case wraps its assertions in a conditional on the observed timeout, so a fast fixture contributes nothing · Where: `zink-tools/sql/duckdb-bridge.mjs:206-209` — the ceiling clamp whose upper branch no test reaches, because the largest timeout any test passes is 1000 against the 30000 ceiling · Where: `.github/workflows/ci.yml` has no step installing the engine.
- Reproduction: mutation probe, executed 2026-10-18 with the engine installed on this host — the baseline suite prints 17 tests / 17 pass / 0 fail / 0 skipped, and with the timeout option removed it printed the same counts, so nothing that runs today distinguishes the two. A red test runs the module against a fixture executable that hangs, asserts the typed timeout code and that the child was killed, and separately asserts that an oversized requested timeout is clamped to the ceiling.
- Acceptance criteria: one unskippable assertion proves the subprocess timeout is applied and the child reaped, the clamp is driven at its boundary, and removing either reddens the lane; the flag-driven case may remain but no longer counts as the control's evidence.
- Related findings: F-304 (the probe that decides the skip), F-221, F-240 · nguồn: R7-C delta audit C5 — test validity, first half

### F-295 — the ingress-registry eviction test compares an empty record against the shape an absent record also produces, so presence and eviction are indistinguishable

- Category: F1 — Logic & Functional Bugs
- Legacy register id: `R7-C5-03`
- Affected modules: OpenClaw governance plugin
- Severity: Medium
- Status: OPEN
- Root cause: the assertion that is meant to prove the oldest entry was evicted checks that its mention list equals an empty array, but the fixture never populates mention lists and the read path returns the same empty shape for a missing identifier — a fact the same file proves eleven lines later at `:301` in the unknown-id test. Only the size bound is genuinely constrained, so eviction ORDER can be inverted and the suite stays green: measured, evicting the newest key keeps the store at 256 and the probed identifier reading an empty list. Wholesale removal of the eviction is caught, and caught only by that size bound (measured store size 300 against the 256 assertion), never by the eviction assertion itself.
- Evidence: Where: `tests/m10-t2-r5-host-inbound-metadata.test.mjs:284-293` — three hundred inserts, then `const first = readZinkIngressMetadata("154543000000100000"); assert.deepEqual(first.mentionedUserIds, []);` followed by the store-size bound · Where: `:299-307` — the unknown-identifier test asserting the identical empty shape, which is the proof that the eviction assertion cannot fail · Where: the fixture builder defaults mentioned users to an empty list · Where: the production eviction site whose order is unconstrained is `integrations/openclaw/topology/lib/native-patch.mjs:386`, inside the preflight injection constant (the identical loop is repeated verbatim in the lineage text at `:251`, which this test does not compile, so a mutation there is invisible to it).
- Reproduction: measured mutation probe (2026-10-18, run against an in-memory copy of the compiled injection, no tracked file touched) — HEAD keeps the store at 256 with the oldest key absent and the test passes; the evict-newest variant also keeps it at 256, retains the oldest key, and the test still passes. A red test writes records carrying distinct non-empty mention lists, asserts the newest identifier reads back its own list and the evicted identifier reads as absent, and drives the exact boundary at the capacity limit.
- Acceptance criteria: the eviction assertion is falsifiable — it distinguishes a retained record with content from an absent record — and the boundary case at capacity and capacity-plus-one is exercised.
- Related findings: F-219, F-240, F-296 · nguồn: R7-C delta audit C5 — test validity, first half

### F-296 — the durability gate is a text search after the only rename in each file, so any of the four writers can retarget its directory fsync onto the already-durable file handle and stay green

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-C5-04`
- Affected modules: Workflow topology + ledger, governance records, Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: the gate reads each writer's source, slices from the final occurrence of the rename call, and asserts that the remaining text mentions the fsync call. It never names a directory handle and never binds an fsync to a specific rename, so the check is satisfied by any mention of the fsync call after the file's single rename — measured, each of the four writers has exactly one rename call and its directory fsync is the only fsync mention after it — whatever the other publication paths do, and the gate's own failure message at `:176` asserts a parent-directory fsync the predicate cannot see.
- Evidence: Where: `tests/m10-t2-r15-critical-path-invariants.test.mjs:163-178` — the writer list (the array opens at `:163`, so the previously cited range showed only its last two entries), `assert.match(src, /renameSync/u)`, then `const after = src.slice(src.lastIndexOf("renameSync")); assert.match(after, /fsyncSync/u, …)` · Where the claim is about: `integrations/openclaw/topology/lib/ledger.mjs:602-606`, `integrations/openclaw/lib/queue-manager.mjs:248-254`, `integrations/openclaw/lib/decision-ledger.mjs:293-305`, `integrations/openclaw/lib/artifact-validator.mjs:1389-1397` — in each file the rename is at the first cited line and the directory fsync at the last · Where: the same list omits tracked publication renames at `integrations/openclaw/plugins/zink-governance/index.mjs:446`, `integrations/openclaw/templates/openclaw-gemini-stream-hotfix.mjs:265`, `integrations/openclaw/topology/lib/native-patch.mjs:842`, `integrations/openclaw/topology/lib/runtime-backup.mjs:349` and `:358`, and `zink-tools/adapters/skill-store/skill-adapter.mjs:190`, whose durability requirement has not been assessed.
- Reproduction: static mutation probe — in the ledger writer, retarget the fsync from the directory handle to the already-durable file handle: the rename becomes non-durable on crash and the gate stays green because the text still mentions fsync after the rename; measured against the gate's own predicate, that retarget stays green for all four writers while deleting the fsync line reddens all four, because each file has exactly one rename call and its directory fsync is the only fsync mention after it (this session ran the file: 7 tests / 7 pass / 0 fail). A red test opens a directory handle and fsyncs it between each rename and the next write, or drives the writer and asserts the syscall sequence.
- Acceptance criteria: each rename site is individually proven to be followed by a directory fsync, and a mutation that re-targets or removes any one of them reddens the lane.
- Related findings: F-221, F-219, F-140 · nguồn: R7-C delta audit C5 — test validity, first half

### F-297 — the snapshot-target test wraps its assertions in the condition that is itself under test, so reclassifying one scope silences the check without failing it

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-C5-05`
- Affected modules: governance records, Gates + CI
- Severity: Low
- Status: OPEN
- Root cause: the test builds a set of declared scopes from the production pins and then runs its assertions only if that set contains the channel scope. Removing the scope from the pin removes the assertions rather than tripping them, and the preceding array check passes on an empty list. Consequence is limited because a sibling suite in the same lane asserts the same invariant unconditionally, which is why this is Low rather than Medium.
- Evidence: Where: `tests/m10-t2-r22-publish-durability-and-bounded-backup.test.mjs:190-201` — the scope set is built from the pins and the only assertion loop sits behind the discordChannel membership test, after the array-shape check, which passes on an empty list · Where: `integrations/openclaw/topology/lib/native-patch.mjs:889-895` — the channel derivation emits an entry only for a pin source whose scope is discordChannel, so deleting that pin scope empties the list instead of tripping the loop · Where: `tests/m10-t2-r8-deployment-snapshot-safety.test.mjs:122-142` — the sibling case asserts the same channel target inclusion and the derived list unconditionally, which is why the consequence stays Low.
- Reproduction: static mutation probe — drop the channel scope from the pin and the guarded loop never executes while the test reports passed. A red test asserts the derived set is non-empty and that every declared scope value has a matching snapshot bucket before iterating.
- Acceptance criteria: the assertion set cannot be emptied by changing production data — either the scope set is required non-empty, or the invariant is asserted unconditionally as the sibling already does.
- Related findings: F-240, F-296, F-097 · nguồn: R7-C delta audit C5 — test validity, first half

### F-298 — the lane that names the retry rule never attempts a retry, so widening the transient-failure class in production leaves it green

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-C5B-A`
- Affected modules: Workflow topology + ledger, Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: the case titled as the no-retry-path invariant drives a killed run and asserts only that its reason code belongs to the documented transient pair — which the file's own comment admits means the run is retryable. The behaviour the title claims (a reservation must be refused for a non-transient terminal state) is never performed: no reservation event is applied and no refusal is asserted, so the production classification set is unconstrained.
- Evidence: Where: `tests/m7-lane-h1-state-replay-matrix.test.mjs:851-881` — outcome killed, then `assert.equal(["RUN_TIMEOUT","TRANSIENT_RUNTIME_FAILURE"].includes(…runtime_reason_code), true, …)` with the comment at `:866-868` stating the run IS retryable here · Where the control lives: `integrations/openclaw/topology/lib/workflow.mjs:1566` (`TRANSIENT_FAILURE_CLASS.has(run.runtime_reason_code)`) and the reconcile gate at `:487` · Where the positive half exists: `:758-849` proves a transient failure does retry, which is the only side actually exercised.
- Reproduction: static mutation probe — remove the transient-class test from the reconcile path so every failure class becomes retryable, and the case still passes because it never issues a reservation. A red test drives a terminal run whose reason code is outside the transient set and asserts the reservation raises and the task stays blocked.
- Acceptance criteria: the lane performs the refused-retry case it names, and deleting or widening the production transient class reddens it; the state vocabulary is imported from production rather than hand-copied, or a test asserts the copy equals it.
- Related findings: F-206, F-219, F-240 · nguồn: R7-C delta audit C5B — test validity, second half

### F-299 — the native-receipts containment case branches on the outcome under test and its positive branch asserts a test-built object is truthy

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-C5B-B`
- Affected modules: OpenClaw governance plugin, Gates + CI
- Severity: Medium
- Status: REFUTED — premise measured false 2026-10-18 under the owner's ruling; the row stays in the queue per §0.2 rule 25 and the deletion threshold, because a refuted premise is an owner decision, not pending work.
- Root cause: the fixture reliably takes the allow path, because the plugin falls back to the recorded parent identity, and the assertion chosen for that branch is that a snapshot task object exists. That predicate holds for any task the test itself created, so the control the title names — a rejected ledger write must block the run — is only ever verified in the branch the fixture does not reach.
- Evidence: Where: `tests/m7-lane-d3-native-receipts.test.mjs:210-223` — `if (decision.allow === true) { const after = readSnapshot(paths).tasks[taskId]; assert.ok(after); } else { …blocked and BLOCKED assertions… }`, with the comment at `:213-214` explaining that the plugin reconciles this input · Where: the production containment is the subagent-ended path in `integrations/openclaw/plugins/zink-governance/index.mjs` that must set the task to blocked when the write cannot be applied.
- Reproduction: REFUTED by code read 2026-10-18, chain re-opened line by line — the fixture records `parent_session_key: main-session` at `tests/m7-lane-d3-native-receipts.test.mjs:89` and `:103`, then hands the hook `requesterSessionKey: forged-parent-session` at `:209`; `integrations/openclaw/plugins/zink-governance/index.mjs:8000-8001` prefers the supplied value with no fallback to the recorded parent, so the event payload carries the forged key, `integrations/openclaw/topology/lib/workflow.mjs:408-414` matches zero delegations and raises LINEAGE_MISMATCH, and `index.mjs:8021-8031` returns the block helper's shape at `:7954-7956` (`allow: false`, `blocked: true`). The case therefore runs the ELSE branch at `:218-223`, which is the branch holding the containment assertions the row said were unreached; the row's error came from repeating the test's own stale comment at `:213-214`. What survives is far smaller and is a test-shape weakness, not a containment gap: the allow branch at `:215-217` asserts only that a task object the test itself created is truthy, so it would say nothing if a future change made that path reachable. Original claim kept below for the record — static mutation probe — make the production path never fail on an unreconcilable requester session so it always allows, and the case passes through the vacuous branch. A red test removes the conditional, constructs the input deterministically producing a rejected write, and asserts the block decision and the blocked status on that exact input.
- Acceptance criteria: the case has one deterministic path with an assertion that is false when the containment is removed; no branch of the test may be satisfied by the mere existence of fixture state.
- Related findings: F-219, F-298, F-088 · nguồn: R7-C delta audit C5B — test validity, second half

### F-300 — the test that repeated attempts must not mutate the ledger runs no attempt and asserts only a property of the snapshot builder

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-C5B-C`
- Affected modules: governance records, Gates + CI
- Severity: Low
- Status: OPEN
- Root cause: after building one transaction snapshot, the case asserts that none of the recorded preimage paths mention the ledger word. That is a fact about how the builder enumerates targets, not about whether repeated applies touch durable governance state: no attempt is run, no restore happens, and no ledger file is opened, so the named invariant is untested while the lane reports it green.
- Evidence: Where: `tests/m8-t2.12-r15-attempt-identity.test.mjs:333-347` — one snapshot build, then a single assertion that no recorded preimage key contains the ledger word, with the comment at `:336-337` conceding that no apply path here touches the ledger, and the fixture at `:57-77` never creates a ledger file · Where: `integrations/openclaw/topology/lib/transaction-snapshot.mjs:74-90` — the frozen target list the assertion actually measures, and the restore walk at `:256` that only ever iterates it · Where: `tests/m8-t2.13-r16-apply-rehearsal.test.mjs:644-654` — the only case anywhere that counts ledger events around a real apply, and it sits behind the skip flag at `:574`, so on the default host the named invariant has no runner. · R7-E (vị trí mới, gộp): `tests/m10-t2-r15-result-payload-bytes.test.mjs:76-112` — ca tự ghép `truncateUtf8` với `validateAgentClaim` bằng tay và chỉ import `runtime.mjs` (dòng 10-11), không bao giờ import guard là caller thật (`integrations/openclaw/topology/lib/guard.mjs:1050-1084`, phép cắt ở `:1060`, `:1068`, `:1077-1082`, validate ở `:1084`); xóa cả ba điểm cắt trong production thì năm ca vẫn xanh, trong khi output 16384 ký tự tiếng Việt thực sẽ vượt bound byte và chết ở `SCHEMA_VALIDATION_FAILED`.
- Reproduction: static mutation probe — make the restore routine also rewrite a governance ledger path and the case still passes, since it never restores. A red test performs two applies against a tree containing a ledger file and asserts its bytes are unchanged after restore.
- Acceptance criteria: the case drives repeated applies with a ledger file present and compares its bytes before and after; the preimage-shape check may stay as a secondary assertion but no longer stands as the evidence.
- Related findings: F-299, F-221, F-101 · nguồn: R7-C delta audit C5B — test validity, second half · R7-E delta audit E3/D4: hai vị trí 'lane báo phủ một thứ mà nó không chạy' gộp vào đây thay vì mở hàng riêng · F-298 là hàng cùng họ nhưng subject khác (retry classification), nên không nhận location này

### F-301 — the approval card tells the owner the result preview is attached, and no outbound path in the integration can attach a file

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R7-C6-01`
- Affected modules: OpenClaw governance plugin, Zink Tools
- Severity: High
- Status: OPEN
- Root cause: the preview renderer writes a PNG to disk and the card line inserts only its base name, while the posting helper takes no file parameter and the transport builds a JSON body. One card variant goes further and prints that the image is attached. The owner therefore approves work believing they have seen a rendered preview of it, when the artefact never leaves the host — and the governance policy that makes a real preview mandatory is satisfied by a claim.
- Evidence: Where: `integrations/openclaw/lib/discord-result-preview.mjs:139-145` — the rendered PNG is written into the evidence directory and only its path is returned · Where: `integrations/openclaw/lib/discord-formatter.mjs:699-701` — the expected-result line in the approval body prints the base name the plugin passes at `integrations/openclaw/plugins/zink-governance/index.mjs:6771` · Where: `integrations/openclaw/lib/discord-formatter.mjs:892-896` — the result card line ends with the wording that marks the image as already attached · Where: `integrations/openclaw/lib/discord-forum-tags.mjs:617-662` — the governed publish helper takes no file or bytes argument and posts a JSON body carrying only the thread name, the message content and the tag ids · Where: `integrations/openclaw/plugins/zink-governance/index.mjs:6807-6820` — the second approval post is likewise a JSON body, so neither governed publish can carry the artifact · Where measured: a grep for the multipart encoding and the form-data type across `integrations/openclaw` returns only an unrelated log helper, and the outbound attachment seams that do exist — `index.mjs:3036-3064` and the send guard at `:8265-8295` — belong to host-sent messages, not to either governed publish path · Where: `integrations/openclaw/lib/policy.mjs:1172-1176` — the coordinator prompt that makes a real rendered preview mandatory.
- Reproduction: static — any first-spawn approval produces a body naming the PNG base name while the request carries no file part; the evidence directory holds the image the owner never sees. A red test captures the outbound request for an approval post with a non-null preview and asserts the body is a multipart payload containing the image bytes.
- Acceptance criteria: either the outbound path attaches the rendered bytes and a captured request proves it, or the card stops claiming a preview image and the mandatory-preview rule in the policy is withdrawn in the same change. Silently dropping the renderer is not acceptable while the rule still requires it.
- Related findings: F-259, F-077, F-302 · nguồn: R7-C delta audit C6 — orphan runtime files and contracts

### F-302 — the preview renderer's table inputs have no producer, so every generated image is the placeholder layout while the plan data that would fill it is in scope

- Category: F1 — Logic & Functional Bugs
- Legacy register id: `R7-C6-02`
- Affected modules: OpenClaw governance plugin
- Severity: Medium
- Status: OPEN
- Root cause: the renderer accepts declared columns and sample rows and falls back to a labelled placeholder header, but its only production caller passes a target, a title, a truncated note string and an output directory. The fallback is therefore the only path that ever runs, and the governed task nodes carrying the declared criteria are read in the same function for the text card one statement later — the data exists and is simply not handed to the image.
- Evidence: Where: `integrations/openclaw/lib/discord-result-preview.mjs:71-76` — the parameters default to empty collections and `const headers = headerRow.length > 0 ? headerRow : [UNKNOWN_COLUMN];` · Where the placeholder is defined in the same module · Where: `integrations/openclaw/plugins/zink-governance/index.mjs:6736-6744` — the only call site, with no columns or rows key · Where: `:6774` — the same scope builds plan nodes for the text card.
- Reproduction: static — every image produced by the governed path renders the placeholder header and a predicted row, so a red test spies the renderer from the card path and asserts a non-empty column set for a task whose nodes declare criteria. Deleting the renderer to make the assertion pass is blocked by F-301's acceptance line.
- Acceptance criteria: for a task whose snapshot nodes declare validation criteria or inputs, the rendered table's header is not the placeholder value, proved by a test that drives the real card path.
- Related findings: F-301, F-259 · nguồn: R7-C delta audit C6 — orphan runtime files and contracts

### F-303 — the two tool envelopes resolve only through repo-relative and working-directory paths that packaging does not ship, and the failure is swallowed as a generic schema error

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R7-C6-03`
- Affected modules: OpenClaw governance plugin, Zink Tools, Gates + CI
- Severity: High
- Status: LATENT
- Root cause: the contract resolver walks a candidate list whose first entries are the topology directory and its tools subdirectory, then two repo-relative walks, then two working-directory lookups. Packaging copies only the topology contracts and rewrites only the topology-relative specifier, so in a flattened installed tree the two envelope files have no candidate that can exist, and the guard converts the resulting not-found into an undifferentiated validation failure. Whether the live host masks this depends on the working directory it happens to run with, which no lane measures — hence LATENT with the mechanism confirmed.
- Evidence: Where: `integrations/openclaw/topology/lib/schema.mjs:118-156` — the candidate list, ending in two `process.cwd()` resolutions, and `return null` when none exists · Where: `integrations/openclaw/lib/policy.mjs:1238-1242` — packaging assets are built from the topology contracts directory only · Where: `integrations/openclaw/topology/lib/guard.mjs:1571-1576` — `try { validateContractSchema("tool-call", event.params); } catch { fail("SCHEMA_VALIDATION_FAILED"); }`, which erases a missing-file cause from a malformed-payload symptom · Where: `tests/fixtures/r10-policy-load-probe.mjs:136-160` — the off-repo load probe calls only session and agent operations, never a governed tool, so the envelope path is never exercised outside the repository · Where: `tests/m7-t3-tools-contract.test.mjs:393` runs the same validator from the repository working directory, where a candidate always exists.
- Reproduction: static — with the working directory set to an empty temporary tree, resolving the two envelope names returns null and validation reports the schema was not found; extend the existing off-repo probe to call the envelope validator and it reddens. The fix must either ship the tool contracts with the plugin or drop working-directory resolution.
- Acceptance criteria: contract resolution never consults the working directory, the packaged tree resolves every contract the guard validates, and the off-repo probe exercises a governed tool call; a missing contract file is reported with its own reason code rather than folded into a generic validation failure.
- Related findings: F-252, F-128, F-144 · nguồn: R7-C delta audit C6 — orphan runtime files and contracts

### F-304 — the availability probe folds every failure into "engine not installed", so a hanging or broken DuckDB retires six SQL gates that still report success

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-C6-04`
- Affected modules: Gates + CI, Zink Tools
- Severity: High
- Status: OPEN
- Root cause: one catch-all turns a missing binary, a timed-out probe, a permission error and a nonzero exit into the same false value, and the skip helper derived from it returns a message that asserts the engine is absent. Because the test runner treats a skip reason as a skipped test and the lane still exits zero, a partially installed or misbehaving engine silently withdraws the SQL safety coverage while every consumer reports green; no gate counts the skips or verifies the engine's presence.
- Evidence: Where: `tests/helpers/duckdb-availability.mjs:27-45` — `execFileSync("duckdb", ["-c","SELECT 1"], { timeout: 15000, … })` with `catch { cached = false; }`, and the skip text "DuckDB engine not installed on this host (NOT RUN)" · Where it is consumed: `tests/duckdb-bridge.test.mjs:22,272,292,306,328` and `tests/m7-t4-orchestration.test.mjs:123` · Where nothing checks: a grep for skip or pass-count accounting in `scripts/repository-check.mjs` returns no matches, and no CI step installs the engine before `npm run verify`.
- Reproduction: static — make the probe time out (a slow or corrupt install) and every dependent gate is reported skipped while the suite passes; the reason recorded is factually wrong. A red test distinguishes the causes — only an absent binary yields NOT RUN, a failed presence check reddens the lane — and one gate records which condition occurred.
- Acceptance criteria: the probe reports its cause, a non-ENOENT failure reddens the suite, and the release evidence states the engine status per lane rather than inferring it from a skip.
- Related findings: F-294, F-221, F-197 · nguồn: R7-C delta audit C6 — orphan runtime files and contracts

### F-305 — the preview rasteriser performs no redaction of its own, unlike every other Discord-visible surface

- Category: F2 — Security & Authorization
- Legacy register id: `R7-C6-06`
- Affected modules: OpenClaw governance plugin
- Severity: Low
- Status: HYPOTHESIS
- Root cause: the renderer turns note text, columns and rows into image cells without invoking the sanitiser or the forbidden-pattern checks that every text surface applies, so its safety depends entirely on each caller pre-sanitising. Today's caller does sanitise upstream, which is why this is filed as a hypothesis rather than an open exposure: the defect is the missing local control, and it becomes live the moment a second caller passes producer-derived content.
- Evidence: Where: `integrations/openclaw/lib/discord-result-preview.mjs:71-102` — the table builder stringifies inputs with no sanitise call · Where the sibling rule lives: `integrations/openclaw/lib/discord-formatter.mjs:12-31` defines the identifier sanitiser and the forbidden-pattern set used by every card path · Where the current caller compensates: `integrations/openclaw/plugins/zink-governance/index.mjs:6983` sanitises the task before the preview is built, and `integrations/openclaw/topology/lib/runtime.mjs:86-92` carries the secret-pattern replacements.
- Reproduction: unconfirmed — no second caller exists today, so nothing to observe; the falsifiable version is a test that passes an unsanitised note or row through the renderer and asserts the secret pattern never reaches the rasterised grid. Before fixing, measure whether the renderer should own the control or the callers should be required to.
- Acceptance criteria: either the renderer sanitises every inbound string itself and a test proves a token-shaped input cannot survive into the image, or the module's contract states that it accepts pre-sanitised data and a gate rejects unsanitised arguments at the seam.
- Related findings: F-259, F-301, F-302 · nguồn: R7-C delta audit C6 — orphan runtime files and contracts

### F-306 — the PDF runtime manifest stamps model provenance copied from the downloader's own constant, and two supply-chain fields are checked for presence only

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R7-E1-01`
- Affected modules: Zink Knowledgebase, deployment topology
- Severity: High
- Status: OPEN
- Root cause: the manifest builder imports the revision map that the download script also feeds to the hub client, and writes it into the manifest verbatim, so the recorded "immutable artifact revision" is a restatement of the request rather than an observation of what was fetched. The two fields that could contradict it — the locked distribution hashes and the hashed requirements digest — are demanded to exist and are then never recomputed or compared by either the child verifier or the parent verification, so a stale artifact tree paired with edited revision strings still yields a fresh processing identity and a passing probe.
- Evidence: Where: `apps/knowledge/pdf-runtime/src/zink_pdf_runtime/manifest.py:14` imports `MODEL_REVISIONS` and `:33` writes `"model_artifact_revisions": dict(sorted(MODEL_REVISIONS.items()))` · Where: `apps/knowledge/pdf-runtime/src/zink_pdf_runtime/download_models.py:11-15` declares the same three repo/revision pairs and `:23-28` passes them as `revision=` to `snapshot_download` writing into `--output-dir` · Where: `apps/knowledge/app/pdf_runtime.py:64-77` demands the key set including `locked_distribution_hashes` and `hashed_requirements_digest`, and `:124-131` is the whole verification — it compares the lock digest, `distributions`, `artifact_digests` and `runner_code_digest` only · Where: `apps/knowledge/Dockerfile:25-30` downloads the models with no checksum instruction, in contrast with the reranker artifact pins in the same file · Measured this session: a grep for the two supply-chain field names returns the manifest writer, the parent's presence set at `:67-68`, the identity input at `:103`, and test fixture literals — no recomputation anywhere. · R7-E challenge correction (measured at HEAD): the `Dockerfile:25-30` locator is `:26-30`, and the `manifest.py:103` locator sits inside `_locked_distribution_hashes` lock parsing (`:98-108`), not in an identity input.
- Reproduction: static — the recorded revision is never observed from the fetched tree: `manifest.py:33` copies the request map declared at `download_models.py:11-15`, so a manifest regenerated against any artifact tree asserts provenance it did not measure, and `apps/knowledge/Dockerfile:26-30` performs the download with no checksum instruction (contrast the reranker artifact pins at `:64-66`). What this row first claimed — that editing the revision strings leaves a cached builder layer and a passing probe — is refuted by the build path: the file is COPYed at `:26`, so its bytes bust the layer and the RUN at `:27-30` re-fetches. Measurement a fixer must take before coding: whether any consumer recomputes `locked_distribution_hashes` or `hashed_requirements_digest` from the artifact tree rather than trusting the manifest.
- Acceptance criteria: the recorded revision for each hub repository is proven to equal the commit the artifact tree was actually materialised from, and every entry in `distribution_versions` is verified against `locked_distribution_hashes`; presence-only checks are not sufficient and removing the fields is not an acceptable fix.
- Related findings: F-286 (an echoed identity in the same boundary, different field), F-252, F-237 · nguồn: R7-E delta audit E1 — Knowledgebase python modules

### F-307 — the run-error payload counts errors after deduplication and redaction, so `total_error_count` is not the number of errors

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R7-E1-02`
- Affected modules: Zink Knowledgebase
- Severity: Medium
- Status: OPEN
- Root cause: the serialiser builds a set of sanitised tuples first, then reports the length of that set as the total, and derives the truncation flag from the same reduced list. Distinct failures that share a code collapse into one entry, and every error whose source path is judged unsafe collapses further because its path becomes null, so the operator-visible count under-reports and the per-file location is destroyed precisely for the class of errors that needs locating. · corrected by the R7-E challenge pass: the dedup set is keyed on the `(source_path, code)` tuple (`run_errors.py:30-31`, `:103-106`), so the same code on two different safe paths does NOT collapse, and `markdown_adapter.py:296-301` emits a vault-relative directory whose first root (`01. Knowledge`) is inside `_SAFE_SOURCE_ROOTS` (`run_errors.py:15-17`) — it is whitelisted, not redacted. The loss comes from the `.md` filter at `index_lifecycle.py:146-156`.
- Evidence: Where: `apps/knowledge/app/run_errors.py:30` `unique = {_sanitize_error(error) for error in errors}`, `:31` sorts it, `:38` `"total_error_count": len(ordered)`, `:39` `"truncated": len(ordered) > MAX_ERROR_ENTRIES` · Where: `:103-106` the sanitiser replaces an unsafe code with a single redaction constant and an unsafe path with `None` · Where: `:113-123` `_is_safe_source_path` requires the first component to be one of the whitelisted roots · Where the input comes from: `apps/knowledge/app/index_lifecycle.py:147-160` already nulls paths that do not end in the markdown suffix, and `apps/knowledge/app/markdown_adapter.py:299-300` raises a directory-scoped read failure that is therefore always nulled before counting.
- Reproduction: static — two directory-scoped `SOURCE_READ_FAILED` errors are nulled by `index_lifecycle.py:150`/`:155` because neither path ends in `.md`, sanitise to the same `(None, code)` tuple at `run_errors.py:103-106`, and are reported as one error; `total_error_count` is `len()` of that deduped set (`run_errors.py:30`/`:38`), so the run payload understates what happened while still naming the code. A red test builds two such errors and asserts both the count and the paths survive serialisation.
- Acceptance criteria: `total_error_count` equals the number of error objects supplied (or the field is renamed to the count it actually performs, in the same change as every consumer), and the truncation flag reflects the raw list rather than the reduced one.
- Related findings: F-101, F-039, F-310 · nguồn: R7-E delta audit E1 — Knowledgebase python modules

### F-308 — the markdown topic derivation silently discards every alias tag the module itself recognises, and the code it reserves for that case is never raised

- Category: F1 — Logic & Functional Bugs
- Legacy register id: `R7-E1-03`
- Affected modules: Zink Knowledgebase
- Severity: High
- Status: HYPOTHESIS — the write-side/query-side acceptance asymmetry is measured in code, but no note in the corpus was shown to carry an alias tag, so the loss itself is unproven (Vault is out of scope this round).
- Root cause: the canonical topic list is built by filtering raw tags through the literal-tag map, so an alias spelling that the same module publishes in its slug table contributes nothing yet stays in the tag set the search filter also reads. The consequence is two-sided: a note whose tags mix an alias with a literal is indexed under the topic of whichever literal tag survived the filter first, and the alias-intended topic silently vanishes, and a note carrying only recognised aliases is refused outright with a missing-topic error, while the dedicated unsupported-topic code that would name the real cause exists in the precedence table and the message map and has no raising site at all. · narrowed by the R7-E challenge pass: `primary_topic = canonical_topics[0]` (`markdown_adapter.py:420`) is a topic the author DID declare, so this row's earlier phrasing about producing a topic nobody declared is withdrawn. What stands is the acceptance asymmetry.
- Evidence: Where: `apps/knowledge/app/markdown_adapter.py:406-408` `canonical_topics = tuple(TAG_TO_TOPIC[raw_tag] for raw_tag in raw_tags if raw_tag in TAG_TO_TOPIC)` and `:409-410` the missing-topic error when the filter empties the list · Where: `:420` `primary_topic = canonical_topics[0]` takes the surviving literal tag's topic, and `:421-428` `normalized_tags` keeps the discarded alias · Where the aliases live: `:62-81` the eighteen-entry canonical slug table and `:82-84` the loop that extends the topic-to-tag direction with those slugs — while `:85` builds the tag-to-topic map only from the literal pairs, so no slug is added to it · Where the code is declared: `:94` the precedence entry and `:923` the detail string — a grep over the package finds those two occurrences and no raise · Where the filter bites: `apps/knowledge/app/retrieval.py:78-87` and `apps/knowledge/app/database.py:1043` match `primary_topic` exactly. · measured at HEAD for the asymmetry: write side accepts only the 13 pairs of `TOPIC_TAGS` (`markdown_adapter.py:85` builds `TAG_TO_TOPIC` from them) and silently drops everything else at `:406-410`; query side additionally resolves 18 canonical slugs from `CANONICAL_SLUG_TO_TOPIC` (`markdown_adapter.py:62-81`) through `retrieval.py:73-88`.
- Reproduction: static — a note tagged with a hyphenated supply-chain slug plus a literal data tag indexes under the data topic and is invisible to a topic filter for the real one, while matching on the tag set still finds it; a note tagged only with the slug fails the run with the missing-topic error. The fixer test: ingest one note per published alias and assert either the mapped topic or the unsupported-topic error naming the source path.
- Acceptance criteria: every tag the module's own slug table recognises either produces its canonical topic or raises the unsupported-topic error with the source path, and a test iterates the full published alias set rather than the literal pairs.
- Related findings: F-008, F-015 (write-side versus filter-side normalisation), F-138 · nguồn: R7-E delta audit E1 — Knowledgebase python modules

### F-309 — the reranker validates a graph contract the exporter wrote about itself, and the measured evidence that could contradict it is not shipped or loadable

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R7-E1-04`
- Affected modules: Zink Knowledgebase, deployment topology
- Severity: Medium
- Status: OPEN
- Root cause: the runtime check compares the manifest's graph-contract values against the same literals the export script stamps into that manifest, rather than against properties measured from the loaded session, so the guard can only ever agree with the file it trusts. The genuinely measured artefacts — the fidelity report, the exporter and quantiser records, and the digest of the fidelity evidence — are either excluded from the shipped file set or absent from the manifest dataclass, so they are dropped at load and nothing downstream can re-verify them.
- Evidence: Where: `apps/knowledge/app/reranker.py:131-141` — `contract.get("max_batch_size") != 20`, `max_sequence_length` against the module constant, `one_logit_per_pair is not True`, and a CPU-provider equality check · Where those numbers are authored: `apps/knowledge/scripts/export_reranker.py:219` writes `graph_contract` as the literal batch axis 0, sequence axis 1, max batch 20, max sequence 1024, one logit per pair true, alongside `exporter`, `quantizer` and `fidelity_evidence_sha256` · Where the shipped set is decided: `:212` runtime paths cover the int8 model, its external data files and the tokenizer only, and `apps/knowledge/Dockerfile:108` copies only the runtime-artifacts directory · Where the fields are lost: `apps/knowledge/app/reranker.py:29-38` the manifest dataclass has no exporter, quantiser or fidelity member, and `:80-90` the loader reads only the ten fields it has, so the extra keys are discarded at load · Counter-evidence measured this session so the row is not overstated: `:211` pins the tokenizer digest as a literal, but `reranker.py:118-125` re-hashes the deployed tokenizer file, so that pin is genuinely checked. · measured at HEAD: `ArtifactManifest` has nine fields (`reranker.py:30-38`), not ten, and the exporter path is `apps/knowledge/scripts/export_reranker.py:205-206`.
- Reproduction: static - hand-edit a fixture manifest so its graph_contract repeats the constants while the deployed session actually caps batches or sequence lengths elsewhere (a dynamic-axis graph carries no max): the two ceilings and the one-logit flag are never exercised against the session, and the only measurement that bounded them - the 1-by-8, 20-by-17 and 1-by-1024 probe recorded in `apps/knowledge/scripts/export_reranker.py:105-127` and written to the fidelity file at `:189` - is neither copied into the runtime set (`:216-217`) nor shipped (`apps/knowledge/Dockerfile:108`) nor loadable (`apps/knowledge/app/reranker.py:29-38`, `:80-90`). Note the guard is not purely tautological: input shapes, axis dynamism, output arity and provider are measured from the session at `:137-177`.
- Acceptance criteria: `graph_contract` values are computed from the exported session rather than typed, and the fidelity evidence digest is either shipped and re-verified at load or removed from the manifest together with the export step that produces it.
- Related findings: F-175, F-252, F-312 · nguồn: R7-E delta audit E1 — Knowledgebase python modules

### F-310 — the Knowledgebase start-up flattens every reranker failure into one string, stores it in a field nothing reads, and readiness re-emits that same string rather than reading the field

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R7-E1-06`
- Affected modules: Zink Knowledgebase
- Severity: Medium
- Status: OPEN
- Root cause: the constructor converts eight distinct failure codes into one exception type carrying a single literal, the application bootstrap catches that type and writes a constant into a state field, and the readiness endpoint emits its own literal rather than the stored value. Measured this session, the field has four write sites and zero readers, so the only surviving identity of a failed start-up is a constant that cannot distinguish a bad artifact pin from a corrupted image or an unusable graph. · corrected by the R7-E challenge pass: the constructor does NOT flatten — `reranker.py:71-72` is `except RerankerUnavailableError: raise`, so the codes raised inside survive, and `:73-74` only wraps foreign faults. The flattening is the bootstrap alone at `main.py:194-195` (and the search path at `:433`), which catches the typed error and writes one literal, discarding the code carried in `str(error)`.
- Evidence: Where: `apps/knowledge/app/reranker.py:71-74` — a typed inner error is re-raised unchanged by the bare raise at `:71-72`, and only an unexpected exception becomes the single unavailable literal at `:73-74`, so the codes raised by the constructor sequence (manifest invalid, contract mismatch, artifact missing, artifact mismatch, graph invalid, graph not dynamic) reach the caller intact · Where the flattening actually happens: `apps/knowledge/app/main.py:194-195` catches every failure of that type without binding the exception and writes one constant · Where it is flattened again: `apps/knowledge/app/main.py:194-195` `except RerankerUnavailableError: reranker_error = "RERANKER_UNAVAILABLE"` · Where it is stored: `:187`, `:197` and a second write at `:220` · Measured: a grep for `reranker_error` across the package returns exactly those four lines, all assignments — no read site · Where the operator looks: the readiness branch at `:263-273` emits its own status literal rather than the stored field.
- Reproduction: static — two fixture failures with different codes produce byte-identical observable state. The fixer test: construct the app with a provenance-mismatch artifact and with a missing artifact, and assert two different code values surface on the readiness payload or the state field the operator consumes.
- Acceptance criteria: the first-attempt failure code is observable to the operator through a read site that a test proves, and a readiness or log line distinguishes an artifact problem from a graph problem; adding logging alone does not close the row while the field stays unread.
- Related findings: F-101, F-307, F-264 · nguồn: R7-E delta audit E1 — Knowledgebase python modules

### F-311 — the atomic-index test's fake connection records no transaction event, so the swap can stop being atomic and the suite stays green

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-E2-01`
- Affected modules: Zink Knowledgebase, Gates + CI
- Severity: High
- Status: OPEN
- Root cause: the test's transaction stand-in enters and exits without recording anything, and the fake connection's call log never receives a marker saying whether a statement ran inside a transaction. Every assertion in the file therefore constrains statement text and ordering only, while the property the module docstring names as the point of the whole suite — the stale, superseded, active and cleanup statements all committing as one unit — is unobservable. Production gets that property from a single line the suite cannot see through.
- Evidence: Where: `apps/knowledge/tests/test_r24_atomic_incremental_index.py:23-28` the transaction class's enter returns itself and its exit returns false, with no state recorded, and `:46-47` the fake connection hands out a fresh instance of it · Where: `:41` and `:49-50` the call log stores only the SQL text and arguments · Where: `:77-78` the fixture pre-satisfies the production ownership guards by assigning a bare pool object and the fake as the owner connection · Where the real control lives: `apps/knowledge/app/database.py:1319` `async with self._mutation_transaction() as connection:` with the guards at `:373-380` · Measured: a grep for transaction-membership assertions across the package's tests returns nothing — the two files defining a fake transaction are the only matches.
- Reproduction: static mutation probe — replace `database.py:1319` with a plain owner-connection acquisition and the whole suite still passes, while a crash between the supersede and the active write can now leave two active indexes. The fixer measurement: make the fake record an open flag that every logged call captures, then assert the four statements carry it.
- Acceptance criteria: the fake transaction is observable (open flag recorded with each call) and a test requires every statement of the incremental swap to have executed inside it, so removing the production transaction context reddens the suite.
- Related findings: F-296, F-221, F-149 · nguồn: R7-E delta audit E2 — Knowledgebase pytest suite

### F-312 — every reranker test constructs the object around its constructor, so the artifact-digest verification is executed by no test and eight failure codes are asserted as one

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-E2-02`
- Affected modules: Zink Knowledgebase, Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: the suite builds instances by allocating the class and hand-assigning the fields the constructor would have produced, which skips the manifest load, the contract check, the artifact digest verification and the session construction ordering entirely. The one production construction site is therefore untested, the sha256 comparison against the deployed model file never runs, and the negative cases assert only the shared exception type, so any of eight distinct codes satisfies them.
- Evidence: Where: `apps/knowledge/tests/test_reranker.py:83`, `:112`, `:133` all use the allocate-without-init idiom and assign the internals by hand · Where the skipped work is: `apps/knowledge/app/reranker.py:44-70` the constructor sequences manifest load, contract verification, `:56` the artifact verification, session build and graph validation · Where nothing tests the digest gate: a grep for the verification method name across the package finds its definition at `:115` and the single call inside the constructor — no test reference · Where the production call is: `apps/knowledge/app/main.py:189` · Measured: a grep for the constructor call across the tracked tree returns that one site and no test, and a probe that replaces the verification method with a no-op leaves the suite at four passed · Where the matcher is too wide: `test_reranker.py:117`, `:124`, `:170` assert only the exception type, while a count of the literals in the module shows eight codes raisable from the constructor: manifest-invalid, provenance-mismatch, artifact-missing, artifact-mismatch, graph-invalid, graph-not-dynamic, onnx-runtime-unavailable and the catch-all. · R7-F (vị trí mới, gộp): `apps/knowledge/tests/test_run_errors.py:10-12` — ca mang tên "model drift is a run-level error" chỉ dựng `SafeRunError("EMBEDDING_MODEL_DRIFT")` rồi `assertIsNone(error.source_path)`: đó là default của constructor, không phải bằng chứng code được đối xử run-level ở bất kỳ call site nào.
- Reproduction: static mutation probe — delete the verification call at `reranker.py:56` and the suite stays green, while a swapped model binary is then accepted at start-up. The fixer test: construct the real class against a tampered artifact directory and assert the mismatch code, plus code-level assertions replacing the three type-only negative cases.
- Acceptance criteria: at least one test drives the constructor rather than bypassing it, and each negative case asserts its own failure code, so removing any single verification step reddens a named case.
- Related findings: F-207, F-309, F-219 · nguồn: R7-E delta audit E2 — Knowledgebase pytest suite

### F-313 — one tests directory is run by two incompatible runners, and the image lane runs it without pytest installed

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-E2-04`
- Affected modules: Zink Knowledgebase, Gates + CI, deployment topology
- Severity: Medium
- Status: LATENT
- Root cause: the CI quality job installs the development group and runs pytest over the directory, while the image's test stage installs with the development group excluded and runs the standard-library test discovery instead. Seven modules in that directory import the test framework at module level and use its module-level skip mechanism, so under the image's environment they cannot be imported at all, and the "report NOT RUN rather than passed" convention those skips implement has no meaning to the other runner. Recorded as LATENT because no tracked lane executes the image stage — the only caller is an acceptance script that itself runs in no gate.
- Evidence: Where: `apps/knowledge/Dockerfile:14` the builder venv is created with the development group and the project both excluded, `:69` the test stage inherits it, and `:77` adds the no-sync flag before running unittest discovery over the copied tests directory, so that stage installs nothing · Where: `package.json:25` the CI command runs pytest over the same directory · Where: `.github/workflows/ci.yml:91-93` the python-quality job syncs the locked development dependencies and `:97-100` runs that command · Measured: `apps/knowledge/pyproject.toml:18-20` lists the framework in the development group only · Measured: an import probe over the directory with the framework made unimportable fails at import for exactly seven of its nineteen test modules and imports the other twelve, and each of the seven performs a module-level skip when the tokenizer fixture is unavailable · Measured: unittest turns those import failures into errors and exits non-zero, so the image stage would fail rather than report success · Where the divergence in coverage is documented: F-237 and F-269 already record that the child package suite runs in no enforced lane · Measured: the only caller of the image stage is `infrastructure/docker/scripts/knowledge-t2.ps1:31-36` and `tests/m3-t2-contract.test.mjs:88-110` reads that script as text only, which is why the row stays LATENT.
- Reproduction: could not run under this round's read-only rules. The measurement a fixer must take first: execute both runners against the directory and compare the collected-test counts and the import errors, then state which runner the release evidence will use.
- Acceptance criteria: exactly one runner is declared authoritative for the directory and an enforced lane asserts the collected-test count from it; if both remain, the image lane must not be able to report success while framework-importing modules failed to load.
- Related findings: F-237, F-269, F-212, F-223 · nguồn: R7-E delta audit E2 — Knowledgebase pytest suite

### F-314 — the readiness attribution test hand-copies five cases and cannot see three mapped branches the route actually emits

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-E2-05`
- Affected modules: Zink Knowledgebase, Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: the case table is a literal list of five fixtures, and the production route has three further mapped outcomes that the list does not and cannot reach: an unavailable-database branch that runs before the try block and echoes a startup code, an opt-out parameter that changes which dependency is required, and two PDF-runtime branches with their own codes. The setup also fixes the availability flag truthy and never varies the opt-out, so a regression that changes any of the three is invisible while the file's own docstring claims those surfaces are covered.
- Evidence: Where: `apps/knowledge/tests/test_b20_readyz_attribution.py:146-170` the five literal tuples and `:171-188` the loop asserting only their status and code · Where the unmapped branches are: `apps/knowledge/app/main.py:252-253` the pre-try unavailable return carrying the startup error code or a default, `:251` the parameter that lets a caller waive the reranker requirement consumed at `:263`, `:326-330` the runtime-error branch echoing the raised code, and `:331-338` the missing-artifact branch emitting its own unavailable code · Measured: a grep across the package tests returns zero hits for the startup-code field, the opt-out parameter and the runtime-unavailable code, and this file is the only test that requests the route · Where the setup fixes the flag: `:68` assigns a bare pool object while `apps/knowledge/app/database.py:177-178` derives availability from that field · Measured: `apps/knowledge/Dockerfile:124` enables the runtime in the shipped image, so the two artifact and probe branches are production-reachable · Counter-evidence measured this session: `tests/m10-t2-r21-skill-chunking-and-text-budgets.test.mjs:154-163` pins the parameter default as source text, so a changed default reddens that gate even though no executed case varies the behaviour · Measured: `:222-240` does exercise the generic handler inside the PDF branch, so four mapped outcomes are blind rather than three.
- Reproduction: static — delete the pre-try unavailable branch or ignore the opt-out parameter and every case still passes. The fixer test: derive the case list from the codes the route can emit, or add one assertion that the emitted-code set and the case set are equal, so a newly mapped branch reddens the file.
- Acceptance criteria: the readiness case matrix is derived from production (or a test asserts the two sets are equal), and the unavailable-database and opt-out branches each have an executed case.
- Related findings: F-214, F-310, F-240 · nguồn: R7-E delta audit E2 — Knowledgebase pytest suite

### F-315 — the migration-digest guard reconciles only manifest-to-disk, and its own fixture test mandates the blind direction

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-E3-03`
- Affected modules: Zink Knowledgebase, Gates + CI, governance records
- Severity: Medium
- Status: OPEN
- Root cause: the guard walks the entries named in the digest manifest and hashes the file each one points at, so it can detect a listed file changing but never notices a migration file that is absent from the manifest; the manifest has no other reader in the repository, and the suite that owns this invariant asserts as desired behaviour that a new unlisted migration reddens nothing. The consequence is that the control is one-directional by design and the blind direction is pinned green, so the only way to close it is to add the reverse enumeration rather than to weaken anything.
- Evidence: Where: `tests/m12-t2.2-a4-migration-digest.test.mjs:64` iterates `manifest.migrations` and `:123-132` is the only real gate, hashing disk contents for those entries · Where: `:201-213` a fixture writes a fourth migration file and asserts the failure list stays empty, titled as the forward-migration allowance · Where the manifest is consumed: a grep for its filename returns this suite, the contracts document itself and governance notes — no loader in the application · Where the adoption key lives: `apps/knowledge/app/database.py` applies migrations by filename and records the version row, which is the mechanism F-166 records as unreappliable after a lost row · Where the sibling gap is recorded: F-221 notes that only one of the three files is exercised by a real lane.
- Reproduction: static mutation probe — remove one entry from the manifest and rewrite that SQL file freely: both real assertions still pass, because nothing asks whether every file on disk is listed. The fixer test: a case requiring every tracked migration file to appear in the manifest, with a non-empty failure list when one is dropped.
- Acceptance criteria: the guard reconciles in both directions (every listed entry matches disk, and every disk file is listed), and the forward-migration allowance is expressed as an explicit owner decision about how a new file enters the manifest rather than as an absence of checking.
- Related findings: F-166, F-221, F-218 · nguồn: R7-E delta audit E3 — JS test validity, first half

### F-316 — the specialist-provenance rule's claimed-active allow branch is exercised only as a denial, so deleting the branch changes nothing

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-E3-04`
- Affected modules: OpenClaw governance plugin, Zink Tools, Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: the state matrix in the suite is written out by hand with literal status strings rather than derived from the production vocabulary, and although the rule admits three situations, the fixtures only ever present two of them as allowed. The third — a task still in the active state that has already been claimed — appears in the table exclusively as a denial built without the claim field, so the clause that makes it allowed is never exercised and the suite cannot tell whether it exists.
- Evidence: Where: `integrations/openclaw/plugins/zink-governance/index.mjs:717-719` — the executing test is the OR of the two in-flight statuses plus the claimed-active clause · Where the cases are: `tests/m12-t1-result-preview-and-ownership.test.mjs:205-244` — the positives use the in-flight statuses, and the only ACTIVE entry at `:239-244` supplies no claim timestamp and expects the ACTIVE denial · Measured: a grep for the evaluated function across the repository returns six lines, the production definition, its one guarded call at index.mjs:8164, and this suite's import plus three call sites, so no other suite covers the branch · Where the state is produced: `integrations/openclaw/topology/lib/workflow.mjs:863-875` — the claim transition requires the queued pre-state and writes the executing status in the same event, while the only active-status writer is the open transition at `:381`, so no repository event produces an active task carrying a claim timestamp
- Reproduction: static mutation probe — deleting the claimed-active clause leaves both positive cases green because they satisfy the in-flight OR, and the ACTIVE table entry still denies for the absent claim, so all 14 assertions in the two P4 cases keep their outcome (the file holds 24 assertions across 8 cases); the clause is additionally unreachable through the production reducer, so the branch is dead code rather than only untested. The fixer test: one case with an active status and a claim timestamp asserting the allowed outcome, and the state set imported from production instead of retyped.
- Acceptance criteria: the branch has an executed positive case that reddens when the clause is removed, and the status matrix is derived from the production vocabulary or asserted equal to it.
- Related findings: F-193, F-298, F-240 · nguồn: R7-E delta audit E3 — JS test validity, first half

### F-317 — a file-wide occurrence count is asserted as per-list membership, with a failure message describing a condition the assertion cannot evaluate

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-E3-06`
- Affected modules: Workflow topology + ledger, Gates + CI
- Severity: Low
- Status: OPEN
- Root cause: the assertion splits a source file on a marker and requires the count to be two, with a message stating the entry must appear in the preflight list and the apply list. A count cannot bind membership to either list: two copies inside one window satisfy it while the other window is empty. The row is graded Low rather than Medium because a sibling suite does bind the same structure positionally and would catch the regression; what this assertion adds is a reword-sensitive gate, not coverage.
- Evidence: Where: `tests/m10-t2-r8-observability-predecessor.test.mjs:99-111` the count comparison and the preflight-versus-apply failure message, and the same shape at `:113-130`, whose membership check is a file-wide includes plus a split count · Where the two real lists are: `integrations/openclaw/configure.mjs:1286-1530` the preflight predecessor array and `:1631-1797` the apply array, with the candidate digest at `:1359` and `:1731` and the baseline digest at `:1472` and `:1703` · Measured: re-running the sibling's window-slice predicate in node prints preflight 1286-1530 with 40 digests and apply 1631-1797 with 40 digests, each R8 digest present once per window and no digest missing from apply · The structural sibling that does bind: `tests/m8-t2.10-r13-r7-predecessor-allowlist.test.mjs:867-900`, while its own count case at `:850-864` shares the weak idiom. · corrected by the R7-E challenge pass (measured at HEAD): the two real lists are `integrations/openclaw/configure.mjs:1280-1531` (array literal 1286-1530, R5 digest at `:1472`) and `:1625-1798` (`materializeOwnedFile`, array 1631-1797, R5 digest at `:1703`); measured occurrences are `0fb628e8` × 2 (`:1472`, `:1703`) and `6a7968b7` × 2 (`:1359`, `:1731`). The sibling `tests/m8-t2.10-r13-r7-predecessor-allowlist.test.mjs:867-900` binds preflight ⊆ apply in one direction only.
- Reproduction: static — place both entries in the preflight window and empty the apply window: the count stays two and the assertion passes. The fixer change: use the sibling's two-window slice and assert set containment per window, so the case is falsifiable in exactly the way the message describes.
- Acceptance criteria: the assertion evaluates membership per window rather than a file-wide count, and both-entries-in-one-window reddens it.
- Related findings: F-218, F-213 (the same file's historical-object dependency), F-214 · nguồn: R7-E delta audit E3 — JS test validity, first half

### F-318 — the heartbeat exemption case passes the hook's arguments to a map lookup, so the handler is never invoked and both assertions are structural

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-E4-01`
- Affected modules: OpenClaw governance plugin, Zink Tools, Gates + CI
- Severity: Low
- Status: OPEN
- Root cause: the suite resolves the handler with a single-argument map lookup and passes the intended call arguments as extra lookup keys, so it receives the function itself rather than its result. Awaiting a plain function yields the function, the property the assertion inspects is therefore absent by construction, and the ledger check that follows proves nothing beyond the fact that nothing ran. The case that names the production exemption is the one case that never reaches it.
- Evidence: Where: `tests/m8-t2.7-r10-heartbeat-trigger.test.mjs:376-391` — the call is a Map lookup given the intended handler arguments as extra keys, so it receives the handler itself, followed by an equality on the awaited value's context property and a snapshot task-count check · Where the map is built: `:123` and `:130` — hooks is a plain Map keyed by hook name, so the additional arguments are ignored · The same file's correct idiom: `:348` invokes the resolved handler, while `integrations/openclaw/plugins/zink-governance/index.mjs:7750-7765` is the only path that returns the inspected property and `:7775` is the heartbeat exemption the case never reaches · The correct idiom elsewhere, measured: `tests/m8-t2.5-r7-remediation.test.mjs:370` and `tests/m8-t2.16-r19-promptbuild-liveness.test.mjs:173`, with 32 such call sites across the tests directory · Measured: a grep for the lookup-with-arguments form across the tests directory returns exactly this one site, and a probe of the same Map shape prints the awaited value as a function with the inspected property undefined. · corrected by the R7-E challenge pass (measured at HEAD): the bad call is the multiline `hooks.get("before_prompt_build", {}, {…})` at `tests/m8-t2.7-r10-heartbeat-trigger.test.mjs:378-388`, and a repo-wide scan for `hooks.get("<event>", {` returns that site alone. The production exemption it names IS covered elsewhere by the correct-idiom twin `tests/m8-t2.5-r7-remediation.test.mjs:368-378`, so the harm is one duplicate no-op case whose two assertions cannot redden — not an unguarded exemption.
- Reproduction: static mutation probe — remove the heartbeat early-return from the production prompt-build hook and the case still passes, because the hook never executed; the durable-state assertion likewise passes with any handler. The fixer test: invoke the resolved handler and assert both the exemption result for a heartbeat and a real context string for a governed run, so deleting the early-return reddens the governed case.
- Acceptance criteria: the case calls the resolved hook and asserts an outcome the handler produced, and it fails when the production exemption is removed.
- Related findings: F-300, F-299, F-219 · nguồn: R7-E delta audit E4 — JS test validity, second half

### F-319 — the cross-agent quota-leak assertion searches a JSON string for a quoted number, a form the payload can never contain

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-E4-02`
- Affected modules: Zink Tools, OpenClaw governance plugin, Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: the confidentiality check serialises the receipt and looks for another agent's percentage as a quoted string, but the field is numeric in both the producer and the assertion two lines above, so JSON emits it unquoted. The condition is unfalsifiable: the guard the test names can be widened to return aggregate data and the check still reports clean, while the per-agent identity assertions continue to hold because they inspect only the caller's own identifier.
- Evidence: Where: `tests/m7-t3-run-model.test.mjs:374-386` — membership over the stringified receipt in the quoted numeric form · Where the field is numeric: `:376` asserts the value equals a number, `integrations/openclaw/lib/quota-telemetry.mjs:150-161` emits it from a snapshot the normaliser at `:68-71` constrains to a finite percentage, and the three field hits across the integration are two assignments (`quota-telemetry.mjs:156`, `index.mjs:3267`) and one read (`quota-telemetry.mjs:235`) · Where the read is supposed to be self-scoped: `integrations/openclaw/lib/quota-telemetry.mjs:131-190` the self-read and receipt builders, reached through `integrations/openclaw/topology/lib/native-boundary.mjs:314-324` and the guard function at `integrations/openclaw/topology/lib/guard.mjs:772-776` · Measured: a probe against the real module prints the caller's receipt with the percentage unquoted, the quoted-form pattern false for the caller's own value and for a widened receipt that adds the other agents' percentages as numeric fields, and the caller's own value still pinned by the earlier equality · corrected by the R7-E challenge pass (measured at HEAD): the guard is `integrations/openclaw/topology/lib/guard.mjs:772-776`, not `native-boundary.mjs` — that file is 637 lines, so `:772-776` cannot exist in it — and it is reached from `native-boundary.mjs:314-324`.
- Reproduction: static mutation probe — have the self-read path add other agents' snapshots to the receipt as numeric fields; the equality on the caller's own percentage still holds and the absence check still reports clean, because the pattern it searches is a form the payload type cannot produce. The fixer test: assert the receipt against a constructed single-agent expectation, or scan for the other agents' identifiers, so a widened reader reddens the case.
- Acceptance criteria: the leak assertion is falsifiable against a widened reader, and the receipt is checked for the absence of other agents by identifier rather than by a string form the data type cannot produce.
- Related findings: F-219, F-240, F-110 · nguồn: R7-E delta audit E4 — JS test validity, second half

### F-320 — six differently named n8n refusals are all proven by one flattened constant, so no case shows its titled rule firing

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-E4-03`
- Affected modules: Workflow topology + ledger, Zink Tools, Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: the boundary's refusal helper returns the same operator-facing sentence for every canonical reason code and sends the code only to the diagnostic stream. Five of the six cases in the live-gate lane assert equality with that sentence and the sixth asserts only that the call is blocked, so no case in that lane can show which guard fired: any block satisfies all five, and removing a check named in a case's title lets a different guard produce the same string.
- Evidence: Where: `integrations/openclaw/topology/lib/native-boundary.mjs:23` the single refusal-text constant and `:153-170` the refusal helper, which logs the canonical code to the error stream and returns block true with the constant · Where the cases are: `tests/m7-lane-i-n8n-live-path.test.mjs:307-325`, `:327-344`, `:346-366`, `:368-394`, `:411-430` — five asserting the reason equals that constant — while the root-session case at `:396-409` asserts only that the call is blocked · Where the same rules are proven at the decision level in the same file: `:193-212`, `:214-236`, `:238-277` assert the distinct canonical codes but never drive the installed gate · Measured: a grep for the constant across the tests directory returns 5 files · Where the code channel is already asserted behaviourally: `tests/m10-t2-r8-governance-error-isolation.test.mjs:186-202` captures the diagnostic stream and matches a canonical code, whereas `tests/m8-t2.6-r8-asset-provenance.test.mjs:112-127` and `:130-149` pin the constant and the helper as source text · Where a deletion still blocks: the approval binding in the plugin's n8n branch at `integrations/openclaw/plugins/zink-governance/index.mjs:6509-6534` is repeated by the canonical seam at `integrations/openclaw/topology/lib/guard.mjs:1834-1852` · corrected by the R7-E challenge pass (measured at HEAD): `tests/m8-t2.6-r11-boundary-diagnostics.test.mjs` DOES NOT EXIST (`git ls-files tests` returns only `m8-t2.6-r8-asset-provenance.test.mjs` for that prefix). The source-text pin is `tests/m8-t2.6-r8-asset-provenance.test.mjs:130-148`, and the code channel is asserted behaviourally at `tests/m10-t2-r8-governance-error-isolation.test.mjs:186-200`, which narrows this row's claim that no case shows its titled rule firing.
- Reproduction: static mutation probe — delete the approval-binding requirement from the n8n branch of the tool guard: the canonical seam binds the approval again, so the call stays blocked, the refusal string is unchanged, and the lane case titled for approval binding still passes; the same holds for any single check whose removal leaves another guard on the path.
- Acceptance criteria: each named refusal asserts its own canonical code from the diagnostic channel, and the flattened sentence stays as the operator-facing text it is documented to be.
- Related findings: F-207, F-219, F-321 · nguồn: R7-E delta audit E4 — JS test validity, second half

### F-321 — the canonical-versus-live SQL agreement matrix compares the validator against itself, because the live seam is a wrapper around the same module

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-E4-04`
- Affected modules: Zink Tools, OpenClaw governance plugin, Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: the lane header states that asserting every case against both the canonical validator and the live seam means the two can never diverge, but the seam lazily loads the same repository module the test imports, so the agreement step is one function compared with a copy of itself and can only redden if the wrapper's own mapping breaks. The rest of the lane is a live oracle — each case is also pinned against a literal reason code — so what the lane genuinely cannot do is detect divergence between the repository validator and a materialised packaged copy, and nothing in it routes through the guard branch that consumes the verdict.
- Evidence: Where: `integrations/openclaw/plugins/zink-governance/index.mjs:781-795` — the seam lazily loads `zink-tools/sql/validator.mjs`, calls the same validateSqlQuery binding and maps the thrown message to reason · Where both specifiers resolve to one file: `tests/m7-lane-h4-sql-safety-matrix.test.mjs:3-7`, with the never-diverge claim written at `:9-15` · Where the comparison happens: `:106-128` — seam verdict against canonical outcome at `:114-118`, literal reason codes still asserted at `:120-125` · Measured: running the lane at HEAD prints tests 5, pass 5, fail 0; a node probe prints one identical resolved URL for both specifiers; counting the two case tables gives 18 admitted entries and 31 refused entries · Where the verdict must be honoured: the plugin guard branch for the sql tool at `index.mjs:6391-6401`, inside the hook registered at `index.mjs:6146`, which no suite reaches — the seam is called directly only in this lane, `tests/m7-lane-b-ingress.test.mjs:196` and `tests/m7-lane-h5-persistence-deps.test.mjs:225-227`, and no test file imports both registerTools and resolveGovernance.
- Reproduction: static mutation probe — change one canonical reason code and the literal assertions at `:120-125` redden; instead reduce the seam wrapper to always return ok true, or drop the guard branch's use of the returned verdict, and the agreement step stays green because the seam is the module the test imports. The fixer test: drive the seam through a materialised packaged copy (the idiom already used at `tests/m8-t2.16-r19-promptbuild-liveness.test.mjs`) or through the registered guard hook, and assert a block decision carrying the canonical reason.
- Acceptance criteria: the agreement assertion compares two artefacts that can differ — the installed extension's copy versus the repository validator — and a divergence in the guard's consumption of the verdict reddens the lane.
- Related findings: F-320, F-240, F-105 · nguồn: R7-E delta audit E4 — JS test validity, second half

### F-322 — the contract byte-integrity lane regenerates the manifest it is comparing, so editing any tool contract reddens nothing

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-E5-02`
- Affected modules: Zink Tools, Workflow topology + ledger, Gates + CI, governance records
- Severity: Medium
- Status: OPEN
- Root cause: the verification helper takes a manifest parameter that defaults to a freshly generated manifest built from the same files it is about to hash, and both callers in the enforced lanes pass that generated value. Completeness is checked properly against the canonical name lists, but every hash comparison is then disk-versus-disk inside one process, so the only property demonstrated is that hashing is deterministic. No lane compares the repository's contracts against a committed expectation.
- Evidence: Where: `integrations/openclaw/topology/lib/schema.mjs:415-429` — the default argument, the comment justifying the completeness sweep, and the canonical-list checks · Where the comparison is self-referential: `:430-457` re-reads each file, hashes it and compares to the entry produced by the same call · Where it is called that way: `tests/m7-lane-h5-persistence-deps.test.mjs:157-166` generates a manifest, asserts it verifies, then tampers the in-memory copy to prove the mismatch branch fires · and `tests/m12-t2.2-b9-manifest-completeness.test.mjs:43-45` the same pattern · Measured consequence: changing a numeric ceiling in a tool contract (for example the forecast horizon maximum or the simulation iterations maximum) leaves both suites green.
- Reproduction: static mutation probe — edit a ceiling value in any canonical tool contract file and run the two lanes: the generated manifest changes with the file and the comparison still passes. The fixer test: compare against a committed expectation (a pinned manifest checksum asserted to match the repository state), with an explicit, owner-visible step for legitimately updating it.
- Acceptance criteria: an enforced lane fails when a contract's bytes change without the pinned expectation being updated in the same commit, and the self-generated comparison remains only as a unit test of the mismatch branch.
- Related findings: F-252, F-275, F-315 · nguồn: R7-E delta audit E5 — remaining orphan files

### F-323 — the byte-identical acceptance pair is pinned only against each other, and one driver pins the embedding model while the other inherits the operator's

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R7-E5-04`
- Affected modules: deployment topology, Zink Knowledgebase, Gates + CI
- Severity: Low
- Status: LATENT
- Root cause: the two acceptance overlays are held identical by a text-equality test, which is the only cross-check between them, and the divergence that matters sits outside the compared bytes: the third driver sets the embedding model in the shell before composing, the fourth leaves it to the env file, and neither overlay carries the value. Two acceptance runs can therefore resolve different embedding models while their compose files are provably identical, and the byte gate cannot see it because it compares files, not resolutions.
- Evidence: Where: `infrastructure/docker/scripts/knowledge-t3.ps1:20` saves the prior value, `:100` assigns the model explicitly and `:175-176` restores it · Measured: a case-insensitive grep for that variable across `infrastructure/docker` returns the assignment in the third driver only, and the save-and-restore lines are the third driver's alone — the fifth driver's cleanup at `infrastructure/docker/scripts/knowledge-t5.ps1:283-285` clears the run id, the acceptance vault root and the image revision · Where the substitution defaults: `infrastructure/docker/compose/compose.core.yml:150` with dimensions fixed at `:149`, and every driver composes through an explicit env file at `knowledge-t3.ps1:24`, `knowledge-t4.ps1:23` and `knowledge-t5.ps1:33`, so the fourth driver resolves the value from the operator env file while the third overrides it in the shell · Where the byte check lives: `tests/m12-t2.2-b15-compose-equivalence.test.mjs:33-43`, and a grep for the two overlay names across the tests directory returns that file only · Measured: the two overlays compare byte-identical at HEAD and that lane prints tests 2, pass 2, fail 0 · Why the dimensions matter: the fourth driver builds 1024-element probe vectors at `infrastructure/docker/scripts/knowledge-t4.ps1:54` and `:235` and asserts the hnsw index at `:55-56` and `:86-87`, while the first driver asserts the 1024 length at `infrastructure/docker/scripts/knowledge-t1.ps1:128` and the fifth at `infrastructure/docker/scripts/knowledge-t5-common.ps1:327` and `:342` — a wrong-dimension model is caught by three acceptance runs, not by one.
- Reproduction: static — nothing in the enforced lanes resolves the composed environment, and the operator env file was deliberately not opened under this round's rules, so whether the current host carries an overriding value is unmeasured. The fixer measurement: compose the fourth driver's stack and print the resolved embedding model next to the dimension the first and fifth drivers assert.
- Acceptance criteria: either both drivers pin the model the dimensions were designed for, or the overlays carry it explicitly, and one lane asserts the resolved value rather than only the file bytes. This does not ask to widen the byte-equality test, which is doing its stated job.
- Related findings: F-288, F-262, F-223 · nguồn: R7-E delta audit E5 — remaining orphan files

### F-324 — the router placeholder convention is enforced in a helper that six suites bypass, and one of them spawns a generator with the inherited environment

- Category: F2 — Security & Authorization
- Legacy register id: `R7-E5-05`
- Affected modules: Gates + CI, Zink Tools, OpenClaw governance plugin
- Severity: Low
- Status: REFUTED — premise measured dead 2026-10-18 by this session's own challenge pass: no generator is spawned and no router consumer runs in the named suites. `buildConfig` call count measured 0 in all six files that pre-set the variables (`tests/m12-t2.2-m1-live-reachability.test.mjs:22-24`, `-a1:14`, `-a2:24`, `-a3:20`, `-k1:17`, `tests/m10-t2-r14-review-defects.test.mjs:5`); the m1 suite only spawns `git archive`/`tar` at `:98-107` before importing `governancePluginFiles` at `:109-114`, which reads no `ZINK_ROUTER_*`; the only consumers are `integrations/openclaw/lib/policy.mjs:1292` and `:1309` inside `buildConfig` (`:788`). What survives is a convention-consistency observation about `||=` seeding, which is not an F2 defect. (was: LATENT)
- Root cause: the shared test helper assigns the three router variables, which is the documented way to keep real values out of test lanes, while six suites pre-set the same variables with the nullish-assignment operator, preserving whatever the invoking host exported. The divergence is real but its stated route is not: none of the six runs the deployment generator — the only child processes the reachability suite spawns are git archive and tar — so on today's tree the bypass keeps a host value inside the test process instead of carrying it into a generated fixture, and the live exposure is a lane addressing the operator's real router endpoint rather than the non-routable placeholder.
- Evidence: Where: `tests/helpers/router-env.mjs:21-36` — plain assignment of all three variables at `:27-29` and the restore closure at `:30-35` · Measured bypass population, six suites: `tests/m12-t2.2-m1-live-reachability.test.mjs:22-24`, `tests/m12-t2.2-a1-stack-authority.test.mjs:14-16`, `tests/m12-t2.2-a2-stack-registry.test.mjs:24-26`, `tests/m12-t2.2-a3-queue-writer-lock.test.mjs:20-22`, `tests/m12-t2.2-k1-announce-discard-reason.test.mjs:17-19` and `tests/m10-t2-r14-review-defects.test.mjs:5-7` · Where the generator convention lives: `tests/m10-t2-r3-asset-predecessor.test.mjs:187-194` supplies the placeholder constants into the child env for the spawn at `:195-200`, and the boundary, authority, provenance and allowlist predecessor suites import the same constants · Measured: no bypassing suite spawns the generator — the reachability suite only reads its source text at `tests/m12-t2.2-m1-live-reachability.test.mjs:38` after resolving the path at `:36`, and its child processes are git archive and tar at `:98-107` · Measured consequence: that suite prints tests 4, pass 3, fail 0, skipped 1 both at baseline and with a sentinel exported for the credential variable, and an in-process build through the packaged-asset builder reports the sentinel absent from the generated entrypoint and from all 34 assets.
- Reproduction: the measurement this row said it could not run was run: a sentinel exported for one of the three variables leaves the single suite at the same counts and never reaches the generated config, so the credential-into-fixture route is not reproducible today. The surviving measurement: assert at the head of each bypassing suite that the value it sees equals the documented placeholder, which is exactly what a host-exported router host would violate.
- Acceptance criteria: one policy for all suites — either every lane that can build the deployed config calls the helper that forces placeholders, or the suites that keep the preserving form assert that the values they see are the documented placeholders; no lane may write a real credential into a fixture or print one.
- Related findings: F-264, F-103, F-023 · nguồn: R7-E delta audit E5 — remaining orphan files

### F-325 — the vault scanner's link and junction gate reports "no link" when it cannot read metadata, so an unreadable component is indexed rather than refused

- Category: F2 — Security & Authorization
- Legacy register id: `R7-E1-05`
- Affected modules: Zink Knowledgebase
- Severity: Medium
- Status: LATENT
- Root cause: both link-detection helpers treat an OS error while stating a path component as a clean result — the exception arm returns false, the same value as "checked, and there is no link". Nothing downstream distinguishes the two, so a component whose metadata cannot be read is admitted, indexed, and given provenance attributed to the link path. Escaping the vault root is still caught by the separate resolve-and-contain check, which is why the row is LATENT rather than an open exposure: the reachable harm is an intra-vault junction whose content is attributed to the wrong source.
- Evidence: Where: `apps/knowledge/app/markdown_adapter.py:443-452` — the component walk with its OSError arm returning false at `:451-452` · Where the second arm is: `:321-331` — the entry check reads `entry.stat` without following at `:329` and returns false from its OSError arm at `:330-331` · Where the checks are used: the discovery walk at `:288-319`, whose link test at `:305` decides whether a path becomes a candidate, and the documented rejection at `:920`, with the same code declared in the precedence list at `:91` · Compensating control measured so the row is not overstated: `:357-361` resolves the candidate strictly and re-checks containment against the vault root · Measured on this host with a real intra-vault junction: unpatched the candidate is refused with the link-not-allowed code; with the metadata call for the junction component made to raise, the walk at `:305` returns the link path as a candidate with no errors, the resolve-and-contain step at `:357-361` still passes, and validation proceeds to the content parser — so nothing on the link path refuses it, and the attribution the row describes comes from `:349` and the source built at `:430-441`.
- Reproduction: static — a candidate under a directory whose `lstat` raises `PermissionError` (or a reparse point the host refuses to describe) is returned without an error, so the file is indexed and its `sha256` and line positions are attributed to the link path. The measurement that decides live reachability must be taken on the host that carries the vault, under this round's read-only rules it was not taken. The fixer test: patch the metadata call to raise and assert the scanner emits the link-not-allowed or read-failed code rather than accepting.
- Acceptance criteria: an unreadable path component yields a source-attributed refusal, never acceptance, and the two helpers distinguish "no link" from "cannot tell" instead of collapsing them into a false return.
- Related findings: F-055 (the validated-path versus opened-path topology in the same module), F-308, F-101 · nguồn: R7-E delta audit E1 — Knowledgebase python modules

### F-326 — the heartbeat sentinel's second context field is production-reachable but no test ever supplies it, so deleting that disjunct keeps every lane green

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-F1-01`
- Affected modules: Zink Tools, Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: the pure-liveness exemption accepts the sentinel from either of two context fields, while the single near-miss case that names the second field overrides the first one instead — so the branch it advertises is never entered, the entry duplicates the plain no-sentinel case, and its negative assertion is satisfied trivially rather than by reaching the branch.
- Evidence: Where: `integrations/openclaw/plugins/zink-governance/index.mjs:4469-4472` — the return admits the sentinel from either transcriptPrompt or prompt · Where: `tests/m8-t2.14-r17-runend-heartbeat-parity.test.mjs:117` — the entry labelled "sentinel only on prompt" is `{ transcriptPrompt: "hello" }`; prompt is never set, and :116 already carries the identical no-sentinel shape, while the loop starting at :119 asserts the exemption does not apply · Measured 2026-10-18: a grep for a sentinel supplied through prompt across every file under `tests/` returned zero hits, and exactly nine files mention the heartbeat sentinel (r4:535, r5:675, verdict-matrix:205, r16:918, r17:34, r18:64, r19:82, r7:75, r10:50), all of them through transcriptPrompt only; the three remaining SENTINEL strings in the tree (m3-t5-contract:277, m7-lane-h2:460, m7-t2-openclaw:1257) are unrelated vault and corruption markers · No test anywhere reads or pins the second disjunct: a grep for context.prompt across `tests/` returned zero hits, so deleting index.mjs:4471 keeps every lane green · The exemption itself is documented at `index.mjs:4427`.
- Reproduction: static — delete the `context.prompt === HEARTBEAT_LIVENESS_SENTINEL` disjunct at `index.mjs:4471`: every lane stays green, because no case ever supplies the sentinel through `prompt` and the one case that names that shape asserts `false`, which a missing disjunct satisfies without executing it.
- Acceptance criteria: one near-miss entry passes `{ transcriptPrompt: undefined, prompt: SENTINEL }` and asserts the exemption applies, and a companion entry keeps the sentinel off both fields and asserts it does not — so the disjunct has a producer and a negative.
- Related findings: F-300, F-240, F-318 · nguồn: R7-F delta audit F1 — the 12 uncited test lanes

### F-327 — the lane that proves each run resolves its own task pins the approved half only as absence of one code, so the stale-task symptoms it exists to disprove pass

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-F1-02`
- Affected modules: Zink Tools, Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: the harness folds thrown errors and refusal codes into one channel and the approved assertion excludes exactly one code, so any other diagnostic — including the two the guard raises when a task cannot be resolved — satisfies it; the guard's real approved outcome is a boolean allow, and this file never reads it for the approved run.
- Evidence: Where: `tests/m10-t2-r11-run-identity-resolution.test.mjs:170-172` — `return { allow: d?.allow === true, reason: d?.reason ?? null }` and, in the catch, `return { allow: false, threw: error?.message ?? String(error) }` · Where: `:198-203` — the approved run asserts only `assert.notEqual(approved.reason ?? approved.threw, "AUTH_APPROVAL_REQUIRED")`, and the comment at `:195-197` states that "whatever later verdict it reaches is not this test's concern" · Where: `integrations/openclaw/topology/lib/guard.mjs:813` (`MISSING_PREREQUISITE`) and `guard.mjs:668` (`EXECUTION_STATE_UNKNOWN`) both pass that assertion while meaning the task was never resolved · Where: the approval path returns `allow: true` at `guard.mjs:1539-1543`, never read here · Where: `:213` comments "Cases 4-5" but supplies one call.
- Reproduction: static — change run→task resolution so the approved run falls back to an unknown task and throws `EXECUTION_STATE_UNKNOWN`; `assert.notEqual` still holds and the R11 lane stays green, which is exactly the symptom the file header at `:4-9` says this suite exists to disprove.
- Acceptance criteria: the approved case asserts `approved.allow === true` rather than the absence of one other code, and each negative case asserts the named code instead of a disjunction.
- Related findings: F-207, F-300, F-319 · nguồn: R7-F delta audit F1

### F-328 — the preflight-ingress lane never awaits the async harness it built, so the denial branch its own docstring advertises is unobservable in every case

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-F1-03`
- Affected modules: Zink Tools, Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: the harness is async and awaits the injected function internally, but each test calls it bare and discards the returned promise, and no case supplies the two inputs the gate reads — so the gate's early return is unreachable, and the value the tests would have to inspect is never produced or awaited.
- Evidence: Where: `tests/m10-t2-r8-raw-mention-fallback.test.mjs:37` — runPreflightInjection is async and awaits the built function internally at :54 · Where: the six call sites :102, :122, :140, :156, :173, :189 — measured 2026-10-18: none is preceded by await, and the lane passes 6/6 only because the metadata stash is written synchronously while the gate await is never reached · Where: the gate-entry condition at `integrations/openclaw/topology/lib/native-patch.mjs:418` requires a registered preflight predicate plus a string effectiveRoute.agentId, while resolvedAccountId is read at :421-422 but only null-defaulted, not required — and no case here registers a predicate or passes either input · Where: `tests/m10-t2-r8-raw-mention-fallback.test.mjs:32-35` claims the return null from the gate is observable here the same way it is live — inside this file it never is · Scope measured 2026-10-18: the sibling lane `tests/m10-t2-r8-preflight-intake-seam.test.mjs` awaits the same injection with a stub gate and asserts both the denial (P1 at :89-98) and the Main allow (P4 at :121-124), so the denial semantics are covered suite-wide and this row is a harness/docstring gap confined to the fallback file.
- Reproduction: static — make the gate branch deny unconditionally; the lane stays green because the branch is never entered and the discarded promise is never inspected.
- Acceptance criteria: every case awaits the harness and asserts on the value it resolves to, and at least one case installs a stub gate plus `effectiveRoute.agentId` and asserts the denial reaches the caller.
- Related findings: F-300, F-318, F-194 · nguồn: R7-F delta audit F1

### F-329 — the e2e workflow lane names scenarios its bodies never run, compares a production constant to its own literal, and cites an execution contract that is not in the repository

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-F1-04`
- Affected modules: Zink Tools, Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: three scenario titles promise more than their bodies deliver — a state that is never fed to production, a resend that is a single call with the end state pre-set, and an empty artifact that is only a missing file — and the file's requirement header cites a transient `ACTIVE.md` section as authority while that file is not tracked, so the lane's green says nothing about the behaviours its names claim.
- Evidence: Where: `tests/m8-t2-e2e-workflow.test.mjs:50-51` — `const state1 = TASK_STATES.PREFLIGHT;` then `assert.equal(state1, "PREFLIGHT")`; PREFLIGHT is never passed to any function, so only the assertion text can falsify it · Where: `:292-303` — `"Scenario 09 & 10: Duplicate actions from Discord resends are rejected"` issues ONE `validateActionAuthority` call with `currentState: TASK_STATES.COMPLETE` hand-set at `:298`; there is no first action and no resend · Where: `:347-354` — `"Scenario 14: Non-existent or empty artifact fails Technical Validation"` passes only `artifactPath: "non_existent_file_path.xlsx"`; the empty-content half appears nowhere in the file, in contrast to `:361` which writes bytes · Where: `:150` cites "Required Failure & Edge Scenarios (ACTIVE.md Section 37)", and `docs/contracts/execution/` contains only `README.md` and `archive/`.
- Reproduction: static — let a zero-byte artifact pass technical validation: this lane stays green because no case supplies an empty artifact, and no test anywhere names the FILE_EMPTY diagnostic (grep count 0 across `tests/`, measured 2026-10-18) · but the resend half is a fidelity gap, not an unobservability one: dropping the terminal-state refusal that rejects a second ACCEPT (`integrations/openclaw/lib/authority.mjs:267`) turns this lane RED at `tests/m8-t2-e2e-workflow.test.mjs:301`, because the one hand-set COMPLETE call does exercise the refusal a resend would hit — what no case does is issue a first action and a second delivery of the same message.
- Acceptance criteria: the resend case issues the action twice and asserts the second refusal; one case writes a zero-byte artifact and asserts its named diagnostic; the PREFLIGHT step is fed to production instead of compared to itself; and the header cites a tracked requirement source.
- Related findings: F-240, F-300, F-135 · nguồn: R7-F delta audit F1

### F-330 — the case that claims to test ids outside both reference registries reads only one of them, and its surviving assertion is sensitive to data it never names

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-F1-05`
- Affected modules: Zink Tools, Gates + CI
- Severity: Low
- Status: OPEN
- Root cause: the case probes one registry's membership and then asserts the resolver's boolean, so the execution registry named in its title is never read, the resolver throw its sibling cases demand is not asserted here, and a change to unrelated registry data reddens the case for a reason it does not describe.
- Evidence: Where: `tests/m12-t2.2-b5-reference-resolvability.test.mjs:39-43` — the case titled for ids outside both registries probes only the topic registry at :41, then the boolean predicate at :42, which wraps the resolver and therefore cannot say which registry refused · Where: `REFERENCE_EXECUTION_CODES` occurs twice in the file, at :5 in the import list and at :20 inside the first case, and never in this case · Where: the sibling cases assert the resolver diagnostic directly at :29 and :35, while this case asserts nothing about it, and the malformed-id case at :45-49 repeats only the same boolean predicate · Where: `zink-tools/common/semantic-contract.mjs:624-629` throws on an unregistered topic code before the execution check at :630-635, so registering topic 99 in the shipped registry reddens :41 although the id is still refused · Measured: `node --test` on the file at HEAD returns 5 pass and 0 fail, and neither shipped registry holds a key 99.
- Reproduction: static — register a topic code `99` in the shipped registry and this case reddens although `99-99-0001` may still be refused for the right reason; conversely, delete the execution-registry check from the resolver and the case stays green.
- Acceptance criteria: the case asserts the resolver's refusal for an id outside BOTH registries (or is split into two cases, one per registry), and each assertion names the registry it is probing.
- Related findings: F-240, F-312 · nguồn: R7-F delta audit F1

### F-331 — an assertion that promises to scan the boundary source for retired codes actually scans a 41-character refusal constant

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R7-F1-06`
- Affected modules: Zink Tools, Gates + CI
- Severity: Low
- Status: OPEN
- Root cause: the comment states the retired codes must not reappear anywhere in the boundary source, but the value under scan is the model-visible refusal constant, and the retired codes do remain in the module the comment names — so the guarantee is both undelivered and false, and the loop that would have caught a leak inspects one string instead of the module or its branches.
- Evidence: Where: `tests/m10-t2-r8-governance-error-isolation.test.mjs:227-229` — `// The historical codes must not reappear anywhere in the boundary source.` followed by `const source = POLICY_REFUSAL_TEXT;` and `assert.equal(source.includes("GOVERNANCE"), false);` · Where: measured this session in `integrations/openclaw/topology/lib/native-boundary.mjs`, the `GOVERNANCE_*` literals are still raised at `:44`, `:134`, `:138`, `:172`, `:179`, `:192`, `:208`, `:222` · Where: cases L1-L3 in the same file cover only the guard-denial and throw paths.
- Reproduction: static — measured: the lane is green at HEAD (`node --test` returns 7 pass and 0 fail), and the scan at `:228-229` can never fail on anything except an edit to the refusal constant itself, because it reads the same 41-character string the `:221-226` loop already read; the source-wide guarantee its comment states is already false by design at the internal raise sites, which the same file's L5 at `:186-202` requires to stay in diagnostics, so no leak case is available here.
- Acceptance criteria: the guarantee is tested where it is claimed — either by scanning the module source or, better, by exercising every refusal branch and asserting no retired code escapes on any channel.
- Related findings: F-218, F-320, F-307 · nguồn: R7-F delta audit F1

### F-332 — the PDF content-identity digest test derives its expected value from the production domain constant, so the persisted lookup key has no independent pin

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R7-F2-01`
- Affected modules: Zink Knowledgebase, Gates + CI
- Severity: Medium
- Status: OPEN
- Root cause: the domain prefix that namespaces the content-identity digest is imported from the module under test and reused to build the expected digest, so the assertion recomputes whatever the constant currently says; nothing in tracked source pins the literal, and the digest it produces is the key that joins persisted `knowledge.pdf_content_builds` rows.
- Evidence: Where: `apps/knowledge/tests/test_pdf_foundation.py:9-17` imports the domain constant from the module under test at :10, and `:38-46` rebuilds the expected digest from that same import · Where: `apps/knowledge/app/pdf_foundation.py:25` is the only tracked source occurrence of the domain bytes and `:70-77` shows the production digest reading that same module global · Where: the digest is the persisted lookup key at `apps/knowledge/app/pdf_pipeline.py:120-127`, its component digests are what the drift branch at `:139-143` compares, and the composite is only compared against itself inside `revalidate_identity` at `:228-238` · Measured: git grep for the domain string returns that one source line plus this register row, and a filesystem grep adds six untracked copies under the Lead's `temp/` and `scratch/` trees; no lane holds a fixed expected content identity — `apps/knowledge/tests/test_pdf_foundation.py:48` compares two computed digests to each other, and a plain grep for a 64-hex literal across `apps/knowledge/tests` returns only the parent lock and project pins in `test_pdf_runtime.py:38-39`.
- Reproduction: static — change the domain bytes to `…:v2`: the test recomputes with the new constant and stays green, while every already-stored content identity silently re-keys (READY builds re-extract and drift checks compare different digests), because no gate holds an independent expectation of the prefix.
- Acceptance criteria: a lane pins the domain literal as data (a golden digest recorded once and asserted verbatim), and any change to it requires a documented, tested migration of the stored identities.
- Related findings: F-240, F-315, F-306 · nguồn: R7-F delta audit F2 — Knowledgebase and configuration remainder

### F-333 — three distinct parent-side PDF build failures are folded into the generic runtime-failure code, and the test that names the specific case pins the generic one

- Category: F1 — Logic & Functional Bugs
- Legacy register id: `R7-F2-02`
- Affected modules: Zink Knowledgebase
- Severity: Medium
- Status: OPEN
- Root cause: the parent pipeline routes a content-identity race, any state-transition error raised during recovery, and an illegal batch status through the same `PDF_RUNTIME_FAILED` code that otherwise means the child runtime died, so an operator cannot distinguish a schema race from a dead child; the suite reinforces the fold by asserting the generic code for a case it titled specifically.
- Evidence: Where: `apps/knowledge/app/pdf_pipeline.py:134-135` — `except PdfContentIdentityExistsError as error: raise PdfBuildError("PDF_RUNTIME_FAILED") from error` · Where: `:155-156` — the identical fold for `StateTransitionError`, which the recovery path raises for states including an incomplete READY manifest · Where: `:171-172` — a non-`PENDING` batch status folds to the same code · Where: `apps/knowledge/tests/test_pdf_pipeline.py:403` — `test_incomplete_ready_manifest_is_rejected` asserts `assertRaisesRegex(PdfBuildError, "PDF_RUNTIME_FAILED")` at `:428` (these two test lines were measured by the round's agent; the Lead re-opened the three production sites and the fold shape).
- Reproduction: static — delete the identity-exists handler at `:134-135` and let the error escape: no assertion anywhere demands a distinct parent-side diagnostic, the lane stays green, and the operator-facing code is unchanged.
- Acceptance criteria: each parent-side failure carries its own code and a test asserts that code by name, and `PDF_RUNTIME_FAILED` is reserved for actual child-runtime failure.
- Related findings: F-283, F-304, F-310, F-312 · nguồn: R7-F delta audit F2 — Knowledgebase and configuration remainder
