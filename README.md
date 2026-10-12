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

| Agent ID   | Tên hiển thị Discord | Snowflake ID          | Handle / Tag        | Nhiệm vụ chính                                                                                                            | Công cụ Zink được gọi                                                                                                  | Cấp bậc & Thẩm quyền             |
| :--------- | :------------------- | :-------------------- | :------------------ | :------------------------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------- | :------------------------------- |
| `main`     | **Quản Lý**          | `1545436878835163156` | `@Quản Lý`          | Tiếp nhận yêu cầu, phân tích DAG, chỉ định Primary (`o1`/`o2`), điều phối phê duyệt, thông báo tổng kết                   | `sessions_spawn` (chỉ gọi `o1`/`o2`), `sessions_yield`, `session_status`, `zink_knowledge_search`, `zink_skill_search` | Giám sát Quản trị (Governance)   |
| `o1`       | **Điều Phối 1 (O1)** | `1545437953197744248` | `@Điều Phối 1 (O1)` | Giám sát thực thi ETL & Bảng tính (điều phối `excel`, `sql`, `python`), đăng `#approvals`, hỏi `#office`, đăng `#results` | `sessions_spawn` (`excel`, `sql`, `python`), `session_status`, `zink_knowledge_search`, `zink_skill_search`            | Giám sát Thực thi (Execution O1) |
| `o2`       | **Điều Phối 2 (O2)** | `1545438251966402661` | `@Điều Phối 2 (O2)` | Giám sát thực thi BI & Khoa học Dữ liệu (điều phối `power-bi`, `python`), đăng `#approvals`, hỏi `#office`, `#results`    | `sessions_spawn` (`power-bi`, `python`), `session_status`, `zink_n8n`, `zink_knowledge_search`, `zink_skill_search`    | Giám sát Thực thi (Execution O2) |
| `excel`    | **Excel**            | `1545438637750227104` | `@Excel`            | Chuyên viên Bảng tính (Spreadsheet Specialist) — chạy ngầm dưới quyền O1, xuất bản workbook `.xlsx` và ảnh preview `.svg` | `session_status`, `zink_excel`, `zink_skill_search`, `zink_skill_propose`, `zink_knowledge_search`                     | Chuyên viên (Năng lực thuần túy) |
| `power-bi` | **PowerBI**          | `1545439082019164271` | `@PowerBI`          | Chuyên viên Báo cáo BI (BI Specialist) — chạy ngầm dưới quyền O2, thiết kế dashboard và công thức DAX                     | `session_status`, `zink_power_bi`, `zink_skill_search`, `zink_skill_propose`, `zink_knowledge_search`                  | Chuyên viên (Năng lực thuần túy) |
| `sql`      | **SQL**              | `1545438861356966010` | `@SQL`              | Chuyên viên Truy vấn Dữ liệu (SQL Specialist) — chạy ngầm dưới quyền O1, thực thi kịch bản trích xuất ETL                 | `session_status`, `zink_sql`, `zink_skill_search`, `zink_skill_propose`, `zink_knowledge_search`                       | Chuyên viên (Năng lực thuần túy) |
| `python`   | **Python**           | `1545439279843508235` | `@Python`           | Chuyên viên Khoa học Dữ liệu (Data Science Specialist) — chạy ngầm dưới quyền O1 (ETL) hoặc O2 (Analytics/ML/Forecast)    | `session_status`, `zink_python`, `zink_n8n`, `zink_skill_search`, `zink_skill_propose`, `zink_knowledge_search`        | Chuyên viên (Năng lực thuần túy) |

---

### Hồ sơ Chi tiết Từng Agent

#### 1. Agent `main` — Quản Lý (Governance Supervisor)

- **Discord Handle:** `@Quản Lý` (ID: `1545436878835163156`)
- **Chức năng chính:** Điểm tiếp nhận yêu cầu đầu tiên từ người vận hành trên kênh `#office` hoặc DM. Phân tích yêu cầu, phân loại bài toán (Work/Research), phân rã DAG và chỉ định duy nhất một Primary Coordinator (`o1` hoặc `o2`).
- **Quyền hạn & Công cụ:**
  - Được phép sử dụng `sessions_spawn` để giao nhiệm vụ con **chỉ cho hai điều phối viên (`o1`, `o2`)** ở chế độ cô lập hoàn toàn (`context=isolated`, `mode=run`, `sandbox=require`).
  - Được phép sử dụng `sessions_yield` để nhận kết quả dạng push-based bất đồng bộ từ điều phối viên.
  - Sử dụng `session_status` để kiểm tra trạng thái luồng làm việc.
  - Phát thông báo tổng kết cuối cùng (`FINAL_NOTIFICATION`) trên kênh `#office` sau khi người dùng đã nghiệm thu kết quả tại `#results`.
- **Ranh giới an toàn & Giới hạn Bất biến:**
  - **TUYỆT ĐỐI KHÔNG** tự gọi trực tiếp các chuyên viên (`excel`, `power-bi`, `sql`, `python`) hoặc tự thực thi nghiệp vụ kỹ thuật.
  - **TUYỆT ĐỐI KHÔNG** tự nhấn `APPROVE`, `REJECT` (kế hoạch) hoặc `ACCEPT / COMPLETE`, `REJECT` (kết quả). Quyền này thuộc độc quyền của `User`.
  - Không phát ngôn chi tiết quá trình thực thi thô (raw execution narration) lên kênh `#office`.

#### 2. Agent `o1` — Điều Phối 1 (Execution Supervisor — ETL & Spreadsheets)

- **Discord Handle:** `@Điều Phối 1 (O1)` (ID: `1545437953197744248`)
- **Chức năng chính:** Giám sát thực thi toàn bộ các tác vụ trích xuất, chuyển đổi dữ liệu (ETL), truy vấn SQL và tạo lập bảng tính Excel.
- **Quyền hạn & Công cụ:**
  - Lập kế hoạch thực thi chi tiết và phát hành thẻ phê duyệt kế hoạch (`### 🔖 [PHÊ DUYỆT THỰC THI]`) trên `#approvals`.
  - Quản lý và điều phối các chuyên viên cấp dưới: `excel`, `sql`, `python` (cho mục đích ETL) thông qua `sessions_spawn`.
  - Trực tiếp gửi tin nhắn làm rõ câu hỏi nghiệp vụ tới người dùng trên kênh `#office` khi gặp điểm mơ hồ (`WAITING_FOR_USER`).
  - Sau khi kiểm định đa tầng thành công, phát sự kiện `EXECUTION_FINISHED` và đăng thẻ nghiệm thu kết quả kèm ảnh preview thực tế lên `#results`.
- **Ranh giới an toàn & Giới hạn:**
  - Thư mục nguồn Obsidian Vault của con người được mount ở chế độ **chỉ đọc (`read-only`)**; tuyệt đối không sửa đổi hay xóa tài liệu trong Vault.
  - Không tự cấp quyền phê duyệt (`APPROVE`) hoặc tự nghiệm thu hoàn tất (`COMPLETE`).

#### 3. Agent `o2` — Điều Phối 2 (Execution Supervisor — BI & Advanced Analytics)

- **Discord Handle:** `@Điều Phối 2 (O2)` (ID: `1545438251966402661`)
- **Chức năng chính:** Giám sát thực thi các tác vụ trực quan hóa dữ liệu (Power BI Dashboard, DAX modeling), kịch bản khoa học dữ liệu, dự báo chuỗi thời gian (Forecasting), tối ưu hóa quy hoạch (Optimization) và tự động hóa n8n.
- **Quyền hạn & Công cụ:**
  - Lập kế hoạch thực thi chi tiết và phát hành thẻ phê duyệt trên `#approvals`.
  - Quản lý và điều phối các chuyên viên cấp dưới: `power-bi`, `python` (cho mục đích Data Viz, ML, Forecast) thông qua `sessions_spawn`.
  - Sử dụng `zink_n8n` để kích hoạt các workflow chuẩn đã được cấp phép.
  - Trực tiếp hỏi làm rõ người dùng trên `#office` và đăng thẻ kết quả lên `#results`.
- **Ranh giới an toàn & Giới hạn:**
  - Không tự cấp quyền phê duyệt (`APPROVE`) hoặc tự nghiệm thu hoàn tất (`COMPLETE`).

#### 4. Agent `excel` — Chuyên viên Bảng tính (Spreadsheet Specialist)

- **Discord Handle:** `@Excel` (ID: `1545438637750227104`)
- **Chức năng chính:** Chuyên trách xử lý, chuyển đổi dữ liệu và tạo lập bảng tính Excel (`.xlsx`), đồng thời sinh ảnh trực quan SVG preview cho các sheet đầu ra.
- **Quyền hạn & Công cụ:**
  - Chạy ngầm dưới quyền điều phối trực tiếp của `o1`.
  - Sử dụng `zink_excel`, `zink_skill_search`, `zink_skill_propose`, `zink_knowledge_search`, `session_status`.
- **Ranh giới an toàn & Giới hạn:**
  - **Không có quyền quản trị:** Cấm tham gia phê duyệt hoặc tự ý phát ngôn trên Discord.
  - File `.xlsx` xuất bản phải đi kèm preview trực quan dạng `.svg`, không lưu đè vào thư mục Git `artifacts/`.

#### 5. Agent `power-bi` — Chuyên viên Báo cáo BI (BI Specialist)

- **Discord Handle:** `@PowerBI` (ID: `1545439082019164271`)
- **Chức năng chính:** Thiết kế mô hình dữ liệu quan hệ, viết công thức DAX và xuất bản báo cáo Power BI (`.pbix` / `.pbit`).
- **Quyền hạn & Công cụ:**
  - Chạy ngầm dưới quyền điều phối trực tiếp của `o2`.
  - Sử dụng `zink_power_bi`, `zink_skill_search`, `zink_skill_propose`, `zink_knowledge_search`, `session_status`.
- **Ranh giới an toàn & Giới hạn:**
  - File report phải được kiểm định container PK\x03\x04 hợp lệ kèm thông tin kích thước và preview báo cáo.
  - Cấm tự ý giao tiếp trực tiếp với người dùng trên `#office`.

#### 6. Agent `sql` — Chuyên viên Truy vấn Dữ liệu (SQL Specialist)

- **Discord Handle:** `@SQL` (ID: `1545438861356966010`)
- **Chức năng chính:** Khảo sát, trích xuất và biến đổi dữ liệu phân tích thông qua các câu truy vấn SQL hiệu năng cao trên DuckDB, MotherDuck và BigQuery.
- **Quyền hạn & Công cụ:**
  - Chạy ngầm dưới quyền điều phối trực tiếp của `o1`.
  - Sử dụng `zink_sql` để gửi câu lệnh truy vấn tới DuckDB Governed Bridge trên Windows hoặc các cloud data warehouse.
  - Sử dụng `session_status`, `zink_skill_search`, `zink_skill_propose`, `zink_knowledge_search`.
- **Ranh giới an toàn & Giới hạn:**
  - **Chỉ đọc (`read-only`):** DuckDB Bridge kiểm soát chặt chẽ cú pháp (AST validation); cấm tuyệt đối các thao tác thay đổi schema tùy tiện, cấm `ATTACH`, `COPY`, cấm thoát khỏi thư mục cơ sở dữ liệu (`DUCKDB_FILESYSTEM_ACCESS_DENIED`) và cấm gọi lệnh shell máy chủ.

#### 7. Agent `python` — Chuyên viên Khoa học Dữ liệu (Decision & Data Science)

- **Discord Handle:** `@Python` (ID: `1545439279843508235`)
- **Chức năng chính:** Thực thi các bài toán khoa học quyết định phức tạp: phân tích thống kê, tối ưu hóa tuyến tính/phi tuyến, dự báo chuỗi thời gian, mô phỏng Monte Carlo và xử lý dữ liệu định lượng.
- **Quyền hạn & Công cụ:**
  - Chạy ngầm dưới quyền điều phối của `o1` (khi phục vụ ETL/data processing) hoặc `o2` (khi phục vụ Data Science/ML/Analytics).
  - Sử dụng `zink_python` để chạy các script Python phân tích trong môi trường container runtime bảo mật.
  - Sử dụng `zink_n8n` để kích hoạt pipeline tính toán khi cần thiết.
  - Sử dụng `session_status`, `zink_skill_search`, `zink_skill_propose`, `zink_knowledge_search`.
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

| Kênh Discord            | Loại kênh                    | Snowflake ID          | Chức năng & Quy chuẩn                                                                                                                                                                        |
| :---------------------- | :--------------------------- | :-------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`#office`**           | Văn phòng chung (Text)       | `1545425766161063937` | Nơi tiếp nhận yêu cầu, giao việc và điều phối hoạt động chung. Hỗ trợ tag trực tiếp bot hoặc trao đổi với `@Quản Lý`. Bảo toàn mã `task_id` người dùng cung cấp.                             |
| **`#results`**          | Kết quả phân tích (Forum)    | `1545696269010477056` | Diễn đàn đăng tải báo cáo, artifact và kết quả nghiệm thu của các task. Mọi bài viết là một Thread riêng biệt (`inheritParent: false` để fail-closed).                                       |
| **`#approvals`**        | Phê duyệt quyết định (Forum) | `1545696207316455527` | Nơi các agent gửi đề xuất giải quyết mâu thuẫn ngữ nghĩa (`BLOCKED_SEMANTIC_REVIEW`) chờ chủ sở hữu phê duyệt.                                                                               |
| **`#incidents`**        | Báo cáo sự cố (Forum)        | `1545696360018481182` | Kênh thông báo cảnh báo lỗi, vi phạm hợp đồng dữ liệu hoặc sự cố ranh giới an toàn.                                                                                                          |
| **Tin nhắn riêng (DM)** | Direct Message               | N/A                   | Vô hiệu hóa (`channels.discord.directMessages.enabled: false`). Toàn bộ tương tác bắt buộc diễn ra trên các kênh máy chủ để đảm bảo tính minh bạch và lưu vết kiểm toán bền vững vào Ledger. |

---

### Hướng dẫn Tương tác trên Discord Desktop & Discord Mobile

Để đảm bảo các bot luôn phản hồi 100% chính xác trên cả ứng dụng máy tính (Desktop) và ứng dụng điện thoại (Discord Mobile), người vận hành lưu ý các cơ chế giao tiếp sau:

#### 1. Cơ chế Nhận diện Mention và Quy tắc Giao tiếp Nghiêm ngặt (Strict Explicit Mention)

Hệ thống tuân thủ nguyên tắc **CHỈ BOT ĐƯỢC TAG MỚI ĐƯỢC PHÉP NÓI CHUYỆN**:

- **Bắt buộc Tag `@` rõ ràng (Explicit Mention):**
  - **Native Mention (`<@ID>`):** Gõ ký tự `@` và chọn bot tương ứng từ pop-up danh sách thành viên của Discord.
  - **Nickname Mention (`<@!ID>`):** Khi Discord Mobile hoặc Desktop gắn tag bot kèm biệt danh máy chủ.
  - **Cú pháp tiền tố `@`:** Bắt buộc phải có tiền tố `@` phía trước tên bot (ví dụ: `@Quản Lý`, `@Excel`, `@Python`).
- **Nghiêm cấm tự ý kích hoạt bằng chữ thường (No Plain-text Trigger):**
  - Chỉ gõ tên thường trong câu mà **không có tag `@`** (ví dụ: gõ "Excel tính cái này", "Quản lý xem báo cáo") thì **tuyệt đối KHÔNG một bot nào được phép phản hồi**. Hệ thống giữ im lặng hoàn toàn.
- **Chống xen ngang giữa các bot (`ignoreOtherMentions: true`):**
  - Khi người dùng tag `@Quản Lý`, chỉ duy nhất `@Quản Lý` được phản hồi. Các bot khác (`@Excel`, `@Python`...) dù có thấy tên mình được nhắc trong câu nói cũng phải tuyệt đối giữ im lặng.
- **Ranh giới Agent Chuyên biệt (Specialist Agents):**
  - Các bot chuyên viên thực thi (`Excel`, `PowerBI`, `SQL`, `Python`) là sub-agent làm việc ngầm. Người dùng chỉ giao việc qua `@Quản Lý` (hoặc hai điều phối viên `@Điều Phối 1` / `@Điều Phối 2`). Các specialist không tự ý nhảy vào chat trực tiếp với người dùng trên kênh `#office`.

#### 2. Thảo luận trong Diễn đàn Forum (`#results`, `#approvals`, `#incidents`)

- Trên cả Desktop và Mobile, mỗi bài đăng trong Forum là một **Thread**.
- Cấu hình an toàn `thread.inheritParent: false` đảm bảo quyền hạn được kiểm soát độc lập, fail-closed an toàn trên từng bài viết thay vì ngầm thừa kế tự do.
- Bạn chỉ cần mở thread và tag bot cần làm việc (ví dụ: `@Excel kiểm tra số liệu bảng này giúp anh`), bot sẽ phản hồi trực tiếp ngay trong thread đó.

#### 3. Chính sách Tin nhắn Trực tiếp (Direct Message — DM)

- Nhằm phục vụ lưu vết kiểm toán bất biến và toàn vẹn của Ledger, hệ thống cấu hình `channels.discord.directMessages.enabled: false`. Mọi yêu cầu và phản hồi đều phải được định tuyến qua 4 bề mặt kênh máy chủ chính thức (`#office`, `#approvals`, `#results`, `#incidents`).

#### 4. Quy trình Phê duyệt Kỹ năng Mới trên Kênh `#office`

- Khi một agent chuyên môn (`excel`, `power-bi`, `sql`, `python`) hoàn thiện giải pháp phân tích tái sử dụng, agent gọi `zink_skill_propose` để khởi tạo bản ghi `CANDIDATE` được lưu bền vững (durable proposal). (Các agent điều phối `main`, `o1`, `o2` không có quyền đề xuất kỹ năng theo ma trận `SKILL_STORE_ACCESS_MATRIX`). Đề xuất đơn thuần không tạo skill chuẩn tắc.
- Đề xuất được định danh bằng mã băm nội dung bất biến (raw SHA-256 của đúng các byte sẽ trở thành `SKILL.md`) và thông báo xác nhận học tập được gửi tới kênh `#office` (không dùng diễn đàn `#approvals` của phê duyệt thực thi).
- **Phê duyệt:** Chủ sở hữu đọc nội dung đề xuất và bấm nút phê duyệt skill chuyên biệt (`zink:skill:approve`) gắn chặt proposal và mã băm nội dung. Phê duyệt skill và phê duyệt kế hoạch thực thi (`APPROVE`) là hai đường quản trị phân biệt, không bao giờ đi chung.
- **Xác thực tự động:** Hệ thống `handleOwnerSkillApproval` sẽ xác thực danh tính chủ sở hữu, tính toàn vẹn của mã băm nội dung và ràng buộc identity, sau đó tiến hành materialize skill chuẩn tắc (`SKILL.md` + `manifest.json`, trạng thái `ACTIVE`) bằng mã nội bộ tin cậy rồi mới đồng bộ dẫn xuất sang PostgreSQL vector index (pgvector). Đề xuất lạ/không tồn tại, hết hạn, bị từ chối hoặc xung đột đều bị từ chối fail-closed; lỗi đồng bộ vector không bao giờ rollback bản chuẩn tắc.

#### 5. Thứ tự Ưu tiên Phân giải Ngữ nghĩa (Deterministic Semantic Resolver Precedence)

Hệ thống định tuyến thông điệp dựa trên thứ tự ưu tiên tất định, không suy diễn:

1. **Tag Mention rõ ràng (Explicit Mention):** Tag `<@ID>` hoặc `@Handle` bot đích trên Discord luôn có độ ưu tiên cao nhất.
2. **Ngữ cảnh Task ID / Thread hiện hành (Task & Thread Correlation):** Nếu không có mention mới trong thread diễn đàn đã gán cho một task, điều phối viên đang quản lý task đó tiếp tục nhận quyền xử lý.
3. **Phân rã Điều phối viên (Coordinator Assignment):** Các yêu cầu từ người dùng gửi tới `@Quản Lý` được phân loại thành bài toán ETL (chỉ định `o1`) hoặc Analytics/BI (chỉ định `o2`).
4. **Mặc định Dự phòng (Safe Fallback):** Nếu thông điệp mơ hồ, hệ thống phát sinh câu hỏi làm rõ (`WAITING_FOR_USER`) thay vì tự ý giả định hay kích hoạt thực thi ngoài luồng.

---

## 6. Danh mục Công cụ Zink (Tool Taxonomy & Capability Registry)

Hệ thống phân định ranh giới kiến trúc rõ ràng giữa 3 nhóm công cụ:

### Nhóm 1: 5 Giao diện Công cụ Thực thi có thể gọi (Callable Execution Tools)

Các công cụ được gọi qua ranh giới quản trị (dispatched qua contract seam hoặc adapter):

1. **`zink_excel`:** Giao diện hợp đồng xử lý bảng tính Excel (`load`, `populate`, `validate`, `generate`) cho agent `excel` (contract seam).
2. **`zink_power_bi`:** Giao diện hợp đồng báo cáo Power BI (`load`, `bind`, `update`, `validate`) cho agent `power-bi` (contract seam).
3. **`zink_sql`:** Giao diện truy vấn SQL phân tích chỉ đọc (`SELECT`) có giới hạn `target_database` (`knowledge`, `analytics_read`) cho agent `sql` (contract seam).
4. **`zink_python`:** Giao diện xử lý tính toán số và sandbox kịch bản Python (`entrypoint`, `stack`) cho agent `python` (contract seam).
5. **`zink_n8n`:** Bộ điều hợp kích hoạt luồng công việc tất định (`data_plant_ingest`, `data_plant_sync`, `pipeline_notify`) cho agent `o2` và `python` (governed adapter).

### Nhóm 2: 3 Công cụ Bộ nhớ & Truy xuất Tri thức (Governed Memory & Semantic RAG Tools)

1. **`zink_skill_search`:** Tra cứu vector ngữ nghĩa trong Zink Skill Store (1024-dim BGE-M3, HNSW cosine distance, chỉ lọc skill trạng thái `ACTIVE`). Cả 7 agent đều có quyền sử dụng.
2. **`zink_knowledge_search`:** Tra cứu ngữ nghĩa Knowledgebase một chiều (Vector HNSW + FTS + RRF reranker kèm trích dẫn source). Cả 7 agent đều có quyền sử dụng.
3. **`zink_skill_propose`:** Cơ chế ghi nhớ 2 chiều (Human-in-the-Loop Memory) dành độc quyền cho các chuyên viên (`excel`, `power-bi`, `sql`, `python`) đề xuất kỹ năng mới dưới dạng `CANDIDATE`.

### Nhóm 3: 4 Năng lực Lược đồ Đặc tả (Schema-Only Specifications)

_4 Năng lực đặc tả (Schema-only capabilities):_ `zink_forecast`, `zink_optimization`, `zink_operations_research`, `zink_simulation` là các lược đồ đặc tả định dạng bài toán toán học trong `zink-tools/contracts/tools/`, không phải là công cụ thực thi trực tiếp trên hệ thống cục bộ (`isExecutable: false`).

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
3. `npm test`: Chạy toàn bộ bài kiểm thử bao phủ hợp đồng M1–M8, OpenClaw governance và DuckDB bridge (số lượng bài kiểm thử lấy từ kết quả chạy thực tế, không ghi cứng).
4. `npm run repo:check`: Kiểm tra toàn vẹn chính sách repository.

Tier Python của Zink Knowledgebase là một gate blocking riêng và **không** nằm trong `verify`: một CI job chỉ cài Node (như `CI / quality-gate`) không có `uv`, nên gộp cả hai tier vào một lệnh sẽ làm job đó chết ở `uv: not found`. Trên máy cục bộ, chạy tường minh:

```powershell
npm run test:knowledge
```

(hoặc `make test-knowledge`). Lệnh này chạy bài kiểm thử Python của Zink Knowledgebase qua `uv run --directory apps/knowledge --locked` (pytest từ `uv.lock`) và yêu cầu `KNOWLEDGE_TOKENIZER_PATH` trỏ tới `tokenizer.json` của bge-reranker-v2-m3. Trong CI, `npm run test:knowledge` chỉ được phép thực thi bởi đúng một job là `CI / python-quality`; `npm run repo:check` sẽ fail nếu job đó bị xóa, bị trùng ở job khác, hoặc bị chuyển sang job khác.

Bộ kiểm thử `pdf-runtime` là Linux/x86_64-specific và kéo theo torch/docling, nên CI cố ý **không** chạy bước này. Trạng thái của nó là `NOT RUN`, không phải PASS.

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

| Nhà cung cấp      | Trạng thái (State)  | Hợp đồng (Contract) | Kiểm thử mô phỏng (Mock) | Kiểm thử trực tiếp (Live) | Ghi chú vận hành                                             |
| ----------------- | ------------------- | ------------------- | ------------------------ | ------------------------- | ------------------------------------------------------------ |
| **n8n**           | `PROVISIONED`       | PASS                | PASS                     | PASS                      | Docker container localhost:5678 sẵn sàng                     |
| **Cloudflare R2** | `PROVISIONED`       | PASS                | PASS                     | PASS                      | Quản lý Landing & Silver hoạt động                           |
| **DuckDB**        | `PROVISIONED`       | PASS                | PASS                     | PASS                      | Governed Windows Bridge; native CLI Windows đã được xác minh |
| **MotherDuck**    | `CONTRACT_VERIFIED` | PASS                | PASS                     | NOT_RUN                   | Sẵn sàng, kết nối khi cấp token                              |
| **BigQuery**      | `CONTRACT_VERIFIED` | PASS                | PASS                     | NOT_RUN                   | Sẵn sàng, kích hoạt khi có GCP ADC                           |
| **Kaggle**        | `CONTRACT_VERIFIED` | PASS                | PASS                     | NOT_RUN                   | Bounded runner có kiểm soát                                  |
| **Databricks**    | `CONTRACT_VERIFIED` | PASS                | PASS                     | NOT_RUN                   | Batch compute adapter sẵn sàng                               |
| **MLflow Local**  | `PROVISIONED`       | PASS                | PASS                     | PASS                      | Ghi log thí nghiệm cục bộ hoạt động                          |
| **DagsHub**       | `CONTRACT_VERIFIED` | PASS                | PASS                     | NOT_RUN                   | Đồng bộ có chọn lọc sẵn sàng                                 |
| **Hugging Face**  | `CONTRACT_VERIFIED` | PASS                | PASS                     | NOT_RUN                   | Đánh giá mô hình an toàn                                     |
| **Streamlit**     | `PROVISIONED`       | PASS                | PASS                     | PASS                      | Giao diện phân phối Gold localhost:8501                      |

---

## 17. Hướng dẫn Vận hành Runtime Quản trị, Thẩm quyền & Độ tin cậy (M8/T2)

Mục này hướng dẫn chi tiết quy chế vận hành, phân định thẩm quyền nghiêm ngặt, cơ chế hàng đợi xử lý ngoại tuyến và kiểm định đa tầng được hoàn thiện trong cột mốc M8/T2.

### 1. Mô hình Phân cấp Thẩm quyền (Authority Hierarchy)

Hệ thống thiết lập ranh giới quyền hạn phân cấp nghiêm ngặt nhằm bảo đảm không có agent nào tự cấp quyền hoặc tự nghiệm thu kết quả:

```text
USER / OWNER
│
└── MAIN / QUẢN LÝ
    │
    ├── O1 (Điều Phối 1: Excel, SQL, Python — Giám sát ETL & Bảng tính)
    │   └── Specialists / Tools
    │
    └── O2 (Điều Phối 2: Power BI, Python — Giám sát BI & Khoa học Dữ liệu)
        └── Specialists / Tools
```

**Ý nghĩa và Phân định Vai trò:**

- **User / Owner:** Final Authority — Người duy nhất có thẩm quyền phê duyệt kế hoạch (`APPROVE`), chấp thuận kết quả (`ACCEPT / COMPLETE`), từ chối (`REJECT`) hoặc yêu cầu chỉnh sửa (`REQUEST_REVISION`).
- **Main / Quản Lý:** Control & Governance Supervisor — Tiếp nhận yêu cầu ban đầu, phân loại bài toán, chỉ định điều phối viên chính (Primary Coordinator `o1` hoặc `o2`), điều phối phê duyệt trên `#approvals`, theo dõi trạng thái hệ thống và phát thông báo tổng kết cuối cùng trên `#office`. Tuyệt đối không tự thực thi kỹ thuật và không tự spawn chuyên viên.
- **O1 / O2:** Execution Supervisors — Giám sát thực thi, lập kế hoạch chi tiết, điều phối chuyên viên cấp dưới, trực tiếp hỏi làm rõ người dùng trên `#office`, phát sự kiện `EXECUTION_FINISHED` và đăng kết quả lên `#results`.
- **Specialist (Excel, PowerBI, SQL, Python):** Capability Executors — Chuyên viên năng lực thực thi thuần túy chạy ngầm, không có thẩm quyền ra quyết định quản trị; kết quả trả về Coordinator cha.
- **Execution agent:** Runtime Execution — Agent chuyên môn nhận node đã được duyệt từ hàng đợi (`QueueManager`), thực thi trong capability scope và xuất bản artifact thật.
- **Tool:** Capability — Năng lực công cụ thực thi, không phải thẩm quyền.

#### Ma trận Thẩm quyền 5 Bộ (Actor + Channel + Task + State + Action)

| Hành động (`Action`)        | Kênh Discord  | Tác nhân được phép (`Actor`)  | Trạng thái yêu cầu (`State`) | Trạng thái chuyển đổi (`Next State`) |
| :-------------------------- | :------------ | :---------------------------- | :--------------------------- | :----------------------------------- |
| `APPROVE`                   | `#approvals`  | Duy nhất `User`               | `APPROVAL_PENDING`           | `QUEUED`                             |
| `REJECT_APPROVAL`           | `#approvals`  | Duy nhất `User`               | `APPROVAL_PENDING`           | `REJECTED`                           |
| `REQUEST_REVISION_APPROVAL` | `#approvals`  | `User`, `Main`                | `APPROVAL_PENDING`, `EXECUT` | `REVISING`                           |
| `ACCEPT_RESULT`             | `#results`    | Duy nhất `User`               | `RESULT_PENDING_REVIEW`      | `COMPLETE`                           |
| `REJECT_RESULT`             | `#results`    | Duy nhất `User`               | `RESULT_PENDING_REVIEW`      | `REJECTED`                           |
| `REQUEST_REVISION_RESULT`   | `#results`    | `User`, `Main`                | `RESULT_PENDING_REVIEW`      | `REVISING`                           |
| `CLAIM`                     | N/A (Queue)   | `Execution agent`, `O1`, `O2` | `QUEUED`                     | `EXECUTING`                          |
| `ASK_USER`                  | `#office`     | `O1`, `O2`, `Main`            | `EXECUTING`, `PREFLIGHT`     | `WAITING_FOR_USER`                   |
| `ANSWER_USER`               | `#office`     | Duy nhất `User`               | `WAITING_FOR_USER`           | `EXECUTING`                          |
| `EXECUTION_FINISHED`        | N/A (Runtime) | `O1`, `O2`, `Execution agent` | `EXECUTING`                  | `RESULT_PENDING_REVIEW`              |
| `FINAL_NOTIFICATION`        | `#office`     | Duy nhất `Main`               | `COMPLETE`, `REJECTED`       | Giữ nguyên trạng thái cuối           |

_Nguyên tắc cốt lõi:_ Sự kiện `EXECUTION_FINISHED` chỉ đánh dấu kết thúc thực thi kỹ thuật. Nhiệm vụ chỉ được coi là hoàn tất (`COMPLETE`) khi người dùng trực tiếp nhấn nút **ACCEPT** trên thẻ nghiệm thu tại `#results`.

---

### 2. Quy chuẩn Vận hành 4 Kênh Discord Chuyên biệt

Hệ thống phân tách luồng giao tiếp thành 4 kênh Discord độc lập, tuyệt đối không dùng Discord làm bus truyền thông điệp nội bộ giữa các agent (agent-to-agent bus):

```text
# office
Command / clarification / final notification

# approvals
Execution authorization

# results
Result review

# incidents
Failure / recovery
```

#### Sơ đồ Vòng đời Tác vụ Chuẩn tắc (Canonical Lifecycle)

```text
# office
   ↓ (Người dùng gửi yêu cầu & Main phân tích gán Primary O1/O2)
Main
   ↓ (Kiểm tra đầy đủ công cụ, tri thức, quyền hạn)
Preflight
   ↓
# approvals
   ↓ (Duy nhất User có quyền bấm APPROVE)
O1 / O2
   ↓
QUEUE
   ↓ (Execution agent tự claim node)
EXECUTION
   ↓
EXECUTION_FINISHED (Chỉ là sự kiện kỹ thuật, CHƯA PHẢI hoàn tất!)
   ↓
VALIDATION + PREVIEW (Kiểm định Đa tầng & Sinh ảnh preview thực tế)
   ↓
# results
   ↓
USER REVIEW (Duy nhất User phản hồi lệnh APPROVE / REJECT / ACCEPT / REQUEST_REVISION)
   ↓ (Chỉ khi User phản hồi ACCEPT hoặc COMPLETE)
TASK = COMPLETE
   ↓
# office (Main gửi thông báo tổng kết cuối cùng)
```

#### Hướng dẫn Thao tác Thực tế Theo Từng Kênh

1. **Kênh `#office` — Giao việc, Làm rõ & Thông báo Hoàn tất:**
   - **Giao việc:** Người dùng gửi yêu cầu bình thường (ví dụ: tag `@Quản Lý Hãy tạo bảng tính doanh thu tháng 9`). Main tiếp nhận, bảo toàn mã định danh `task_id` do người dùng cung cấp (ví dụ: `TASK-042`) hoặc tự động sinh mã khi chưa có, đảm bảo không bị lược bỏ.
   - **Điều phối viên hỏi trực tiếp:** Khi cần làm rõ yêu cầu nghiệp vụ, O1/O2 gửi câu hỏi trực tiếp trên `#office` theo mẫu:

     ```text
     **TASK-042 | O1**
     **Cần xác nhận:** [Nội dung câu hỏi nghiệp vụ]
     **Lý do:** [Căn cứ kỹ thuật / dữ liệu]
     Task chuyển trạng thái: `WAITING_FOR_USER`
     ```

     Người dùng phản hồi trực tiếp tại `#office` để tiếp tục luồng thực thi.

   - **Thông báo Hoàn tất:** Sau khi người dùng đã nghiệm thu tại `#results`, Main phát thông báo tổng kết ngắn gọn trên `#office`. Tuyệt đối không đưa nhật ký thực thi thô (raw narration) làm loãng kênh.

2. **Kênh `#approvals` — Cấp quyền Thực thi (Execution Authorization):**
   - Mỗi task có một thẻ phê duyệt duy nhất hiển thị: `TASK_ID`, Plan version, Primary Coordinator, Kế hoạch thực thi, Rủi ro, Tiêu chuẩn kiểm định và Trạng thái hàng đợi.
   - Cú pháp phản hồi lệnh (Markdown Instructions — trả lời trực tiếp trong thread):
     - **`APPROVE`:** Đưa task vào hàng đợi `QUEUED` (Duy nhất User có quyền).
     - **`REJECT`:** Hủy và đóng task ở trạng thái `REJECTED` (Duy nhất User có quyền).
     - **`REQUEST REVISION [nội dung góp ý]`:** Chuyển task sang `REVISING` để cập nhật kế hoạch.
   - Tuyệt đối không bắt đầu thực thi nếu kế hoạch chưa chuyển sang trạng thái `APPROVED`.

3. **Kênh `#results` — Nghiệm thu Kết quả & Xem trước Dữ liệu Thực:**
   - Đăng tải kết quả sau khi vượt qua kiểm định: `TASK_ID`, Attempt/version, Trạng thái thực thi, Kết quả kiểm tra kỹ thuật (Technical Validation), Kết quả kiểm tra nghiệp vụ (Business Validation), Khung xem trước dữ liệu có cấu trúc (kèm ảnh Preview thực tế nếu có đối tượng `previewImage`), Đường dẫn Artifact, Phát hiện chính.
   - Cú pháp phản hồi nghiệm thu (Markdown Instructions — trả lời trực tiếp trong thread):
     - **`ACCEPT` hoặc `COMPLETE`:** Người dùng xác nhận đạt yêu cầu; task chuyển sang `COMPLETE` và Main thông báo hoàn tất trên `#office`.
     - **`REJECT`:** Người dùng từ chối kết quả; task chuyển sang `REJECTED`.
     - **`REQUEST REVISION [nội dung góp ý]`:** Chuyển task sang `REVISING` kèm góp ý để thực thi lại phiên bản kế tiếp.

4. **Kênh `#incidents` — Giám sát & Khắc phục Sự cố:**
   - Quy trình vòng đời sự cố:
     $$\mathbf{RECEIVED \longrightarrow INVESTIGATING \longrightarrow REPAIRING \longrightarrow RESOLVED}$$
   - Tự động phát thẻ cảnh báo đỏ kèm mã `incident_id` và liên kết với `task_id` liên quan khi:
     - Vi phạm thẩm quyền hoặc sai lệch kênh.
     - Kiểm định kỹ thuật thất bại hoặc kiểm định nghiệp vụ không đạt (`RESULT BLOCKED`).
     - Execution agent mất kết nối quá hạn nhịp tim.

---

### 3. Cơ chế Hàng đợi & Phục hồi Execution Agent

Hệ thống tách biệt hoàn toàn giữa **Control Plane** (chạy 24/7 trên máy chủ/VPS/môi trường luôn mở) và **Execution Agent** (có thể ngoại tuyến hoặc khởi động lại độc lập):

- **Xử lý khi execution agent ngoại tuyến:** Khi execution agent ngoại tuyến, task được lưu trữ an toàn trong hàng đợi bền vững (`QueueManager`) ở trạng thái `QUEUED`. Không có task nào được giả định là đã thực thi.
- **Tự động nhận việc (Atomic Claim):** Khi execution agent kết nối, agent thực hiện `claimTask` nguyên tử để khóa độc quyền task và bắt đầu thực thi theo lease.
- **Giám sát nhịp tim (Heartbeat & Stale Recovery):** Execution agent cập nhật heartbeat định kỳ. Nếu agent bị tắt đột ngột hoặc mất nguồn, Control Plane định kỳ quét qua `detectAndRecoverStaleTasks` để thu hồi task bị treo và chuyển lại về `QUEUED` cho lượt chạy kế tiếp.

---

### 4. Kiểm định Đa tầng (Multi-tier Validation)

Quy trình nghiệm thu kết quả tuân thủ nghiêm ngặt 2 tầng kiểm tra độc lập:

1. **Tầng Kỹ thuật (Technical Validation & Multi-Format Data File Validation):**
   - Kiểm tra tệp artifact tồn tại trên đĩa, kích thước hợp lệ (lớn hơn ngưỡng byte tối thiểu).
   - **Xác thực và sinh Preview Đa định dạng (`artifact-validator.mjs`):**
     - **Excel (`.xlsx`):** Phân tích workbook, kiểm tra số dòng/cột, sinh ảnh SVG preview trực quan các sheet đầu ra.
     - **SQL (`.sql`):** Đọc UTF-8, đếm câu lệnh, phân loại DML/Read-only, preview 30 dòng đầu kèm chú thích phân tích an toàn (`sql/validator.mjs`).
     - **Python (`.py`):** Phân tích AST, đếm hàm/class, phân loại import thư viện (Data Science: pandas, numpy, scipy, scikit-learn; Database: duckdb, psycopg2, sqlalchemy; File I/O: csv, json, openpyxl), preview 30 dòng đầu (`python/python-validator.mjs`).
     - **Power BI (`.pbix`, `.pbit`):** Kiểm tra magic byte zip `PK\x03\x04`, xác thực tính toàn vẹn của container và dung lượng tệp.
     - **Apache Parquet (`.parquet`):** Kiểm tra magic byte `PAR1` ở header và footer, xác nhận biên byte hợp lệ.
     - **PDF (`.pdf`):** Kiểm tra magic byte `%PDF-`, trích xuất chuỗi phiên bản từ header.
     - **Microsoft Word (`.docx`, `.doc`):** Kiểm tra magic byte zip `PK\x03\x04`, xác thực container tệp.
     - **Markdown (`.md`):** Đọc UTF-8, đếm heading, trích xuất preview 20 dòng đầu.
     - **CSV & JSON:** Xác thực cấu trúc bảng, kiểm tra sự hiện diện của các cột/trường dữ liệu bắt buộc.
2. **Tầng Nghiệp vụ (Business Validation):**
   - Kiểm tra ràng buộc chỉ số KPI (giá trị tối thiểu, tối đa).
   - Kiểm định tính hợp lý của số liệu tính toán, phát hiện dữ liệu mock hoặc rỗng.

**Nguyên tắc Bất biến Khóa Kết quả:**

> **Technical PASS + Business FAIL = `RESULT BLOCKED`**
>
> Nếu kết quả thỏa mãn tính toàn vẹn kỹ thuật nhưng sai lệch chỉ số kinh doanh, hệ thống lập tức khóa kết quả ở trạng thái `BLOCKED`, ghi nhận sự cố lên `#incidents` và thông báo tới người dùng; không tự ý che giấu hay chuyển sang trạng thái hợp lệ.

---

### 5. Sổ cái Quyết định (Decision Ledger) & Mã Tham chiếu Có cấu trúc

Nhằm tránh việc agent liên tục hỏi lại người dùng các câu hỏi đã được trả lời trong quá khứ:

- **Sổ cái Quyết định (Decision Ledger):** Lưu trữ bền vững các câu trả lời và quyết định đã được con người xác nhận (`isHumanConfirmed: true`). Trước khi gửi câu hỏi làm rõ trên `#office`, agent phải tra cứu Decision Ledger. Nếu đã có tiền lệ được xác nhận, agent áp dụng ngay mà không làm phiền người dùng.
- **Lọc Trùng Ngữ cảnh (Context Deduplication):** Thuật toán `deduplicateRetrievalContext` tự động loại bỏ các đoạn thông tin trùng lặp nội dung được lấy từ nhiều nguồn khác nhau, tối ưu dung lượng ngữ cảnh gửi tới mô hình.

#### Ma trận Mã Tham chiếu Có Cấu trúc (Structured Reference ID Matrix)

Theo quy định tại `ACTIVE.md` (Mục 1, 21, 39, 40, 41), định danh tri thức, skill và kết quả thực thi tuân thủ cấu trúc tương thích 3 phân đoạn:
$$\text{Cú pháp: } \mathbf{TOPIC(2) - EXEC(2) - TASK(4)}$$
Ví dụ: `01-03-0042`, `01-00-0042`, `03-03-0105`.

##### 1. Ma trận Mã Lĩnh vực (Topic Code Matrix - 2 chữ số)

| Mã TOPIC | Lĩnh vực chuyên môn                | Domain            | Trọng trách quản lý                                                |   Ký hiệu    |
| :------: | :--------------------------------- | :---------------- | :----------------------------------------------------------------- | :----------: |
|   `01`   | Supply Chain & Logistics (LSCM)    | `office` / `data` | Chuỗi cung ứng, kho vận, vận tải                                   |    `LSCM`    |
|   `02`   | Knowledgebase & Research Ingestion | `general`         | Thu nạp tài liệu nghiên cứu, tri thức con người                    |     `KB`     |
|   `03`   | Office Automation & Spreadsheets   | `office`          | Tự động hóa bảng tính, báo cáo văn phòng (O1 / Excel)              |   `EXCEL`    |
|   `04`   | Relational Analytics & SQL         | `data`            | Truy vấn cơ sở dữ liệu quan hệ, phân tích dữ liệu (O1 / SQL)       |    `SQL`     |
|   `05`   | Business Intelligence & Reporting  | `data`            | Trực quan hóa dữ liệu, mô hình DAX, Dashboard (O2 / Power BI)      |  `POWER_BI`  |
|   `06`   | Data Engineering & Scripting       | `engineering`     | Kịch bản trích xuất, chuyển đổi và xử lý dữ liệu (O1, O2 / Python) |   `PYTHON`   |
|   `07`   | System Governance & Lifecycle      | `governance`      | Kiểm soát hợp đồng, trạng thái tác vụ, chính sách kênh             | `GOVERNANCE` |

##### 2. Ma trận Mã Chu kỳ Thực thi (Execution / Tool Code Matrix - 2 chữ số)

| Mã EXEC | Loại hình thực thi                          |  Tính chất tri thức  | Ý nghĩa & Quy định                                                                                                                              |
| :-----: | :------------------------------------------ | :------------------: | :---------------------------------------------------------------------------------------------------------------------------------------------- |
|  `00`   | Personal Experience / Human-Contributed     |      Con người       | **Bất biến:** Dành riêng cho tri thức, quy tắc hoặc kinh nghiệm do chính người dùng (User/Owner) trực tiếp đóng góp. AI không được tự ý ghi đè. |
|  `01`   | Automated Pipeline / ETL                    |   Hệ thống tự động   | Dòng chảy xử lý dữ liệu và trích xuất tự động (O1: SQL / Python).                                                                               |
|  `02`   | Analytical & Statistical Modeling           | Phân tích chuyên sâu | Mô hình hóa dữ liệu thống kê, phân rã chỉ số và DAX (O2: Power BI).                                                                             |
|  `03`   | Tool Direct Execution / Artifact Generation |    Sinh Artifact     | Thực thi công cụ chuyên trách trực tiếp sinh file output (O1: Excel, O2: Python chart).                                                         |
|  `04`   | ML & Predictive Forecasting                 |   Máy học & Dự báo   | Huấn luyện mô hình ngoại vi, dự báo chuỗi thời gian (O2 / Python).                                                                              |
|  `05`   | Optimization & Operations Research          |      Tối ưu hóa      | Thuật toán quy hoạch tuyến tính/phi tuyến, mô phỏng hoạt động chuỗi cung ứng (O2).                                                              |

##### 3. Ví dụ Ma trận Định danh Thực tế

| Mã Reference ID | Phân rã ngữ nghĩa                     |     Loại hình      | Ý nghĩa chi tiết                                                                         |
| :-------------- | :------------------------------------ | :----------------: | :--------------------------------------------------------------------------------------- |
| `01-00-0042`    | `TOPIC: 01`, `EXEC: 00`, `TASK: 0042` | Tri thức con người | Kinh nghiệm thực tế của người dùng về chuỗi cung ứng cho Task #42 (bảo toàn nguyên vẹn). |
| `01-03-0042`    | `TOPIC: 01`, `EXEC: 03`, `TASK: 0042` |    Tool Output     | File bảng tính tính toán chuỗi cung ứng được sinh tự động bởi công cụ cho Task #42.      |
| `03-03-0105`    | `TOPIC: 03`, `EXEC: 03`, `TASK: 0105` |  Bảng tính Excel   | File workbook `.xlsx` và ảnh preview `.svg` do O1/Excel thực hiện cho Task #105.         |
| `04-01-0089`    | `TOPIC: 04`, `EXEC: 01`, `TASK: 0089` |    SQL Pipeline    | Kịch bản trích xuất ETL tự động từ cơ sở dữ liệu quan hệ cho Task #89.                   |
| `05-02-0050`    | `TOPIC: 05`, `EXEC: 02`, `TASK: 0050` | Power BI Modeling  | Mô hình số liệu trực quan hóa DAX do O2/Power BI thiết lập cho Task #50.                 |
| `06-04-0067`    | `TOPIC: 06`, `EXEC: 04`, `TASK: 0067` |   ML Forecasting   | Mô hình dự báo chuỗi thời gian và độ chính xác MAPE do O2/Python tính toán cho Task #67. |

---

### 6. Phân định Lưu trữ Bộ nhớ Dài hạn (Long-Term Memory Ownership)

Nhằm đảm bảo ranh giới dữ liệu không bị xung đột, trùng lặp và phân tán, hệ thống phân định độc quyền quyền sở hữu dữ liệu theo bảng sau (`ACTIVE.md` Mục 18):

| Phân vùng Lưu trữ (Store)  | Quyền Sở hữu Dữ liệu (Ownership)            | Ý nghĩa, Ranh giới & Quy định Vận hành                                                                    |
| :------------------------- | :------------------------------------------ | :-------------------------------------------------------------------------------------------------------- |
| **Knowledgebase**          | Factual / Business Knowledge                | Dữ liệu tri thức thực tế, tài liệu nghiên cứu tham khảo và ghi chép cá nhân của con người.                |
| **Skill Store**            | Reusable Procedure                          | Các quy trình kỹ thuật, kỹ năng phân tích dữ liệu và mẫu template đã được chuẩn hóa.                      |
| **Tools**                  | Executable Capability                       | Năng lực công cụ thực thi tính toán và xuất bản artifact thật (Excel, Power BI, SQL, Python).             |
| **Decision Ledger**        | User Decisions                              | Sổ cái lưu các câu trả lời và quyết định đã được con người trực tiếp xác nhận (`isHumanConfirmed: true`). |
| **Main Operational State** | Current Task / Execution Agent / Governance | Trạng thái vòng đời tác vụ, hàng đợi, phân công điều phối và nhật ký chuyển đổi thời gian thực.           |

_Nguyên tắc tham chiếu:_ Ưu tiên tham chiếu (reference) qua mã định danh có cấu trúc thay vì nhân bản (duplication) dữ liệu thô giữa các tầng bộ nhớ.

---

### 7. Các Quy tắc Quản trị Vận hành Bổ sung (Operational Governance Rules)

#### 1. Nguyên tắc Điều phối viên Chính & Tư vấn (Primary / Consultant Rule)

- Mỗi nhiệm vụ chỉ có **DUY NHẤT một Điều phối viên Chính (Primary Coordinator: O1 hoặc O2)** chịu trách nhiệm sở hữu luồng công việc, ban hành kế hoạch và đăng thẻ nghiệm thu kết quả.
- Điều phối viên còn lại có thể tham gia với tư cách **Chuyên gia Tư vấn (Consultant)** để cung cấp thông tin hoặc ý kiến chuyên môn nhưng **tuyệt đối không đồng sở hữu (joint ownership)** nhiệm vụ.

#### 2. Quy trình Thay đổi Kế hoạch Đáng kể (Significant Plan Change)

- Trong quá trình `EXECUTING`, nếu O1/O2 nhận thấy cần thay đổi đáng kể về: phương pháp thực thi, phạm vi dữ liệu, nguồn dữ liệu, quy tắc kinh doanh, công cụ sử dụng, định dạng đầu ra, rủi ro hoặc tiêu chí nghiệm thu:
- **Quy trình bắt buộc:**
  $$\mathbf{PAUSE \longrightarrow REQUEST\_REVISION \longrightarrow \#approvals \longrightarrow USER\ DECISION}$$
- Task tạm dừng ở `REVISING`; O1/O2 cập nhật phiên bản kế hoạch và chỉ tiếp tục thực thi sau khi người dùng đã duyệt phiên bản mới.

#### 3. Thẩm quyền Ngữ nghĩa Thuộc về Con người (Human Semantic Authority)

- Đối với các điểm mơ hồ về thuật ngữ hoặc ánh xạ ngữ nghĩa (semantic mapping):
  $$\mathbf{DETECT \longrightarrow PROPOSE \longrightarrow \#office \longrightarrow USER\ DECISION \longrightarrow PERSIST}$$
- Tuyệt đối cấm AI tự ý quyết định hoặc tự động gộp (merge) các khái niệm ngữ nghĩa khi chưa được người dùng phê duyệt trên `#office`.

#### 4. Vòng lặp Học tập Bộ nhớ (Memory Learning Loop)

- Sau khi nhiệm vụ được nghiệm thu hoàn tất (`COMPLETE`), các tri thức hoặc tiền lệ mới được phát hiện phải tuân thủ quy trình:
  $$\mathbf{FEEDBACK \longrightarrow CANDIDATE\ PROPOSAL \longrightarrow \#office \longrightarrow USER\ CONFIRMS \longrightarrow PERSIST}$$
- Không tự động ghi trực tiếp vào bộ nhớ dài hạn nếu người dùng chưa xác nhận. Không đưa đề xuất học tập vào diễn đàn `#approvals`.
- Ứng viên được phân loại rõ ràng trước khi persist: quy tắc/quyết định vận hành đã xác nhận thuộc về Decision Ledger (tra cứu chính xác theo scope); quy trình tái sử dụng thuộc về Skill Store (đề xuất `CANDIDATE`, chỉ `ACTIVE` sau phê duyệt chủ sở hữu với ràng buộc đúng-bytes); trạng thái task hiện hành không phải bộ nhớ dài hạn. Phân loại mơ hồ thì không persist (fail-closed).
- Trạng thái hỗ trợ (M8/T3): Decision và Skill learning đã triển khai đầy đủ (persist + truy xuất fresh-session). Tri thức thực tế (factual/reference) được phân loại và định tuyến nhưng **chủ ý chưa triển khai** persist do người dùng ghi trực tiếp vào Knowledgebase trong milestone này (adapter cấm ingestion theo hợp đồng, Vault nguồn chỉ đọc) — routing trung thực báo `persisted: false`, không giả vờ đã lưu. Chưa kiểm chứng live (môi trường dev không có Discord/runtime live).

#### 5. Mô hình Embedding & Truy xuất Ngữ nghĩa (Embedding & Retrieval)

- Sử dụng mô hình `bge-m3` (1024 chiều) chạy trên máy chủ Ollama cục bộ.
- Chuỗi bao bọc ngữ nghĩa (`renderEmbeddingEnvelope`) chỉ đóng vai trò đầu vào sinh vector, tuyệt đối không ghi đè nội dung tài liệu gốc hoặc văn bản tìm kiếm toàn văn (FTS).
- Tuyệt đối không dùng độ tương đồng vector (vector similarity) để giải mã cú pháp cấu trúc của Structured Reference ID.

#### 6. Quy tắc Xử lý Sự cố & Phục hồi Thường gặp (Common Failure & Recovery Rules)

1. **Execution agent ngoại tuyến / Laptop Sleep:** Khi execution agent tạm dừng, tác vụ được bảo toàn trong hàng đợi bền vững `QueueManager` ở trạng thái `QUEUED`; không tạo artifact hay kết quả giả.
2. **Execution agent crash / Mất nguồn đột ngột:** Control Plane phát hiện nhịp tim bị gián đoạn quá thời hạn cho phép, tự động kích hoạt `detectAndRecoverStaleTasks` để thu hồi task bị treo và chuyển lại về `QUEUED`.
3. **Kết quả Kỹ thuật Đạt nhưng Nghiệp vụ Sai:** Vi phạm chỉ số KPI khiến kết quả bị khóa lập tức ở trạng thái `RESULT BLOCKED`, tự động gửi cảnh báo thẻ đỏ lên `#incidents`; cấm chuyển sang trạng thái thành công.
4. **Bảo vệ Chống Thao tác Cũ / Trùng lặp (Stale / Duplicate Protection):** Mọi tương tác nút bấm trên Discord đều gắn kèm `attemptToken`. Thao tác trên các lượt thử cũ bị hệ thống từ chối với mã lỗi `STALE_ACTION_REJECTED`.
5. **Quản trị Ngoại tuyến (Governance Unavailable):** Hệ thống luôn tuân thủ nguyên tắc **Fail-Closed**; cấm bỏ qua (bypass) chốt an toàn và cấm tự động fallback về thực thi trực tiếp trên máy chủ chủ quyền (host fallback).

---

### 8. Khung Quản trị 15 Họ Nguyên nhân Gốc (Root-Cause Hardening Map — RC-01 đến RC-15)

Nhằm đảm bảo hệ thống vận hành bền vững không xảy ra lỗi hồi quy, M8/T2.2 khóa cứng 15 họ nguyên nhân gốc tại tầng kiến trúc:

| Họ Root Cause | Tên lĩnh vực Quản trị                    | Nguyên tắc & Ranh giới Khóa cứng tại Runtime                                                                                                                                      |
| :------------ | :--------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RC-01**     | Discord Ingress / Routing Authority      | Cổng tiếp nhận kiểm tra trước khi gọi model; `@Quản Lý` là root owner duy nhất; từ chối mention trực tiếp chuyên viên (`SPECIALIST_NO_DIRECT_INGRESS`); chống duplicate event.    |
| **RC-02**     | Agent Topology / Spawn Authorization     | Khóa cứng cây phân cấp: `Main -> [O1, O2]`, `O1 -> [Excel, SQL, Python]`, `O2 -> [Power BI, Python]`, leaf -> `[]`; chặn Main gọi trực tiếp chuyên viên, cấm O1/O2 gọi chéo nhau. |
| **RC-03**     | Task Identity / Lineage / Idempotency    | Mã tương quan bền vững (`task_id`), tra cứu chính xác; từ chối duplicate action hoặc xử lý lũy thừa không tạo execution mới.                                                      |
| **RC-04**     | Approval / Revision / Result Transaction | Bản ghi phê duyệt bất biến gắn liền mã băm kế hoạch; sửa đổi kế hoạch lập tức hủy hiệu lực phê duyệt cũ; độc quyền User duyệt.                                                    |
| **RC-05**     | Queue / Ledger / Lease / Recovery        | Hàng đợi bền vững trên đĩa với atomic cross-process file lock, heartbeat fencing, tự động thu hồi task treo khi laptop tắt/ngủ.                                                   |
| **RC-06**     | Discord Outbound / Channel Authority     | Tách bạch 4 kênh: `#office` (Main trao đổi người dùng), `#approvals` (duyệt kế hoạch), `#results` (nghiệm thu kết quả), `#incidents` (báo cáo lỗi).                               |
| **RC-07**     | Artifact / Result Delivery Truth         | Loại bỏ đường dẫn tuyệt đối nội bộ và `file://` khỏi tin nhắn người dùng; tách riêng artifact lưu trữ ngoài Git.                                                                  |
| **RC-08**     | Excel Execution Truth                    | Loại bỏ ghi đè vào Git `artifacts/`; xuất bản `.xlsx` kèm ảnh SVG preview trực quan từng sheet.                                                                                   |
| **RC-09**     | SQL Execution Truth                      | Chạy DuckDB engine thật qua Windows bridge; trả trạng thái thực thi rõ ràng (`REAL_EXECUTED`, `EMPTY_RESULT`, `TEST_SIMULATION`, `TIMEOUT`); cấm trả mock rows khi lỗi.           |
| **RC-10**     | Python Execution Truth                   | Tách biệt stack ETL của O1 và stack Analytics/Forecast của O2; phân tích cú pháp AST và kiểm soát import thư viện.                                                                |
| **RC-11**     | Power BI Execution Truth                 | Kiểm tra magic byte zip `PK\x03\x04`, tính toàn vẹn của container `.pbix`/`.pbit` và tương quan preview dashboard.                                                                |
| **RC-12**     | External Adapter / Simulation Truth      | Tách biệt rõ ràng chế độ mô phỏng (`TEST_SIMULATION`) và cấm dùng dữ liệu mô phỏng trong đường dẫn thành công của production.                                                     |
| **RC-13**     | Security / Path / Endpoint Isolation     | Zero secret leaks; chặn mọi hành vi path traversal (`..`) hoặc truy cập file ngoài workspace; cấm bypass sandbox.                                                                 |
| **RC-14**     | Semantic / Capability Boundary           | Ánh xạ namespace được kiểm duyệt; lưu đề xuất skill vào thư mục chuyên dụng, không làm bẩn source tree.                                                                           |
| **RC-15**     | Verification / CI / Schema Truth         | Toàn bộ kiểm thử trực tiếp PASS (`npm test` xanh, xem kết quả chạy thực tế); DuckDB native bridge PASS; format, lint, diff và repo check PASS.                                    |

---

## 18. Quy trình Dừng Hệ thống

Khi kết thúc phiên làm việc:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/stop.ps1 -Profile all -EnvironmentFile ./infrastructure/docker/env/.env
```

Lệnh này dừng an toàn các container và bảo toàn toàn bộ dữ liệu trên các Docker volume.
