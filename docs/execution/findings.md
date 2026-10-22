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
đó). Từ 2026-10-21 (`H10`), `CHANGELOG.md` cũng là nơi lịch sử của **một hàng đã đóng** nằm: file này giữ hàng đợi
đang mở (xem §0.5).

## 0. NỘI QUY — KHỐI NÀY CẤM XÓA

**0.1 Vai trò file.** Đây là danh sách bug cần sửa. Mỗi bug đúng một khối `### F-xxx — <tiêu đề>` với 10 dòng field.
Ngoại trừ khối §0 và §0.4, file không chứa record lịch sử, không chứa proposal cải tiến, không chứa tường thuật phiên
làm việc — mấy thứ đó thuộc `PLAN.md` §8/`CHANGELOG.md`/archive, không thuộc đây. Lịch sử của một hàng đã đóng
cũng thuộc `CHANGELOG.md`, không thuộc đây (xem §0.5).

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
   Trước khi xóa phải ghi disposition vào `PLAN.md` §4.17/§8 **và ghi lịch sử hàng đó vào `CHANGELOG.md`** (id + dòng
   lỗi một dòng + commit đã đóng + bằng chứng) — §2 ở đây không còn là nơi chứa lịch sử, xem §0.5. Thiếu một trong ba → **giữ lại**, đổi `Status:`. Số `F-xxx` đã cấp là **vĩnh viễn**: không đánh số lại, không tái sử dụng — xóa thì để lại khoảng trống, còn §1 đếm số hàng đang sống.
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

**0.5 File này là HÀNG ĐỢI MỞ; lịch sử của một hàng đã đóng nằm ở `CHANGELOG.md`.** Quyết định của
chủ (`H10`, 2026-10-21): _"lỗi nào fix xong và chứng minh được là đã fix thì được phép xóa lỗi đó trong
findings, lịch sử lưu vào changelog"_. Hàng đã fix xong **và đã chứng minh** (test đỏ-trước/xanh-sau, gate của
band không ở trạng thái `NOT RUN`, dòng `Acceptance criteria:` thỏa đúng nghĩa) thì **xóa** khỏi file này;
lịch sử của nó (id + dòng lỗi một dòng + commit đã đóng + bằng chứng) ghi vào `CHANGELOG.md`. Hàng **chưa fix**
thì ở lại: `REFUTED` (premise đo thật là chết — không có gì để fix) và `EXCLUDED` (đang chờ một quyết định
của chủ) không nằm trong quy tắc này. Bảng đóng ở §2 đã bị gỡ khỏi file này: **389** hàng đã đóng nằm ở
`CHANGELOG.md`, mỗi hàng giữ id và commit đã đóng nó.

## 1. hiện trạng queue

Tổng **35** hàng còn nằm trong file, chia theo nhóm. **4 hàng đang mở** (mọi câu trả lời của chủ — `H1`/`H2`/`H3`/`H5`/`H6`/`H8`/`H10` — đã được sửa xong, đã chứng minh và đã xoá khỏi file này theo §0.5), 28 hàng `REFUTED` (premise đo thật là đã chết ở HEAD, kèm bằng chứng đo được trong chính dòng `Status:`) và 3 hàng `EXCLUDED` (quyết định của chủ, hoặc dòng chỉ để đo). **383** hàng đã đóng không nằm ở đây nữa: lịch sử của chúng (id + dòng lỗi một dòng + commit đã đóng) nằm ở `CHANGELOG.md`.

| Nhóm     | Nội dung                                                              | Bug    | Critical | High | Medium | Low | Ungraded |
| -------- | --------------------------------------------------------------------- | ------ | -------- | ---- | ------ | --- | -------- |
| F1       | Logic & Functional Bugs — Lỗi logic, sai chức năng                    | 4      | 0        | 0    | 2      | 1   | 1        |
| F2       | Security & Authorization — Lỗi bảo mật và phân quyền                  | 4      | 0        | 0    | 3      | 1   | 0        |
| F3       | State & Lifecycle Integrity — Lỗi trạng thái và vòng đời              | 5      | 0        | 3    | 2      | 0   | 0        |
| F4       | Integration & Contract Violations — Lỗi tích hợp và vi phạm hợp đồng  | 6      | 0        | 1    | 3      | 2   | 0        |
| F5       | Data Integrity & Result Correctness — Lỗi toàn vẹn dữ liệu và kết quả | 7      | 1        | 1    | 4      | 1   | 0        |
| F6       | Reliability & Performance — Lỗi độ tin cậy và hiệu năng               | 1      | 0        | 1    | 0      | 0   | 0        |
| F7       | Testing & Verification Gaps — Thiếu kiểm thử và xác minh              | 8      | 0        | 2    | 5      | 1   | 0        |
| **Tổng** |                                                                       | **35** | 1        | 8    | 19     | 6   | 1        |

Theo trạng thái: OPEN 4 · EXCLUDED 3 · LATENT 0 · REFUTED 28 · PARTIAL 0 · HYPOTHESIS 0.

Các hàng đã đóng không nằm ở đây nữa: **389** hàng (134 hàng M12/T9 đóng ngày 2026-10-19, 47 hàng lượt đóng đầu của band thứ hai, 120 hàng lượt đóng cuối của band thứ hai, 16 hàng chủ đã phán ngày 2026-10-21, 51 hàng của các band `M12/T2.x` trước đó, 5 hàng của band thứ ba đóng ngày 2026-10-21, 2 hàng của blocker triển khai đóng ngày 2026-10-21, và 1 hàng của band E đóng ngày 2026-10-22, 1 hàng của band A3 đóng ngày 2026-10-22, 2 hàng của band C đóng ngày 2026-10-22, 5 hàng của blocker triển khai lần hai đóng ngày 2026-10-22, 5 hàng của vòng review đóng ngày 2026-10-22) đã chuyển sang `CHANGELOG.md`, mỗi hàng kèm commit đã đóng nó. Ở M12/T9 mỗi hàng có commit riêng trỏ `F-xxx` và legacy id; ba hàng bị gộp chung một commit vì chúng sửa cùng một file và các hunk của chúng phụ thuộc nhau — tách ra sẽ tạo ra một commit không parse được (`F-055`+`F-101`+`F-240`, đo bằng cách dựng lại từng tiền tố của chuỗi commit và kiểm tra `node --check`).

Theo field: đo lại 2026-10-22 trên cả **35** hàng còn lại với predicate "field trống, là placeholder, hoặc ngắn dưới 40 ký tự" — **0** hàng thiếu `Reproduction`, **0** hàng thiếu `Acceptance criteria`, và 0 hàng có một trong hai field ngắn dưới 40 ký tự. Chữ "không tái hiện được" trong hai field đó ở `F-015`, `F-017`, `F-020` là ghi chú verdict của hàng REFUTED, không phải placeholder.

Một hàng còn `Severity: Ungraded`: `F-020` (đã REFUTED nên grade không còn hệ quả). `F-021`, `F-103` và `F-104` đã đóng trong M12/T9 nên không còn nằm ở đây.

Lịch sử các vòng audit và các lượt đối chiếu không nằm ở đây; register chỉ giữ hàng đợi đang mở cộng các số đo dẫn xuất trực tiếp từ nó. Mỗi hàng giữ `Legacy register id` để `PLAN.md` §4.17/§11 tra được về id cũ; **chiều ngược lại không được bảo đảm** — đo 2026-10-19 trên bảy file trong `docs/contracts/execution/archive/`: 89 id được trích, **9** id không khớp hàng nào ở §1 lẫn bảng §2 lúc đó (`R3-P04-03`, `R4-V01-01`, `R6-V03-01`, `R6-V03-02`, `R6-V04-04`, `R6-V05-01`, `R6-V10-01`, `R6-V11-01`, `R16-DRIVER-05`), dù cả chín đều còn trong `PLAN.md`. Lỗ một chiều đó là hàng `F-344`.

File này được tái cấu trúc ngày 2026-10-17 từ register audit sáu vòng. Mỗi hàng giữ `Legacy register id` để
`PLAN.md` §4.17/§11 tra được về id cũ; chiều archive→register có 9 lỗ, đo 2026-10-19, ghi ở `F-344`.

Phủ, đo 2026-10-19 bằng hai predicate trên `git ls-files` (404 file bị track: 300 nguồn + 104 non-source). Nguồn, đo bằng `temp/coverage-probe3.mjs` (suffix-match): **300/300** đã được ít nhất một vòng read-only mở ra, **292/300** có ít nhất một hàng trích path, **8** file còn lại đã đọc và báo không có defect. Cũng population đó, đo bằng predicate chặt hơn — hàng phải mang **đúng path đầy đủ** (`temp/o1-coverage3.mjs`) — thì là **256/300**; hai con số không so sánh được với nhau và không được đặt cạnh nhau như hai lần đo cùng một thứ. Non-source: **62/104** có hàng trích theo predicate chặt; 42 file còn lại là README/`.gitkeep`/fixture đã mở và báo sạch nên không có hàng để trích. Danh sách cụ thể để ở `temp/uncited-files3.txt`, `temp/uncited-source-o1.txt`, `temp/uncited-nonsource-o1.txt` và **không** ghi vào file này, vì token nằm trong §1 sẽ tự bị tính là phủ — chính xác là lỗi khiến bản trước nói 291/300 trong khi số đo theo hàng lúc đó là 284/300. Vòng **R7-O1** (2026-10-19) là vòng đầu đọc toàn bộ 104 file non-source mà mẫu lọc theo phần mở rộng đã bỏ lại ngoài phạm vi các vòng trước. Vòng **R7-IG** (2026-10-19, chín hàng `F-360`–`F-368`) đọc hai quần thể Git-ignored — `backups/` và `.agents/states/` — mà không vòng nào mở ra; vì path của chúng không nằm trong `git ls-files`, vòng này **không** đổi bất kỳ con số phủ nào ở trên, và đó là lý do một vòng audit có thể "xanh về coverage" mà vẫn bỏ sót toàn bộ vùng ghi đè của repo. Vòng **R8-M** (2026-10-19) không đo thêm file nào trong `git ls-files`: nó chạy lại bằng **thực thi** những hàng mà các vòng trước chỉ đọc code — `F-046` (stub `fetch` và endpoint localhost thật), `F-055` (sáu hình thái path trên ext4), `F-143` (vết cắt đuôi journal trong `mkdtemp`), `F-063` (toàn vẹn journal sống), `F-287` và `F-308` (dân số thật) — và ghi hai hàng mới `F-369`–`F-370` về cây runtime đang chạy; vì mọi bằng chứng của ba hàng nguồn đều nằm ở path ngoài repo (thư mục `extensions/`, journal, Vault) nên **không con số phủ nào ở trên đổi**, và `BLOCKED` về 0 ở bảng trạng thái.

## 2. Các hàng còn nằm trong file (hàng đợi mở)

Các hàng `REFUTED`, `EXCLUDED`, `BLOCKED`, `PARTIAL` ở danh sách dưới đây không phải việc chưa làm: `REFUTED` là
premise đo thật là chết (không có gì để fix), `EXCLUDED` là hàng đang chờ một quyết định của chủ. Giữ lại để band sau
không nộp lại một premise đã bị bác hoặc một việc chủ đã gạt: quyết định `H10` (2026-10-21) chỉ cho phép xóa hàng đã
fix xong và đã chứng minh, nên hai loại hàng này ở lại. Dọn chúng khỏi file là quyết định của anh, không của agent.

---

### F-013 — node -e comparing deriveSemanticMetadata({}) with deriveSemanticMetadata({namespace:"general"}) — only resolved_namespaces differs

- Category: F1 — Logic & Functional Bugs
- Legacy register id: `R5-E07-01`
- Affected modules: Zink Skill Store, Zink Tools
- Severity: Medium
- Status: REFUTED — premise measured dead at HEAD: `zink-tools/common/semantic-contract.mjs:205` returns `{ resolved: null, ambiguous: true }` for an empty namespace, so `deriveSemanticMetadata({})` yields the non-canonical domain `AMBIGUOUS`, which `CANONICAL_DOMAINS` (`:9`) does not contain; the adapter refuses any domain outside it and the Skill Store grammar requires `identity.namespace.length >= 1`. The register's reproduction ("only `resolved_namespaces` differs") does not reproduce, and the case is pinned by `tests/m8-t1-skill-vector-memory.test.mjs:541`. (was: OPEN)
- Root cause: the taxonomy gate (B05) is bypassable by omitting input rather than by choosing a bad value — a skill proposed with an empty namespace array is admitted and indexed as general.
- Evidence: Where: semantic-contract.mjs:213-219 (deriveSemanticMetadata), :175; consumer gate skill-adapter.mjs:842 · Evidence: const ambiguous = resolvedNamespaces.length === 0 && nsList.length > 0; / let domain = ambiguous ? "AMBIGUOUS" : "general"; — so with namespace absent or [] the function returns domain/primary_topic/subtopic/ambiguous byte-identical to an explicit namespace:"general", and general satisfies the consumer's CANONICAL_DOMAINS.includes(semanticMeta.domain) gate.
- Reproduction: node -e comparing deriveSemanticMetadata({}) with deriveSemanticMetadata({namespace:"general"}) — only resolved_namespaces differs.
- Acceptance criteria: an empty/absent namespace cannot produce a domain that passes CANONICAL_DOMAINS validation.
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

### F-074 — the sole cross-agent evidence store has no version, no diff history, no CI visibility and no backup

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R5-E12-03`
- Affected modules: Architecture + contracts docs
- Severity: High
- Status: REFUTED — premise measured dead at HEAD: the gate and the assertion already exist — `tests/repository-policy.test.mjs:1081` asserts `git ls-files` lists `docs/execution/findings.md`, and the register is tracked. (was: OPEN)
- Root cause: the sole cross-agent evidence store has no version, no diff history, no CI visibility and no backup; it is simultaneously declared non-authoritative, untracked and mandatory; and the zero-OPEN test cannot be independently executed by a reviewer on another machine. Parallel writers are already interleaving into it — which this session did, six lanes at once.
- Evidence: Where: validating/SKILL.md:103; code-review/SKILL.md:83; .gitignore:57, :61 · Evidence: validating:103 makes the gate depend on findings.md having "zero OPEN findings", while code-review:83 declares the same file "navigation/working-memory aids only; they are never authority". .gitignore:57 ignores it; it is 283,001 bytes and grew mid-audit (12 Status: OPEN on first grep, 24+ minutes later), with concurrent out-of-order appends — R5-E05-03 at :2172 precedes R5-E05-02 at :2192 and R5-E05-01 at :2207. · Detail: this is exactly the R3-P04-08 question the owner has not answered yet, so it is a decision, not a fix.
- Reproduction: Measured on this host before the commit: `git ls-files --error-unmatch docs/execution/findings.md` fails, `git status --porcelain docs/execution/` prints '?? docs/execution/', `git log -- docs/execution/findings.md` is empty and `git check-ignore` exits 1 (not ignored), while .agents/skills/code-review/SKILL.md:122 and validating/SKILL.md:96 assert the register is tracked and permanent. After the closeout commit, `git ls-files` must list it — pin that as an assertion in tests/repository-policy.test.mjs, which already scans tracked files through execFileSync. File measured at 430,703 bytes / 224 rows / 186 OPEN.
- Acceptance criteria: `git ls-files` lists docs/execution/findings.md, so every row edit carries a commit, an author and a diff, an append is reviewable in git show, and the 'tracked, permanent' claim in both skills is literally true. Whether the register may gate a task remains a separate owner decision.
- Related findings: bug mở: R5-E05-03, R5-E05-02, R5-E05-01, R3-P04-08 · nguồn: E12 — skills procedure vs practice (7 findings; the two…

### F-084 — the §3 release-gate cell still records the pre-deployment build, so a reader concludes the deployment never happened

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R1-A09-08`
- Affected modules: Governance records
- Severity: Medium
- Status: REFUTED — premise measured dead at HEAD: the digest claims about the installed build already agree across PLAN.md's §3, §4 and §8 and README.md; the deployed-build digest (`18fbb077…`, Deployment B) is now stated identically in all four. (was: OPEN)
- Root cause: PLAN.md is internally inconsistent — the durable §8 record and §4 header were updated, the §3 milestone cell was not — so any agent that bootstraps from the release-gate table reads the deployment as never having happened. This is the same failure mode as R1-A15-05 and it is what misled the orchestrator earlier in this session.
- Evidence: Detail: live lib/discord-forum-tags.mjs = 18fbb077… while "PLAN records it as e0a755bb… still installed", i.e. the deployed build is not the recorded one.
- Reproduction: Refutation check at HEAD, no live host needed: run `sha256sum integrations/openclaw/lib/discord-forum-tags.mjs` and compare against the digest the §3 release-gate cell records as installed (`PLAN.md:619-621`, `18fbb077…`) and the Deployment B evidence (`PLAN.md:5702-5706`) — they match exactly (`18fbb0774c18d013f599f562810932cfb80c4071c0614376d16f46c30fc256b3`), so the cell records the post-deployment build and a reader concludes the deployment DID happen. Then `grep -n e0a755bb PLAN.md` and verify every hit is a historical record — `:635` (the failed R3b apply), `:5489` (Deployment A's install), `:5548` (the admitted predecessor pin), `:5602`, `:5706` (the rollback counterfactual) — and never a current installed-build claim. No `npm test` suite gates `PLAN.md` content (`scripts/repository-policy.mjs:11` requires only the file's existence), so the gate is this two-command documentation check; the original defect (live `18fbb077…` vs recorded `e0a755bb…`) is not reproducible against the HEAD record.
- Acceptance criteria: every digest claim about the installed build agrees across §3, §4 and §8.
- Related findings: bug mở: R1-A15-05 · nguồn: A09 — Discord and external integrations

### F-090 — rehearsal traffic increments budget counters in live state

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R2-B03-02`
- Affected modules: Repo tooling + deploy scripts
- Severity: Medium
- Status: REFUTED — premise measured dead at HEAD: `integrations/openclaw/topology/fixtures/runtime-regression/live-governance-probe.mjs:33-37` refuses to default to the production root — the state root must be NAMED (env or argv) and a target that IS the production root needs an explicit opt-in. (was: OPEN)
- Root cause: Register kết luận: rehearsal traffic increments budget counters in live state.. Chưa có phân tích root cause riêng — phải đọc `Where:` ở HEAD hiện tại và viết lại nguyên nhân trước khi sửa (nội quy mục 2).
- Evidence: Evidence: live-governance-probe.mjs:241-242 asserts delegated_runs_used === 6, transitions_used === 1 against the production snapshot, so a later audit of real task spend reads rehearsal numbers.
- Reproduction: Static — read `integrations/openclaw/topology/fixtures/runtime-regression/live-governance-probe.mjs`: the production binding at `:25`/`:39` is a hardcoded constant with no `--state-dir` or env override, `openFixture` journals `WORKFLOW_OPENED` into the live ledger at `:94`, and the nested rehearsal performs six real delegated spawns and one stack transition whose budget counters the probe then asserts (`:241-242`) — so the probe can only PASS by incrementing `delegated_runs_used`/`transitions_used` in production state, permanently: the journal is an append-only hash chain with no removal path (`topology/lib/ledger.mjs:526-561`) and the synthetic tasks carry no schema-level rehearsal marker, only conventions (`zink-r12-probe-` session keys `:87`, `"a".repeat(64)` principal `:90`, ``REDACTED`n + BigInt(Date.now())` message ids `:91`). Gate in `tests/m12-t2.2-b4-live-probe-invariants.test.mjs` (the live-probe invariants suite) using the scratch-state harness pattern of `tests/m12-t2-r4-orphan-lock-recovery.test.mjs:49`/`:64-68` (`--state-dir` into a `mkdtempSync` root): assert the probe's ledger target is injectable and that it refuses to `recordWorkflowEvent` against the hardcoded production root — red at HEAD, where neither holds. The live-side count of `zink-r12-probe-` tasks in `/home/hoang_vinh/.openclaw-zink/operator/m7-t2/ledger/snapshot.json` requires the WSL host.
- Acceptance criteria: `live-governance-probe.mjs` runs its rehearsal against a caller-supplied scratch state tree and refuses to start when its ledger target resolves to the hardcoded production root, so `delegated_runs_used === 6` and `transitions_used === 1` at `:241-242` are asserted about a task that exists only in that scratch tree and the production snapshot and journal gain no probe task, no probe event and no probe-incremented counter.
- Related findings: nguồn: B03 — governance / ledger / audit integrity (10 claims…

### F-119 — Cluster A goes RED on landing with no owner approval for that red

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R6-V01-01`
- Affected modules: Gates + CI
- Severity: High
- Status: REFUTED — premise measured dead at HEAD: the archived `docs/contracts/execution/archive/2026-10-15-M12-T2.1-R3.md:235` already excludes 4A.1 with the owner's own answer (`owner answer I1-A`), names the successor (`**T2.2**`) and names the pinned gate it would have had to amend; the successor band carries `### A-5 … (4A.1 / R5-E05-03, High)`; `PLAN.md` records the same exclusion; and the register row for the underlying defect (F-142, legacy `R5-E05-03`) is `Status: REFUTED`. The row's own line numbers are stale — the pinned assertion moved from `:118-119` to `:179-180`. (was: OPEN)
- Root cause: Cluster A goes RED on landing with no owner approval for that red. §4.5 obtained an explicit "G có" for its known-red; 4A.1 has none, so either the executor silently edits a gate assertion (which AGENTS.md §10 treats as weakening an integrity control and §12 does not authorize) or it silently skips the item. Both are exactly the failure mode the whole audit is chasing.
- Evidence: Where: tests/m8-t1-skill-vector-memory.test.mjs:112-119 vs ACTIVE.md §3 (:126) and §4A.1 (:361-368) · Evidence: the suite comments // Empty catalog is valid at :112, then asserts at :118-119 assert.equal(emptyReport.status, "READY") and assert.equal(emptyReport.active_count, 0). The existing gate therefore enshrines the defect 4A.1 exists to remove: the required named refusal makes that state return a refusal code instead of READY, so the assertion must change. m8-t1-skill-vector-memory is a named gate file (ACTIVE.md:686, gate 3's mandatory WSL list), while §3 states Cluster A "adds cases, no existing case deleted".
- Reproduction: read :118 and §4A.1's fix text — they are mutually exclusive.
- Acceptance criteria: M12/T2.1-R3 either records an explicit grant for the gate edit or excludes 4A.1 with its successor named.
- Related findings: nguồn: V01 — Cluster A (4A.1–4A.4): three CONFIRMED, one…

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
- Status: REFUTED — premise measured dead at HEAD: the six mutations the row asks for already exist — `tests/repository-policy.test.mjs:943-976` mutates the pinned `python-quality` job's steps and asserts the policy fails for each. (was: OPEN)
- Root cause: deleting the Node toolchain or the tokenizer checksum step from ci.yml keeps repo:check and CI green — the two guards the workflow's own comment claims exist. checkWorkflowDefinitions (scripts/repository-policy.mjs:584) constrains a step list, not the toolchain the job depends on.
- Evidence: Where: tests/repository-policy.test.mjs:84-95 vs ci.yml:69-100 · Evidence: the golden VALID_CI_WORKFLOW python-quality job is exactly checkout, setup-python, pip install uv, uv sync --locked, npm run test:knowledge, while the real job additionally installs Node 24.15 + npm 12.0.2 and fetches the pinned tokenizer, because ci.yml:65-68 warns that "without this toolchain … npm abort before pytest collects anything". The fixture also omits working-directory.
- Reproduction: Static — the golden `VALID_CI_WORKFLOW` python-quality job (`tests/repository-policy.test.mjs:98-108`) has 5 steps, while the real job (`.github/workflows/ci.yml:52-100`) has 9 and adds `Set up Node.js` plus `Install npm 12.0.2` plus `Verify Node and npm versions` (`:69-80`), `Fetch pinned tokenizer` with `sha256sum --check --strict` (`:84-90`), `working-directory: apps/knowledge` (`:92`) and `KNOWLEDGE_TOKENIZER_PATH` (`:99`); since the fixture contains none of them, no `.replace()` mutation can even express their deletion — `scripts/repository-policy.mjs:359-366` calls `checkToolchainWorkflowJob` for `"quality-gate"` only, and `checkPythonQualityJob` (`:415-497`) requires just pinned `actions/setup-python` (`:436`), `uv sync --locked` ordered before `npm run test:knowledge` (`:445-455`), no `continue-on-error`, and no `pdf-runtime` install. `grep -n tokenizer scripts/repository-policy.mjs` returns nothing, and the only python-quality mutations exercised are job-missing, `continue-on-error` twice, suite-dropped, suite-reordered and pdf-runtime (`tests/repository-policy.test.mjs:345-447`). Add two cases to `tests/repository-policy.test.mjs`: one that feeds `checkWorkflowDefinitions` a python-quality job stripped of the Node toolchain and of the tokenizer fetch and asserts a failure, and one drift case asserting the shipped `.github/workflows/ci.yml` python-quality job still contains both (the `checkGateRegistry` precedent at `:309-318` already reads a shipped governance file directly); both are red today. The tokenizer half is provably CI-green if deleted: seven knowledge modules skip at import when `KNOWLEDGE_TOKENIZER_PATH` is unset (`apps/knowledge/tests/test_main_api.py:13-19`, plus `test_b14_cause_attribution.py:34`, `test_b18_index_run_attribution.py:41`, `test_b20_readyz_attribution.py:35`, `test_m11_api_attribution.py:40`, `test_markdown_adapter.py:30`, `test_r23_obsidian_ingestion.py:45`), so `pytest -q` exits 0, and the digest is bound only to `apps/knowledge/Dockerfile` (`tests/m3-t2-contract.test.mjs:32-39`), never to `ci.yml`.
- Acceptance criteria: `repo:check` fails when the `python-quality` job loses anything the suite depends on: the policy requires the pinned `actions/setup-node` step, the `npm@12.0.2` bootstrap from the runner temp directory and the Node/npm version assertion in that job, requires the pinned tokenizer fetch with its `sha256sum --check --strict` line and `KNOWLEDGE_TOKENIZER_PATH` on the suite step or records an explicit owner decision that the Python attribution gates may be NOT RUN, requires `working-directory: apps/knowledge` on `uv sync --locked`, and the golden `VALID_CI_WORKFLOW` fixture carries all of it, so deleting any of those steps from `ci.yml` turns `npm run repo:check` red.
- Related findings: nguồn: E09 — CI: the gate tier that can print green without…

### F-140 — Independently derived by two lanes; E01's addition is the reachability arithmetic — with limit < 20, ranks limit+1…20 of MAX_RERANK_CANDIDATES = 20 are dropped, and anything past the 40-per-branch SQL cap (database.py:1060, :1079) is…

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R5-E01-06`
- Affected modules: Zink Knowledgebase
- Severity: Low
- Status: REFUTED — premise measured dead at HEAD: `apps/knowledge/app/main.py:658-669` already reports `total_count`, `returned_count`, `has_more` and `candidate_pool_count`, and `:658-665` cites "F-132 and F-140"; the register's claim that the reachability arithmetic is missing does not reproduce. The asserting module (`apps/knowledge/tests/test_m11_api_attribution.py`) is `NOT RUN` on this host — the tokenizer is not provisioned — and runs in the CI lane. (was: OPEN)
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

### F-158 — a missing or unparseable governance manifest surfaces as a raw filesystem error, not a denial

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R1-A04-07`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: Medium
- Status: REFUTED — premise measured dead at HEAD: `readGovernanceManifests` in the plugin throws `GOVERNANCE_DEPENDENCY_MISSING` and `integrations/openclaw/topology/lib/runtime.mjs` `loadReasonPolicy` throws `REASON_POLICY_UNREADABLE` / `_MALFORMED`; the shipped case "M12/T9 F-158: a missing or unparseable governance manifest is a canonical denial" is green. (was: OPEN)
- Root cause: ENOENT/SyntaxError escapes to the host and, per the run-end seam, is re-attributed as a model failure; a module-level load failure takes the whole plugin down. Unknown governance_version rows do fail correctly (GOVERNANCE_HASH_MISMATCH), so only file-level failure is mis-shaped.
- Evidence: Where: index.mjs:4865-4872 (manifestFor), consumed by guard.mjs:928-936, :7212; runtime.mjs:11 module-level matrix load
- Reproduction: Read index.mjs:4865-4872: manifestFor parses the mapping with JSON.parse(readFileSync(…)) and no try/catch, so a missing manifest raises ENOENT and a corrupt one SyntaxError; both escape to the host, where the run-end seam re-attributes them as a model failure, and runtime.mjs:11 loads the reason matrix at module level so that failure takes the whole plugin down. guard.mjs:928-936 and :7212 consume the result, and unknown governance_version rows already fail correctly with GOVERNANCE_HASH_MISMATCH. Gate it in tests/m8-t2.9-manifest-completeness.test.mjs: delete and corrupt the manifest, assert a declared canonical code either way.
- Acceptance criteria: every policy-artifact read is wrapped and yields a declared canonical code.
- Related findings: nguồn: A04 — policy and capability enforcement

### F-167 — read-only EXPLAIN (ANALYZE, BUFFERS) of the dense branch + SELECT index_id, count(*) FROM knowledge.segments GROUP BY 1, taken while no run holds the lock

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R5-E03-05`
- Affected modules: Zink Knowledgebase
- Severity: Medium
- Status: EXCLUDED — excluded pending decision `H9` (reclamation of unreclaimable PDF text copies — a retention decision that deletes derived content). MEASURED 2026-10-21: this row is parked behind a question that would not retire it. The defect is real and measured (the graph holds two identical copies of every vector during an incremental run, against a global, unpartitioned HNSW index — `apps/knowledge/app/database.py:1127-1203` and `migrations/001_initial.sql:143-144`), but `H9` asks whether the unreclaimable PDF TEXT copies get a reclamation path, and shrinking the corpus does not remove the duplication that splits the neighbour set. Its own reproduction is a READ-ONLY probe (EXPLAIN + the per-index_id count) that needs no decision and was never run.
- Root cause: during every incremental run the graph holds two identical copies of each vector, so roughly half of the 100 scanned ANN neighbours belong to a non-ACTIVE index and are discarded before LIMIT 40 fills — recall silently drops for the duration of a run, degrades with total segments rows (including un-purged FAILED content per R5-E03-04), and DDL time grows with corpus while the owner lock is held.
- Evidence: Where: 001_initial.sql:143-144 (global HNSW) vs database.py:1012-1082 search_candidates, :872-963 accept_incremental · Evidence: CREATE INDEX … USING hnsw (embedding vector_cosine_ops) has no WHERE clause and is not partitioned, while the query filters index_id = $1::uuid AND segment_type = ANY($6::text[]) (:1041-1046) under SET LOCAL hnsw.ef_search = 100 / hnsw.max_scan_tuples = 20000 (:1037-1038); accept_incremental clones the entire live segment set (:927-948).
- Reproduction: read-only EXPLAIN (ANALYZE, BUFFERS) of the dense branch + SELECT index_id, count(*) FROM knowledge.segments GROUP BY 1, taken while no run holds the lock.
- Acceptance criteria: candidate recall for a fixed query set is identical with and without a shadow clone present.
- Related findings: bug mở: R5-E03-04 · quyết định chủ: H9 · disposition: excluded pending decision `H9` (reclamation of unreclaimable PDF text copies — a retention decision that deletes derived content). · nguồn: E03 — Knowledgebase persistence: schema, SQL, migrations…

### F-169 — one stray control byte in one SKILL.md body makes that skill permanently unsyncable, and its FAILED marker suppresses it from retrieval while its outdated segments stay in the ANN set

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R5-E05-07`
- Affected modules: Zink Skill Store
- Severity: Medium
- Status: REFUTED — premise measured dead at HEAD: `zink-skill-store/src/catalog.mjs:524` `hasForbiddenControlByte` is called from `validateVersion` at `:666` and raises `INVALID_SKILL_CONTENT` at scan time; the control is pinned by `tests/m11-t1-skill-vector-sql.test.mjs:871` (R3-6: the named code and zero SQL statements) and `:539` (R3-7: the failed row clears its segments). A copy-based probe without the guard lets the NUL body reach two SQL statements, so the guard is load-bearing. (was: OPEN)
- Root cause: one stray control byte in one SKILL.md body makes that skill permanently unsyncable, and its FAILED marker suppresses it from retrieval while its outdated segments stay in the ANN set. Two escaping regimes for two representations of the same untrusted file text.
- Evidence: Where: vector-sync.mjs:485-489, :111-114, :74-91, :191 · Evidence: heading_path goes through toPostgresArrayLiteral, which throws ARRAY_LITERAL_CONTROL_CHARACTER; but content goes only through escapeSqlLiteral, which "doubles single quotes" and nothing else. A heading whose only oddity is NUL/ESC survives :191 (replace(/\s+/g," ") does not match \x00 or \x1b), so both paths end in a hard failure of the whole skill's transaction (:726) — and per R5-E05-04 the FAILED row then keeps stale vectors.
- Reproduction: No red test can be constructed at HEAD because the defect scenario is already reproduced and passing: `node --test tests/m11-t1-skill-vector-sql.test.mjs` (measured 9 pass 0 fail) runs R3-6 at `:473`, which feeds a NUL-bearing body through `syncSkillsToVectorStore` and asserts `CATALOG_INVALID` with an `INVALID_SKILL_CONTENT` detail and zero database statements, and R3-7 at `:393`, which asserts the FAILED-row statement clears the segments; static confirmation is `hasForbiddenControlByte` at `catalog.mjs:485-493` called from `validateVersion` at `:627`, rejecting every C0 byte except tab/LF/CR plus DEL at scan time.
- Acceptance criteria: a body containing 0x00 fails at scan with a named error rather than as a database error, and never leaves half-updated segments.
- Related findings: đã sửa/xóa khỏi file: R5-E05-04 · nguồn: E05 — Skill Store vector sync (8 findings; the derived…

### F-171 — the traversal fix was applied to the numeric field and its comment, not to the caller-supplied identifier beside it (artifact_id is only checked for truthiness at :61-66, :120-125)

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: `R5-E06-09`
- Affected modules: Zink Tools
- Severity: Medium
- Status: REFUTED — premise measured dead at HEAD: `zink-tools/adapters/storage/r2-adapter.mjs:74` exports `assertLogicalArtifactId` and it is called on all three entry points (`:136` putLandingArtifact, `:224` promoteToSilver, `:310` getArtifact); the guard landed with commit `7656ccc` ("fix: F-052 R5-E15-02"), whose comment block at `:56-69` names F-052 and F-171 together, so the register's line anchors are the pre-`7656ccc` numbering. The traversal is refused at every entry point by `tests/m7-t5-remediation.test.mjs:1499-1610`. (was: OPEN)
- Root cause: the traversal fix was applied to the numeric field and its comment, not to the caller-supplied identifier beside it (artifact_id is only checked for truthiness at :61-66, :120-125). — Hệ quả: artifact_id: "../silver/foo/v1" creates landing/../silver/foo/v1, a key distinct from silver/foo/v1, so the landing-immutability check (this.storage.has(key)) and the Silver collision check are aliasable; on a path-keyed object store the zone semantics diverge, so a contract-green run is not evidence the real boundary holds.
- Evidence: Where: zink-tools/adapters/storage/r2-adapter.mjs:68, :144, :220-223 (rule stated at :126-131) · Evidence: const key = landing/${artifact_id}; and const key = silver/${artifact_id}/v${version}; with no validation of artifact_id; the file's own comment says "The version is interpolated straight into the storage key … a value like ../../landing/orders injects path syntax into the namespace".
- Reproduction: Static plus a probe at HEAD — in `zink-tools/adapters/storage/r2-adapter.mjs`, `artifact_id` passes only a truthiness test (`:61` `if (!task_id || !run_id || !artifact_id || data === undefined) {` in `putLandingArtifact`, likewise `!artifact_id` at `:123` in `promoteToSilver`) before being interpolated raw into storage keys at `:68` (`landing/${artifact_id}`), `:154` (`silver/${artifact_id}/v${version}`) and `:230-233` (`getArtifact`), while the adjacent `version` was hardened at `:137-152` beneath the file's own comment at `:132-136` that states the exact rationale — a value like `../../landing/orders` injects path syntax into the namespace. Probe at HEAD: `putLandingArtifact` with `artifact_id: "../../silver/orders/v1"` was ACCEPTED and stored under key `landing/../../silver/orders/v1` and round-tripped by `getArtifact`, and `promoteToSilver` accepted `"../escape"`, while `version: "../../landing/orders"` was refused `R2_INVALID_SILVER_VERSION`. Gate: `tests/m9-t1-functional-truth-remediation.test.mjs`, whose F3 (`:867-898`) already pins injected versions including `"../../landing/orders"` (`:878`) — add an F-domain case asserting all three entry points reject any `artifact_id` containing `/`, a backslash, or a `..` segment with a fail-closed `R2AdapterError` code; it is red today. The class is the in-process Map contract double (`:30-39`), so the injected path syntax lands in precisely the governed key namespace it models.
- Acceptance criteria: a traversal-shaped artifact_id is refused and no two keys can address the same object.
- Related findings: nguồn: E06 — Zink Tools adapters (9 findings; two High, and they…

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

### F-181 — leaked onto the Windows drive root, and a guard that assumes it cannot exist there is already false

- Category: F6 — Reliability & Performance
- Legacy register id: `R6-I01-03`
- Affected modules: Gates + CI, Repo tooling + deploy scripts
- Severity: High
- Status: REFUTED — premise measured dead at HEAD: a platform-first refusal already exists — the rehearsal refuses to run on a non-WSL host for a stated reason, before any directory-existence check. (was: PARTIAL)
- Root cause: some Windows-side code path (2026-09-29) passed the live WSL path into a filesystem call without the WSL translation, and mkdir-with-recursive created the mirror. — Hệ quả: any control whose safety rests on "that path cannot exist on this host" is currently resting on nothing — including the guard that stands between npm run rehearse:r16 and touching the live runtime shape. Combined with the new confirmation gate the risk is bounded by the operator typing the token, but the _reason_ the tool believes it is on WSL is wrong. Nothing was deleted or changed: removing an unowned tree under C:\home is destructive and §10 requires…
- Evidence: Where: observed C:\home\hoang_vinh\.openclaw-zink\operator (mtime 2026-09-29, empty); consumed by r16-rehearsal.mjs:62 (if (!existsSync(R16_ROOTS.stateDir)) … "R16 runs in WSL only") via tests/helpers/r16-fingerprint.mjs R16_ROOTS.stateDir = /home/hoang_vinh/.openclaw-zink · Evidence: on this host fs.existsSync("/home/hoang_vinh/.openclaw-zink") returns true and R16_ROOTS.runtimeRoot (/home/hoang_vinh/.local/lib/node_modules/openclaw) returns false — i.e. the check is discriminating on real state, and the .openclaw-zink half of it exists _on Windows_ because Node resolved a POSIX absolute path against the current drive. Three directories, no files. · Expected/Actual: the driver's only host-safety guard assumes a POSIX home cannot exist on Windows; it does.
- Reproduction: node -e "console.log(require('fs').existsSync('/home/hoang_vinh/.openclaw-zink'))" on Windows, and ls -la /c/home/hoang_vinh — read-only.
- Acceptance criteria: r16-rehearsal.mjs refuses to run on a non-WSL host for a stated reason that does not depend on whether a directory happens to exist, and no repository code creates C:\home\….
- Related findings: disposition: the platform-first refusal CLOSED by `703fec4` (DRIVER-05 pins it); the writer of `C:\home\hoang_vinh\.openclaw-zink\operator` is still unidentified. · nguồn: Disposition of the register entries M12/T2.1-R3 executed…

### F-200 — I recorded what I had just measured instead of grepping the register first, which is the exact step AGENTS.md §4 and the audit's own anti-duplication rule require

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R6-V07-01`
- Affected modules: OpenClaw governance plugin + runtime libs
- Severity: High
- Status: REFUTED — premise measured dead at HEAD: `git grep R6-CFG` returns only PLAN.md history; the live register carries no R6-CFG rows; `PLAN.md:5952-5993` and `:7018` already record the merge into `R5-E11-01` / `R1-A04-01` / `R1-A04-05`, and `R1-A04-01` / `R1-A04-05` are closed at `ccf2ad7` / `09aa698`. (was: OPEN)
- Root cause: I recorded what I had just measured instead of grepping the register first, which is the exact step AGENTS.md §4 and the audit's own anti-duplication rule require. — Hệ quả: with four IDs standing for two decisions plus one deployment note, the next contract would have counted one naming fix as three, and would have tiered R5-E11-01 as T2.3 "documents" — which drops R1-A04-01 (High, an enforcement bug that kills a legal brief with UNAUTHORIZED_TARGET) and R1-A04-05 (Medium, a denial that names the wrong subsystem) out of scope entirely.
- Evidence: Where: this file's R6-CFG-01…03 block vs R5-E11-01 (:3805-3819), R1-A04-01 (:139-144), R1-A04-05 (:148-153) · Evidence: R5-E11-01's own Where already includes policy.mjs:566-572 and its Verify-by says to diff "AGENT_SPAWN_POLICY + AGENT_DEFINITIONS display names" — i.e. the naming defect I filed as new under R6-CFG-01/-02 was recorded three weeks ago. R6-CFG-03's STACK_IDS half is verbatim R1-A04-05, and its guard.mjs half is verbatim R1-A04-01.
- Reproduction: Register inspection reproduces the duplication: R6-CFG-01/-02 have no rows of their own, the R6-CFG-03 row (merged into R1-A04-01; its history is in `CHANGELOG.md`) lists R1-A04-01 as already fixed, and R5-E11-01 already carries the AGENT_SPAWN_POLICY display-name diff at policy.mjs:566-572 — the same naming defect re-filed as new. The line cites inside the Evidence field (:3805-3819, :139-153) are stale for a 3 068-line file.
- Acceptance criteria: One defect holds one register id: the R6-CFG-01/-02/-03 claims are merged into R5-E11-01, R1-A04-01 and R1-A04-05, so a later contract counts one naming decision as one item instead of three.
- Related findings: bug mở: R6-CFG-01, R5-E11-01, R6-CFG-03 · đã sửa/xóa khỏi file: R1-A04-01, R1-A04-05 · nguồn: The two refutations that hit the orchestrator's own…

### F-206 — MODEL_ALLOWLIST_VIOLATION is an unreachable guard whose "coverage" is a tautology

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R1-A12-06`
- Affected modules: Gates + CI
- Severity: Medium
- Status: REFUTED — premise measured dead at HEAD: the guard is REACHABLE and already tested. The `MODEL_ALLOWLIST_VIOLATION` guard in `integrations/openclaw/lib/quota-telemetry.mjs` is exercised by `tests/m7-t2-quota-telemetry.test.mjs` TEST M3 through an allowlist whose own membership test disagrees with its contents — removing the guard turns TEST M3 red. The stale single-entry comments are gone, and TEST M asserts the reachable invariant (the resolver consults only the first two entries) instead of re-asserting a tautology. (was: OPEN)
- Root cause: the gate reports coverage of a security invariant that is untested, and readers keep believing indices 2–4 are unreachable.
- Evidence: Where: lib/quota-telemetry.mjs:262-264 guard, stale comments :203, :214-219; tests/m7-t2-quota-telemetry.test.mjs:465-471 (TEST M), :474-493 (TEST M2) · Evidence: the resolver only assigns allowlist[0]/allowlist[1], so membership cannot fail; TEST M2's own comment says the guard "is unreachable by construction" then re-asserts membership. MODEL_ALLOWLIST now has 5 entries (policy.mjs:534-543).
- Reproduction: Static — no input can make `chosen` a non-member: the resolver reads only indices 0/1 of the same array (`quota-telemetry.mjs:212-213`, `primary = allowlist[0]` and `fallback = allowlist[1]`, assigned at `:225`/`:229`/`:232`/`:246` and `:249`/`:253` behind the `!fallback`/`latch` guards at `:236`/`:244`) and returns either `primary` or `fallback`, so the `MODEL_ALLOWLIST_VIOLATION` guard at `:262-264` (`if (!allowlist.includes(chosen)) { throw new Error("MODEL_ALLOWLIST_VIOLATION"); }`) is dead and its "coverage" — TEST M's `MODEL_ALLOWLIST.includes(result.model)` (`tests/m7-t2-quota-telemetry.test.mjs:467-470`) — is a tautology that TEST M2's own comment at `:475` ("unreachable by construction") admits before re-asserting membership at `:491`. The stale comments at `:203-206` ("governed set is a single entry under M10/T2-R9") and `:214-219` ("the router's single `execute` combo entry") still describe the removed single combo while `policy.mjs:625-628` records the five-model chain (`ROUTER_PROVIDER_MODEL_IDS`, `:534-540`, "`execute` (the combo) is no longer governed at all"). Gate in `tests/m7-t2-quota-telemetry.test.mjs`: replace TEST M/M2 with a falsifiable property — inject a stub `allowlist` whose `includes` returns `false` to demonstrate the guard can never fire through the real code path, or delete the dead guard and pin the reachable invariant that the resolver consults only `allowlist[0]`/`allowlist[1]` — and correct the two comment blocks to the five-model chain; the red observation today is that no resolution can produce `MODEL_ALLOWLIST_VIOLATION`.
- Acceptance criteria: The `MODEL_ALLOWLIST_VIOLATION` guard either becomes a reachable, tested invariant - a case actually triggers the throw and reddens if the guard is removed - or is deleted as dead code together with the stale single-entry comments at `quota-telemetry.mjs:203-206`/`:214-219`, and in either world the tautological membership re-assertions of TEST M/TEST M2 (`tests/m7-t2-quota-telemetry.test.mjs:462-493`) stop counting as coverage of that invariant.
- Related findings: adjudication Vòng 2: Verified, corrected · nguồn: A12 — test validity and regression coverage

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

### F-214 — the gate is decorative for ~90 % of the surface it names — a tag id introduced in lib/discord-forum-tags.mjs, configure.mjs, templates/, topology/fixtures/ or an env file keeps it green

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R5-E10-02`
- Affected modules: OpenClaw governance plugin (Discord), OpenClaw integration, Gates + CI
- Severity: Medium
- Status: REFUTED — premise measured dead at HEAD: `tests/m12-t2-governed-surface.test.mjs:573-633` already walks the tracked tree via `git ls-files` and asserts BOTH patterns — the `/applied_tags:\s*\[\s*"\d{15,25}"/u` regex and the literal — against every tracked `.mjs`/`.js`/`.cjs`/`.ts`/`.json` file, plus `templates/` and `fixtures/`. (was: OPEN)
- Root cause: the gate is decorative for ~90 % of the surface it names — a tag id introduced in lib/discord-forum-tags.mjs, configure.mjs, templates/, topology/fixtures/ or an env file keeps it green. Same class as R5-E13-05 (guard aimed at the wrong files) and R4-V01-01 (verification over a set it silently shrank). A real repo-wide walk precedent already exists at tests/m7-lane-g-policy.test.mjs:731.
- Evidence: Where: tests/m12-t2-governed-surface.test.mjs:489-505 · Evidence: the test is titled "no Discord tag id is hardcoded anywhere in the repository" but reads exactly one file (readFileSync("integrations/openclaw/plugins/zink-governance/index.mjs")) and checks only two things: /applied_tags:\s*\[\s*"\d{15,25}"/u and pluginSource.includes("`REDACTED`").
- Reproduction: Static — the gate `M12/T2 P1: no Discord tag id is hardcoded anywhere in the repository` (`tests/m12-t2-governed-surface.test.mjs:494`) reads exactly one file, `pluginSource = readFileSync("integrations/openclaw/plugins/zink-governance/index.mjs")` (`:489-492`), and asserts only `/applied_tags:\s*\[\s*"\d{15,25}"/u.test(pluginSource) === false` (`:496`) and `pluginSource.includes("`REDACTED`") === false` (`:501`). Every other surface the title names is real and unread — `integrations/openclaw/lib/discord-forum-tags.mjs`, `integrations/openclaw/configure.mjs`, `integrations/openclaw/templates/`, `integrations/openclaw/topology/fixtures/` and the env files — so a 15-25 digit tag literal introduced in any of them keeps the assertion green. Reproduce by adding an `applied_tags: ["`REDACTED`"]` literal to `lib/discord-forum-tags.mjs` and confirming `node --test tests/m12-t2-governed-surface.test.mjs` still passes. Fix gates in this same test: widen P1 to walk the tracked tree — the multi-file precedent is `tests/m7-lane-g-policy.test.mjs:725-733`, and `tests/repository-policy.test.mjs` already enumerates the repo via `execFileSync("git", …)` — asserting both patterns are absent from every tracked `.mjs`, `.env` and template, not from `index.mjs` alone.
- Acceptance criteria: the `M12/T2 P1` gate asserts both patterns - the `/applied_tags:\s*\[\s*"\d{15,25}"/u` regex and the literal `REDACTED` - against every tracked source, template, fixture and env file in the repository (enumerated the way `scripts/repository-policy.mjs` `listTrackedFiles` walks the tree), so that introducing either literal in `integrations/openclaw/lib/discord-forum-tags.mjs`, `configure.mjs`, `templates/`, `topology/fixtures/` or any env file turns `node --test tests/m12-t2-governed-surface.test.mjs` red instead of staying green.
- Related findings: bug mở: R5-E13-05, R4-V01-01 · nguồn: E10 — test infrastructure: the source-text assertion…

### F-224 — the failure is injected by SQL source text, so any rewording of the tombstone statement silently moves the injected failure to a different call site while the same assertions still pass — the "not swallowed" guarantee can stop covering…

- Category: F7 — Testing & Verification Gaps
- Legacy register id: `R5-E10-07`
- Affected modules: Gates + CI
- Severity: Low
- Status: REFUTED — premise measured dead at HEAD: the injected failure is already role-bound — `tests/m11-t1-skill-vector-sql.test.mjs:154-170` binds the tombstone to its statement by role and call ordinal rather than by source text. (was: OPEN)
- Root cause: the failure is injected by SQL source text, so any rewording of the tombstone statement silently moves the injected failure to a different call site while the same assertions still pass — the "not swallowed" guarantee can stop covering the intended statement with no red signal. (It is also the only test-side coverage of the R5-E05-02/03 tombstone, which is why those findings went unnoticed.) Leaked temp trees accumulate invisibly on constrained /tmp.
- Evidence: Where: tests/m11-t1-skill-vector-sql.test.mjs:160-176; tests/m7-t3-tools-contract.test.mjs:143-147 · Evidence: dbExecutor: async (sql) => { if (sql.includes("DELETE FROM skills.catalog_index")) return ""; throw new Error("PSQL_REJECTED_SIMULATION"); } for a test named "failure escalation — a failed failSql is surfaced, not swallowed"; and cleanup try { fs.rmSync(tempDir, …) } catch { void 0; }.
- Reproduction: Static — the fault is injected by matching SQL source text, not by targeting the tombstone call: `tests/m11-t1-skill-vector-sql.test.mjs:165-168` uses a `dbExecutor` that returns an empty string when `sql.includes("DELETE FROM skills.catalog_index")` and otherwise throws `PSQL_REJECTED_SIMULATION`, inside the test `M11-04: failure escalation — a failed failSql is surfaced, not swallowed` (`:153`), then asserts `report.status === "FAILED"` (`:170`), `report.failed_count === 1` (`:171`) and `report.error_code === "VECTOR_FAILURE_WRITE_FAILED"` (`:172`). The matched substring is the production tombstone at `zink-skill-store/src/vector-sync.mjs:626-631`, so rewording that statement makes the `includes()` miss it and the injected throw silently migrates to whichever statement runs first — the same three assertions still pass while the "not swallowed" guarantee stops covering the tombstone. Reproduce by rewording the `vector-sync.mjs` DELETE (rename the table or prepend a comment) and confirming `node --test tests/m11-t1-skill-vector-sql.test.mjs` stays green. The companion leak is `tests/m7-t3-tools-contract.test.mjs:142-146`, whose cleanup swallows removal failures so temp trees accumulate. Fix gates in `tests/m11-t1-skill-vector-sql.test.mjs`: inject the failure by statement role or call ordinal, or assert the exact SQL the failing executor received, rather than by a substring that can drift.
- Acceptance criteria: the `M11-04` executor in `tests/m11-t1-skill-vector-sql.test.mjs:153-180` binds the injected failure to the tombstone call by statement role or call ordinal, or asserts the exact SQL text the failing executor received, so rewording the DELETE at `zink-skill-store/src/vector-sync.mjs:626-634` turns the test red instead of silently moving `PSQL_REJECTED_SIMULATION` to a different statement while `:170-176` stay green - and the companion cleanup at `tests/m7-t3-tools-contract.test.mjs:141-147` no longer swallows `rmSync` failures.
- Related findings: bug mở: R5-E05-02 · nguồn: E10 — test infrastructure: the source-text assertion…

### F-248 — a result recorded without a payload digest wedges the task in `RESULT_PENDING_REVIEW`: every owner verdict demands a digest that was never stored

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: `R7-D11B-02`
- Affected modules: Zink Tools (workflow topology)
- Severity: High
- Status: REFUTED — premise measured dead at HEAD: `integrations/openclaw/topology/lib/workflow.mjs:1420` reads `payload.payload_digest ?? reducerMintedResultDigest(task)` — the conditional store the row describes is gone (closed with F-077 in `832f082`); `requireResultIdentityMatch` admits an unbound verdict when the task has no root result and the digest is the reducer-minted one, and `tests/m7-lane-a-workflow.test.mjs:484` drives ACCEPT on a digest-less record. (was: LATENT)
- Root cause: the event contract makes `payload_digest` optional and the reducer stores it only when present, while every verdict path begins by requiring that stored digest to be a string. The task has no exit except cancellation, and the failure looks like an owner decision problem rather than a missing field.
- Evidence: Where: integrations/openclaw/topology/lib/workflow.mjs:1207-1210 (`task.workflow_status = "RESULT_PENDING_REVIEW"; … if (payload.payload_digest) task.execution_payload_digest = payload.payload_digest;`) vs :1580-1583 (`const currentDigest = task.root_result?.payload_digest ?? task.execution_payload_digest; requireCondition(typeof currentDigest === "string", "RESULT_MISMATCH");`) · Evidence: the comment at :1584-1587 records that a previous null-versus-undefined bug "made EVERY verdict fail and wedged the task in review" — the same wedge remains for the absent-digest case.
- Reproduction: static — contract-legal but not reachable from the current emitter, so the row stays `LATENT`: `index.mjs:2424-2428` always names the key, and when it computes `payloadDigest = null` (no artifact set and no artifact file, :2313-2319) the append is rejected outright by `validateContract("ledger-event", …)` at `topology/lib/ledger.mjs:543` — verified by handing a synthetic event with a null `payload_digest` to that validator, which throws `SCHEMA_INVALID: SCHEMA_VALIDATION_FAILED`. The live digest-less case is F-077's; the absent-key wedge here fires only for a new emitter or a hand-written event. `WORKFLOW_RESULT_RECORDED {task_id}` with no digest from EXECUTING leaves the status set and no digest; ACCEPT, REJECT, BLOCK and REQUEST_REVISION all throw `RESULT_MISMATCH`, and APPROVAL_DECIDED refuses the status.
- Acceptance criteria: either `payload_digest` is required in that contract branch, or verdict binding tolerates an unbound result; a test drives ACCEPT after a digest-less record.
- Related findings: successor to F-077 (that row records the wedge, this one names the mechanism), F-226, F-113, F-249 · nguồn: R7 delta audit D11B

### F-293 — model-service response text is interpolated unescaped into the acceptance SQL literals, so a hostile or malformed tag response writes arbitrary statements

- Category: F2 — Security & Authorization
- Legacy register id: `R7-C4-06`
- Affected modules: deployment topology, Zink Knowledgebase
- Severity: Medium
- Status: REFUTED — premise measured dead at HEAD: commit `88cdf31` already landed the row's remediation. `infrastructure/docker/scripts/knowledge-t1.ps1:165-174` validates the provider value against its documented shape (`^[0-9a-f]{64}$`) before any use, and the digest reaches the client as a psql VARIABLE (`:'model_digest'`) instead of an interpolated literal; the same gate landed in `knowledge-t3.ps1:171` and `knowledge-t5-common.ps1:371`. No provider response text reaches a report, a log line or a file: the only provider-derived value used is the digest, shape-gated to 64 lowercase hex, and every throw in the driver is a static string. The row's own line anchors (`:119`, `:137-147`, `:166-173`, `:212`) describe the pre-fix file. (was: LATENT)
- Root cause: the acceptance scripts take fields straight out of the local model service's response and splice them into single-quoted SQL literals inside a here-string passed to the database client. The strongest validation anywhere on these paths is a truthiness test at one site, and the value's shape is never constrained. Impact is bounded because the target is an ephemeral acceptance database, but the pattern is exactly the one the repository's safety rules forbid: untrusted response data used as command text.
- Evidence: Where: `infrastructure/docker/scripts/knowledge-t1.ps1:119` — the guard is only `if (-not $model -or -not $model.digest)` · Where: `:137-147` — the insert with `'$($model.digest)'` at `:144` · Where: `:166-173` — the second statement repeating it · Where: `infrastructure/docker/scripts/knowledge-t3.ps1:157` and `knowledge-t5.ps1:174` — the same interpolation shape, and the t3 site is worse than the row allowed: `:154` assigns the model value from the tags endpoint with no guard at all, not even the truthiness test · Where: `knowledge-t1.ps1:212` — a third statement repeating the same interpolation · Where: the response is fetched from the local tags endpoint by `Invoke-RestMethod`, so its fields are provider-controlled.
- Reproduction: unconfirmed — a tags response carrying a digest containing a quote and a statement terminates inside the literal and produces two statements where one was intended. Before fixing, measure whether any lane or operator run feeds a non-validated endpoint; the intended assertion is a charset check plus parameter passing, exercised by a fixture whose digest contains a quote.
- Acceptance criteria: every provider-derived value is validated against its documented shape before use and passed to the database client as a parameter rather than interpolated, and a fixture with a quote-bearing value proves the statement cannot be split.
- Related findings: F-264, F-052, F-103 · nguồn: R7-C delta audit C4 — docker compose overlays and acceptance scripts

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

### F-324 — the router placeholder convention is enforced in a helper that six suites bypass, and one of them spawns a generator with the inherited environment

- Category: F2 — Security & Authorization
- Legacy register id: `R7-E5-05`
- Affected modules: Gates + CI, Zink Tools, OpenClaw governance plugin
- Severity: Low
- Status: REFUTED — premise measured dead 2026-10-18, and re-measured by the Lead on 2026-10-18 for a different reason than this row first gave. The route the title named ("one of them spawns a generator with the inherited environment") does not exist: none of the six bypassing suites spawns `configure.mjs` or `verify.mjs`, and the only one that names `configure.mjs` reads it as source text. What survives is a convention-consistency observation about `||=` seeding, which is not an F2 defect. (was: LATENT; the first refutation cited `buildConfig` call counts, a symbol that is not the route — see `Evidence`)
- Root cause: the shared test helper assigns the three router variables, which is the documented way to keep real values out of test lanes, while six suites pre-set the same variables with the nullish-assignment operator, preserving whatever the invoking host exported. The divergence is real but its stated route is not: none of the six runs a generator or calls a router resolver, so on today's tree the bypass keeps a host value inside the test process instead of carrying it into a generated fixture. Reaching the operator's real router endpoint would need a lane that both skips the helper and calls `resolveRouterBaseUrl()`/`resolveRouterApiKey()`; measured, no such lane exists in the six.
- Evidence: Where: `tests/helpers/router-env.mjs:21-36` — plain assignment of all three variables at `:27-29` and the restore closure at `:30-35` · Measured bypass population, six suites: `tests/m12-t2.2-m1-live-reachability.test.mjs:22-24`, `tests/m12-t2.2-a1-stack-authority.test.mjs:14-16`, `tests/m12-t2.2-a2-stack-registry.test.mjs:24-26`, `tests/m12-t2.2-a3-queue-writer-lock.test.mjs:20-22`, `tests/m12-t2.2-k1-announce-discard-reason.test.mjs:17-19` and `tests/m10-t2-r14-review-defects.test.mjs:5-7` · Where the router values are actually read: three **exported** resolvers — `integrations/openclaw/lib/policy.mjs:1291` (`resolveRouterHost`), `:1298` (`resolveRouterBaseUrl`), `:1308` (`resolveRouterApiKey`) — each of which throws `ROUTER_*_UNAVAILABLE` when unset; `buildConfig` at `:788` only composes them, so counting `buildConfig` calls was the wrong probe · Generator consumers: `configure.mjs:1252` and `:1593` write `stableJson(buildSecretsPlan())`, `verify.mjs:311-312` and `:511` call the resolvers and compare the plan · Measured with `temp/f324-probe.mjs` over all 122 tracked suites: exactly six pre-set with `||=`, twelve import the helper, and of the six **none spawns a generator** — `tests/m12-t2.2-m1-live-reachability.test.mjs` resolves the path at `:36` and reads its source text at `:38`, and its only child processes are `git archive` at `:98` and `tar` at `:104`, whose imported symbol `governancePluginFiles` at `:109-114` reads no `ZINK_ROUTER_*`; `tests/m10-t2-r14-review-defects.test.mjs:89` mentions `validateConfig` only inside a comment and imports `evaluateCapabilityAccess`/`AGENT_SPAWN_POLICY`, neither of which reads a router variable · Measured consequence: that suite prints tests 4, pass 3, fail 0, skipped 1 at baseline AND with a sentinel exported for all three variables, and the sentinel string appears 0 times in its output (`temp/f324-base.log`, `temp/f324-sent.log`).
- Reproduction: the measurement this row said it could not run was run: a sentinel exported for one of the three variables leaves the single suite at the same counts and never reaches the generated config, so the credential-into-fixture route is not reproducible today. The surviving measurement: assert at the head of each bypassing suite that the value it sees equals the documented placeholder, which is exactly what a host-exported router host would violate.
- Acceptance criteria: one policy for all suites — either every lane that can build the deployed config calls the helper that forces placeholders, or the suites that keep the preserving form assert that the values they see are the documented placeholders; no lane may write a real credential into a fixture or print one.
- Related findings: F-264, F-103, F-023 · nguồn: R7-E delta audit E5 — remaining orphan files

### F-383 — the apply refused with a reason the classifier does not name, so the operator's report said "APPLY_REJECTED" and nothing else

- Category: F7 — Testing & Verification Gaps
- Legacy register id: — (new in M12/T9)
- Affected modules: Gates + CI, OpenClaw governance plugin
- Severity: High
- Status: OPEN — the refusal is now DISCLOSABLE (the detail goes to the operator's stderr), but the reason itself is not yet known: the owner's apply on 2026-10-22 rolled back cleanly (`mutationStarted: true`, `rollbackSucceeded: true`, `transactionStatus: complete`) and the live state was restored, so the next apply will say which step refused and why.
- Root cause: the apply's classifier names every refusal it knows (`KNOWN_REFUSAL_REASONS`), and anything else degrades to the generic `APPLY_REJECTED`. The apply's stage (`builder-apply`) was known, so the refusal was inside the builder's apply — but nothing said which check or which write refused, and the operator's report therefore carried no actionable fact.
- Evidence: Where: `integrations/openclaw/topology/fixtures/runtime-regression/apply-orchestration.mjs` (the catch that classifies) and `integrations/openclaw/topology/fixtures/runtime-regression/refusal-classifier.mjs` (the known reasons) · Evidence: the owner's run printed `{"status":"FAIL","stage":"builder-apply","reason":"APPLY_REJECTED","rollbackSucceeded":true,...}`; the live state root shows the builder's own writes (the packaged extension at 06:21, the auth plans, the systemd drop-in) and the ledger's checkpoint untouched, so the refusal came after the extension was written and before the ledger's checkpoint.
- Reproduction: run the operator apply on the live host with the current build: `node integrations/openclaw/topology/fixtures/runtime-regression/operator-apply.mjs "$ZINK_OPERATOR_STATE_DIR"` — the refusal's detail is now on the operator's stderr, so the next run names the step.
- Acceptance criteria: the apply refuses with a reason the classifier names, or the operator's stderr names the step that refused; a refusal that neither names is a defect in the classification, not a fact the operator can use.
- Related findings: bug mở: the deploy blocker of 2026-10-22 (the same finding's own row) · nguồn: M12/T9 — the deploy blocker family.

### F-389 — the reclamation's subject: the extraction's copy is reclaimed, the searchable copy is not, and only the owner can say which one `H9` meant

- Category: F4 — Integration & Contract Violations
- Legacy register id: — (new in M12/T9)
- Affected modules: Zink Knowledgebase
- Severity: Medium
- Status: OPEN — the owner's decision is required (RED, `AGENTS.md` §7): the answer `H9` ("the derived text copies may be reclaimed; the PDF itself stays") does not say which copy it meant, and the two copies are not the same thing.
- Root cause: the Knowledgebase holds TWO copies of a PDF's text. The extraction's copy is `knowledge.pdf_content_segments` (the extracted text with its page and bounding box), its provenance and its manifest; the published, searchable copy is `knowledge.segments.text`, which the owner asked the Knowledgebase to keep. The implemented path (band C, `H9`) reclaims the extraction's copy and leaves the published one — the published segments carry no build reference, so they survive by construction.
- Evidence: Where: `apps/knowledge/app/database.py` (the reclamation), `apps/knowledge/migrations/001_initial.sql:98` (the published segments, which reference no content build) · Evidence: the deleted relations are `pdf_source_details`, `pdf_content_segments`, `pdf_content_batches`; the lane proves the published segments are untouched (`apps/knowledge/tests/test_m12_t9_pdf_content_reclamation.py`).
- Reproduction: reclaim one PDF's derived copy, then count the rows: the extraction's rows are gone and the same text is still in `knowledge.segments`.
- Acceptance criteria: the owner says which copy `H9` meant. If it meant the extraction's copy (what is implemented), the row closes with the answer. If it meant the searchable copy too, the published segments of that PDF must be reclaimed as well — that is a change to what the Knowledgebase keeps, so it needs its own approved step and its own durable record.
- Related findings: quyết định chủ: `H9` · nguồn: M12/T9 — the review round of 2026-10-22.

### F-390 — the reclamation route carries no authorization and records no caller

- Category: F2 — Security & Authorization
- Legacy register id: — (new in M12/T9)
- Affected modules: Zink Knowledgebase
- Severity: Medium
- Status: OPEN — the owner's decision is required (RED, `AGENTS.md` §7): the Knowledgebase's API has no per-route authorization at all, and adding one is a change to the security boundary, which `docs/contracts/execution/ACTIVE.md` §1 does not authorize.
- Root cause: `POST /v1/pdf-content-reclamations` is a destructive door: it deletes a PDF's derived text copy. No route of the Knowledgebase API carries a credential, the nginx proxy exposes `/knowledge/` without a `limit_except`, and the service sits on the shared `platform` network, so any process on the host and any container on that network can call it. Nothing records WHO reclaimed what: the durable record is the content build's terminal state (WHAT and WHEN), and the Skill Store's own governed retirement — the pattern this repository already uses for a governed destructive act — carries a decision reference and an actor, which this route does not ask for.
- Evidence: Where: `apps/knowledge/app/main.py` (the route), `infrastructure/nginx/conf.d/default.conf` (the proxy), `zink-skill-store/src/catalog.mjs:1756` (the `decisionRef`/`ownerActor` pattern) · Evidence: the Knowledgebase's API has no `Depends`/token check on any of its ten routes; the blast radius is bounded (the published searchable segments survive; only the derived copy goes, and the PDF can be ingested again), but the door itself is open to anything that can reach the port.
- Reproduction: POST `{"source_path": "02. Books/Authority/report.pdf"}` to `http://127.0.0.1:8080/knowledge/v1/pdf-content-reclamations` from any process on the host, or from any container on the `platform` network.
- Acceptance criteria: the owner decides whether this door needs a credential (and which), and whether the record must carry the actor and the decision that authorized it. If the platform boundary is the trust boundary, the row closes with that answer; if a credential is wanted, the change needs its own approved step (a new configuration knob and a new durable record are both outside the current band).
- Related findings: quyết định chủ: — · nguồn: M12/T9 — the review round of 2026-10-22.

### F-391 — the reclamation's SQL never runs against a real PostgreSQL, so its foreign-key order is unproven

- Category: F7 — Testing & Verification Gaps
- Legacy register id: — (new in M12/T9)
- Affected modules: Zink Knowledgebase, Gates + CI
- Severity: Medium
- Status: OPEN — the gap is real and the fix is a case in the SQL statement gate, which needs the PostgreSQL container; it was not closed in this band.
- Root cause: the reclamation's correctness rests on the ORDER of its statements: the link `knowledge.pdf_source_details` pins the build's status to `READY`, so the link must be deleted before the build leaves `READY`. The foreign key is `ON DELETE RESTRICT`, so the wrong order is refused by the database — but the Knowledgebase's own lane drives the writer against a recording fake, which enforces no constraint, and the real-PostgreSQL gate (`tests/m11-t1-postgres-sql-gate.test.mjs`) never runs these statements.
- Evidence: Where: `apps/knowledge/app/database.py` (the writer), `apps/knowledge/migrations/002_pdf_ingestion_foundation.sql:71` (the link's foreign key) · Evidence: the Knowledgebase's lane uses a fake connection (`apps/knowledge/tests/test_m12_t9_pdf_content_reclamation.py`); the SQL statement gate applies the tracked migrations and runs the Skill Store's statements, but nothing from the reclamation.
- Reproduction: run the reclamation's statements against a real PostgreSQL with the link still present and the build's status changed first — the foreign key refuses it.
- Acceptance criteria: the SQL statement gate runs the reclamation's statements against a real PostgreSQL, in the writer's own order, and proves that the published segments and the source row survive while the derived relations go.
- Related findings: quyết định chủ: `H9` · nguồn: M12/T9 — the review round of 2026-10-22.

### F-342 — `.editorconfig` and `repo:check` prescribe opposite trailing-whitespace rules for Markdown

- Category: F4 — Integration & Contract Violations
- Legacy register id: `R7-OA-05`
- Affected modules: Build & runtime config, Governance docs
- Severity: Low
- Status: REFUTED — premise measured dead at HEAD: the gate already defers to the editor-facing `.editorconfig` — `tests/repository-policy.test.mjs:1147-1158` asserts exactly that, so the two authorities no longer prescribe opposite trailing-whitespace policy. (was: LATENT)
- Root cause: two authorities state opposite requirements for the same file class, and neither names the other. The editor-facing rule exists for Markdown's hard-break semantics; the gate-facing rule rejects the same bytes. Which one wins depends on which surface the operator touches last.
- Evidence: Where: `.editorconfig:18-19` `[*.md]` with `trim_trailing_whitespace = false` · Where: `scripts/repository-policy.mjs:707-712` — `checkWorkingTreeTextPolicy` fails any tracked file whose line ends `/[ \t]+\r?$/` · Where that runs: `npm run repo:check`, a `verify` stage, and the CI `quality-gate` · measured: count of tracked `.md` files whose lines end in whitespace = 0.
- Reproduction: static — add two trailing spaces to a `docs/*.md` line and run `npm run repo:check`; prettier preserves them per `package.json:21`'s markdown glob and `.editorconfig` declares them legal, while the policy check reddens.
- Acceptance criteria: one authority owns trailing-whitespace policy for Markdown and the other defers to it (either the gate exempts `*.md` hard breaks, or the editorconfig rule is removed and the docs are normalized).
- Related findings: F-129 (governance docs describing reality), F-153 · nguồn: R7-O1 delta audit A
