# Hướng dẫn Sử dụng Công cụ Excel (zink_excel)

Tài liệu này hướng dẫn chi tiết cách thức sử dụng giao diện công cụ `zink_excel` bằng tiếng Việt, tuần tự theo đúng logic mã nguồn và hợp đồng kỹ thuật.

---

## 1. Giới thiệu & Phạm vi

`zink_excel` cung cấp các thao tác có kiểm soát đối với bảng tính Microsoft Excel trong hệ sinh thái Zink.

- **Agent được phép gọi:** Duy nhất agent `excel` (`TOOL_POLICY.excel = ["zink_excel"]`).
- **Lược đồ hợp đồng:** [`contracts/tools/zink-excel.schema.json`](../contracts/tools/zink-excel.schema.json).
- **Văn bản hợp đồng:** [`excel/contract.md`](contract.md).
- **Thư mục template chuẩn:** Lưu trữ tại [`zink-skill-store/templates/excel/`](../../zink-skill-store/templates/excel/).

---

## 2. Các Thao tác Hợp đồng Được hỗ trợ

Công cụ hỗ trợ đúng 4 thao tác đóng (closed operations):

1. **`load`:** Đọc và kiểm tra cấu trúc metadata của workbook và danh sách các sheet.
2. **`populate`:** Điền dữ liệu từ tầng Gold vào template có sẵn. **Yêu cầu phê duyệt xác thực từ chủ sở hữu (Owner Approval Required).**
3. **`validate`:** Đánh giá dữ liệu trong workbook theo các quy tắc nghiệp vụ.
4. **`generate`:** Tạo bảng tính mới dựa trên bản đặc tả kỹ thuật. **Yêu cầu phê duyệt xác thực từ chủ sở hữu.**

---

## 3. Hướng dẫn Sử dụng Từng bước

### Bước 1: Chuẩn bị đường dẫn tệp logic

Mọi đường dẫn tệp đều phải được xác thực qua bộ kiểm tra an toàn `validateArtifactLogicalPath`, nằm trong ranh giới thư mục cho phép (cấm duyệt thư mục qua `..` hoặc dùng đường dẫn tuyệt đối trái phép).

### Bước 2: Cấu hình phong bì gọi công cụ (Tool Call)

```javascript
// Ví dụ cấu trúc gọi lệnh load để kiểm tra bảng tính
const toolCallPayload = {
  operation: "load",
  file_path: "templates/supply_chain_report.xlsx",
  options: {
    read_only: true,
  },
};
```

Đối với các thao tác nhạy cảm (`populate`, `generate`), bắt buộc phải kèm theo mã phê duyệt hợp lệ `approval_id` đã được xác thực qua Ledger:

```javascript
// Ví dụ cấu trúc điền dữ liệu vào template
const sensitiveCallPayload = {
  operation: "populate",
  file_path: "reports/monthly_inventory_2026_09.xlsx",
  approval_id: "appr-valid-ledger-token",
  data_payload: {
    sheet_name: "Inventory_Gold",
    range: "A2:E100",
    values: [/* Dữ liệu lấy từ tầng Gold */],
  },
};
```

---

## 4. Các Ranh giới An toàn Bắt buộc

- **Bảo vệ Template:** Nghiêm cấm tự ý thiết kế lại hoặc xóa cấu trúc template chuẩn của chủ sở hữu trong Skill Store.
- **Chống phát lại mã phê duyệt (Anti-replay):** Mỗi `approval_id` chỉ có hiệu lực sử dụng đúng một lần duy nhất, các lần gọi lặp lại sẽ bị ném lỗi `AUTH_APPROVAL_REPLAYED`.
