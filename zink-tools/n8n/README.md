# Hướng dẫn Sử dụng Bộ điều hợp n8n (zink_n8n)

Tài liệu này hướng dẫn chi tiết cách thức kích hoạt các luồng công việc tự động tất định (deterministic workflows) trên n8n bằng tiếng Việt, tuần tự theo đúng logic mã nguồn tại [`n8n/trigger.mjs`](trigger.mjs).

---

## 1. Giới thiệu & Phạm vi

`zink_n8n` là bộ điều hợp (adapter) cho phép OpenClaw kích hoạt các luồng tự động hóa trên n8n thông qua webhook cục bộ.

- **Agent được phép gọi:** Agent `o2` (Orchestrator) và `python` (`TOOL_POLICY.o2 = ["zink_n8n"]`, `TOOL_POLICY.python = ["zink_python", "zink_n8n"]`).
- **Lược đồ hợp đồng:** [`contracts/tools/zink-n8n.schema.json`](../contracts/tools/zink-n8n.schema.json).
- **Mã nguồn kích hoạt:** [`n8n/trigger.mjs`](trigger.mjs).
- **Ranh giới mạng:** **CHỈ LOCALHOST** (`http://127.0.0.1:5678`), nghiêm cấm mở public webhook hoặc tạo tunnel ra ngoài Internet.

---

## 2. Danh sách Luồng công việc Được phép (Workflow Registry)

Hệ thống chỉ chấp nhận đúng 3 luồng công việc đã đăng ký:

| Định danh Luồng (`workflow_id`) | Agent được gọi | Mục đích sử dụng                                    | Dữ liệu đầu ra chuẩn                      |
| ------------------------------- | -------------- | --------------------------------------------------- | ----------------------------------------- |
| `data_plant_ingest`             | `o2`, `python` | Tiếp nhận và kéo dữ liệu từ nguồn ngoài vào Landing | `ingest_id`, `status`, `records_ingested` |
| `data_plant_sync`               | `o2`           | Đồng bộ cấu trúc bảng và metadata                   | `sync_id`, `status`, `synced_tables`      |
| `pipeline_notify`               | `o2`, `python` | Gửi thông báo trạng thái hoàn tất luồng             | `delivered` (boolean), `notification_id`  |

---

## 3. Hướng dẫn Sử dụng Từng bước qua Code

### Bước 1: Khởi động dịch vụ n8n Docker

Trước khi gọi, đảm bảo n8n container đang chạy:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/start.ps1 -Profile automation -EnvironmentFile ./infrastructure/docker/env/.env
```

Truy cập kiểm tra giao diện n8n: `http://127.0.0.1:5678`.

### Bước 2: Kích hoạt luồng n8n thông qua `invokeN8n`

```javascript
import { invokeN8n } from "./zink-tools/n8n/trigger.mjs";

// Ngữ cảnh ủy quyền đã qua kiểm tra của OpenClaw Governance Guard
const decisionContext = {
  scope: {
    common: {
      toolId: "zink_n8n",
      agentId: "o2", // Hoặc "python"
      taskId: "task-workflow-01",
      runId: "run-01",
    },
  },
};

// Dữ liệu đầu vào theo zink-n8n.schema.json
const input = {
  workflow_id: "data_plant_ingest",
  payload: {
    source_name: "crm_customer_records",
    batch_size: 100,
  },
  timeout_ms: 10000, // Tùy chọn, tối đa 30,000ms
};

const result = await invokeN8n(decisionContext, input);

console.log(`Trạng thái thực thi: ${result.status}`);
console.log(`Dữ liệu đầu ra:`, result.data);
```

---

## 4. Các Lỗi Thường gặp & Xử lý

| Mã lỗi                         | Nguyên nhân                                          | Cách khắc phục                                               |
| ------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------ |
| `RUNTIME_CAPABILITY_MISMATCH`  | `workflow_id` không tồn tại trong danh mục           | Chỉ định đúng 1 trong 3 workflow ở bảng trên                 |
| `AUTH_POLICY_DENIED`           | Agent gọi không có quyền kích hoạt workflow này      | Dùng agent `o2` hoặc `python`                                |
| `ENDPOINT_COMMUNICATION_ERROR` | Không thể kết nối tới n8n (cổng 5678)                | Kiểm tra Docker container n8n xem đã bật chưa                |
| `EXECUTION_TIMED_OUT`          | Workflow chạy vượt quá trần thời gian (`timeout_ms`) | Tối ưu hóa workflow hoặc tăng timeout trong hạn mức cho phép |
