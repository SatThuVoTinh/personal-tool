# Hướng dẫn Sử dụng Hợp đồng Lược đồ Công cụ (Zink Tool Contracts)

Tài liệu này hướng dẫn chi tiết cách thức sử dụng các hợp đồng JSON Schema tại thư mục `zink-tools/contracts/` bằng tiếng Việt, tuần tự theo đúng logic mã nguồn thực tế.

---

## 1. Giới thiệu & Vai trò

Mọi tương tác gọi công cụ và trả lời kết quả trong hệ sinh thái Zink đều phải được đóng gói vào các phong bì hợp đồng (Contract Envelopes) và xác thực chặt chẽ qua JSON Schema:

- **Chuẩn JSON Schema:** Draft 2020-12.
- **Nguyên tắc đóng (Closed Object Models):** Mọi object đều thiết lập `additionalProperties: false` để chống rò rỉ hoặc tiêm thuộc tính trái phép.

---

## 2. Hai Phong bì Hợp đồng Cốt lõi

### 2.1. Phong bì Gọi công cụ (`tool-call.schema.json`)

Quy định cấu trúc mà OpenClaw phải cung cấp khi gọi bất kỳ công cụ Zink nào:

- `tool_id`: Tên công cụ (ví dụ: `zink_sql`, `zink_python`).
- `task_id`: Định danh tác vụ hiện hành.
- `operation`: Tên thao tác cần thực thi.
- `parameters`: Tham số đầu vào tương ứng với từng công cụ.
- `approval_id`: (Bắt buộc với các thao tác nhạy cảm như `populate`, `generate`, `bind`, `update`).

### 2.2. Phong bì Kết quả (`tool-result.schema.json`)

Quy định cấu trúc mà công cụ Zink phải trả lời về cho OpenClaw:

- `status`: `"SUCCESS"` hoặc `"ERROR"`.
- `tool_id`: Khớp chính xác với công cụ được gọi.
- `task_id`: Khớp chính xác với task_id yêu cầu.
- `data`: Kết quả đầu ra (chỉ có khi `status: "SUCCESS"`).
- `error`: Thông tin lỗi chuẩn hóa gồm `code` và `message` (chỉ có khi `status: "ERROR"`).

---

## 3. Danh mục Lược đồ Cho Từng Công cụ (`contracts/tools/`)

| Tên Schema                             | Trạng thái                | Năng lực quản lý                                               |
| -------------------------------------- | ------------------------- | -------------------------------------------------------------- |
| `zink-sql.schema.json`                 | Callable Interface        | Truy vấn SQL phân tích (query, target_database, parameters)    |
| `zink-python.schema.json`              | Callable Interface        | Thực thi mã số học và xử lý dữ liệu định lượng                 |
| `zink-n8n.schema.json`                 | Governed Adapter          | Kích hoạt webhook n8n tất định                                 |
| `zink-excel.schema.json`               | Callable Interface        | Xử lý bảng tính Excel (load, populate, validate, generate)     |
| `zink-power-bi.schema.json`            | Callable Interface        | Quản lý semantic model Power BI (load, bind, update, validate) |
| `zink-forecast.schema.json`            | Schema-Only Specification | Đặc tả bài toán dự báo chuỗi thời gian                         |
| `zink-optimization.schema.json`        | Schema-Only Specification | Đặc tả bài toán tối ưu hóa và quy hoạch toán học               |
| `zink-operations-research.schema.json` | Schema-Only Specification | Đặc tả bài toán nghiên cứu vận hành và luồng mạng              |
| `zink-simulation.schema.json`          | Schema-Only Specification | Đặc tả bài toán mô phỏng ngẫu nhiên và sự kiện rời rạc         |

---

## 4. Hướng dẫn Xác thực Payload Từng bước qua Code

```javascript
import fs from "node:fs";
import path from "node:path";
import { validateContractSchema } from "../../integrations/openclaw/topology/lib/guard.mjs";

// Đọc lược đồ hợp đồng
const schemaPath = path.resolve(
  "zink-tools/contracts/tools/zink-sql.schema.json",
);
const sqlSchema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

// Payload cần kiểm tra
const payload = {
  query: "SELECT id, name FROM knowledge",
  target_database: "knowledge",
  max_rows: 50,
};

// Xác thực tính tuân thủ hợp đồng
const isValid = validateContractSchema(sqlSchema, payload);
if (isValid) {
  console.log("Payload hoàn toàn hợp lệ theo hợp đồng zink-sql.");
}
```
