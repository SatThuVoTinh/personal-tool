# Hướng dẫn Sử dụng Bộ điều hợp Hạ tầng Ngoại vi (Zink Adapters)

> ## ⚠️ Trạng thái thật của toàn bộ adapter trong thư mục này
>
> **Tất cả 9 adapter hạ tầng ngoại vi dưới đây là CONTRACT TEST DOUBLE (giả lập), KHÔNG phải tích hợp nhà cung cấp thật.**
>
> | Vấn đề                | Thực tế                                                                                                                                                                                          |
> | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
> | Gọi mạng tới provider | **Không có.** Không adapter nào mở socket hay import HTTP client.                                                                                                                                |
> | Dùng credential       | **Không.** `token`, `apiToken`, `key`, `username`, `endpoint` được nhận vào rồi **không bao giờ đọc lại**. Token không được dùng không phải là tích hợp.                                         |
> | Lưu trữ bền vững      | **Không.** `storage` là `Map` trong bộ nhớ, mất sạch khi tiến trình kết thúc. Một `Map` không phải R2 hay MLflow.                                                                                |
> | Có thể fail-closed    | **Phần lớn không.** Nhiều adapter trả `SUCCESS` vô điều kiện; chỉ có cờ `simulateTimeout` / `simulateAuthFailure` (chỉ dùng cho test) là đường thất bại.                                         |
> | Kết quả trả về        | **Dữ liệu cứng trong mã.** `run_id` sinh bằng `randomBytes` không phải run của Databricks; metric cố định không phải đánh giá Hugging Face; chuỗi URL không phải thao tác publish của Streamlit. |
>
> **Vì vậy:**
>
> - Được phép dùng để kiểm thử **hợp đồng** (bất biến landing, đánh phiên bản, checksum, xác thực người gọi).
> - **Tuyệt đối không** được dùng để tạo bằng chứng, kết quả nghiệm thu, hay tuyên bố rằng đã thực thi với provider thật.
> - Nối backend thật là **một task riêng cần owner phê duyệt**, không phải việc làm thêm cho xong trong task này.
>
> Hai adapter **KHÔNG** nằm trong danh sách giả lập và là đường thực thi thật:
> `adapters/knowledge/knowledge-adapter.mjs` (HTTP client thật tới Knowledgebase) và
> `adapters/skill-store/skill-adapter.mjs` (băm SHA-256 thật trên nội dung đã lưu).
>
> Ngoài ra `zink-tools/n8n/trigger.mjs` là adapter **thật**: nó gọi webhook n8n qua loopback
> và thực thi kiểm tra registry, timeout, chặn redirect, giới hạn kích thước và chuẩn hóa lỗi.
> Nó được nối qua `CALLABLE_DISPATCH_REGISTRY` với mục `zink_n8n -> "adapter"`.

Tài liệu này hướng dẫn chi tiết cách thức sử dụng 9 bộ điều hợp hạ tầng ngoại vi (Infrastructure Adapters) tại thư mục `zink-tools/adapters/` bằng tiếng Việt, tuần tự theo đúng logic mã nguồn thực tế.

---

## 1. Giới thiệu & Vai trò Kiến trúc

Các bộ điều hợp tại `zink-tools/adapters/` là các **backend thực thi đứng sau 5 công cụ Zink hiện có**, không phải là các công cụ Zink độc lập mới.

- **Nguyên tắc an toàn:** Không tự động tạo tài khoản, không lưu trữ thông tin xác thực vào mã nguồn, chỉ giao tiếp qua giao thức an toàn.
- **Tệp xuất trung tâm:** [`zink-tools/adapters/index.mjs`](index.mjs).

---

## 2. Danh mục 9 Bộ điều hợp và Cách Sử dụng

### 2.1. Cloudflare R2 (`storage/r2-adapter.mjs`)

> **Trạng thái: SIMULATION / contract test double.** Không gọi Cloudflare R2, không dùng credential, lưu trữ trong Map của bộ nhớ.

Quản lý lưu trữ đối tượng với hai phân vùng logic:

- **Tầng Landing:** Lưu dữ liệu thô từ nguồn vào; **bất biến hoàn toàn** (mọi nỗ lực ghi đè sẽ ném lỗi `R2_LANDING_IMMUTABLE_VIOLATION`).
- **Tầng Silver:** Lưu dữ liệu đã làm sạch; **quản lý theo số phiên bản** (`v1`, `v2`).

```javascript
import { R2StorageAdapter } from "./zink-tools/adapters/storage/r2-adapter.mjs";

const r2 = new R2StorageAdapter();

// 1. Ghi vào Landing
const landing = await r2.putLandingArtifact({
  task_id: "task-01",
  run_id: "run-101",
  artifact_id: "raw-orders.json",
  data: JSON.stringify([{ id: 1, amount: 250 }]),
});

// 2. Thăng cấp lên Silver (có phiên bản)
const silver = await r2.promoteToSilver({
  task_id: "task-01",
  run_id: "run-101",
  artifact_id: "clean-orders",
  version: 1,
  data: JSON.stringify([{ id: 1, amount: 250, validated: true }]),
});
```

---

### 2.2. MotherDuck (`analytics/motherduck-adapter.mjs`)

> **Trạng thái: SIMULATION / contract test double.** Không gọi MotherDuck; trả 2 dòng Gold cứng.

Hỗ trợ thực thi truy vấn SQL phân tích từ xa đằng sau năng lực `zink_sql`.

```javascript
import { MotherDuckAdapter } from "./zink-tools/adapters/analytics/motherduck-adapter.mjs";

const md = new MotherDuckAdapter();
const context = { agent_id: "sql", task_id: "task-01" };

const result = await md.executeQuery(context, {
  query: "SELECT id, name, value FROM analytics_read",
  target_database: "analytics_read",
  max_rows: 100,
});
console.table(result.rows);
```

---

### 2.3. Google BigQuery (`analytics/bigquery-adapter.mjs`)

> **Trạng thái: SIMULATION / contract test double.** Không gọi BigQuery, không có token, không có SDK; trả 1 dòng cứng.

Hỗ trợ truy vấn phân tích trên Cloud Data Warehouse BigQuery.

```javascript
import { BigQueryAdapter } from "./zink-tools/adapters/analytics/bigquery-adapter.mjs";

const bq = new BigQueryAdapter({ projectId: "personal-tool-prod" });
const context = { agent_id: "sql", task_id: "task-01" };

const result = await bq.executeQuery(context, {
  query: "SELECT dataset_name, total_records FROM cloud_analytics_lake",
  target_database: "cloud_analytics_lake",
});
```

---

### 2.4. Kaggle Compute (`compute/kaggle-adapter.mjs`)

> **Trạng thái: SIMULATION / contract test double.** run_id được sinh ngẫu nhiên, không phải run thật của Kaggle.

Kích hoạt các tác vụ tính toán nặng (huấn luyện batch, chạy notebook trên GPU) ngoại vi. Bắt buộc có ngữ cảnh `task_id`.

```javascript
import { KaggleComputeAdapter } from "./zink-tools/adapters/compute/kaggle-adapter.mjs";

const kaggle = new KaggleComputeAdapter();
const context = { task_id: "task-01" };

const job = await kaggle.triggerJob(context, {
  kernel_slug: "gold-feature-model-train",
  dataset_sources: ["gold_features_r2"],
});
console.log(`Job ID: ${job.job_id}, Trạng thái: ${job.status}`);
```

---

### 2.5. Databricks Compute (`compute/databricks-adapter.mjs`)

> **Trạng thái: SIMULATION / contract test double.** run_id ngẫu nhiên và state SUCCESS cố định, không phải job Databricks thật.

Điều phối và kích hoạt job xử lý phân tán trên nền tảng Databricks.

```javascript
import { DatabricksComputeAdapter } from "./zink-tools/adapters/compute/databricks-adapter.mjs";

const dbr = new DatabricksComputeAdapter();
const context = { task_id: "task-01" };

const job = await dbr.triggerJob(context, {
  job_id: 1042,
  notebook_path: "/Shared/FeatureETL",
});
console.log(`Run ID: ${job.run_id}, Trạng thái: ${job.status}`);
```

---

### 2.6. MLflow Local (`mlops/mlflow-adapter.mjs`)

> **Trạng thái: SIMULATION / contract test double.** trackingUri được nhận vào rồi không dùng; mọi run nằm trong Map và mất khi tiến trình kết thúc.

Ghi nhận tham số, độ đo và artifact của các thí nghiệm định lượng cục bộ vào cơ sở dữ liệu SQLite hoặc tệp lưu trữ.

```javascript
import { MLflowLocalAdapter } from "./zink-tools/adapters/mlops/mlflow-adapter.mjs";

const mlflow = new MLflowLocalAdapter();

const run = await mlflow.createRun({
  experiment_name: "inventory-optimization",
});
await mlflow.logParameters(run.run_id, {
  safety_stock_days: 14,
  reorder_point: 50,
});
await mlflow.logMetrics(run.run_id, {
  service_level: 0.985,
  holding_cost: 1240.5,
});
await mlflow.endRun(run.run_id, "FINISHED");
```

---

### 2.7. DagsHub (`mlops/dagshub-adapter.mjs`)

> **Trạng thái: SIMULATION / contract test double.** token không bao giờ được đọc; kết quả SYNC_COMPLETED trả vô điều kiện.

Đồng bộ các thí nghiệm đã chọn lọc rõ ràng từ MLflow Local lên kho lưu trữ DagsHub từ xa. **Cấm đồng bộ tự động hàng loạt (blind sync).**

```javascript
import { DagsHubAdapter } from "./zink-tools/adapters/mlops/dagshub-adapter.mjs";

const dagshub = new DagsHubAdapter();

const syncResult = await dagshub.syncSelectedRuns({
  repo_owner: "vinh-owner",
  repo_name: "personal-tool-experiments",
  selected_run_ids: [run.run_id],
});
console.log(`Đã đồng bộ ${syncResult.synced_runs_count} lượt chạy.`);
```

---

### 2.8. Hugging Face (`mlops/huggingface-adapter.mjs`)

> **Trạng thái: SIMULATION / contract test double.** apiToken không bao giờ được đọc; metric là hằng số viết cứng, không phải kết quả đánh giá.

Đánh giá mô hình ngoại vi từ Hugging Face Hub.

- **Ranh giới bất biến:** Mô hình ngoại vi luôn bị xem là dữ liệu đầu vào chưa được xác thực (`untrusted input`).
- **Trạng thái:** Được gắn cờ `candidate_status: "EVALUATED_NOT_PROMOTED"`, tuyệt đối không tự ý thăng cấp lên production.

```javascript
import { HuggingFaceAdapter } from "./zink-tools/adapters/mlops/huggingface-adapter.mjs";

const hf = new HuggingFaceAdapter();

const evalResult = await hf.evaluateCandidateModel({
  repo_id: "zink-research/candidate-llm-v1",
  evaluation_dataset: "test-benchmark-split",
});
console.log(
  `Trạng thái: ${evalResult.candidate_status}, F1: ${evalResult.eval_metrics.f1_score}`,
);
```

---

### 2.9. Streamlit (`app/streamlit-adapter.mjs`)

> **Trạng thái: SIMULATION / contract test double.** Chỉ ghép một chuỗi URL, không phát hành gì; không có tác vụ nền nào chạy.

Xuất bản khung nhìn dữ liệu tầng Gold phục vụ giao diện trực quan hóa Streamlit tại `http://127.0.0.1:8501`.

```javascript
import { StreamlitAdapter } from "./zink-tools/adapters/app/streamlit-adapter.mjs";

const streamlit = new StreamlitAdapter({ port: 8501 });

const view = await streamlit.exportGoldViewForStreamlit({
  task_id: "task-01",
  gold_dataset_id: "gold_supply_chain_kpis",
  view_name: "view_kpi_dashboard",
  columns: ["metric_name", "gold_value", "updated_at"],
  row_count: 5,
});
console.log(`Endpoint trực quan hóa: ${view.endpoint}`);
```

---

## 3. Quản lý Lỗi & Xử lý Khi Bị Chặn

Khi thiếu token xác thực hoặc quyền truy cập mạng:

- Adapter sẽ ném lỗi định danh rõ ràng (ví dụ: `MOTHERDUCK_UNAUTHORIZED_CALLER`, `DAGSHUB_AUTH_REQUIRED`).
- Hệ thống sẽ dừng lại ở trạng thái `BLOCKED` để người vận hành cung cấp cấu hình qua biến môi trường hoặc tham số an toàn, tuyệt đối không tự động bỏ qua (fail-closed).
