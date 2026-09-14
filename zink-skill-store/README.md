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
│   └── catalog.mjs                 # Logic quét catalog, kiểm tra schema và băm SHA-256
├── skills/                         # Thư mục gốc chứa các kỹ năng đã được chuẩn hóa
│   └── <namespace...>/             # Phân cấp danh mục (tối đa 8 cấp, vd: supply-chain/inventory)
│       └── <capability>/           # Tên kỹ năng cụ thể (vd: safety-stock)
│           └── <version>/          # Phiên bản SemVer (vd: 1.0.0 hoặc v1.0.0)
│               ├── manifest.json   # Tệp đặc tả cấu hình, metadata và băm SHA-256
│               └── skill.md        # Tệp hướng dẫn thực thi kỹ năng (Markdown UTF-8)
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

Mỗi phiên bản kỹ năng bắt buộc phải chứa đúng 2 tệp: `skill.md` và `manifest.json`.

### 3.1. Tệp nội dung kỹ năng (`skill.md`)

- Định dạng văn bản thuần UTF-8 Markdown.
- Chứa toàn bộ hướng dẫn nghiệp vụ, công thức toán học, thuật toán, mã nguồn mẫu hoặc các tham số cần thiết để AI Agent thực thi kỹ năng.

### 3.2. Tệp đặc tả (`manifest.json`)

Phải tuân thủ schema JSON đóng với các trường bắt buộc sau:

```json
{
  "name": "safety-stock",
  "namespace": "supply-chain/inventory",
  "version": "1.0.0",
  "status": "ACTIVE",
  "description": "Thuật toán tính toán tồn kho an toàn động dựa trên độ biến động nhu cầu và thời gian bổ hàng.",
  "entrypoint": "skill.md",
  "sha256": "3a8b4c9e1f2d3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b",
  "tags": ["inventory", "safety-stock", "supply-chain", "lead-time"]
}
```

- **`name`:** Tên kỹ năng, phải trùng khớp hoàn toàn với tên thư mục `<capability>`.
- **`namespace`:** Không gian tên phân cấp, khớp với đường dẫn thư mục `<namespace...>`.
- **`version`:** Phiên bản ngữ nghĩa SemVer (vd: `1.0.0`).
- **`status`:** Trạng thái vòng đời. Chỉ chấp nhận một trong 4 giá trị:
  - `ACTIVE`: Phiên bản hoạt động chính thức (mỗi capability chỉ được có duy nhất 1 phiên bản ACTIVE).
  - `DRAFT`: Đang trong giai đoạn phát triển hoặc kiểm thử.
  - `DEPRECATED`: Phiên bản cũ không còn khuyến nghị sử dụng.
  - `ARCHIVED`: Đã lưu trữ lịch sử, không sử dụng cho tác vụ mới.
- **`entrypoint`:** Bắt buộc phải là `"skill.md"`.
- **`sha256`:** Chuỗi băm SHA-256 viết thường (64 ký tự hex) của tệp `skill.md`.
- **`tags`:** Mảng chuỗi nhãn phân loại phục vụ tìm kiếm.

---

## 4. Hướng dẫn Từng Bước Thêm Kỹ Năng Mới (Skill Onboarding)

Để thêm một kỹ năng phân tích mới vào hệ thống, thực hiện tuần tự theo 6 bước sau:

### Bước 1: Khởi tạo cấu trúc thư mục

Tạo thư mục tương ứng với namespace, capability và phiên bản:

```powershell
New-Item -ItemType Directory -Path "zink-skill-store/skills/supply-chain/inventory/safety-stock/1.0.0" -Force
```

### Bước 2: Soạn thảo tệp hướng dẫn nghiệp vụ (`skill.md`)

Tạo tệp `skill.md` trong thư mục vừa tạo với nội dung nghiệp vụ chi tiết (mã hóa UTF-8 không BOM):

```powershell
@'
# Kỹ năng Tính Tồn Kho An Toàn (Safety Stock Calculation)

## Mục đích
Tính toán mức tồn kho an toàn nhằm bảo vệ chuỗi cung ứng trước sự biến động của nhu cầu và thời gian giao hàng (lead time).

## Công thức chuẩn
SS = Z * sqrt( (LeadTime_Avg * (Demand_StdDev ^ 2)) + ((Demand_Avg ^ 2) * (LeadTime_StdDev ^ 2)) )

Trong đó:
* Z: Hệ số mức dịch vụ (Service Level Factor), vd: 95% -> Z = 1.65.
* Demand_Avg, Demand_StdDev: Nhu cầu trung bình và độ lệch chuẩn nhu cầu.
* LeadTime_Avg, LeadTime_StdDev: Thời gian giao hàng trung bình và độ lệch chuẩn.
'@ | Out-File -FilePath "zink-skill-store/skills/supply-chain/inventory/safety-stock/1.0.0/skill.md" -Encoding utf8
```

### Bước 3: Tính toán mã băm SHA-256 chính xác của `skill.md`

Sử dụng PowerShell hoặc Node.js để lấy chuỗi SHA-256 chuẩn:

- **Cách 1: Bằng lệnh PowerShell:**

```powershell
$hash = (Get-FileHash -Algorithm SHA256 -Path "zink-skill-store/skills/supply-chain/inventory/safety-stock/1.0.0/skill.md").Hash.ToLower()
Write-Host "Mã SHA-256 là: $hash"
```

- **Cách 2: Bằng lệnh Node.js:**

```powershell
node -e "const crypto=require('crypto'),fs=require('fs'); console.log(crypto.createHash('sha256').update(fs.readFileSync('zink-skill-store/skills/supply-chain/inventory/safety-stock/1.0.0/skill.md')).digest('hex'))"
```

### Bước 4: Khởi tạo tệp đặc tả `manifest.json`

Tạo tệp `manifest.json` và điền giá trị hash vừa thu được:

```powershell
@'
{
  "name": "safety-stock",
  "namespace": "supply-chain/inventory",
  "version": "1.0.0",
  "status": "ACTIVE",
  "description": "Thuật toán tính toán tồn kho an toàn động dựa trên biến động nhu cầu và lead time.",
  "entrypoint": "skill.md",
  "sha256": "MÃ_HASH_VỪA_TÍNH_Ở_BƯỚC_3",
  "tags": ["inventory", "safety-stock", "supply-chain"]
}
'@ | Out-File -FilePath "zink-skill-store/skills/supply-chain/inventory/safety-stock/1.0.0/manifest.json" -Encoding utf8
```

### Bước 5: Kiểm tra tính hợp lệ toàn diện của kho kỹ năng (`validate`)

Chạy công cụ CLI để xác nhận toàn bộ catalog hợp lệ:

```powershell
node zink-skill-store/bin/skill-store.mjs validate
```

Nếu thành công, màn hình sẽ in ra:

```json
{ "status": "valid", "manifest_count": 1 }
```

### Bước 6: Kiểm tra truy xuất kỹ năng (`get`)

Thử nghiệm truy xuất nội dung kỹ năng bằng lệnh `get`:

```powershell
node zink-skill-store/bin/skill-store.mjs get --namespace supply-chain/inventory --capability safety-stock
```

Kết quả trả về JSON chứa đầy đủ `manifest` và nội dung Markdown `skill.md`.

---

## 5. Chi tiết Lệnh CLI & Bảng Mã Thoát (Exit Codes)

Công cụ CLI tại `bin/skill-store.mjs` trả về mã thoát (exit code) chuẩn POSIX:

| Mã thoát | Tên trạng thái           | Ý nghĩa                                                                             | Xử lý                                                                          |
| :------: | ------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **`0`**  | `SUCCESS`                | Lệnh thực thi thành công hoàn toàn                                                  | Tiếp tục quy trình                                                             |
| **`1`**  | `OPERATIONAL_FAILURE`    | Lỗi hệ thống ngoại lệ ngoài dự kiến                                                 | Kiểm tra quyền truy cập đĩa hoặc Node.js runtime                               |
| **`2`**  | `CATALOG_ERROR`          | Lỗi cú pháp JSON, sai schema manifest, sai mã băm SHA-256, hoặc trùng lặp phiên bản | Đọc thông báo chi tiết trong `stderr` và sửa lại manifest/hash                 |
| **`3`**  | `ACTIVE_SKILL_NOT_FOUND` | Không tìm thấy kỹ năng có trạng thái `ACTIVE` tương ứng                             | Kiểm tra lại cờ `--namespace`, `--capability` hoặc đặt `status` thành `ACTIVE` |
| **`4`**  | `CLI_INPUT_INVALID`      | Tham số dòng lệnh không đúng định dạng slug hoặc thiếu cờ                           | Kiểm tra lại cú pháp gọi lệnh CLI                                              |

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

| Vấn đề                                                | Nguyên nhân                                                          | Cách khắc phục                                                                                                                      |
| ----------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Lệnh `validate` trả về mã 2 kèm lỗi `SHA256_MISMATCH` | Tệp `skill.md` đã bị chỉnh sửa sau khi tạo manifest                  | Chạy lại lệnh tính SHA-256 ở Bước 3 và cập nhật trường `sha256` trong `manifest.json`. Chú ý định dạng mã hóa UTF-8 (không có BOM). |
| Lệnh `get` trả về `ACTIVE_SKILL_NOT_FOUND` (mã 3)     | Kỹ năng có tồn tại nhưng đang ở trạng thái `DRAFT` hoặc `DEPRECATED` | Nếu kỹ năng đã sẵn sàng sử dụng, đổi `"status": "ACTIVE"` trong `manifest.json`.                                                    |
| Lỗi `CLI_INPUT_INVALID` (mã 4)                        | Tên namespace hoặc capability chứa chữ in hoa hoặc ký tự `_`         | Đổi tên thư mục và tham số sang chữ thường, dùng dấu gạch ngang `-` (vd: `supply-chain` thay vì `SupplyChain` hay `supply_chain`).  |
| Lỗi trùng lặp phiên bản (`DUPLICATE_VERSION`)         | Có 2 thư mục kỹ năng cùng khai báo một phiên bản                     | Đảm bảo mỗi phiên bản là duy nhất trong cùng một capability.                                                                        |
