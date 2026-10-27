# Cẩm nang Kiến trúc & Vận hành Zink Knowledge Platform

Tài liệu này cung cấp hướng dẫn chi tiết, tuần tự từng bước bằng tiếng Việt về kiến trúc phân tầng, các phân vùng chức năng và quy trình vận hành thực tế của **Zink Knowledge Platform** (Zink Knowledgebase), tuân thủ nghiêm ngặt hợp đồng kiến trúc của hệ thống.

---

## 1. Giới thiệu & Vai trò Cốt lõi

**Zink Knowledge Platform** là nền tảng quản trị tri thức nghiên cứu và tham chiếu của con người trong hệ sinh thái Zink:

- **Thu nạp tài liệu (Ingestion):** Đọc dữ liệu từ Obsidian Vault của con người, bao gồm ghi chú Markdown cá nhân, sách chuyên khảo (Books) và bài báo nghiên cứu (Papers) dạng PDF.
- **Xử lý trí tuệ nhân tạo (Knowledge AI):** Phân đoạn văn bản ngữ nghĩa (semantic chunking), sinh vector nhúng đa ngôn ngữ chất lượng cao thông qua mô hình Ollama BGE-M3 (1024 chiều) và tái xếp hạng kết quả (reranking).
- **Lưu trữ & Lập chỉ mục lai (Hybrid Indexing):** Kết hợp tìm kiếm vector HNSW và tìm kiếm toàn văn Full-Text Search (FTS) trên PostgreSQL/pgvector với thuật toán hợp nhất Reciprocal Rank Fusion (RRF).
- **Truy xuất & Dẫn xuất nguồn gốc (Retrieval & Provenance):** Cung cấp API tìm kiếm ngữ nghĩa có trích dẫn chính xác (số trang, tên tệp, đoạn trích) cho các tác nhân AI (Agent O1 / OpenClaw).

### Ranh giới kiến trúc bất biến

1. **Obsidian Vault là bất biến (Read-Only Human Asset):** Thư mục Vault là tài sản thuộc quyền sở hữu riêng của con người. Hệ thống và các Agent chỉ có quyền đọc (`read-only`), tuyệt đối không được phép chỉnh sửa, ghi đè hoặc xóa bất kỳ tệp tin nào trong Vault.
2. **Quan hệ với `apps/knowledge/`:** Theo hợp đồng kiến trúc [AGENTS.md](../../AGENTS.md), container runtime FastAPI tại `apps/knowledge/` hiện là môi trường thực thi đã được kiểm chứng và đang hoạt động. Thư mục `platforms/knowledge-platform/` là đặc tả kiến trúc mục tiêu (target architecture scaffold). Mọi thao tác vận hành API đều tương tác trực tiếp với container runtime này thông qua Nginx loopback cổng `8080`.
3. **Độc lập tuyệt đối với Zink Skill Store:** Zink Skill Store là module ngang hàng tại `zink-skill-store/`, hoàn toàn tách biệt về quyền sở hữu, lưu trữ và logic nghiệp vụ.

---

## 2. Cấu trúc Các Phân vùng Chức năng

Thư mục `platforms/knowledge-platform/` được thiết kế theo mô hình mô-đun hóa cao:

```text
platforms/knowledge-platform/
├── ingestion/                      # Bộ thu nạp tài liệu thô
│   ├── connectors/                 # Kết nối nguồn (Obsidian Vault, Books, Papers, Videos)
│   └── processing/                 # Tiền xử lý (Cleaners, Parsers, Metadata Extraction, Normalizers)
├── knowledge-ai/                   # Khối tính toán AI nội bộ
│   ├── chunking/                   # Chiến lược phân đoạn văn bản thông minh theo tiêu đề và ngữ cảnh
│   ├── embeddings/                 # Tạo vector nhúng qua Ollama BGE-M3 (1024 chiều)
│   ├── reranking/                  # Tái xếp hạng kết quả với mô hình ONNX nội bộ
│   └── document-understanding/     # Phân tích cấu trúc bảng biểu, hình ảnh trong PDF
├── retrieval/                      # Khối truy xuất tri thức và trích dẫn
│   ├── search/                     # Thuật toán tìm kiếm lai Hybrid Search (HNSW + FTS RRF)
│   ├── citations/                  # Tạo trích dẫn chuẩn xác theo số trang và vị trí văn bản
│   ├── filters/                    # Lọc kết quả theo tag, thư mục, thời gian, loại tài liệu
│   └── source-policy/              # Ràng buộc độ tin cậy và nhãn nguồn
├── services/                       # Đặc tả dịch vụ nền tảng
│   ├── knowledge-api/              # Giao diện lập trình ứng dụng HTTP API
│   └── knowledge-indexer/          # Tiến trình quét nền và đồng bộ chỉ mục định kỳ
└── stores/                         # Quản lý tầng dữ liệu bền vững
    └── research-knowledge-store/   # Lưu trữ siêu dữ liệu và trạng thái tri thức nghiên cứu
```

---

## 3. Quy chuẩn Nguồn Dữ liệu Obsidian Vault

Để tiến trình lập chỉ mục hoạt động chính xác, thư mục gốc của Vault (`KNOWLEDGE_VAULT_ROOT`) phải tuân thủ quy tắc tổ chức:

- **`01. Knowledge/`:** Chứa các ghi chú cá nhân định dạng Markdown UTF-8 (`.md`).
  - Mỗi ghi chú cần có ít nhất một thẻ phân loại dạng chữ thường (vd: `#supplychain`, `#logistics`, `#ai`. Tập thẻ hợp lệ được khai báo trong `apps/knowledge/app/markdown_adapter.py` (`TOPIC_TAGS` cho các chủ đề gốc, `CANONICAL_SLUG_TO_TOPIC` cho các bí danh); ghi chú không mang thẻ hợp lệ sẽ bị từ chối với mã `REQUIRED_TOPIC_TAG_MISSING`.).
- **`02. Books/`:** Chứa sách chuyên khảo dạng PDF kèm theo một tệp Markdown "sidecar" cùng tên hoặc chứa cú pháp nhúng Obsidian: `![[Ten_Sach.pdf]]`.
- **`03. Papers/`:** Chứa các bài báo khoa học dạng PDF kèm tệp sidecar ghi rõ tác giả, năm xuất bản và tóm tắt (abstract).

---

## 4. Hướng dẫn Vận hành Từng Bước (End-to-End Walkthrough)

Tất cả các lệnh tương tác với Knowledge Platform được thực hiện thông qua Nginx loopback tại địa chỉ `http://127.0.0.1:8080/knowledge`:

### Bước 1: Kiểm tra tính sẵn sàng của hệ thống (Readiness Probe)

Trước khi lập chỉ mục hoặc tìm kiếm, đảm bảo container PostgreSQL, pgvector và dịch vụ Ollama nhúng vector đã sẵn sàng:

```powershell
Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:8080/knowledge/readyz"
```

- **Đầu ra mong đợi:** HTTP 200 với `status` = `ready`, kèm `active_index_id` và `embedding_model` (`name`, `digest`, `dimensions`) của model đã tải vào bộ nhớ.

---

### Bước 2: Kích hoạt Tiến trình Lập chỉ mục (Trigger Indexing)

Khi bổ sung tài liệu mới vào Obsidian Vault, kích hoạt tiến trình lập chỉ mục:

- **Lập chỉ mục bổ sung (Incremental - chỉ xử lý tệp mới/sửa đổi):**

```powershell
$body = @{ kind = "INCREMENTAL" } | ConvertTo-Json -Compress
$run = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8080/knowledge/v1/index-runs" -ContentType "application/json" -Body $body
$runId = $run.index_run_id
Write-Host "Bắt đầu lập chỉ mục với Run ID: $runId"
```

- **Xây dựng lại toàn bộ từ đầu (Full Rebuild):**

```powershell
$body = @{ kind = "FULL_REBUILD" } | ConvertTo-Json -Compress
$run = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8080/knowledge/v1/index-runs" -ContentType "application/json" -Body $body
$runId = $run.index_run_id
Write-Host "Bắt đầu xây dựng lại toàn bộ với Run ID: $runId"
```

---

### Bước 3: Theo dõi Tiến độ Lập chỉ mục (Polling Status)

Sử dụng `run_id` để kiểm tra tiến trình xử lý tài liệu cho đến khi hoàn tất:

```powershell
$status = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:8080/knowledge/v1/index-runs/$runId"
Write-Host "Trạng thái: $($status.status) | Đã xử lý: $($status.sources_indexed)/$($status.sources_discovered) nguồn"
```

- Trạng thái hoàn thành thành công: `SUCCEEDED`.
- Nếu có sự cố trong quá trình đọc tài liệu: `FAILED` kèm thông báo lỗi chi tiết.

---

### Bước 4: Thực hiện Tìm kiếm Ngữ nghĩa Lai & Trích dẫn Nguồn

Gửi truy vấn tìm kiếm tri thức để phục vụ phân tích nghiệp vụ:

```powershell
$queryBody = @{
    query = "mô hình quản trị tồn kho đa chặng và công thức tính an toàn"
    limit = 5
} | ConvertTo-Json -Compress

$response = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8080/knowledge/v1/search" -ContentType "application/json" -Body $queryBody

foreach ($hit in $response.results) {
    Write-Host "--------------------------------------------------"
    Write-Host "Tài liệu : $($hit.title)"
    Write-Host "Trích dẫn: $($hit.citation.markdown)"
    Write-Host "Điểm RRF : $($hit.rrf_score)"
    Write-Host "Nội dung : $($hit.text)"
}
```

---

## 5. Hướng dẫn Tích hợp với OpenClaw & Agent O1

Agent `o1` (Knowledge Specialist) là tác nhân duy nhất được giao tiếp trực tiếp với Knowledge Platform:

1. **Truy vấn tri thức chính xác:** Khi người dùng đặt câu hỏi về lý thuyết, quy chuẩn hoặc tài liệu tham khảo, OpenClaw định tuyến tác vụ đến Agent `o1`.
2. **Nguyên tắc chống ảo giác (Anti-hallucination Invariant):** Mọi câu trả lời của Agent `o1` bắt buộc phải kèm theo đường dẫn trích dẫn và số trang cụ thể từ kết quả của endpoint `/v1/search`. Nếu kết quả tìm kiếm không chứa dữ kiện, Agent phải trả lời rõ ràng rằng tài liệu không có thông tin, tuyệt đối không được tự suy diễn.

---

## 6. Xử lý Sự cố Thường Gặp (Troubleshooting)

| Triệu chứng                           | Nguyên nhân khả dĩ                                                        | Hướng xử lý                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Lỗi HTTP 503 tại `/readyz`            | Dịch vụ Ollama chưa bật hoặc chưa kéo mô hình `bge-m3:latest`             | Kiểm tra terminal Ollama: chạy `ollama serve` và `ollama pull bge-m3:latest`.                                               |
| Lỗi HTTP 409 khi gọi `/v1/index-runs` | Đang có một tiến trình lập chỉ mục khác đang chạy dở dang                 | Đợi tiến trình hiện tại hoàn tất hoặc kiểm tra log tại cổng Dozzle `http://127.0.0.1:9999`.                                 |
| Không tìm thấy tệp trong Vault        | Đường dẫn `KNOWLEDGE_VAULT_ROOT` trong `.env` bị sai                      | Kiểm tra tệp `infrastructure/docker/env/.env` và cập nhật đúng đường dẫn tuyệt đối của Obsidian Vault trên máy chủ Windows. |
| Kết quả tìm kiếm trả về rỗng          | Chưa thực hiện lập chỉ mục hoặc Vault chưa có tệp Markdown nào có thẻ tag | Thêm ít nhất 1 ghi chú có thẻ `#supplychain` vào thư mục `01. Knowledge/` và chạy lại lệnh ở Bước 2.                                |
| Không kết nối được tới cổng `8080`    | Container Nginx chưa được khởi động                                       | Chạy lệnh khởi động hệ thống: `powershell ./infrastructure/docker/scripts/start.ps1 -Profile knowledge`.                    |
