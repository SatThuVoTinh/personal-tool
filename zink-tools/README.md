# Zink Tools (Công cụ Zink)

**Zink Tools** cung cấp các giao diện công cụ có thể gọi (callable interfaces), bộ điều hợp (adapters) và hợp đồng cho Excel, Power BI, SQL, Python, n8n cũng như các bài toán khoa học quyết định.

Đây là một ranh giới quản trị mỏng (thin governed boundary), không phải là hệ thống điều phối, không lưu trữ trạng thái workflow, không phải cơ sở tri thức hay nền tảng tổng quát.

---

## 1. 5 Giao diện Công cụ Có thể gọi (Callable Interfaces)

Đúng 5 công cụ Zink được phép gọi trong hệ thống, được ràng buộc với các agent chuyên biệt:

| Định danh Công cụ | Agent Chuyên biệt | Chế độ Thực thi      | Lược đồ Hợp đồng                                                         | Văn bản Hợp đồng Ngữ nghĩa                     |
| ----------------- | ----------------- | -------------------- | ------------------------------------------------------------------------ | ---------------------------------------------- |
| `zink_excel`      | `excel`           | `contract_interface` | [`zink-excel.schema.json`](contracts/tools/zink-excel.schema.json)       | [`excel/contract.md`](excel/contract.md)       |
| `zink_power_bi`   | `power-bi`        | `contract_interface` | [`zink-power-bi.schema.json`](contracts/tools/zink-power-bi.schema.json) | [`power-bi/contract.md`](power-bi/contract.md) |
| `zink_sql`        | `sql`             | `contract_interface` | [`zink-sql.schema.json`](contracts/tools/zink-sql.schema.json)           | [`sql/contract.md`](sql/contract.md)           |
| `zink_python`     | `python`          | `contract_interface` | [`zink-python.schema.json`](contracts/tools/zink-python.schema.json)     | [`python/contract.md`](python/contract.md)     |
| `zink_n8n`        | `o2`, `python`    | `governed_adapter`   | [`zink-n8n.schema.json`](contracts/tools/zink-n8n.schema.json)           | [`n8n/contract.md`](n8n/contract.md)           |

---

## 2. 4 Năng lực Đặc tả Toán học (Schema-Only Capabilities)

Các bài toán khoa học quyết định này là những đặc tả phi thực thi (non-callable specifications), được định nghĩa bằng JSON Schema đóng:

- **`zink_forecast`**: Lược đồ đặc tả bài toán dự báo chuỗi thời gian ([`zink-forecast.schema.json`](contracts/tools/zink-forecast.schema.json)).
- **`zink_optimization`**: Lược đồ bài toán tối ưu hóa và quy hoạch toán học ([`zink-optimization.schema.json`](contracts/tools/zink-optimization.schema.json)).
- **`zink_operations_research`**: Lược đồ mô hình hóa luồng mạng và nghiên cứu vận hành ([`zink-operations-research.schema.json`](contracts/tools/zink-operations-research.schema.json)).
- **`zink_simulation`**: Lược đồ mô phỏng Monte Carlo ngẫu nhiên và mô phỏng sự kiện rời rạc ([`zink-simulation.schema.json`](contracts/tools/zink-simulation.schema.json)).

---

## 3. Governed DuckDB Windows Bridge (Cầu nối DuckDB trên Windows)

Nằm tại [`sql/duckdb-bridge.mjs`](sql/duckdb-bridge.mjs):

- Thực thi truy vấn phân tích SQL cục bộ giới hạn trong danh sách cơ sở dữ liệu cho phép (`knowledge`, `analytics_read`).
- Chặn đứng mọi hành vi thoát sandbox hệ thống tệp (`ATTACH`, `COPY`, `read_csv`, `read_parquet`).
- Chặn đứng việc thực thi lệnh hệ điều hành (`powershell`, `cmd`, `wsl`, `docker`).
- Giới hạn thời gian chạy (timeout) và số lượng dòng kết quả tối đa (mặc định 100, tối đa 1000).

---

## 4. Bộ Điều hợp Hạ tầng Ngoại vi (External Infrastructure Adapters)

Nằm tại [`adapters/`](adapters/index.mjs), đóng vai trò là các backend hỗ trợ đằng sau 5 công cụ Zink hiện có:

- **Lưu trữ đối tượng:** [`adapters/storage/r2-adapter.mjs`](adapters/storage/r2-adapter.mjs) (Cloudflare R2, quản lý tầng Landing bất biến và Silver phân phiên bản).
- **Phân tích dữ liệu:** [`adapters/analytics/motherduck-adapter.mjs`](adapters/analytics/motherduck-adapter.mjs) (MotherDuck từ xa) và [`adapters/analytics/bigquery-adapter.mjs`](adapters/analytics/bigquery-adapter.mjs) (Google BigQuery).
- **Tính toán ngoại vi:** [`adapters/compute/kaggle-adapter.mjs`](adapters/compute/kaggle-adapter.mjs) (Kaggle) và [`adapters/compute/databricks-adapter.mjs`](adapters/compute/databricks-adapter.mjs) (Databricks).
- **Quản lý thí nghiệm (MLOps):** [`adapters/mlops/mlflow-adapter.mjs`](adapters/mlops/mlflow-adapter.mjs) (MLflow Local), [`adapters/mlops/dagshub-adapter.mjs`](adapters/mlops/dagshub-adapter.mjs) (DagsHub) và [`adapters/mlops/huggingface-adapter.mjs`](adapters/mlops/huggingface-adapter.mjs) (Hugging Face).
- **Giao diện ứng dụng:** [`adapters/app/streamlit-adapter.mjs`](adapters/app/streamlit-adapter.mjs) (Streamlit).

---

## 5. Các Tiện ích An toàn & Đóng gói

- **Phong bì Gọi công cụ (Invocation Envelope):** [`contracts/tool-call.schema.json`](contracts/tool-call.schema.json)
- **Phong bì Kết quả (Result Envelope):** [`contracts/tool-result.schema.json`](contracts/tool-result.schema.json)
- **Kiểm tra An toàn Đường dẫn:** [`common/path-safety.mjs`](common/path-safety.mjs)
- **Bộ Kiểm tra Cú pháp SQL:** [`sql/validator.mjs`](sql/validator.mjs)
- **Bộ Kích hoạt n8n:** [`n8n/trigger.mjs`](n8n/trigger.mjs)
