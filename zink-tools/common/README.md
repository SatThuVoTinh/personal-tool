# Hướng dẫn Sử dụng Tiện ích Dùng chung (Zink Common Utilities)

Tài liệu này hướng dẫn chi tiết cách thức sử dụng các tiện ích an toàn dùng chung tại thư mục `zink-tools/common/` bằng tiếng Việt, tuần tự theo đúng logic mã nguồn thực tế.

---

## 1. Giới thiệu

Thư mục `zink-tools/common/` chứa các hàm kiểm tra an toàn hạt nhân được sử dụng xuyên suốt các công cụ Zink và bộ điều phối:

- **Mã nguồn:** [`common/path-safety.mjs`](path-safety.mjs).
- **Mục tiêu:** Đảm bảo mọi đường dẫn tệp (file path) và tham số định danh đều tuân thủ nguyên tắc bảo mật, ngăn chặn tấn công duyệt thư mục (path traversal) và thoát sandbox.

---

## 2. Tiện ích Kiểm tra An toàn Đường dẫn (`validateArtifactLogicalPath`)

Hàm `validateArtifactLogicalPath(logicalPath)` thực thi các quy tắc kiểm tra nghiêm ngặt:

1. **Độ dài hợp lệ:** Từ 1 đến 512 ký tự.
2. **Ký tự cấm:** Nghiêm cấm ký tự `NUL` (`\0`) và các ký tự điều khiển ASCII (`\x01-\x1F\x7F`).
3. **Chỉ chấp nhận đường dẫn tương đối:**
   - Cấm dấu gạch chéo đầu dòng (`/` hoặc `\`).
   - Cấm ổ đĩa Windows (như `C:`, `D:`).
   - Cấm đường dẫn mạng UNC (`\\server\share`).
4. **Chống duyệt cây thư mục:**
   - Cấm các phân đoạn rỗng (`//`).
   - Cấm thư mục hiện tại (`.`) và thư mục cha (`..`).
5. **Ký tự cho phép trong từng phân đoạn:** Chỉ bao gồm `[a-zA-Z0-9_.-]`.
6. **Chống tên thiết bị dành riêng của Windows (Reserved Device Names):** Cấm các tên `CON`, `PRN`, `AUX`, `NUL`, `COM1-COM9`, `LPT1-LPT9` (không phân biệt hoa thường).

---

## 3. Hướng dẫn Sử dụng Từng bước qua Code

### Bước 1: Import hàm kiểm tra an toàn

```javascript
import { validateArtifactLogicalPath } from "./zink-tools/common/path-safety.mjs";
```

### Bước 2: Kiểm tra đường dẫn trước khi truy cập tệp

```javascript
// Ví dụ 1: Đường dẫn hợp lệ -> Trả về đường dẫn đã chuẩn hóa
const safePath = validateArtifactLogicalPath(
  "reports/q3/inventory_summary.xlsx",
);
console.log(`Đường dẫn hợp lệ: ${safePath}`);

// Ví dụ 2: Đường dẫn nguy hiểm -> Ném lỗi SCHEMA_VALIDATION_FAILED
try {
  validateArtifactLogicalPath("../../etc/passwd");
} catch (err) {
  console.error("Phát hiện đường dẫn không an toàn:", err.message);
}
```

---

## 4. Bảng Tra cứu Kiểm tra Hợp lệ / Bất hợp lệ

| Đường dẫn kiểm tra        | Kết quả               | Lý do                                              |
| ------------------------- | --------------------- | -------------------------------------------------- |
| `data/sales.csv`          | **HỢP LỆ (PASS)**     | Đường dẫn tương đối chuẩn                          |
| `reports/v1.0/kpi.xlsx`   | **HỢP LỆ (PASS)**     | Chứa ký tự số, chữ, dấu chấm                       |
| `/root/data.csv`          | **BỊ TỪ CHỐI (DENY)** | Bắt đầu bằng dấu gạch chéo tuyệt đối               |
| `C:\data\file.txt`        | **BỊ TỪ CHỐI (DENY)** | Chứa ổ đĩa Windows tuyệt đối                       |
| `data/../secret.db`       | **BỊ TỪ CHỐI (DENY)** | Chứa ký hiệu duyệt thư mục cha `..`                |
| `reports/CON.txt`         | **BỊ TỪ CHỐI (DENY)** | Chứa tên thiết bị dành riêng của Windows           |
| `data/tệp_tiếng_việt.csv` | **BỊ TỪ CHỐI (DENY)** | Ký tự ngoài bảng mã ASCII an toàn `[a-zA-Z0-9_.-]` |
