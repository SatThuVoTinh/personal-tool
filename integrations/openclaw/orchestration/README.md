# Hướng dẫn Sử dụng Các Mẫu Điều phối Quản trị (OpenClaw Orchestration Patterns)

Tài liệu này hướng dẫn chi tiết cách thức sử dụng 10 mẫu điều phối hệ thống (Orchestration Patterns P1 – P10) tại thư mục `integrations/openclaw/orchestration/` bằng tiếng Việt, tuần tự theo đúng logic mã nguồn tại [`patterns/index.mjs`](patterns/index.mjs).

---

## 1. Tổng quan & Ranh giới Quản trị

Các mẫu điều phối định nghĩa cách các agent OpenClaw kết nối dữ liệu và kích hoạt công cụ Zink xuyên suốt các tầng hạ tầng từ Landing đến Gold:

- **Mã nguồn:** [`integrations/openclaw/orchestration/patterns/index.mjs`](patterns/index.mjs).
- **Quy tắc bất biến:**
  1. Không tạo agent mới động trong lúc chạy (`NO dynamic agent creation`).
  2. Không tạo hạ tầng hay công cụ callable mới (`NO new callable tools`).
  3. Không tự động chuyển đổi nhà cung cấp ngầm định (`NO silent provider fallback`).
  4. Phân loại rõ ràng thao tác (`READ`, `WRITE`, `APPEND`, `REPLACE`, `UPSERT`) và tính lũy thừa (`IDEMPOTENT`, `NON_IDEMPOTENT`, `IDEMPOTENCY-KEY-REQUIRED`).

---

## 2. Chi tiết 10 Mẫu Điều phối & Cách Sử dụng

### P1: Tiếp nhận dữ liệu từ n8n vào R2 Landing

- **Mục đích:** Kéo dữ liệu từ luồng n8n và lưu trữ vào tầng Landing của Cloudflare R2.
- **Quyền hạn:** Agent `o2` hoặc `python` (có quyền `zink_n8n`).
- **Đặc tính:** `WRITE`, `IDEMPOTENT`. Tầng Landing là **bất biến**, cấm ghi đè.

```javascript
import { executePattern1_N8nToR2Landing } from "./patterns/index.mjs";

const result = await executePattern1_N8nToR2Landing({
  context: { agent_id: "o2", task_id: "task-p1-01" },
  workflow_id: "data_plant_ingest",
  payload: { records: [{ id: 1, order_code: "ORD-99" }] },
  r2Adapter: r2Instance,
});
console.log(`Landing Artifact ID: ${result.landing_artifact.artifact_id}`);
```

---

### P2: Làm sạch dữ liệu từ Landing sang R2 Silver

- **Mục đích:** Đọc dữ liệu thô từ Landing, chạy thuật toán kiểm tra và làm sạch bằng Python, sau đó lưu vào tầng Silver có phiên bản.
- **Quyền hạn:** Agent `python` hoặc `sql`.
- **Đặc tính:** `WRITE`, `IDEMPOTENT`, phân phiên bản (`v1`, `v2`).

```javascript
import { executePattern2_R2LandingToCleanSilver } from "./patterns/index.mjs";

const result = await executePattern2_R2LandingToCleanSilver({
  context: { agent_id: "python", task_id: "task-p2-01" },
  artifact_id: "landing-orders-101.json",
  r2Adapter: r2Instance,
  cleanerFn: (raw) => ({ ...raw, validated: true }),
});
console.log(`Silver Version: ${result.silver_artifact.version}`);
```

---

### P3: Giải quyết Mâu thuẫn Ngữ nghĩa (Semantic Ambiguity Resolution)

- **Mục đích:** Khi phát hiện xung đột dữ liệu hoặc định nghĩa nghiệp vụ không rõ ràng, hệ thống tạo đề xuất có cấu trúc và dừng lại ở trạng thái `BLOCKED_SEMANTIC_REVIEW`.
- **Ranh giới:** **Lý luận không đồng nghĩa với phê duyệt (Reasoning ≠ Approval).** Bắt buộc phải có quyết định phê duyệt rõ ràng từ chủ sở hữu (`owner_approval`).

```javascript
import { executePattern3_SemanticAmbiguityResolution } from "./patterns/index.mjs";

// 1. Khi phát hiện mâu thuẫn -> Hệ thống dừng lại
const review = await executePattern3_SemanticAmbiguityResolution({
  context: { task_id: "task-p3-01" },
  ambiguity_evidence:
    "Cột 'amount' trong ERP là trước thuế, nhưng trong CRM là sau thuế",
  proposed_resolution:
    "Quy chuẩn toàn bộ về giá trị trước thuế 'amount_pretax_usd'",
});
console.log(`Trạng thái: ${review.status}`); // "BLOCKED_SEMANTIC_REVIEW"

// 2. Sau khi chủ sở hữu duyệt đề xuất -> Tiếp tục
const approved = await executePattern3_SemanticAmbiguityResolution({
  context: { task_id: "task-p3-01" },
  ambiguity_evidence: "Cột 'amount'...",
  proposed_resolution: "Quy chuẩn...",
  proposal_id: review.proposal.proposal_id,
  owner_approval: { approved: true, proposal_id: review.proposal.proposal_id },
});
console.log(`Trạng thái sau duyệt: ${approved.status}`); // "APPROVED"
```

---

### P4: Nạp dữ liệu Silver lên MotherDuck Gold

- **Mục đích:** Đọc dữ liệu Silver đã được làm sạch và chạy câu lệnh SQL chuyển đổi ETL để nạp vào tầng phân tích Gold trên MotherDuck.
- **Quyền hạn:** Agent `sql` (sử dụng `zink_sql`).
- **Đặc tính:** `UPSERT`, `IDEMPOTENT`.

```javascript
import { executePattern4_SilverToMotherDuckGold } from "./patterns/index.mjs";

const result = await executePattern4_SilverToMotherDuckGold({
  context: { agent_id: "sql", task_id: "task-p4-01" },
  silver_artifact_id: "clean-orders-v1.json",
  version: 1,
  r2Adapter: r2Instance,
  motherDuckAdapter: motherDuckInstance,
});
```

---

### P5: Phân phối dữ liệu Gold sang Báo cáo & Ứng dụng

- **Mục đích:** Cung cấp dữ liệu tầng Gold cho các bề mặt hiển thị: Streamlit (`http://127.0.0.1:8501`), Excel (`.xlsx`), hoặc Power BI (`.pbix`).
- **Đặc tính:** `READ`, `IDEMPOTENT`.

```javascript
import { executePattern5_GoldToDeliverySurfaces } from "./patterns/index.mjs";

const delivery = await executePattern5_GoldToDeliverySurfaces({
  context: { agent_id: "python", task_id: "task-p5-01" },
  gold_dataset_id: "gold_supply_chain_kpis",
  surface: "streamlit",
  streamlitAdapter: streamlitInstance,
});
```

---

### P6: Trích xuất Features sang Compute Ngoại vi (Kaggle / Databricks)

- **Mục đích:** Chuyển giao các ma trận đặc trưng từ tầng Gold sang Kaggle hoặc Databricks để huấn luyện mô hình học máy.
- **Đặc tính:** `NON_IDEMPOTENT`, **Bắt buộc có `idempotency_key`** để chống kích hoạt trùng lặp.

```javascript
import { executePattern6_GoldToExternalComputeFeatures } from "./patterns/index.mjs";

const computeJob = await executePattern6_GoldToExternalComputeFeatures({
  context: { agent_id: "python", task_id: "task-p6-01" },
  compute_target: "kaggle",
  idempotency_key: "train-run-20260914",
  kaggleAdapter: kaggleInstance,
});
```

---

### P7: Quản lý Thí nghiệm MLflow Local và Đồng bộ sang DagsHub

- **Mục đích:** Ghi log thông số huấn luyện cục bộ vào MLflow và đẩy các lượt chạy được lựa chọn cụ thể lên DagsHub.
- **Ranh giới:** Cấm đồng bộ tự động toàn bộ; bắt buộc phải truyền danh sách `selected_runs`.

```javascript
import { executePattern7_ComputeToMLflowLocalToDagsHub } from "./patterns/index.mjs";

const sync = await executePattern7_ComputeToMLflowLocalToDagsHub({
  context: { agent_id: "python", task_id: "task-p7-01" },
  experiment_name: "demand-forecasting-exp",
  selected_runs: ["mlf-run-abc123"],
  mlflowAdapter: mlflowInstance,
  dagshubAdapter: dagshubInstance,
});
```

---

### P8: Đánh giá Mô hình Ứng viên Hugging Face

- **Mục đích:** Tải và chấm điểm mô hình ngoại vi từ Hugging Face.
- **Ranh giới:** Gán nhãn `EVALUATED_NOT_PROMOTED`, tuyệt đối không tự động đưa vào production.

```javascript
import { executePattern8_EvaluateCandidateModel } from "./patterns/index.mjs";

const candidate = await executePattern8_EvaluateCandidateModel({
  context: { task_id: "task-p8-01" },
  repo_id: "zink-research/candidate-bert-v1",
  evaluation_dataset: "benchmark-eval-dataset",
  huggingFaceAdapter: hfInstance,
});
```

---

### P9: Chuyển giao Dự báo từ Mô hình Đã Duyệt vào MotherDuck

- **Mục đích:** Sử dụng mô hình đã được chủ sở hữu phê duyệt để chạy suy luận (inference) và ghi kết quả dự báo vào tầng Gold của MotherDuck.
- **Quyền hạn:** Agent `sql`.

```javascript
import { executePattern9_ApprovedModelPredictionToMotherDuck } from "./patterns/index.mjs";

const prediction = await executePattern9_ApprovedModelPredictionToMotherDuck({
  context: { agent_id: "sql", task_id: "task-p9-01" },
  approved_model_id: "approved-demand-arima-v1",
  motherDuckAdapter: motherDuckInstance,
});
```

---

### P10: Kịch bản Kiểm thử Tích hợp Tổng hợp (Synthetic Composition)

- **Mục đích:** Kịch bản xác thực tự động chạy tuần tự toàn bộ chuỗi: `P1 → P2 → P3 → P4 → P6 → P7 → P9 → P5`.
- **Lưu ý:** Đây là kịch bản kiểm định chất lượng end-to-end, không phải là một generic workflow engine vạn năng.

```javascript
import { executePattern10_SyntheticComposition } from "./patterns/index.mjs";

const testRun = await executePattern10_SyntheticComposition(
  { task_id: "task-e2e-01", run_id: "run-e2e" },
  adapters,
);
console.log(
  `Kịch bản P10 hoàn tất ${testRun.steps_count} bước kiểm thử thành công.`,
);
```
