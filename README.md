# Hướng dẫn Vận hành Personal Tool / Zink (V1)

Tài liệu này là cẩm nang hướng dẫn vận hành toàn diện bằng tiếng Việt dành cho người vận hành hệ thống (operator). Tài liệu được biên soạn tuần tự, đầy đủ các bước, tuân thủ chặt chẽ logic triển khai từ mã nguồn thực tế và ranh giới kiến trúc đã đóng băng tại M7/T4.

---

## 1. Tổng quan về Personal Tool / Zink

**Personal Tool / Zink** là môi trường làm việc local-first hỗ trợ phân tích chuỗi cung ứng (Supply Chain Analytics) và khoa học quyết định (Decision Science), tích hợp với hệ thống điều phối OpenClaw.

Hệ thống được thiết kế theo nguyên tắc:

- **Local-first & An toàn:** Dữ liệu nhạy cảm được xử lý cục bộ; giao tiếp qua ranh giới mạng được kiểm soát chặt chẽ; không cho phép thực thi lệnh máy chủ tùy ý (arbitrary host execution).
- **Quản trị đa tầng:** Tách biệt rõ ràng giữa năng lực (Capability), bộ điều hợp nhà cung cấp (Provider Adapter) và mẫu điều phối (Orchestration Pattern).
- **Tính bất biến & Nguồn gốc (Provenance):** Dữ liệu tầng Landing là bất biến; tầng Silver được đánh phiên bản; mọi artifact đều gắn siêu dữ liệu nguồn gốc (`task_id`, `run_id`, `checksum`).

---

## 2. Kiến trúc 3 Module Logic

Hệ thống bao gồm đúng 3 module logic ngang hàng (peer modules):

```text
personal-tool/
├── apps/knowledge/        # Zink Knowledgebase: ingestion, index, retrieval và trích dẫn Knowledge Vault
├── zink-skill-store/      # Zink Skill Store: lưu trữ skill được quản trị và template Excel/Power BI
└── zink-tools/            # Zink Tools: ranh giới mỏng cho 5 công cụ callable và các adapter hạ tầng
```

- **Zink Knowledgebase:** Chịu trách nhiệm quản lý tài liệu tham khảo, ingestion PDF/Markdown từ Obsidian Vault của con người (mount ở chế độ chỉ đọc `read-only`), lập chỉ mục HNSW/FTS và cung cấp API truy xuất.
- **Zink Skill Store:** Lưu trữ các kỹ năng và template phân tích đã được chuẩn hóa, hoàn toàn tách biệt với chỉ mục nghiên cứu của Knowledgebase.
- **Zink Tools:** Ranh giới hợp đồng mỏng kết nối OpenClaw với các công cụ thực thi và adapter hạ tầng bên ngoài.

_Lưu ý kiến trúc:_ Thuật ngữ lịch sử "L&SC Data Plant" chỉ đại diện cho luồng dữ liệu/tính toán logic ngoại vi (`docs/architecture/lsc-data-flow.md`), không phải là một module phần mềm hay nền tảng lakehouse tự xây dựng trong kho mã nguồn.

---

## 3. Thành phần và 7 Vai trò Agent

Hệ thống OpenClaw quản trị 7 agent vai trò cố định, không tạo thêm agent mới:

| Định danh Agent | Tên hiển thị         | Vai trò chính                                                     | Công cụ Zink được phép gọi |
| --------------- | -------------------- | ----------------------------------------------------------------- | -------------------------- |
| `main`          | Main Coordinator     | Tiếp nhận yêu cầu, phân loại Work/Research, điều phối cấp cao     | Không gọi trực tiếp        |
| `o1`            | Knowledge Specialist | Truy xuất tri thức, phân tích tài liệu tham khảo từ Knowledgebase | Không gọi trực tiếp        |
| `o2`            | Orchestrator         | Điều phối luồng công việc tất định (deterministic workflows)      | `zink_n8n`                 |
| `excel`         | Excel Specialist     | Xử lý bảng tính, mô hình hóa dữ liệu Excel                        | `zink_excel`               |
| `power-bi`      | Power BI Specialist  | Trực quan hóa dữ liệu, báo cáo BI và dashboard                    | `zink_power_bi`            |
| `sql`           | SQL Specialist       | Truy vấn phân tích cơ sở dữ liệu (DuckDB, MotherDuck, BigQuery)   | `zink_sql`                 |
| `python`        | Python Specialist    | Xử lý dữ liệu số, phân tích định lượng, kích hoạt n8n/ML          | `zink_python`, `zink_n8n`  |

---

## 4. 5 Công cụ Zink có thể gọi (Callable Tools)

Đúng 5 công cụ Zink được phép thực thi trong toàn bộ hệ thống:

1. **`zink_excel`:** Hợp đồng gọi xử lý bảng tính Excel cho agent `excel`.
2. **`zink_power_bi`:** Hợp đồng trực quan hóa báo cáo Power BI cho agent `power-bi`.
3. **`zink_sql`:** Giao diện truy vấn SQL phân tích chỉ đọc (Lean Option B) cho agent `sql`.
4. **`zink_python`:** Giao diện xử lý tính toán số và khoa học quyết định cho agent `python`.
5. **`zink_n8n`:** Bộ điều hợp kích hoạt luồng công việc tất định cho agent `o2` và `python`.

_4 Năng lực đặc tả (Schema-only capabilities):_ `zink_forecast`, `zink_optimization`, `zink_operations_research`, `zink_simulation` là các lược đồ định dạng bài toán toán học, không phải công cụ thực thi trực tiếp.

---

## 5. Yêu cầu Hệ thống

Trước khi vận hành, máy trạm cần đáp ứng các điều kiện sau:

- **Hệ điều hành:** Windows 11 (64-bit) có kích hoạt WSL2.
- **Node.js:** Phiên bản `>= 24.15.0 < 25` (Khuyến nghị Node `24.15.0`).
- **npm:** Phiên bản chính xác `12.0.2`.
- **DuckDB CLI:** Bản cài đặt native trên Windows (thông qua WinGet: `DuckDB.cli_Microsoft.Winget.Source_8wekyb3d8bbwe`).
- **Docker Desktop:** WSL2 engine đang chạy (phục vụ n8n, PostgreSQL, pgvector và Nginx).
- **Git:** Bản cài đặt Git chuẩn cho Windows.

---

## 6. Hướng dẫn Thiết lập Từng bước (Setup Walkthrough)

### Bước 1: Kiểm tra môi trường dòng lệnh

Mở PowerShell trên Windows và kiểm tra phiên bản:

```powershell
node -v
npm -v
git --version
duckdb --version
```

### Bước 2: Thiết lập cấu hình môi trường (.env)

Sao chép tệp mẫu môi trường Docker (tuyệt đối không commit tệp `.env` vào Git):

```powershell
Copy-Item infrastructure/docker/env/.env.example infrastructure/docker/env/.env
```

Mở `infrastructure/docker/env/.env` và thiết lập các biến:

- `KNOWLEDGE_VAULT_ROOT`: Đường dẫn tuyệt đối đến thư mục Obsidian Vault của bạn (ví dụ: `C:\Users\Username\Documents\MyVault`).
- `N8N_POSTGRES_PASSWORD`: Mật khẩu cho database n8n.
- `N8N_ENCRYPTION_KEY`: Khóa mã hóa cho n8n (chuỗi ngẫu nhiên tối thiểu 32 ký tự).

### Bước 3: Chạy kiểm tra tính toàn vẹn kho mã nguồn

```powershell
npm run verify
```

Lệnh trên sẽ tự động chạy:

1. `npm run format:check`: Kiểm tra định dạng mã nguồn.
2. `npm run lint`: Phân tích tĩnh cú pháp JavaScript và Markdown.
3. `npm test`: Chạy 112 bài kiểm thử nền tảng.
4. `npm run repo:check`: Kiểm tra toàn vẹn chính sách repository.

---

## 7. Khởi động và Kiểm tra Sức khỏe Hệ thống (Preflight & Start)

### Bước 1: Kiểm tra Preflight Docker

Chạy script kiểm tra điều kiện tiên quyết:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/preflight.ps1 -Profile all -EnvironmentFile ./infrastructure/docker/env/.env
```

### Bước 2: Khởi động các dịch vụ nội bộ (Profile all)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/start.ps1 -Profile all -EnvironmentFile ./infrastructure/docker/env/.env
```

Các dịch vụ sẽ lắng nghe trên cổng cục bộ (localhost only):

- **Nginx / Knowledgebase API:** `http://127.0.0.1:8080/knowledge`
- **n8n Automation:** `http://127.0.0.1:5678`
- **Dozzle (Log Viewer):** `http://127.0.0.1:9999`

### Bước 3: Kiểm tra sức khỏe Knowledgebase

```powershell
Invoke-RestMethod -Method Get -Uri http://127.0.0.1:8080/knowledge/healthz
```

Kết quả trả về `{ "status": "ok" }` báo hiệu hệ thống đã sẵn sàng.

---

## 8. Sử dụng Governed DuckDB Windows Bridge

Cầu nối DuckDB trên Windows (`zink-tools/sql/duckdb-bridge.mjs`) cho phép thực thi truy vấn phân tích cục bộ với độ bảo mật cao:

- **Chỉ chấp nhận cơ sở dữ liệu hợp lệ:** `knowledge` hoặc `analytics_read`.
- **Chỉ agent `sql` được phép truy vấn.**
- **Nghiêm cấm thoát filesystem:** Mọi câu lệnh `ATTACH`, `COPY`, `read_csv`, `read_parquet` trỏ ra đường dẫn tùy ý đều bị từ chối ngay lập tức (`DUCKDB_FILESYSTEM_ACCESS_DENIED`).
- **Nghiêm cấm thực thi lệnh hệ thống:** Chặn đứng `cmd.exe`, `powershell`, `wsl`, `docker`, `PRAGMA`.

Ví dụ mã gọi cầu nối DuckDB trong code:

```javascript
import { executeGovernedDuckDbQuery } from "./zink-tools/sql/duckdb-bridge.mjs";

const result = await executeGovernedDuckDbQuery(
  { agent_id: "sql", task_id: "task-01" },
  {
    query: "SELECT id, name FROM knowledge",
    target_database: "knowledge",
    max_rows: 50,
  },
);
console.log(result.rows);
```

---

## 9. Cấu hình và Sử dụng Nhà cung cấp Ngoại vi (External Providers)

Hệ thống hỗ trợ 11 nhà cung cấp hạ tầng. Các adapter backend nằm tại `zink-tools/adapters/`:

### 1. Cloudflare R2 (`storage/r2-adapter.mjs`)

- Lưu trữ tầng Landing (bất biến) và Silver (quản lý phiên bản).
- Mỗi artifact được băm SHA-256 để kiểm chứng toàn vẹn.

### 2. MotherDuck (`analytics/motherduck-adapter.mjs`)

- Truy vấn SQL phân tích từ xa đằng sau `zink_sql`.
- Sử dụng token định danh `MOTHERDUCK_TOKEN` khi chạy trực tiếp.

### 3. BigQuery (`analytics/bigquery-adapter.mjs`)

- Thực thi truy vấn phân tích trên Cloud Data Warehouse.
- Sử dụng Google Cloud Application Default Credentials (ADC).

### 4. Kaggle & Databricks (`compute/kaggle-adapter.mjs`, `compute/databricks-adapter.mjs`)

- Kích hoạt tác vụ tính toán nặng ngoại vi (huấn luyện mô hình, batch feature processing).
- Bắt buộc có khóa định danh lũy thừa (`idempotency_key`) để chống chạy lặp.

### 5. MLflow Local & DagsHub (`mlops/mlflow-adapter.mjs`, `mlops/dagshub-adapter.mjs`)

- Ghi log tham số, độ đo và artifact cục bộ vào MLflow.
- Đồng bộ có chọn lọc các lượt chạy (`run_ids`) lên DagsHub (cấm đồng bộ tự động hàng loạt).

### 6. Hugging Face (`mlops/huggingface-adapter.mjs`)

- Đánh giá mô hình ngoại vi như một dữ liệu đầu vào chưa tin cậy (`untrusted input`).
- Mô hình được gán nhãn `EVALUATED_NOT_PROMOTED`, tuyệt đối không tự động đưa vào production.

### 7. Streamlit (`app/streamlit-adapter.mjs`)

- Xuất bản các khung nhìn dữ liệu tầng Gold cho ứng dụng Streamlit tại `http://127.0.0.1:8501`.

---

## 10. 10 Mẫu Điều phối Chuẩn (Orchestration Patterns P1 - P10)

Các mẫu điều phối được triển khai tại `integrations/openclaw/orchestration/patterns/index.mjs`:

1. **P1 (n8n → R2 Landing):** Nhận dữ liệu đầu vào qua webhook/trigger n8n và lưu vào R2 Landing. Bất biến, chống ghi đè.
2. **P2 (R2 Landing → Clean → R2 Silver):** Đọc dữ liệu thô từ Landing, làm sạch và chuẩn hóa, lưu vào Silver có gắn phiên bản (`v1`, `v2`).
3. **P3 (Semantic Ambiguity Resolution):** Khi phát hiện mâu thuẫn ngữ nghĩa (ví dụ: xung đột định nghĩa doanh thu), hệ thống dừng lại ở trạng thái `BLOCKED_SEMANTIC_REVIEW` và tạo đề xuất có cấu trúc chờ chủ sở hữu duyệt (`reasoning ≠ approval`).
4. **P4 (R2 Silver → MotherDuck → Gold):** Nạp dữ liệu Silver vào cơ sở dữ liệu phân tích MotherDuck để tạo tầng dữ liệu phân tích Gold.
5. **P5 (Gold → Delivery Surfaces):** Phân phối dữ liệu tầng Gold tới Excel (`.xlsx`), Power BI (`.pbix`) hoặc giao diện Streamlit.
6. **P6 (Gold → Features → Kaggle/Databricks):** Trích xuất đặc trưng từ Gold và chuyển giao cho compute ngoại vi để huấn luyện mô hình.
7. **P7 (Compute → MLflow Local → DagsHub):** Ghi nhận kết quả huấn luyện vào MLflow Local và đồng bộ các run được chọn lên DagsHub.
8. **P8 (Hugging Face → Evaluate):** Tải và đánh giá mô hình ứng viên từ Hugging Face.
9. **P9 (Approved Model → Prediction → MotherDuck):** Dùng mô hình đã được chủ sở hữu phê duyệt để dự báo và ghi kết quả vào tầng Gold của MotherDuck.
10. **P10 (Synthetic Integration Composition):** Kịch bản kiểm thử kết nối toàn bộ chuỗi: `P1 → P2 → P3 → P4 → P6 → P7 → P9 → P5`.

---

## 11. Xử lý Trạng thái Bị Chặn (Blocked Handling)

Khi hệ thống gặp điều kiện cần chủ sở hữu quyết định hoặc thiếu tài nguyên:

- Hệ thống chuyển sang trạng thái `BLOCKED` hoặc `BLOCKED_SEMANTIC_REVIEW`.
- Ghi nhận mã chặn (`BLOCKER_ID`), nguyên nhân, cổng kiểm thử bị ảnh hưởng và hành động cần người vận hành thực hiện.
- **Người vận hành can thiệp:** Cung cấp thông tin xác thực hoặc phê duyệt đề xuất qua giao diện quản trị.
- Sau khi giải quyết, hệ thống tiếp tục chạy chính xác từ cổng bị chặn, không chạy lại toàn bộ từ đầu.

---

## 12. Ranh giới An toàn và Hành vi Bị Cấm Tuyệt đối

Người vận hành và các agent tuyệt đối tuân thủ các điều cấm sau:

1. **CẤM** thực thi lệnh shell/hệ điều hành tùy ý (`NO arbitrary host execution`).
2. **CẤM** điều khiển WSL hoặc can thiệp socket Docker (`NO WSL control`, `NO Docker socket exposure`).
3. **CẤM** mở n8n hoặc bất kỳ dịch vụ nội bộ nào ra mạng công cộng (`NO public exposure`, `localhost-only`).
4. **CẤM** duyệt cây thư mục máy chủ tùy tiện (`NO host traversal`).
5. **CẤM** đưa khóa bí mật, token, password hoặc API key vào mã nguồn, tệp Git hoặc tài liệu.
6. **CẤM** tự động thăng cấp mô hình/tập dữ liệu ngoại vi vào Knowledgebase hoặc production mà chưa qua phê duyệt.
7. **CẤM** chuyển đổi ngầm định (silent fallback) giữa các provider khi chưa có ủy quyền rõ ràng.

---

## 13. Bảng Tra cứu Sự cố (Troubleshooting)

| Hiện tượng                            | Nguyên nhân có thể                                  | Cách khắc phục                                                              |
| ------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| Lỗi `DUCKDB_UNAUTHORIZED_CALLER`      | Agent gọi không có quyền `zink_sql`                 | Chỉ định nhiệm vụ cho agent `sql`                                           |
| Lỗi `DUCKDB_FILESYSTEM_ACCESS_DENIED` | Truy vấn có chứa `ATTACH`, `COPY`, `read_csv`       | Dùng bảng có sẵn trong allowlist (`knowledge`, `analytics_read`)            |
| Lỗi `R2_LANDING_IMMUTABLE_VIOLATION`  | Cố ý ghi đè lên tệp Landing đã tồn tại              | Tạo định danh artifact mới với run_id mới                                   |
| Trạng thái `BLOCKED_SEMANTIC_REVIEW`  | Phát hiện nhập nhằng ngữ nghĩa (P3)                 | Xem xét đề xuất giải pháp và cung cấp quyết định phê duyệt                  |
| Lỗi kết nối n8n `ECONNREFUSED`        | Container n8n chưa chạy                             | Chạy script `./infrastructure/docker/scripts/start.ps1 -Profile automation` |
| Docker báo lỗi cổng bị chiếm          | Cổng 8080, 5678 hoặc 9999 đang mở bởi ứng dụng khác | Đóng ứng dụng chiếm cổng hoặc điều chỉnh cấu hình port                      |

---

## 14. Ma trận Trạng thái Nhà cung cấp (Provider Status Matrix)

Bảng phân định trạng thái thực tế của 11 nhà cung cấp trong phiên bản V1:

| Nhà cung cấp      | Trạng thái (State)  | Hợp đồng (Contract) | Kiểm thử mô phỏng (Mock) | Kiểm thử trực tiếp (Live) | Ghi chú vận hành                         |
| ----------------- | ------------------- | ------------------- | ------------------------ | ------------------------- | ---------------------------------------- |
| **n8n**           | `PROVISIONED`       | PASS                | PASS                     | PASS                      | Docker container localhost:5678 sẵn sàng |
| **Cloudflare R2** | `PROVISIONED`       | PASS                | PASS                     | PASS                      | Quản lý Landing & Silver hoạt động       |
| **DuckDB**        | `PROVISIONED`       | PASS                | PASS                     | PASS                      | Governed Windows Bridge bảo mật          |
| **MotherDuck**    | `CONTRACT_VERIFIED` | PASS                | PASS                     | NOT_RUN                   | Sẵn sàng, kết nối khi cấp token          |
| **BigQuery**      | `CONTRACT_VERIFIED` | PASS                | PASS                     | NOT_RUN                   | Sẵn sàng, kích hoạt khi có GCP ADC       |
| **Kaggle**        | `CONTRACT_VERIFIED` | PASS                | PASS                     | NOT_RUN                   | Bounded runner có kiểm soát              |
| **Databricks**    | `CONTRACT_VERIFIED` | PASS                | PASS                     | NOT_RUN                   | Batch compute adapter sẵn sàng           |
| **MLflow Local**  | `PROVISIONED`       | PASS                | PASS                     | PASS                      | Ghi log thí nghiệm cục bộ hoạt động      |
| **DagsHub**       | `CONTRACT_VERIFIED` | PASS                | PASS                     | NOT_RUN                   | Đồng bộ có chọn lọc sẵn sàng             |
| **Hugging Face**  | `CONTRACT_VERIFIED` | PASS                | PASS                     | NOT_RUN                   | Đánh giá mô hình an toàn                 |
| **Streamlit**     | `PROVISIONED`       | PASS                | PASS                     | PASS                      | Giao diện phân phối Gold localhost:8501  |

---

## 15. Quy trình Dừng Hệ thống

Khi kết thúc phiên làm việc:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/stop.ps1 -Profile all -EnvironmentFile ./infrastructure/docker/env/.env
```

Lệnh này dừng an toàn các container và bảo toàn toàn bộ dữ liệu trên các Docker volume.
