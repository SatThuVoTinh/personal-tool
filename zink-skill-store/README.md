# Cẩm nang Vận hành & Hướng dẫn Sử dụng Zink Skill Store

Tài liệu này cung cấp hướng dẫn toàn diện, chi tiết và tuần tự từng bước bằng tiếng Việt về cách quản trị, xây dựng, kiểm tra và truy xuất các kỹ năng phân tích tái sử dụng (reusable skills) và bộ template chuẩn trong **Zink Skill Store**, tuân thủ 100% theo logic mã nguồn thực tế tại `bin/skill-store.mjs` và `src/catalog.mjs`.

---

## 1. Giới thiệu & Vai trò Module

**Zink Skill Store** là một module ngang hàng (peer module) độc lập trong hệ thống Zink:

- **Mục đích:** Lưu trữ và quản trị vòng đời (lifecycle) các kỹ năng phân tích chuyên sâu (vd: tối ưu hóa tồn kho, dự báo chuỗi cung ứng, mô hình hóa tài chính) và các mẫu báo cáo chuẩn (Excel, Power BI).
- **Kiểm định tính toàn vẹn (Anti-tamper Integrity):** Mỗi kỹ năng được ràng buộc chặt chẽ giữa siêu dữ liệu trong tệp `manifest.json` và nội dung tệp hướng dẫn `skill.md` thông qua mã băm SHA-256. Bất kỳ thay đổi trái phép nào đối với nội dung Markdown đều bị phát hiện ngay lập tức.
- **Giao diện dòng lệnh ngoại tuyến (Offline Read-Only CLI):** Hoạt động hoàn toàn bằng Node.js CLI, không mở cổng mạng, không yêu cầu cơ sở dữ liệu động, đảm bảo an toàn tuyệt đối.

### Ranh giới kiến trúc bất biến

1. **Độc lập với Knowledgebase:** Skill Store hoàn toàn tách biệt với chỉ mục nghiên cứu của Zink Knowledgebase (`platforms/knowledge-platform` và `apps/knowledge`). Skill Store không lưu trữ tài liệu nghiên cứu và không bị nạp vào vector database của Knowledgebase.
2. **Không tự động thăng hạng (Governed Promotion Only):** Kỹ năng chỉ được cập nhật trạng thái `ACTIVE` khi có sự phê duyệt rõ ràng từ chủ sở hữu hệ thống (owner). Agent không có quyền tự ý tạo hoặc duyệt kỹ năng mà không có sự kiểm soát.

---

## 2. Cấu trúc Cây Thư mục Kỹ năng

Toàn bộ kho kỹ năng tuân thủ nghiêm ngặt cấu trúc phân cấp chuẩn:

```text
zink-skill-store/
├── bin/
│   └── skill-store.mjs             # CLI kiểm tra (validate) và truy xuất (get)
├── src/
│   ├── catalog.mjs                 # Logic quét catalog, kiểm tra schema, băm SHA-256 và promotion chuẩn tắc nội bộ
│   └── vector-sync.mjs             # Đồng bộ dẫn xuất Git -> PostgreSQL vector (chỉ skill ACTIVE)
├── skills/                         # Thư mục gốc chứa các kỹ năng đã được chuẩn hóa
│   └── <namespace...>/             # Phân cấp danh mục (tối đa 8 cấp, vd: supply-chain/inventory)
│       └── <capability>/           # Tên kỹ năng cụ thể (vd: safety-stock)
│           └── <version>/          # Phiên bản SemVer (vd: 1.0.0)
│               ├── manifest.json   # Tệp đặc tả cấu hình, metadata và băm SHA-256
│               └── SKILL.md        # Tệp hướng dẫn thực thi kỹ năng (Markdown UTF-8, đúng tên file)
└── templates/                      # Kho lưu trữ template báo cáo chuẩn do chủ sở hữu phê duyệt
    ├── excel/                      # Template bảng tính Excel (.xlsx)
    └── power-bi/                   # Template báo cáo Power BI (.pbix)
```

### Quy tắc đặt tên (Slug Invariant)

- Mọi phân đoạn trong `namespace` và tên `capability` bắt buộc phải tuân thủ định dạng kebab-case viết thường: `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
- Tối đa 8 cấp phân cấp cho `namespace` (ngăn cách bằng dấu `/`).
- Không chứa ký tự viết hoa, khoảng trắng, dấu gạch dưới `_` hoặc ký tự đặc biệt.

---

## 3. Quy chuẩn Tệp Cấu hình Kỹ năng

Mỗi phiên bản kỹ năng bắt buộc phải chứa đúng 2 tệp: `SKILL.md` và `manifest.json`
(tên file chính xác, phân biệt hoa thường; thư mục version không chứa tệp nào khác).

### 3.1. Tệp nội dung kỹ năng (`SKILL.md`)

- Định dạng văn bản thuần UTF-8 Markdown, tối đa 262.144 byte.
- Chứa toàn bộ hướng dẫn nghiệp vụ, công thức toán học, thuật toán, mã nguồn mẫu hoặc các tham số cần thiết để AI Agent thực thi kỹ năng.

### 3.2. Tệp đặc tả (`manifest.json`)

Phải tuân thủ schema JSON đóng với đúng 5 trường gốc sau:

```json
{
  "schema_version": 1,
  "identity": {
    "namespace": ["supply-chain", "inventory"],
    "capability": "safety-stock",
    "version": "1.0.0"
  },
  "content": {
    "path": "SKILL.md",
    "sha256": "MÃ_SHA256_CỦA_FILE_SKILL_MD"
  },
  "provenance": {
    "source_type": "demonstration",
    "references": [{ "type": "plan", "ref": "M8/T3-R1" }]
  },
  "lifecycle": [
    { "status": "CANDIDATE", "at": "2026-10-01T00:00:00Z", "actor": "excel" },
    {
      "status": "ACTIVE",
      "at": "2026-10-01T00:00:00Z",
      "actor": "owner",
      "decision_ref": "PLAN:M8/T3-R1"
    }
  ]
}
```

- **`identity`:** Định danh ổn định namespace + capability + version, phải khớp
  hoàn toàn với đường dẫn thư mục.
- **`content.sha256`:** Chuỗi băm SHA-256 viết thường (64 ký tự hex) của đúng
  các byte file `SKILL.md`. Mọi chỉnh sửa nội dung sau khi tạo manifest đều bị
  phát hiện (`CONTENT_DIGEST_MISMATCH` / `SOURCE_DRIFT_DETECTED`).
- **`provenance`:** `source_type` thuộc
  `owner-authored | demonstration | execution | correction | research`;
  tối đa 32 reference (`repository | url | plan | git`).
- **`lifecycle`:** Trạng thái vòng đời. Chỉ chấp nhận một trong 4 giá trị,
  theo đúng một trong các chuỗi sau:
  - `[CANDIDATE]`: bản nháp chờ phê duyệt (không bao giờ được index vector,
    không bao giờ trả về khi truy xuất).
  - `[CANDIDATE, ACTIVE]`: phiên bản hoạt động chính thức (mỗi capability chỉ
    được có duy nhất 1 phiên bản ACTIVE).
  - `[CANDIDATE, ACTIVE, DEPRECATED]`: phiên bản cũ không còn khuyến nghị.
  - `[CANDIDATE, REJECTED]`: đề xuất bị từ chối, không bao giờ thành ACTIVE.
  - Mọi sự kiện từ `ACTIVE` trở đi bắt buộc có `decision_ref` dạng
    `PLAN:M../T..-R..` (task id có thể có phần nhánh dấu chấm, ví dụ
    `PLAN:M12/T2.2-R3` — đúng dạng id mà `PLAN.md` dùng).

---

## 4. Thêm Kỹ Năng Mới (Skill Onboarding)

Có đúng 2 đường thêm kỹ năng. Đường (a) là đường chuẩn cho mọi kỹ năng do
agent học được; đường (b) chỉ dành cho owner tự biên soạn bootstrap.

### Đường (a): Vòng lặp học tập được quản trị (chuẩn)

1. Agent chuyên môn gọi `zink_skill_propose` với đầy đủ nội dung `SKILL.md`.
   Công cụ chỉ tạo bản ghi `CANDIDATE` lưu bền vững (durable proposal) —
   không tự kích hoạt, không tự publish.
2. Chủ sở hữu xem đúng nội dung đề xuất tại kênh `#office` và phê duyệt bằng
   action skill chuyên biệt (`zink:skill:approve`) gắn chặt proposal và mã băm
   nội dung. Phê duyệt skill không bao giờ đi qua phê duyệt kế hoạch thực thi.
3. Mã nội bộ tin cậy materialize cặp file chuẩn tắc (`SKILL.md` +
   `manifest.json`, vòng đời `CANDIDATE` rồi `ACTIVE`) rồi mới đồng bộ dẫn
   xuất sang PostgreSQL vector. Đề xuất lạ/không tồn tại, hết hạn, bị từ chối
   hoặc xung đột đều bị từ chối fail-closed.

Tuyệt đối không tự tạo/sửa file trong `skills/` để "kích hoạt" một kỹ năng:
catalog fail-closed sẽ phát hiện digest mismatch và toàn bộ truy xuất chuẩn
tắc bị chặn cho đến khi sửa đúng.

### Đường (b): Owner tự biên soạn bootstrap (hiếm)

Tạo thư mục tương ứng với namespace, capability và phiên bản:

```powershell
New-Item -ItemType Directory -Path "zink-skill-store/skills/supply-chain/inventory/safety-stock/1.0.0" -Force
```

Soạn thảo tệp `SKILL.md` (mã hóa UTF-8 không BOM), tính SHA-256 của đúng các
byte file:

```powershell
$hash = (Get-FileHash -Algorithm SHA256 -Path "zink-skill-store/skills/supply-chain/inventory/safety-stock/1.0.0/SKILL.md").Hash.ToLower()
```

Tạo `manifest.json` theo đúng schema tại mục 3 (identity khớp đường dẫn,
`content.sha256` bằng hash vừa tính, lifecycle `CANDIDATE` rồi `ACTIVE` kèm
`decision_ref` hợp lệ), sau đó chạy `validate` ở bước 5.

### Bước 5: Kiểm tra tính hợp lệ toàn diện của kho kỹ năng (`validate`)

Chạy công cụ CLI để xác nhận toàn bộ catalog hợp lệ:

```powershell
node zink-skill-store/bin/skill-store.mjs validate
```

Nếu thành công, màn hình sẽ in ra đúng một dòng JSON:

```json
{ "status": "valid", "manifest_count": 0 }
```

`manifest_count` là số bản ghi `manifest.json` đang có trong cây `skills/`.
Cây `skills/` được theo dõi trong repository này hiện chỉ chứa `README.md`,
nên số đó là `0` cho tới khi có promotion đầu tiên được owner phê duyệt; khi
cây đã có kỹ năng, số sẽ bằng số bản ghi thật. Lệnh `validate` không mở cổng
mạng và không ghi gì vào đĩa.

Catalog fail-closed: một bản ghi lỗi làm toàn bộ catalog không hợp lệ, kể cả
các bản ghi đúng khác — không có chế độ "đọc được phần đúng".

### Bước 6: Kiểm tra truy xuất kỹ năng (`get`)

Thử nghiệm truy xuất nội dung kỹ năng bằng lệnh `get` (chỉ trả về đúng phiên
bản `ACTIVE`):

```powershell
node zink-skill-store/bin/skill-store.mjs get --namespace supply-chain/inventory --capability safety-stock
```

Kết quả trả về JSON chứa đầy đủ `manifest` và nội dung Markdown `SKILL.md`.

---

## 5. Chi tiết Lệnh CLI & Bảng Mã Thoát (Exit Codes)

Công cụ CLI tại `bin/skill-store.mjs` trả về mã thoát (exit code) chuẩn POSIX:

| Mã thoát | Tên trạng thái           | Ý nghĩa                                                                             | Xử lý                                                                          |
| :------: | ------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **`0`**  | `SUCCESS`                | Lệnh thực thi thành công hoàn toàn                                                  | Tiếp tục quy trình                                                             |
| **`1`**  | `OPERATIONAL_FAILURE`    | Lệnh thất bại ngoài dự kiến; `stderr` nêu đúng mã lý do trong `error.code`          | Đọc `error.code` và `error.details` trong `stderr` rồi xử lý theo mã đó        |
| **`2`**  | `CATALOG_INVALID`        | Lỗi cú pháp JSON, sai schema manifest, sai mã băm SHA-256, hoặc trùng lặp phiên bản | Đọc thông báo chi tiết trong `stderr` và sửa lại manifest/hash                 |
| **`3`**  | `ACTIVE_SKILL_NOT_FOUND` | Không tìm thấy kỹ năng có trạng thái `ACTIVE` tương ứng                             | Kiểm tra lại cờ `--namespace`, `--capability` hoặc đặt `status` thành `ACTIVE` |
| **`4`**  | `CLI_INPUT_INVALID`      | Tham số dòng lệnh không đúng định dạng slug hoặc thiếu cờ                           | Kiểm tra lại cú pháp gọi lệnh CLI                                              |

Mã trong cột "Tên trạng thái" là mã **thật** do CLI phát ra trong `stderr`
(dưới dạng `{"error":{"code":...,"message":...,"details":[...]}}`), nên có thể
phân biệt bằng máy mà không phải đọc lời giải thích.

---

## 6. Quản trị & Sử dụng Template Báo cáo Chuẩn

Các mẫu báo cáo chuẩn lưu trữ tại `templates/`:

- **`templates/excel/`:** Chứa tệp `.xlsx` có sẵn cấu trúc bảng biểu, công thức Excel và định dạng chuẩn hóa.
- **`templates/power-bi/`:** Chứa tệp template `.pbix` hoặc `.pbit` đã định nghĩa sẵn mô hình dữ liệu (Star Schema), quan hệ và các chỉ số DAX.

### Quy tắc sử dụng template:

1. **Bảo toàn cấu trúc (Structural Invariance):** Các công cụ chuyên gia (`zink_excel`, `zink_power_bi`) khi nạp dữ liệu từ tầng Gold vào template phải giữ nguyên vẹn tên cột, công thức gốc và measure.
2. **Chỉ đọc (Read-only source):** Tệp template gốc trong `templates/` là tài sản tĩnh chỉ đọc; dữ liệu đầu ra được ghi sang tệp kết quả mới trong thư mục làm việc, không bao giờ ghi đè trực tiếp lên tệp template gốc.

---

## 7. Xử lý Sự cố Thường Gặp (Troubleshooting)

| Vấn đề                                                                                         | Nguyên nhân                                                                               | Cách khắc phục                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lệnh `validate` trả về mã 2 kèm lỗi digest mismatch                                            | Tệp `SKILL.md` đã bị chỉnh sửa sau khi tạo manifest                                       | Không tự sửa hash để "khớp": nội dung chuẩn tắc chỉ thay đổi qua promotion được phê duyệt; kiểm tra vòng đời và nguồn gốc bản ghi. Chú ý định dạng mã hóa UTF-8 (không có BOM). |
| Lệnh `get` trả về `ACTIVE_SKILL_NOT_FOUND` (mã 3)                                              | Kỹ năng có tồn tại nhưng đang ở trạng thái `CANDIDATE`/`REJECTED` hoặc catalog có lỗi     | Đề xuất `CANDIDATE` phải qua phê duyệt chủ sở hữu mới thành `ACTIVE`; bản ghi `REJECTED` không bao giờ thành `ACTIVE`. Kiểm tra lại cờ `--namespace`, `--capability`.           |
| Lỗi `CLI_INPUT_INVALID` (mã 4)                                                                 | Tên namespace hoặc capability chứa chữ in hoa hoặc ký tự `_`                              | Đổi tên thư mục và tham số sang chữ thường, dùng dấu gạch ngang `-` (vd: `supply-chain` thay vì `SupplyChain` hay `supply_chain`).                                              |
| Lỗi trùng lặp phiên bản (`MULTIPLE_ACTIVE_VERSIONS` khi đọc, `SKILL_VERSION_CONFLICT` khi ghi) | Có 2 thư mục kỹ năng cùng khai báo một phiên bản `ACTIVE` cho cùng namespace + capability | Đảm bảo mỗi phiên bản là duy nhất trong cùng một capability; writer sẽ từ chối (`SKILL_VERSION_CONFLICT`) trước khi tạo ra trạng thái đó.                                       |

---

## 8. Khôi phục lock ghi của kho kỹ năng (Operator lock recovery)

Skill Store dùng một writer lock riêng, đặt **cạnh** cây `skills/` (không
phải bên trong), và đặt tên theo cây nó bảo vệ. Khi một tiến trình bị giết
giữa chừng, thư mục lock còn lại và mọi lần promotion sau đó đều thất bại
fail-closed cho tới khi có người dọn.

Công cụ dưới đây là hành động vận hành đó, ở chế độ **chỉ đọc** mặc định:

```powershell
node zink-skill-store/bin/skill-store-lock-recovery.mjs --root <đường-dẫn-tuyệt-đối-tới-skills>
```

Nó in ra một dòng JSON gồm các thông tin suy ra được (lock có tồn tại, pid của
holder, holder còn sống hay không, các mục lạ trong thư mục lock) và **không
xoá gì cả**. Muốn dọn lock bị bỏ rơi, phải chứng minh holder đã chết và phải
gõ xác nhận:

```powershell
node zink-skill-store/bin/skill-store-lock-recovery.mjs --root <đường-dẫn> --recover --confirm=ORPHAN_LOCK_RECOVERY
```

Các trường hợp bị **từ chối** (không xoá gì): holder còn đang chạy, bản ghi
owner không đọc được hoặc sai dạng, thư mục lock có mục lạ, hoặc thiếu xác
nhận. Đây là các quy tắc giống hệt công cụ khôi phục lock của ledger.
