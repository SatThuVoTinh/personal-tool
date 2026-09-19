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

## 3. Thành phần và Hồ sơ Chi tiết 7 Vai trò Agent

Hệ thống OpenClaw quản trị cụm 7 agent vai trò cố định. Các agent hoạt động trong môi trường Docker sandbox cô lập (`/workspace`), tuân thủ ranh giới quyền hạn nghiêm ngặt và không tự ý gọi chéo nhau trực tiếp trên Discord:

### Bảng Tổng hợp Danh mục 7 Bot

| Agent ID   | Tên hiển thị Discord | Snowflake ID          | Handle / Tag        | Nhiệm vụ chính                                         | Công cụ Zink được gọi                                                                                           | Môi trường Sandbox      |
| :--------- | :------------------- | :-------------------- | :------------------ | :----------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------- | :---------------------- |
| `main`     | **Quản Lý**          | `1545436878835163156` | `@Quản Lý`          | Tiếp nhận, phân rã DAG, lập Execution Brief, tổng hợp  | `sessions_spawn`, `sessions_yield`, `session_status`, `zink_knowledge_search`, `zink_skill_search`              | Cô lập, điều phối       |
| `o1`       | **Điều Phối 1 (O1)** | `1545437953197744248` | `@Điều Phối 1 (O1)` | Chuyên viên Tri thức (Knowledge Specialist)            | `session_status`, `zink_knowledge_search`, `zink_skill_search`, `zink_skill_propose`                            | Sandbox read-only Vault |
| `o2`       | **Điều Phối 2 (O2)** | `1545438251966402661` | `@Điều Phối 2 (O2)` | Chuyên viên Quy trình (Orchestrator)                   | `session_status`, `zink_n8n`, `zink_knowledge_search`, `zink_skill_search`                                      | Sandbox Docker          |
| `excel`    | **Excel**            | `1545438637750227104` | `@Excel`            | Chuyên viên Bảng tính (Spreadsheet Specialist)         | `session_status`, `zink_excel`, `zink_skill_search`, `zink_skill_propose`, `zink_knowledge_search`              | Sandbox Docker          |
| `power-bi` | **PowerBI**          | `1545439082019164271` | `@PowerBI`          | Chuyên viên Báo cáo BI (BI & Dashboard Specialist)     | `session_status`, `zink_power_bi`, `zink_skill_search`, `zink_skill_propose`, `zink_knowledge_search`           | Sandbox Docker          |
| `sql`      | **SQL**              | `1545438861356966010` | `@SQL`              | Chuyên viên Dữ liệu & Truy vấn (Data & SQL Specialist) | `session_status`, `zink_sql`, `zink_skill_search`, `zink_skill_propose`, `zink_knowledge_search`                | Governed DuckDB Bridge  |
| `python`   | **Python**           | `1545439279843508235` | `@Python`           | Chuyên viên Khoa học Dữ liệu (Decision & Data Science) | `session_status`, `zink_python`, `zink_n8n`, `zink_skill_search`, `zink_skill_propose`, `zink_knowledge_search` | Sandbox Docker          |

---

### Hồ sơ Chi tiết Từng Agent

#### 1. Agent `main` — Quản Lý (Coordinator Agent)

- **Discord Handle:** `@Quản Lý` (ID: `1545436878835163156`)
- **Chức năng chính:** Điểm tiếp nhận yêu cầu đầu tiên từ người vận hành trên kênh `#office` hoặc DM. Phân tích yêu cầu, phân loại bài toán (Work/Research), phân rã DAG (Directed Acyclic Graph) và lập Execution Brief.
- **Quyền hạn & Công cụ:**
  - Được phép sử dụng `sessions_spawn` để giao nhiệm vụ con cho các sub-agent chuyên trách (`o1`, `o2`, `excel`, `power-bi`, `sql`, `python`) ở chế độ cô lập hoàn toàn (`context=isolated`, `mode=run`, `sandbox=require`).
  - Được phép sử dụng `sessions_yield` để nhận kết quả dạng push-based bất đồng bộ từ các sub-agent.
  - Sử dụng `session_status` để kiểm tra trạng thái luồng làm việc.
- **Ranh giới an toàn & Giới hạn:**
  - **Không** gọi trực tiếp các công cụ thực thi dữ liệu (`zink_excel`, `zink_power_bi`, `zink_sql`, `zink_python`, `zink_n8n`).
  - Kiểm định toàn bộ kết quả đầu ra của sub-agent theo lược đồ hợp đồng `agent-result-payload-v1` (xác thực `outcome_claim`, `assumptions`, `limitations`, `self_validation`) trước khi phản hồi người dùng.

#### 2. Agent `o1` — Điều Phối 1 (Knowledge Specialist)

- **Discord Handle:** `@Điều Phối 1 (O1)` (ID: `1545437953197744248`)
- **Chức năng chính:** Chuyên viên quản trị và khai thác tri thức. Chịu trách nhiệm tra cứu tài liệu tham khảo, tiêu chuẩn quy trình, tài liệu chuyên môn và lịch sử quyết định trong Zink Knowledgebase.
- **Quyền hạn & Công cụ:**
  - Truy xuất Knowledgebase thông qua giao diện API nội bộ `http://127.0.0.1:8080/knowledge` (tìm kiếm vector HNSW, Full-Text Search FTS, trích xuất đoạn văn bản kèm metadata và nguồn gốc provenance).
  - Sử dụng `session_status`.
- **Ranh giới an toàn & Giới hạn:**
  - Thư mục nguồn Obsidian Vault của con người được mount ở chế độ **chỉ đọc (`read-only`)**; tuyệt đối không ghi đè, sửa đổi hay xóa tài liệu trong Vault.
  - Không có quyền thao tác trực tiếp trên cơ sở dữ liệu phân tích hay các adapter ngoại vi.

#### 3. Agent `o2` — Điều Phối 2 (Orchestrator)

- **Discord Handle:** `@Điều Phối 2 (O2)` (ID: `1545438251966402661`)
- **Chức năng chính:** Chuyên viên điều phối các chuỗi quy trình tất định (deterministic workflows) và tự động hóa tác vụ định kỳ giữa các hệ thống.
- **Quyền hạn & Công cụ:**
  - Sử dụng `zink_n8n` để kích hoạt các workflow đã được kiểm định và cấp phép trong n8n instance cục bộ (`http://127.0.0.1:5678`).
  - Sử dụng `session_status`.
- **Ranh giới an toàn & Giới hạn:**
  - Chỉ kích hoạt các mẫu workflow chuẩn (P1 - P10); không tự ý tạo mới hoặc sửa đổi cấu trúc node n8n trên production mà chưa có phê duyệt của operator.

#### 4. Agent `excel` — Chuyên viên Bảng tính (Excel Specialist)

- **Discord Handle:** `@Excel` (ID: `1545438637750227104`)
- **Chức năng chính:** Xử lý, tính toán, định dạng và xuất bản các mô hình bảng tính `.xlsx`, bảng dữ liệu kiểm kê, báo cáo tài chính và supply chain planning.
- **Quyền hạn & Công cụ:**
  - Sử dụng `zink_excel` để thực thi các thao tác đọc/ghi bảng tính, áp dụng công thức, macro chuẩn hóa và tạo sheet báo cáo.
  - Sử dụng template quản trị lưu trữ trong `zink-skill-store/templates/`.
  - Sử dụng `session_status`.
- **Ranh giới an toàn & Giới hạn:**
  - Chỉ thao tác với các tệp tin trong môi trường sandbox cô lập của task hoặc thư mục artifact đã được chỉ định rõ ràng; không truy cập hệ thống tệp bên ngoài.

#### 5. Agent `power-bi` — Chuyên viên Báo cáo BI (Power BI Specialist)

- **Discord Handle:** `@PowerBI` (ID: `1545439082019164271`)
- **Chức năng chính:** Thiết kế, cập nhật và trực quan hóa dữ liệu kinh doanh dưới dạng dashboard và báo cáo Power BI (`.pbix`).
- **Quyền hạn & Công cụ:**
  - Sử dụng `zink_power_bi` để sinh cấu trúc mô hình dữ liệu (semantic model), công thức DAX chuẩn, bố cục dashboard và định dạng báo cáo.
  - Sử dụng `session_status`.
- **Ranh giới an toàn & Giới hạn:**
  - Tiêu thụ dữ liệu phân tích đã được tổng hợp ở tầng Gold; không can thiệp trực tiếp vào dữ liệu thô tầng Landing hoặc Silver.

#### 6. Agent `sql` — Chuyên viên Truy vấn Dữ liệu (SQL Specialist)

- **Discord Handle:** `@SQL` (ID: `1545438861356966010`)
- **Chức năng chính:** Khảo sát, trích xuất và biến đổi dữ liệu phân tích thông qua các câu truy vấn SQL hiệu năng cao trên DuckDB, MotherDuck và BigQuery.
- **Quyền hạn & Công cụ:**
  - Sử dụng `zink_sql` để gửi câu lệnh truy vấn tới DuckDB Governed Bridge trên Windows hoặc các cloud data warehouse.
  - Sử dụng `session_status`.
- **Ranh giới an toàn & Giới hạn:**
  - **Chỉ đọc (`read-only`):** DuckDB Bridge kiểm soát chặt chẽ cú pháp (AST validation); cấm tuyệt đối các thao tác thay đổi schema tùy tiện, cấm `ATTACH`, `COPY`, cấm thoát khỏi thư mục cơ sở dữ liệu (`DUCKDB_FILESYSTEM_ACCESS_DENIED`) và cấm gọi lệnh shell máy chủ.

#### 7. Agent `python` — Chuyên viên Khoa học Dữ liệu (Decision & Data Science)

- **Discord Handle:** `@Python` (ID: `1545439279843508235`)
- **Chức năng chính:** Thực thi các bài toán khoa học quyết định phức tạp: phân tích thống kê, tối ưu hóa tuyến tính/phi tuyến, dự báo chuỗi thời gian, mô phỏng Monte Carlo và xử lý dữ liệu định lượng.
- **Quyền hạn & Công cụ:**
  - Sử dụng `zink_python` để chạy các script Python phân tích trong môi trường container runtime bảo mật.
  - Sử dụng `zink_n8n` để kích hoạt pipeline tính toán khi cần thiết.
  - Sử dụng `session_status`.
- **Ranh giới an toàn & Giới hạn:**
  - Chạy trong Docker container sandbox; tài nguyên compute nặng được điều hướng ra adapter ngoại vi (Kaggle/Databricks) có kiểm soát; mô hình học máy ngoại vi chỉ dừng ở mức đánh giá (`EVALUATED_NOT_PROMOTED`), cấm tự động đưa vào production.

---

## 4. Hướng dẫn Thiết lập và Vận hành Cụm Discord Gateway

Hệ thống giao tiếp Discord của Personal Tool vận hành theo mô hình Multi-Bot Gateway tập trung, quản lý đồng thời 7 bot client dưới một tiến trình duy nhất trên nền tảng OpenClaw trong môi trường WSL2 Ubuntu.

### 1. Quản lý Khóa Bí mật (Discord Tokens) qua Pass-Store

Mọi token của 7 bot được mã hóa bằng GPG thông qua công cụ `pass` (password-store), tuyệt đối không lưu dưới dạng plain text trong mã nguồn:

```bash
# Kiểm tra các khóa token bot đã được lưu trữ trong pass-store
pass show zink/openclaw/DISCORD_BOT_TOKEN_MAIN
pass show zink/openclaw/DISCORD_BOT_TOKEN_O1
pass show zink/openclaw/DISCORD_BOT_TOKEN_O2
pass show zink/openclaw/DISCORD_BOT_TOKEN_EXCEL
pass show zink/openclaw/DISCORD_BOT_TOKEN_POWER_BI
pass show zink/openclaw/DISCORD_BOT_TOKEN_SQL
pass show zink/openclaw/DISCORD_BOT_TOKEN_PYTHON
```

Nếu cần cập nhật token mới cho bot bất kỳ:

```bash
pass insert zink/openclaw/DISCORD_BOT_TOKEN_<AGENT_ID>
```

### 2. Cấu hình Giữ Kết nối Mạng (TCP Keepalive Prevention)

Mặc định trên Linux và WSL2, `net.ipv4.tcp_keepalive_time` là 7200 giây (2 giờ). Khi hệ thống ở trạng thái nhàn rỗi không có tin nhắn, bảng định tuyến NAT / vSwitch của Windows sẽ đóng kết nối WebSocket ngầm định sau khoảng 2 giờ, dẫn tới lỗi ngắt kết nối WebSocket `1006` và làm trễ các bot trong hàng đợi identify rate-limit của Discord.

Hệ thống đã được cấu hình tối ưu vĩnh viễn tại `/etc/sysctl.d/99-openclaw-keepalive.conf`:

```ini
net.ipv4.tcp_keepalive_time = 60
net.ipv4.tcp_keepalive_intvl = 10
net.ipv4.tcp_keepalive_probes = 3
```

Cấu hình này gửi tín hiệu thăm dò socket định kỳ mỗi 60 giây, đảm bảo cả 7 kết nối WebSocket tới Discord Gateway luôn được duy trì liên tục 24/7 mà không bao giờ bị ngắt quãng.

### 3. Vận hành Dịch vụ Gateway qua Systemd

Tiến trình Gateway được quản lý như một dịch vụ người dùng systemd (`openclaw-gateway-zink.service`):

```bash
# Kiểm tra trạng thái hoạt động của cụm bot
systemctl --user status openclaw-gateway-zink.service

# Khởi động lại dịch vụ gateway khi thay đổi cấu hình
systemctl --user restart openclaw-gateway-zink.service

# Xem nhật ký hoạt động thời gian thực của gateway
journalctl --user -u openclaw-gateway-zink.service -f

# Kiểm tra số lượng kết nối WebSocket đang hoạt động tới Discord (phải đủ 7 kết nối)
ss -tnp | grep 443
```

---

## 5. Quy chuẩn Kênh Giao tiếp và Hướng dẫn Tương tác Discord

### Danh mục Kênh Discord của Hệ thống

| Kênh Discord            | Loại kênh                    | Snowflake ID          | Chức năng & Quy chuẩn                                                                                                                  |
| :---------------------- | :--------------------------- | :-------------------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| **`#office`**           | Văn phòng chung (Text)       | `1545425766161063937` | Nơi tiếp nhận yêu cầu, giao việc và điều phối hoạt động chung. Hỗ trợ tag trực tiếp bot hoặc trao đổi với `@Quản Lý`.                  |
| **`#results`**          | Kết quả phân tích (Forum)    | `1545696269010477056` | Diễn đàn đăng tải báo cáo, artifact và kết quả nghiệm thu của các task. Mọi bài viết là một Thread riêng biệt (`inheritParent: true`). |
| **`#approvals`**        | Phê duyệt quyết định (Forum) | `1545696207316455527` | Nơi các agent gửi đề xuất giải quyết mâu thuẫn ngữ nghĩa (`BLOCKED_SEMANTIC_REVIEW`) chờ chủ sở hữu phê duyệt.                         |
| **`#incidents`**        | Báo cáo sự cố (Forum)        | `1545696360018481182` | Kênh thông báo cảnh báo lỗi, vi phạm hợp đồng dữ liệu hoặc sự cố ranh giới an toàn.                                                    |
| **Tin nhắn riêng (DM)** | Direct Message               | N/A                   | Dành riêng cho chủ sở hữu (`854005217715814432`) nhắn tin trực tiếp riêng cho từng bot.                                                |

---

### Hướng dẫn Tương tác trên Discord Desktop & Discord Mobile

Để đảm bảo các bot luôn phản hồi 100% chính xác trên cả ứng dụng máy tính (Desktop) và ứng dụng điện thoại (Discord Mobile), người vận hành lưu ý các cơ chế giao tiếp sau:

#### 1. Cơ chế Nhận diện Mention Đa hình (Polymorphic Mention Resolution)

Hệ thống hỗ trợ 3 hình thức tag bot:

- **Native Mention (`<@ID>`):** Khi bạn gõ `@` và chọn tên bot từ danh sách gợi ý của Discord.
- **Nickname Mention (`<@!ID>`):** Khi Discord Mobile hoặc Desktop gắn tag bot có biệt danh máy chủ.
- **Plain-text Mention (Nhận diện văn bản tiếng Việt & tiếng Anh):** Khi bàn phím trên điện thoại tự động thêm khoảng trắng hoặc không hiện pop-up gợi ý, bạn hoàn toàn có thể gõ trực tiếp tên bot dạng text thuần. Hệ thống đã được tích hợp `groupChat.mentionPatterns` đa ngữ:
  - Gọi Quản Lý: `@Quản Lý`, `@quản lý`, `@Quản lý`, `@main`
  - Gọi Điều Phối 1: `@Điều Phối 1`, `@điều phối 1`, `@o1`, `@knowledge`
  - Gọi Điều Phối 2: `@Điều Phối 2`, `@điều phối 2`, `@o2`, `@orchestrator`
  - Gọi Excel: `@Excel`, `@excel`
  - Gọi Power BI: `@PowerBI`, `@power-bi`, `@powerbi`
  - Gọi SQL: `@SQL`, `@sql`
  - Gọi Python: `@Python`, `@python`

#### 2. Thảo luận trong Diễn đàn Forum (`#results`, `#approvals`, `#incidents`)

- Trên cả Desktop và Mobile, mỗi bài đăng trong Forum là một **Thread**.
- Nhờ cấu hình `thread.inheritParent: true`, mọi bài đăng và phản hồi trong thread đều tự động kế thừa quyền hạn allowlist và phân quyền của kênh diễn đàn cha.
- Bạn chỉ cần mở thread và tag bot cần làm việc (ví dụ: `@Excel kiểm tra số liệu bảng này giúp anh`), bot sẽ phản hồi trực tiếp ngay trong thread đó.

#### 3. Nhắn tin Trực tiếp Riêng (Direct Message — DM)

- Trên Discord Mobile, bạn có thể bấm vào avatar của bất kỳ bot nào và chọn **Nhắn tin** (Send Message).
- Cấu hình `dmPolicy: "allowlist"` kết hợp `allowFrom: ["854005217715814432"]` đảm bảo chỉ duy nhất chủ sở hữu được phép trò chuyện riêng tư với các bot qua tin nhắn DM; các tài khoản lạ sẽ bị từ chối tự động.

#### 4. Quy trình Phê duyệt Kỹ năng Mới trên Diễn đàn `#approvals`

- Khi một agent (`excel`, `power-bi`, `sql`, `python`, `o1`) học được kỹ năng mới hoặc giải pháp phân tích tái sử dụng, agent gọi `zink_skill_propose` để khởi tạo bản ghi `CANDIDATE`.
- Đề xuất được định danh bằng mã băm nội dung bất biến (immutable SHA-256 hash) và gửi thông báo vào diễn đàn `#approvals`.
- **Phê duyệt:** Chủ sở hữu (`854005217715814432`) đọc nội dung đề xuất và trả lời trực tiếp trong thread với nội dung chứa từ khóa `APPROVED` (ví dụ: `APPROVED` hoặc `Đồng ý APPROVED`).
- **Xác thực tự động:** Hệ thống `handleOwnerSkillApproval` sẽ xác thực danh tính chủ sở hữu và tính toàn vẹn của mã băm nội dung, sau đó tiến hành kích hoạt kỹ năng lên trạng thái `ACTIVE` trong Git canonical store và đồng bộ sang PostgreSQL vector index. Mọi nỗ lực giả mạo danh tính hoặc sai lệch mã băm đều bị từ chối fail-closed.

---

## 6. Danh mục Công cụ Zink có thể gọi (Callable Tools)

Hệ thống cung cấp đúng 8 công cụ Zink được phép thực thi có quản trị:

### Nhóm 1: Công cụ Thực thi Chuyên môn (Execution Specialist Tools)

1. **`zink_excel`:** Hợp đồng gọi xử lý bảng tính Excel cho agent `excel`.
2. **`zink_power_bi`:** Hợp đồng trực quan hóa báo cáo Power BI cho agent `power-bi`.
3. **`zink_sql`:** Giao diện truy vấn SQL phân tích chỉ đọc (Lean Option B) cho agent `sql`.
4. **`zink_python`:** Giao diện xử lý tính toán số và khoa học quyết định cho agent `python`.
5. **`zink_n8n`:** Bộ điều hợp kích hoạt luồng công việc tất định cho agent `o2` và `python`.

### Nhóm 2: Công cụ Bộ nhớ & Truy xuất Tri thức (Governed Memory & Semantic RAG Tools)

1. **`zink_skill_search`:** Tra cứu vector ngữ nghĩa trong Zink Skill Store (1024-dim BGE-M3, HNSW cosine distance, chỉ lọc skill trạng thái `ACTIVE`). Cho phép cả 7 agent truy xuất các kỹ năng phân tích và template chuẩn.
2. **`zink_skill_propose`:** Cơ chế ghi nhớ 2 chiều (Human-in-the-Loop Memory) dành cho các agent chuyên môn (`excel`, `power-bi`, `sql`, `python`) và `o1`. Agent đề xuất kỹ năng mới dưới dạng `CANDIDATE` kèm hash định danh bất biến, đẩy vào kênh `#approvals`. Tuyệt đối không cho phép agent tự kích hoạt `ACTIVE`; bắt buộc có sự phê duyệt xác thực từ chủ sở hữu.
3. **`zink_knowledge_search`:** Tra cứu ngữ nghĩa Knowledgebase một chiều (Vector HNSW + FTS + RRF reranker kèm trích dẫn source và bbox). Cho phép cả 7 agent tra cứu tài liệu và quy trình chuẩn từ Obsidian Vault mà không thể can thiệp sửa đổi nội dung nguồn.

_4 Năng lực đặc tả (Schema-only capabilities):_ `zink_forecast`, `zink_optimization`, `zink_operations_research`, `zink_simulation` là các lược đồ định dạng bài toán toán học, không phải công cụ thực thi trực tiếp.

---

## 7. Yêu cầu Hệ thống

Trước khi vận hành, máy trạm cần đáp ứng các điều kiện sau:

- **Hệ điều hành:** Windows 11 (64-bit) có kích hoạt WSL2.
- **Node.js:** Phiên bản `>= 24.15.0 < 25` (Khuyến nghị Node `24.15.0`).
- **npm:** Phiên bản chính xác `12.0.2`.
- **DuckDB CLI:** Bản cài đặt native trên Windows (thông qua WinGet: `DuckDB.cli_Microsoft.Winget.Source_8wekyb3d8bbwe`).
- **Docker Desktop:** WSL2 engine đang chạy (phục vụ n8n, PostgreSQL, pgvector và Nginx).
- **Git:** Bản cài đặt Git chuẩn cho Windows.

---

## 8. Hướng dẫn Thiết lập Từng bước (Docker & Nền tảng Cục bộ)

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

## 9. Khởi động và Kiểm tra Sức khỏe Hệ thống (Preflight & Start)

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

## 10. Sử dụng Governed DuckDB Windows Bridge

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

## 11. Cấu hình và Sử dụng Nhà cung cấp Ngoại vi (External Providers)

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

## 12. 10 Mẫu Điều phối Chuẩn (Orchestration Patterns P1 - P10)

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

## 13. Xử lý Trạng thái Bị Chặn (Blocked Handling)

Khi hệ thống gặp điều kiện cần chủ sở hữu quyết định hoặc thiếu tài nguyên:

- Hệ thống chuyển sang trạng thái `BLOCKED` hoặc `BLOCKED_SEMANTIC_REVIEW`.
- Ghi nhận mã chặn (`BLOCKER_ID`), nguyên nhân, cổng kiểm thử bị ảnh hưởng và hành động cần người vận hành thực hiện.
- **Người vận hành can thiệp:** Cung cấp thông tin xác thực hoặc phê duyệt đề xuất qua giao diện quản trị.
- Sau khi giải quyết, hệ thống tiếp tục chạy chính xác từ cổng bị chặn, không chạy lại toàn bộ từ đầu.

---

## 14. Ranh giới An toàn và Hành vi Bị Cấm Tuyệt đối

Người vận hành và các agent tuyệt đối tuân thủ các điều cấm sau:

1. **CẤM** thực thi lệnh shell/hệ điều hành tùy ý (`NO arbitrary host execution`).
2. **CẤM** điều khiển WSL hoặc can thiệp socket Docker (`NO WSL control`, `NO Docker socket exposure`).
3. **CẤM** mở n8n hoặc bất kỳ dịch vụ nội bộ nào ra mạng công cộng (`NO public exposure`, `localhost-only`).
4. **CẤM** duyệt cây thư mục máy chủ tùy tiện (`NO host traversal`).
5. **CẤM** đưa khóa bí mật, token, password hoặc API key vào mã nguồn, tệp Git hoặc tài liệu.
6. **CẤM** tự động thăng cấp mô hình/tập dữ liệu ngoại vi vào Knowledgebase hoặc production mà chưa qua phê duyệt.
7. **CẤM** chuyển đổi ngầm định (silent fallback) giữa các provider khi chưa có ủy quyền rõ ràng.

---

## 15. Bảng Tra cứu Sự cố (Troubleshooting)

| Hiện tượng                            | Nguyên nhân có thể                                  | Cách khắc phục                                                              |
| ------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| Lỗi `DUCKDB_UNAUTHORIZED_CALLER`      | Agent gọi không có quyền `zink_sql`                 | Chỉ định nhiệm vụ cho agent `sql`                                           |
| Lỗi `DUCKDB_FILESYSTEM_ACCESS_DENIED` | Truy vấn có chứa `ATTACH`, `COPY`, `read_csv`       | Dùng bảng có sẵn trong allowlist (`knowledge`, `analytics_read`)            |
| Lỗi `R2_LANDING_IMMUTABLE_VIOLATION`  | Cố ý ghi đè lên tệp Landing đã tồn tại              | Tạo định danh artifact mới với run_id mới                                   |
| Trạng thái `BLOCKED_SEMANTIC_REVIEW`  | Phát hiện nhập nhằng ngữ nghĩa (P3)                 | Xem xét đề xuất giải pháp và cung cấp quyết định phê duyệt                  |
| Lỗi kết nối n8n `ECONNREFUSED`        | Container n8n chưa chạy                             | Chạy script `./infrastructure/docker/scripts/start.ps1 -Profile automation` |
| Docker báo lỗi cổng bị chiếm          | Cổng 8080, 5678 hoặc 9999 đang mở bởi ứng dụng khác | Đóng ứng dụng chiếm cổng hoặc điều chỉnh cấu hình port                      |

---

## 16. Ma trận Trạng thái Nhà cung cấp (Provider Status Matrix)

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

## 17. Hướng dẫn Vận hành Runtime Quản trị, Thẩm quyền & Độ tin cậy (M8/T2)

Mục này hướng dẫn chi tiết quy chế vận hành, phân định thẩm quyền nghiêm ngặt, cơ chế hàng đợi xử lý ngoại tuyến và kiểm định đa tầng được hoàn thiện trong cột mốc M8/T2.

### 1. Mô hình Phân cấp Thẩm quyền (Authority Hierarchy)

Hệ thống thiết lập ranh giới quyền hạn phân cấp 5 tầng nhằm bảo đảm không có agent nào tự cấp quyền hoặc tự nghiệm thu kết quả:

```text
[ User (Người Dùng / Operator) ]
        │  ▲ (Duy nhất User có quyền: APPROVE, REJECT, ACCEPT, REQUEST_REVISION)
        ▼  │
[ Main Agent (@Quản Lý) ]
        │  ▲ (Giám sát Quản trị & Điều phối, phát hành FINAL_NOTIFICATION trên #office)
        ▼  │
[ Primary Execution Coordinator (O1 hoặc O2) ]
        │  ▲ (Chính xác 1 Coordinator chịu trách nhiệm giám sát thực thi task)
        ▼  │
[ Specialist Agents (Excel, PowerBI, SQL, Python) ]
        │  ▲ (Năng lực thực thi chuyên biệt; TUYỆT ĐỐI KHÔNG can thiệp quản trị)
        ▼  │
[ Local Laptop Worker ]
           (Kéo việc từ Queue, thực thi xử lý nặng, xuất bản artifact thật)
```

#### Ma trận Thẩm quyền 5 Bộ (Actor + Channel + Task + State + Action)

| Hành động (`Action`)        | Kênh Discord  | Tác nhân được phép (`Actor`) | Trạng thái yêu cầu (`State`) | Trạng thái chuyển đổi (`Next State`) |
| :-------------------------- | :------------ | :--------------------------- | :--------------------------- | :----------------------------------- |
| `APPROVE`                   | `#approvals`  | Duy nhất `User`              | `APPROVAL_PENDING`           | `QUEUED`                             |
| `REJECT_APPROVAL`           | `#approvals`  | Duy nhất `User`              | `APPROVAL_PENDING`           | `REJECTED`                           |
| `REQUEST_REVISION_APPROVAL` | `#approvals`  | `User`, `Main`               | `APPROVAL_PENDING`, `EXECUT` | `REVISING`                           |
| `ACCEPT_RESULT`             | `#results`    | Duy nhất `User`              | `RESULT_PENDING_REVIEW`      | `COMPLETE`                           |
| `REJECT_RESULT`             | `#results`    | Duy nhất `User`              | `RESULT_PENDING_REVIEW`      | `REJECTED`                           |
| `REQUEST_REVISION_RESULT`   | `#results`    | `User`, `Main`               | `RESULT_PENDING_REVIEW`      | `REVISING`                           |
| `CLAIM`                     | N/A (Queue)   | `Worker`, `O1`, `O2`         | `QUEUED`, `WAIT_WORKER`      | `EXECUTING`                          |
| `ASK_USER`                  | `#office`     | `O1`, `O2`, `Main`           | `EXECUTING`, `PREFLIGHT`     | `WAITING_FOR_USER`                   |
| `ANSWER_USER`               | `#office`     | Duy nhất `User`              | `WAITING_FOR_USER`           | `EXECUTING`                          |
| `EXECUTION_FINISHED`        | N/A (Runtime) | `O1`, `O2`, `Worker`         | `EXECUTING`                  | `RESULT_PENDING_REVIEW`              |
| `FINAL_NOTIFICATION`        | `#office`     | Duy nhất `Main`              | `COMPLETE`, `REJECTED`       | Giữ nguyên trạng thái cuối           |

_Nguyên tắc cốt lõi:_ Sự kiện `EXECUTION_FINISHED` chỉ đánh dấu kết thúc thực thi kỹ thuật. Nhiệm vụ chỉ được coi là hoàn tất (`COMPLETE`) khi người dùng trực tiếp nhấn nút **ACCEPT** trên thẻ nghiệm thu tại `#results`.

---

### 2. Quy chuẩn Vận hành 4 Kênh Discord Chuyên biệt

Hệ thống phân tách luồng giao tiếp thành 4 kênh Discord độc lập:

1. **Kênh `#office` — Bàn làm việc & Giao tiếp Trực tiếp:**
   - Tiếp nhận lệnh từ người dùng; Main phân tích bài toán và phân rã nhiệm vụ.
   - Khi điều phối viên (`O1`/`O2`) cần làm rõ câu hỏi nghiệp vụ, điều phối viên hỏi trực tiếp người dùng tại `#office`. Task tạm dừng ở `WAITING_FOR_USER`.
   - Người dùng trả lời trực tiếp tại `#office` để đưa task trở lại `EXECUTING`.
   - Sau khi task được nghiệm thu hoàn tất tại `#results`, `Main` phát thông báo tổng kết cuối cùng (`FINAL_NOTIFICATION`) trên `#office`.

2. **Kênh `#approvals` — Phê duyệt Kế hoạch Thực thi:**
   - Hiển thị thẻ kế hoạch (`formatGovernedApprovalCard`) gồm: mục tiêu, phạm vi ranh giới, dự toán tài nguyên, danh sách agent tham gia và token phiên làm việc.
   - Người dùng nhấn nút:
     - **[Duyệt Kế Hoạch]** (`APPROVE`): Đưa task vào hàng đợi `QUEUED`.
     - **[Từ Chối]** (`REJECT`): Đóng task ở trạng thái `REJECTED`.
     - **[Yêu Cầu Hiệu Chỉnh]** (`REQUEST_REVISION`): Chuyển về `REVISING` để cập nhật kế hoạch.

3. **Kênh `#results` — Nghiệm thu Kết quả & Xem trước Dữ liệu Thực:**
   - Chỉ xuất hiện khi task vượt qua quy trình Kiểm định Đa tầng (Multi-tier Validation).
   - Hiển thị thẻ kết quả (`formatGovernedResultCard`) gồm tóm tắt kết quả, chứng thực kiểm tra kỹ thuật/kinh doanh và trích xuất dữ liệu thực tế (Real Artifact Preview: 5 dòng đầu CSV, bảng tổng hợp Excel hoặc trích đoạn JSON/Markdown). Tuyệt đối cấm sử dụng dữ liệu giả mạo (mock).
   - Người dùng bấm nút:
     - **[Nghiệm Thu Hoàn Tất]** (`ACCEPT_RESULT`): Chuyển task sang `COMPLETE`.
     - **[Không Đạt / Từ Chối]** (`REJECT_RESULT`): Đóng task ở `REJECTED`.
     - **[Yêu Cầu Chỉnh Sửa]** (`REQUEST_REVISION`): Chuyển task về `REVISING` kèm phản hồi.

4. **Kênh `#incidents` — Báo cáo Sự cố & Cảnh báo An toàn:**
   - Tự động phát cảnh báo dạng thẻ đỏ (`formatIncidentCard`) khi:
     - Xảy ra vi phạm ranh giới thẩm quyền (ví dụ: agent chuyên biệt cố ý tự duyệt).
     - Kiểm định kỹ thuật thất bại (tệp rỗng, sai schema, thiếu trường dữ liệu).
     - Kiểm định nghiệp vụ không đạt khiến kết quả bị chặn (`RESULT BLOCKED`).
     - Worker crash hoặc mất kết nối quá hạn thời gian cho phép (heartbeat timeout).

---

### 3. Cơ chế Hàng đợi & Phục hồi Worker Cục bộ (Local Laptop Worker)

Hệ thống tách biệt hoàn toàn giữa **Control Plane** (chạy 24/7 trên máy chủ/VPS/môi trường luôn mở) và **Local Laptop Worker** (chạy trên laptop cá nhân của operator):

- **Xử lý khi Laptop tắt/sleep:** Khi laptop của worker ngoại tuyến, task được lưu trữ an toàn trong hàng đợi bền vững (`QueueManager`) ở trạng thái `QUEUED` hoặc `WAITING_FOR_WORKER`. Không có task nào bị mất mát dữ liệu.
- **Tự động nhận việc (Atomic Claim):** Khi laptop khởi động lại và worker kết nối, worker thực hiện `claimTask` nguyên tử để khóa độc quyền task và bắt đầu thực thi.
- **Giám sát nhịp tim (Heartbeat & Stale Recovery):** Worker cập nhật heartbeat định kỳ. Nếu worker bị tắt đột ngột hoặc mất nguồn, Control Plane định kỳ quét qua `detectAndRecoverStaleTasks` để thu hồi task bị treo và chuyển lại về `WAITING_FOR_WORKER` cho lượt chạy kế tiếp.

---

### 4. Kiểm định Đa tầng (Multi-tier Validation)

Quy trình nghiệm thu kết quả tuân thủ nghiêm ngặt 2 tầng kiểm tra độc lập:

1. **Tầng Kỹ thuật (Technical Validation):**
   - Kiểm tra tệp artifact tồn tại trên đĩa, kích thước hợp lệ (lớn hơn ngưỡng byte tối thiểu).
   - Xác thực cấu trúc dữ liệu theo định dạng (`csv`, `json`, `markdown`, `excel`): phân tích cú pháp hợp lệ, kiểm tra sự hiện diện của các cột/trường dữ liệu bắt buộc.
2. **Tầng Nghiệp vụ (Business Validation):**
   - Kiểm tra ràng buộc chỉ số KPI (giá trị tối thiểu, tối đa).
   - Kiểm định tính hợp lý của số liệu tính toán.

**Nguyên tắc Bất biến Khóa Kết quả:**

> **Technical PASS + Business FAIL = `RESULT BLOCKED`**
>
> Nếu kết quả thỏa mãn tính toàn vẹn kỹ thuật nhưng sai lệch chỉ số kinh doanh, hệ thống lập tức khóa kết quả ở trạng thái `BLOCKED`, ghi nhận sự cố lên `#incidents` và thông báo tới người dùng; không tự ý che giấu hay chuyển sang trạng thái hợp lệ.

---

### 5. Sổ cái Quyết định (Decision Ledger) & Mã Tham chiếu Có cấu trúc

Nhằm tránh việc agent liên tục hỏi lại người dùng các câu hỏi đã được trả lời trong quá khứ:

- **Sổ cái Quyết định (Decision Ledger):** Lưu trữ bền vững các câu trả lời và quyết định đã được con người xác nhận (`isHumanConfirmed: true`). Trước khi gửi câu hỏi làm rõ trên `#office`, agent phải tra cứu Decision Ledger. Nếu đã có tiền lệ được xác nhận, agent áp dụng ngay mà không làm phiền người dùng.
- **Mã Tham chiếu Có Cấu trúc (Structured Reference ID):**
  - Cú pháp chuẩn: `TOPIC(2)-EXEC(2)-TASK(4)` (ví dụ: `SC-01-0042`).
  - Trong đó `TOPIC` gồm 2 chữ cái viết hoa đại diện cho lĩnh vực (ví dụ: `SC` cho Supply Chain, `KB` cho Knowledgebase), `EXEC` gồm 2 chữ số đại diện cho chu kỳ thực thi (`00` dành riêng cho tài liệu do con người đóng góp), và `TASK` gồm 4 chữ số thứ tự.
- **Lọc Trùng Ngữ cảnh (Context Deduplication):** Thuật toán `deduplicateRetrievalContext` tự động loại bỏ các đoạn thông tin trùng lặp nội dung được lấy từ nhiều nguồn khác nhau, tối ưu dung lượng ngữ cảnh gửi tới mô hình.

---

## 18. Quy trình Dừng Hệ thống

Khi kết thúc phiên làm việc:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/stop.ps1 -Profile all -EnvironmentFile ./infrastructure/docker/env/.env
```

Lệnh này dừng an toàn các container và bảo toàn toàn bộ dữ liệu trên các Docker volume.
