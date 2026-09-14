# Hướng dẫn Sử dụng Công cụ Power BI (zink_power_bi)

Tài liệu này hướng dẫn chi tiết cách thức sử dụng giao diện công cụ `zink_power_bi` bằng tiếng Việt, tuần tự theo đúng logic mã nguồn và hợp đồng kỹ thuật.

---

## 1. Giới thiệu & Phạm vi

`zink_power_bi` cung cấp các thao tác quản trị mô hình ngữ nghĩa dữ liệu (semantic data models) và dự án Power BI trong hệ sinh thái Zink.

- **Agent được phép gọi:** Duy nhất agent `power-bi` (`TOOL_POLICY["power-bi"] = ["zink_power_bi"]`).
- **Lược đồ hợp đồng:** [`contracts/tools/zink-power-bi.schema.json`](../contracts/tools/zink-power-bi.schema.json).
- **Văn bản hợp đồng:** [`power-bi/contract.md`](contract.md).
- **Thư mục template chuẩn:** Lưu trữ tại [`zink-skill-store/templates/power-bi/`](../../zink-skill-store/templates/power-bi/).

---

## 2. Các Thao tác Hợp đồng Được hỗ trợ

Công cụ hỗ trợ đúng 4 thao tác đóng (closed operations):

1. **`load`:** Đọc thông tin cấu trúc metadata, định nghĩa bảng và độ đo (measures) của semantic model.
2. **`bind`:** Ràng buộc nguồn dữ liệu (tầng Gold hoặc MotherDuck) vào model. **Yêu cầu phê duyệt xác thực từ chủ sở hữu (Owner Approval Required).**
3. **`update`:** Áp dụng các thay đổi về lược đồ, cột tính toán và DAX measure vào model. **Yêu cầu phê duyệt xác thực từ chủ sở hữu.**
4. **`validate`:** Kiểm tra tính toàn vẹn và nhất quán của toàn bộ semantic model.

---

## 3. Hướng dẫn Sử dụng Từng bước

### Bước 1: Nạp và kiểm tra Semantic Model (`load`)

```javascript
const loadPayload = {
  operation: "load",
  model: "templates/supply_chain_kpi.pbix",
  options: {
    inspect_measures: true,
  },
};
```

### Bước 2: Ràng buộc Nguồn dữ liệu Tầng Gold (`bind`)

Thao tác `bind` làm thay đổi nguồn dữ liệu nên bắt buộc phải có `approval_id` hợp lệ được cấp quyền qua quy trình phê duyệt của OpenClaw:

```javascript
const bindPayload = {
  operation: "bind",
  model: "reports/q3_supply_chain.pbix",
  approval_id: "appr-ledger-bind-token",
  datasource: {
    type: "duckdb_gold",
    endpoint: "http://127.0.0.1:8501",
    tables: ["gold_revenue_summary", "gold_inventory_kpis"],
  },
};
```

### Bước 3: Kiểm định tính nhất quán (`validate`)

Trước khi xuất bản báo cáo, chạy thao tác `validate` để đảm bảo không có measure bị gãy hoặc thiếu cột:

```javascript
const validatePayload = {
  operation: "validate",
  model: "reports/q3_supply_chain.pbix",
};
```

---

## 4. Các Ranh giới An toàn Bắt buộc

- **Bảo vệ Cấu trúc Báo cáo:** Nghiêm cấm tự ý thiết kế lại hoặc làm sai lệch cấu trúc báo cáo chuẩn đã được chủ sở hữu phê duyệt trong Skill Store.
- **Cơ chế Duyệt Thao tác Nhạy cảm:** Mọi thao tác `bind` và `update` đều phải đi qua hàng rào kiểm duyệt hai lớp (Governance Guard) và ghi nhận vào Ledger sự kiện.
