# Hướng dẫn Vận hành Runtime Ứng dụng Knowledgebase (apps/knowledge)

Tài liệu này hướng dẫn chi tiết cách thức vận hành, quản trị và tương tác với dịch vụ **Knowledgebase Runtime** tại `apps/knowledge/` bằng tiếng Việt, tuần tự theo đúng logic mã nguồn thực tế.

---

## 1. Giới thiệu Dịch vụ

`apps/knowledge/` là ứng dụng FastAPI (Python 3.13) chạy trong container Docker, chịu trách nhiệm:

- Tiếp nhận tài liệu từ thư mục Knowledge Vault (Obsidian Markdown và PDF).
- Phân đoạn văn bản, tính toán vector nhúng (embedding) và quản lý tiến trình lập chỉ mục.
- Lưu trữ và truy vấn trên cơ sở dữ liệu PostgreSQL + extension pgvector.
- Tái xếp hạng (reranking) bằng mô hình ONNX nội bộ và thực hiện tìm kiếm lai (Hybrid HNSW + FTS RRF).
- Cung cấp HTTP API nội bộ phía sau Nginx proxy tại cổng `8080`.

---

## 2. Các Endpoint API Chính (Qua Nginx Loopback)

Tất cả các lệnh gọi API đều đi qua Nginx tại địa chỉ `http://127.0.0.1:8080/knowledge`:

| Phương thức | Endpoint                  | Chức năng                                  | Tham số / Body                                                |
| ----------- | ------------------------- | ------------------------------------------ | ------------------------------------------------------------- |
| `GET`       | `/healthz`                | Kiểm tra sức khỏe container                | Không                                                         |
| `GET`       | `/readyz`                 | Kiểm tra tính sẵn sàng (DB, Ollama, model) | Không                                                         |
| `POST`      | `/v1/index-runs`          | Kích hoạt tiến trình lập chỉ mục           | `{ "kind": "INCREMENTAL" }` hoặc `{ "kind": "FULL_REBUILD" }` |
| `GET`       | `/v1/index-runs/{run_id}` | Theo dõi tiến độ lập chỉ mục               | Truyền `run_id` trên đường dẫn                                |
| `POST`      | `/v1/search`              | Thực hiện tìm kiếm ngữ nghĩa kèm trích dẫn | `{ "query": "...", "limit": 10 }`                             |

---

## 3. Hướng dẫn Vận hành Từng bước qua PowerShell

### Bước 1: Kiểm tra trạng thái sẵn sàng của dịch vụ

```powershell
Invoke-RestMethod -Method Get -Uri http://127.0.0.1:8080/knowledge/readyz
```

Nếu hệ thống sẵn sàng, kết quả trả về mã trạng thái HTTP 200 kèm trạng thái cơ sở dữ liệu và model probe.

---

### Bước 2: Kích hoạt Lập chỉ mục Toàn bộ (Full Rebuild)

Khi có thêm tài liệu mới trong Obsidian Vault hoặc cần xây dựng lại chỉ mục từ đầu:

```powershell
$body = @{ kind = "FULL_REBUILD" } | ConvertTo-Json -Compress
$runResponse = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8080/knowledge/v1/index-runs -ContentType application/json -Body $body

$runId = $runResponse.index_run_id
Write-Host "Tiến trình lập chỉ mục đã bắt đầu với Run ID: $runId"
```

---

### Bước 3: Theo dõi Tiến độ Lập chỉ mục (Polling)

Sử dụng `index_run_id` vừa nhận được để kiểm tra trạng thái hoàn tất:

```powershell
$status = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:8080/knowledge/v1/index-runs/$runId"
Write-Host "Trạng thái hiện tại: $($status.status)"
```

Khi trạng thái chuyển thành `SUCCEEDED`, toàn bộ chỉ mục HNSW và FTS đã được cập nhật thành công.

---

### Bước 4: Thực hiện Tìm kiếm Tri thức Ngữ nghĩa

```powershell
$searchPayload = @{
    query = "định nghĩa tồn kho an toàn và công thức tính"
    limit = 5
} | ConvertTo-Json -Compress

$results = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8080/knowledge/v1/search -ContentType application/json -Body $searchPayload

foreach ($hit in $results.results) {
    Write-Host "---"
    Write-Host "Tiêu đề: $($hit.title)"
    Write-Host "Điểm RRF: $($hit.rrf_score)"
    Write-Host "Điểm rerank: $($hit.rerank_score)"
    Write-Host "Trích dẫn: $($hit.citation.markdown)"
    Write-Host "SHA-256 nguồn: $($hit.source_sha256)"
    Write-Host "Đoạn trích: $($hit.text.Substring(0, 150))..."
}
```

---

## 4. Xử lý Lỗi Vận hành Thường gặp

| Triệu chứng                  | Nguyên nhân                                              | Cách khắc phục                                                                          |
| ---------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Lỗi 503 tại `/readyz`        | Dịch vụ Ollama chưa bật hoặc thiếu model `bge-m3:latest` | Chạy `ollama serve` và kiểm tra lệnh `ollama list`                                      |
| Lỗi 409 khi kích hoạt index  | Đang có một tiến trình index khác đang chạy dở           | Chờ tiến trình hiện tại hoàn tất hoặc kiểm tra log qua Dozzle (`http://127.0.0.1:9999`) |
| Lỗi mount đường dẫn Vault    | Biến `KNOWLEDGE_VAULT_ROOT` trong `.env` sai đường dẫn   | Kiểm tra tệp `infrastructure/docker/env/.env` và trỏ đúng đường dẫn tuyệt đối           |
| Không kết nối được cổng 8080 | Nginx container chưa chạy                                | Khởi động lại profile: `./infrastructure/docker/scripts/start.ps1 -Profile knowledge`   |
