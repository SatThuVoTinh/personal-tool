# Hướng dẫn Sử dụng Công cụ Python (zink_python)

Tài liệu này hướng dẫn chi tiết cách thức sử dụng giao diện công cụ `zink_python` bằng tiếng Việt, tuần tự theo logic mã nguồn thực tế.

---

## 1. Giới thiệu & Phạm vi

`zink_python` cung cấp môi trường tính toán số học, làm sạch dữ liệu, phân tích định lượng và tích hợp khoa học quyết định.

- **Agent được phép gọi:** Duy nhất agent `python` (`TOOL_POLICY.python = ["zink_python", "zink_n8n"]`).
- **Lược đồ hợp đồng:** [`contracts/tools/zink-python.schema.json`](../contracts/tools/zink-python.schema.json).
- **Văn bản hợp đồng:** [`python/contract.md`](contract.md).

---

## 2. Các Quy trình Sử dụng Chính

Công cụ Python đóng vai trò cốt lõi trong các mẫu điều phối:

1. **Mẫu P2 (Làm sạch dữ liệu):** Nhận artifact thô từ R2 Landing, thực hiện kiểm tra schema, chuẩn hóa kiểu dữ liệu, loại bỏ giá trị rỗng/ngoại lai, và ghi sang R2 Silver có quản lý phiên bản.
2. **Mẫu P6 (Chuẩn bị đặc trưng cho tính toán ngoại vi):** Đọc dữ liệu từ tầng Gold, trích xuất ma trận đặc trưng (feature matrix) và chuyển giao cho Kaggle hoặc Databricks.
3. **Mẫu P7 (Theo dõi thí nghiệm MLOps):** Ghi log tham số mô hình, hàm mất mát (loss) và độ đo (metrics) vào MLflow Local, sau đó đồng bộ các run được duyệt lên DagsHub.

---

## 3. Hướng dẫn Thực thi Từng bước qua Code

### Bước 1: Làm sạch dữ liệu từ Landing sang Silver (Mẫu P2)

```javascript
import { R2StorageAdapter } from "../adapters/storage/r2-adapter.mjs";
import { executePattern2_R2LandingToCleanSilver } from "../../integrations/openclaw/orchestration/patterns/index.mjs";

const r2 = new R2StorageAdapter();
const context = { agent_id: "python", task_id: "task-cleaning-01" };

// Hàm làm sạch dữ liệu tất định
const cleaner = (rawData) => ({
  records: rawData.records.filter((r) => r.id > 0),
  cleaned_at: new Date().toISOString(),
  quality_gate: "PASSED",
});

const silverResult = await executePattern2_R2LandingToCleanSilver({
  context,
  artifact_id: "landing-data-01.json",
  r2Adapter: r2,
  cleanerFn: cleaner,
});

console.log(
  `Đã tạo artifact Silver: ${silverResult.silver_artifact.artifact_id} (Version ${silverResult.silver_artifact.version})`,
);
```

### Bước 2: Ghi log thí nghiệm với MLflow Local (Mẫu P7)

```javascript
import { MLflowLocalAdapter } from "../adapters/mlops/mlflow-adapter.mjs";

const mlflow = new MLflowLocalAdapter();

// Khởi tạo một run thí nghiệm mới
const run = await mlflow.createRun({
  experiment_name: "supply-chain-forecast",
  run_name: "arima-baseline-01",
});

// Ghi nhận tham số và độ đo
await mlflow.logParameters(run.run_id, { p: 2, d: 1, q: 2, horizon: 30 });
await mlflow.logMetrics(run.run_id, { mape: 0.042, rmse: 12.8 });
await mlflow.endRun(run.run_id, "FINISHED");

console.log(`Run hoàn tất: ${run.run_id}`);
```

---

## 4. Các Ranh giới An toàn Bắt buộc

- **CẤM** thực thi mã tải về tùy ý từ Internet (`NO arbitrary downloaded code execution`).
- **CẤM** tự ý thăng cấp (promote) mô hình hoặc dữ liệu ngoài luồng vào Knowledgebase.
- Mọi xử lý phải có cơ chế giới hạn thời gian (bounded timeout) và báo cáo lỗi chuẩn hóa.
