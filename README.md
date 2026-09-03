# Zink

## 1. Zink là gì?

Zink là nền tảng local-first cho công việc phân tích Supply Chain có hỗ trợ
OpenClaw. M5/T1-R2 chỉ đồng bộ kiến trúc, tài liệu và Docker runtime hiện có;
không triển khai Tools, specialist hay adapter mới.

## 2. Kiến trúc tổng thể

Zink có ba module peer:

- Zink Knowledgebase: ingestion, index, retrieval, provenance và citation cho
  Knowledge Vault do con người sở hữu.
- Zink Skill Store: lưu skill được quản trị và template Excel/Power BI.
- Zink Tools: boundary callable mỏng cho các capability thực thi.

apps/knowledge/ là runtime Knowledgebase hiện tại. zink-skill-store/ và
zink-tools/ là peer path; không lồng vào Knowledgebase.

## 3. Kiến trúc Five-Stack

1. Infrastructure: R2, DuckDB, MotherDuck, Kaggle, Databricks và local compute.
2. Execution: Excel, Power BI, SQL, Python và n8n.
3. Semantic: domain meaning, KPI, business rule và constraint.
4. Intelligence: Forecast, Optimization, Operations Research và Simulation.
5. Decision: Main/O1/O2 tổng hợp evidence, rủi ro và khuyến nghị.

Stack là lớp chức năng, không phải service hay agent bắt buộc.

## 4. OpenClaw và n8n làm gì?

OpenClaw sở hữu orchestration, routing, permission và model-tool execution.
n8n sở hữu workflow deterministic, trigger, schedule và trạng thái workflow.
OpenClaw-to-Skill-Store qua adapter mỏng của Tools là boundary đã reserve trong
kiến trúc; adapter chưa được triển khai trong M5/T1-R2.

## 5. L&SC logical data flow

L&SC Data Plant chỉ là tên historical cho logical external data/compute flow:
source → n8n/Python → R2/DuckDB/MotherDuck → external/local compute →
decision-science → OpenClaw → Excel/Power BI. Đây không phải module, runtime hay
data platform cần build trong repository.

## 6. Yêu cầu hệ thống

- Windows 11 hoặc môi trường Windows có WSL2.
- Docker Desktop với WSL2 backend.
- Git.
- Node 24.15.x và npm chính xác 12.0.2 để chạy repository verification.
- Ollama đang chạy tại [http://127.0.0.1:11434](http://127.0.0.1:11434) với bge-m3:latest cho profile
  Knowledge.

## 7. Chuẩn bị Knowledge Vault

KNOWLEDGE_VAULT_ROOT phải trỏ đến Vault tuyệt đối, có tối thiểu:

```text
01. Knowledge/
02. Books/
03. Papers/
```

Vault là human-owned và được mount read-only. Không để runtime ghi vào Vault.

## 8. Quy tắc tài liệu

- Markdown là UTF-8.
- Mỗi note được index cần ít nhất một canonical lowercase tag.
- PDF trong 02. Books hoặc 03. Papers cần Markdown sidecar hợp lệ và một
  Obsidian embed trỏ chính xác PDF.
- Sidecar và PDF chỉ được đọc; không có workflow tự sửa Vault.

## 9. Cấu hình .env

Sao chép infrastructure/docker/env/.env.example thành
infrastructure/docker/env/.env, rồi thay các giá trị secret. Không commit file
này. Profile knowledge và all cần KNOWLEDGE_VAULT_ROOT; profile automation không
cần Nginx hoặc Vault mount. Profile knowledge không yêu cầu secret n8n; profile
automation và all cần N8N_POSTGRES_PASSWORD cùng N8N_ENCRYPTION_KEY.

## 10. Setup và khởi động

Kiểm tra trước:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/preflight.ps1 -Profile knowledge -EnvironmentFile ./infrastructure/docker/env/.env
```

Build Knowledge image (yêu cầu working tree sạch để provenance image khớp Git):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/build.ps1 -Profile knowledge -EnvironmentFile ./infrastructure/docker/env/.env
```

Khởi động:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/start.ps1 -Profile knowledge -EnvironmentFile ./infrastructure/docker/env/.env
```

## 11. Các profile Docker

| Profile    | Runtime service                           |
| ---------- | ----------------------------------------- |
| knowledge  | PostgreSQL, Knowledge, Nginx, Dozzle      |
| automation | PostgreSQL, n8n, Dozzle                   |
| all        | PostgreSQL, Knowledge, Nginx, n8n, Dozzle |

postgres-bootstrap là helper one-shot để chuẩn bị database n8n, không phải
runtime service. Nginx hiện chỉ proxy /knowledge, vì vậy không chạy trong
profile automation.

## 12. Index Knowledgebase

API hiện có hỗ trợ FULL_REBUILD và INCREMENTAL. Ví dụ full rebuild:

```powershell
$body = @{ kind = "FULL_REBUILD" } | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8080/knowledge/v1/index-runs -ContentType application/json -Body $body
```

Chỉ chạy index khi Vault ở trạng thái nhất quán.

## 13. Theo dõi ingestion

Dùng run_id trả về từ request index để poll:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:8080/knowledge/v1/index-runs/<run_id>
```

Recovery/publishing workflow operator đầy đủ chưa được thêm command tiện dụng
mới trong M5/T1-R2; xem runbook hiện hữu khi thực hiện acceptance M4.

## 14. Search / API

Nginx chỉ expose loopback. Các endpoint Knowledge hiện hành đi qua
[http://127.0.0.1:8080/knowledge](http://127.0.0.1:8080/knowledge), gồm /healthz, /readyz, /v1/index-runs và
/v1/search. Endpoint phải được gọi với method/body theo contract ứng dụng;
không có API Tools hay Skill Store runtime trong milestone này.

## 15. n8n

Mở [http://127.0.0.1:5678](http://127.0.0.1:5678) sau khi start profile automation hoặc all. n8n được
giữ làm deterministic workflow runtime; workflow n8n mới chưa được triển khai
trong M5/T1-R2.

## 16. Dozzle

Mở [http://127.0.0.1:9999](http://127.0.0.1:9999) để xem log container của project. Dozzle là operator
log viewer, không phải observability stack. Nó chỉ bind loopback, mount Docker
socket read-only và tắt actions, shell và MCP.

## 17. Dừng / khởi động lại

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/stop.ps1 -Profile knowledge -EnvironmentFile ./infrastructure/docker/env/.env
```

Lệnh stop không xóa named volume. Chạy lại start.ps1 với cùng profile để khởi
động lại.

## 18. Troubleshooting

- preflight.ps1 báo Ollama/model: khởi động Ollama và cài đúng model được cấu
  hình trong OLLAMA_SMOKE_MODEL.
- KNOWLEDGE_VAULT_ROOT lỗi: dùng absolute path và kiểm tra có 01. Knowledge.
- n8n không healthy: kiểm tra POSTGRES_PASSWORD, N8N_POSTGRES_PASSWORD,
  N8N_ENCRYPTION_KEY, rồi xem Dozzle.
- Không dùng docker compose down --volumes cho runtime operational.

## 19. WSL resource limits

| Service             | Maximum limit |
| ------------------- | ------------: |
| Knowledge           |         4 GiB |
| PostgreSQL/pgvector |       1.5 GiB |
| n8n                 |       768 MiB |
| Nginx               |       128 MiB |
| Dozzle              |       128 MiB |
| **Total**           |   **6.5 GiB** |

Đây là maximum memory limits, không phải RAM reservation. Với WSL ceiling 8 GiB,
khoảng 1.5 GiB còn lại là headroom cho Docker/WSL overhead.

## 20. Trạng thái project

M4 là runtime Knowledgebase đã được chấp nhận trước đó. M5/T1-R2 là task hiện
tại cho architecture/documentation/Docker contraction; không đồng nghĩa toàn bộ
M5 hoàn tất. Xem [PLAN.md](PLAN.md) để biết lifecycle và evidence chính xác.
