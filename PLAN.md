# Personal Tool — Development Plan

## Development Rules

### 1. Read Before Acting

Before modifying the repository, the agent MUST:

1. Read `AGENTS.md`.
2. Read `PLAN.md`.
3. Identify the current Active Task in `PLAN.md`.
4. Inspect the relevant repository files and existing implementation.
5. Determine the actual implementation state from repository evidence.
6. Make the smallest change required by the Active Task.

Do not begin implementation before the Active Task is known.

---

### 2. `PLAN.md` Is the Development Source of Truth

`PLAN.md` is the single source of truth for:

* development sequence;
* milestone status;
* task status;
* Current Focus;
* Active Task;
* dependencies;
* Definition of Done;
* completion evidence;
* blockers;
* component completion status.

`AGENTS.md` defines how an agent must work.

`CHANGELOG.md` records historical completed changes.

The agent MUST NOT create a separate development roadmap or progress state in another document.

---

### 3. Active Task Rule

Only the task explicitly identified as the current Active Task in `PLAN.md` is in scope.

The agent MUST NOT:

* implement future milestones proactively;
* start another milestone because it appears easy;
* create infrastructure for future milestones;
* refactor unrelated components;
* add speculative abstractions;
* modify deferred applications;
* mark future work as complete;
* silently expand the scope of the Active Task.

If the current task reveals a prerequisite outside its scope, stop and report the dependency. Do not silently expand the task.

---

### 4. Sequential Milestone Rule

Personal Tool V1 follows the approved milestone sequence:

```text
M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8 → M9 → M10
```

A milestone may move to `IN PROGRESS` only after the previous required milestone has reached `COMPLETE`.

No milestone may run in parallel unless the owner explicitly approves the exception.

The agent MUST NOT unlock or begin the next milestone merely because its implementation appears possible.

---

### 5. Milestone Completion Gate

A milestone may be marked `COMPLETE` only when:

1. its Definition of Done is satisfied;
2. the required implementation exists;
3. relevant validation has passed;
4. required service health checks have passed;
5. completion evidence has been recorded in `PLAN.md`;
6. known blockers affecting the milestone are resolved or explicitly documented.

Code existence alone does not establish completion.

After a milestone becomes `COMPLETE`, the next milestone becomes eligible for execution according to `PLAN.md`.

---

### 6. Evidence Rule

Never infer implementation status from:

* file names;
* directory names;
* architecture diagrams;
* documentation;
* comments;
* TODO items;
* placeholders;
* empty directories;
* configuration templates;
* planned schemas;
* declared Docker services.

A component may be classified as `IMPLEMENTED` only when observable repository evidence supports that status.

Acceptable evidence may include:

* executable implementation;
* passing automated tests;
* successful reproducible commands;
* successful database migration;
* successful service health check;
* validated API behavior;
* validated data-pipeline output;
* validated end-to-end behavior.

If evidence is unavailable, report the component as not verified.

---

### 7. Status Vocabulary

Milestone and task status:

```text
NOT STARTED
IN PROGRESS
BLOCKED
COMPLETE
DEFERRED
CANCELLED
```

Component status:

```text
IMPLEMENTED
PARTIALLY IMPLEMENTED
PLANNED
MISSING
INCONSISTENT
DEPRECATED
```

These two status systems MUST NOT be mixed.

For example:

```text
M5 → IN PROGRESS
ai-chat → PARTIALLY IMPLEMENTED
```

is valid.

Do not use `IMPLEMENTED` as a milestone status or `COMPLETE` as a component status.

---

### 8. Repository-State Verification

Before claiming that something is implemented, inspect the actual repository.

The agent MUST NOT assume that an architectural component exists merely because it is described in:

* `AGENTS.md`;
* `PLAN.md`;
* architecture documentation;
* README files;
* diagrams;
* previous conversations.

If implementation and documentation disagree, treat the repository evidence as the current implementation reality and report the inconsistency.

---

### 9. Architecture and Dependency Changes

Do not silently change approved architecture.

A new:

* database;
* infrastructure service;
* framework;
* model provider;
* external dependency;
* architectural boundary;
* major runtime dependency

requires an explicit architectural decision before implementation when it changes the approved V1 design.

Record the decision in `PLAN.md` under `Decision Log`.

A proposal must be marked `PROPOSED` until explicitly approved by the owner.

Do not implement a `PROPOSED` architectural change as though it were `ACCEPTED`.

---

### 10. Scope Protection

V1 prioritizes the complete Knowledge Assistant before L&SC Intelligence.

The approved execution order is:

```text
Knowledge Assistant
    M3 → M4 → M5 → M6
        ↓
L&SC Intelligence
    M7 → M8 → M9
        ↓
V1 Hardening
    M10
```

Deferred applications, including:

```text
applications/admin-dashboard/
applications/document-manager/
```

must not be developed during V1 unless explicitly re-approved.

---

### 11. Validation Rule

After implementation, run the narrowest meaningful validation first and broader validation when required.

Examples:

```text
implementation
    ↓
unit test
    ↓
integration validation
    ↓
service health
    ↓
end-to-end validation
```

If validation cannot be performed:

* do not claim completion;
* record the missing validation or blocker in `PLAN.md`;
* report exactly what remains unverified.

---

### 12. `PLAN.md` Update Rule

Update `PLAN.md` when:

* a task is completed;
* a task becomes blocked;
* a task is deferred or cancelled;
* the Active Task changes;
* a dependency changes;
* the Definition of Done changes;
* the implementation materially changes the approved approach;
* a new architectural decision is required;
* completion evidence changes.

All updates must describe actual repository state, not intentions.

---

### 13. `CHANGELOG.md` Update Rule

`CHANGELOG.md` is a historical record of completed and validated changes.

Add an entry only after the relevant task reaches its Definition of Done.

Do not add entries for:

* planned work;
* work in progress;
* blocked work;
* placeholders;
* empty directories;
* unverified code;
* architecture proposals;
* speculative changes.

When a task reaches Definition of Done, update `PLAN.md` and `CHANGELOG.md` in the same change set whenever practical.

`CHANGELOG.md` MUST NOT be used as the source of truth for the current Active Task.

---

### 14. Security and Secrets

Never:

* commit `.env` files containing secrets;
* expose API keys;
* expose passwords;
* expose access tokens;
* print credentials;
* commit private certificates;
* expose sensitive local configuration.

Environment files may be inspected for variable names and structure, but secret values must remain redacted.

Use `.env.example` to document configuration shape.

---

### 15. Database and Persistent Data Safety

Do not:

* silently delete databases;
* reset persistent volumes without explicit approval;
* destroy existing data merely to simplify testing;
* introduce schema changes without appropriate validation;
* treat a migration file as proof that a migration has been executed successfully.

Database changes must be reproducible and validated.

---

### 16. Minimal Change Principle

Prefer the smallest coherent change that satisfies the Active Task.

Do not perform unrelated cleanup, broad refactoring, dependency replacement, or architecture modernization during an implementation task.

If a larger refactor is genuinely required, explain why and obtain the necessary architectural decision before expanding scope.

---

### 17. Final Verification

Before reporting a task as complete:

1. Verify the changed files.
2. Run the relevant tests/checks.
3. Verify affected services where applicable.
4. Confirm no secrets were exposed.
5. Record completion evidence in `PLAN.md`.
6. Update `CHANGELOG.md` if the Definition of Done was reached.
7. Confirm the next milestone is actually unlocked.

The final response must clearly state:

* what was changed;
* what was validated;
* what evidence was obtained;
* what remains blocked or unverified;
* whether the next milestone is unlocked.
## End rule


## Kế hoạch phát triển V1

> **Trạng thái tài liệu:** ĐÃ PHÊ DUYỆT
> **Đánh giá gần nhất:** 2026-08-11
> `PLAN.md` theo dõi tiến độ và trình tự phát triển; `CHANGELOG.md` chỉ lưu thay đổi đã hoàn thành và được xác thực.

## Current Focus

**Milestone:** M1 — Development Foundation
**Trạng thái:** `IN PROGRESS`

**Active Task:** M1/T1 — Git/GitHub và quy ước repository.

**Phạm vi:**

- Xác nhận Git repository và GitHub remote; ghi rõ quy ước phát triển/repository.
- Chuẩn bị phạm vi chỉnh sửa cho `.editorconfig`, `.gitattributes`, `.gitignore`, `README.md` và tài liệu development.
- Không triển khai CI, runtime, database schema, business logic, RAG, AI Agent hoặc dashboard trong T1.

**Hành động kế tiếp:** Chờ quyền truy cập rõ ràng vào các file thuộc M1/T1, rồi kiểm tra trạng thái thực tế trước khi thay đổi nhỏ nhất cần thiết.

**Blocker:** Quyền hiện tại chỉ cho phép chỉnh sửa `PLAN.md` và `CHANGELOG.md`; chưa có quyền truy cập các file M1/T1 khác.

**Bằng chứng M0 hoàn thành:** Chủ sở hữu đã phê duyệt kế hoạch V1 vào 2026-08-11. M0 không bao gồm thay đổi chức năng hệ thống.

## Nhật ký quyết định

| ID | Ngày | Trạng thái | Quyết định | Lý do | Tác động |
| --- | --- | --- | --- | --- | --- |
| D-001 | 2026-08-10 | `ACCEPTED` | V1 đi theo vertical slice: Knowledge Assistant, rồi L&SC Intelligence, rồi hardening. | Hoàn thành một luồng dùng được trước khi mở rộng phạm vi. | M3–M6 hoàn tất trước M7. |
| D-002 | 2026-08-10 | `ACCEPTED` | AI và embedding là local-first; Ollama chạy trên Windows host. | Phù hợp RAM 24 GB, VRAM 6 GB và yêu cầu không dùng cloud. | Container truy cập Ollama qua host gateway; M2 xác thực kết nối này. |
| D-003 | 2026-08-10 | `ACCEPTED` | M1 chỉ là Development Foundation. | Không đưa domain hoặc runtime vào trước khi repository có cơ chế kiểm chứng. | Không có database schema, business logic, RAG, agent hoặc dashboard ở M1. |
| D-004 | 2026-08-10 | `ACCEPTED` | M2 gồm Docker, PostgreSQL + pgvector, Redis, Nginx, Ollama, Prometheus, Grafana, Dozzle, MinIO và n8n. | Cung cấp nền local cho các vertical slice sau. | M2 chỉ xác thực hạ tầng; chưa có workflow nghiệp vụ hoặc data pipeline. |
| D-005 | 2026-08-10 | `ACCEPTED` | `PLAN.md` là nguồn trạng thái; `CHANGELOG.md` chỉ ghi việc đã hoàn thành và được xác thực. | Tách kế hoạch khỏi lịch sử thay đổi. | Hai file cập nhật cùng change set khi task đạt Definition of Done. |

## Lộ trình Personal Tool V1

```text
PERSONAL TOOL V1
│
M0  Phê duyệt kế hoạch
│
M1  Development Foundation
│
M2  Local Infrastructure
│
├── PHASE 1 — KNOWLEDGE ASSISTANT
│   ├── M3  Knowledge Platform
│   ├── M4  AI Platform
│   ├── M5  Web Chat
│   └── M6  Automation + Observability
│
├── PHASE 2 — L&SC INTELLIGENCE
│   ├── M7  Data Intake & Data Plant
│   ├── M8  Forecasting
│   └── M9  Dashboard
│
└── PHASE 3 — V1 RELEASE
    └── M10 Hardening → V1 DONE
```

| Milestone | Trạng thái | Phụ thuộc | Mục tiêu |
| --- | --- | --- | --- |
| M0 — Phê duyệt kế hoạch | `COMPLETE` | — | Chốt phạm vi, thứ tự và Definition of Done. |
| M1 — Development Foundation | `IN PROGRESS` | M0 `COMPLETE` | Tạo nền tảng phát triển và kiểm chứng repository. |
| M2 — Local Infrastructure | `NOT STARTED` | M1 `COMPLETE` | Đưa và xác thực các service nền local. |
| M3 — Knowledge Platform | `NOT STARTED` | M2 `COMPLETE` | Index và retrieval Obsidian có citation. |
| M4 — AI Platform | `NOT STARTED` | M3 `COMPLETE` | Điều phối AI local và RAG route. |
| M5 — Web Chat | `NOT STARTED` | M4 `COMPLETE` | Cung cấp ai-chat dùng Knowledge Assistant. |
| M6 — Automation + Observability | `NOT STARTED` | M5 `COMPLETE` | Tự động hóa, telemetry và runbook cho Knowledge Assistant. |
| M7 — Data Intake & Data Plant | `NOT STARTED` | M6 `COMPLETE` | Tạo dữ liệu L&SC được govern. |
| M8 — Forecasting | `NOT STARTED` | M7 `COMPLETE` | Huấn luyện, đánh giá và suy luận dự báo local. |
| M9 — Dashboard | `NOT STARTED` | M8 `COMPLETE` | Hiển thị data product và forecast có lineage. |
| M10 — Hardening | `NOT STARTED` | M9 `COMPLETE` | Sẵn sàng phát hành V1. |

## M1 — Development Foundation

**Phạm vi được phép:**

- Git và GitHub workflow.
- CI cơ bản; framework lint, format và test.
- Quy ước repository và environment không chứa secret.
- Makefile/script cơ bản và tài liệu phát triển.

**Ngoài phạm vi:**

- Database schema hoàn chỉnh.
- Business logic.
- Knowledge RAG, AI Agent và dashboard.

**Definition of Done:**

- Quy ước phát triển và cấu trúc kiểm thử được ghi rõ.
- Lệnh lint, format, test và verify được tái lập từ hướng dẫn phát triển.
- GitHub workflow kiểm tra các điều kiện cốt lõi đó.
- Không có runtime service, domain implementation hoặc secret được thêm vào M1.

## M2 — Local Infrastructure

**Phạm vi được phép:**

- Docker Compose; PostgreSQL + pgvector; Redis; Nginx.
- Ollama chạy trên Windows host.
- Prometheus; Grafana; Dozzle; MinIO; n8n.
- Cấu hình, persistence, health check, network local, script vận hành và tài liệu kiểm chứng hạ tầng.

**Ngoài phạm vi:**

- Database schema nghiệp vụ; Knowledge RAG; AI Agent; dashboard; data pipeline.
- n8n workflow nghiệp vụ, index workflow và notification workflow.

**Definition of Done:**

| Năng lực | Bằng chứng bắt buộc |
| --- | --- |
| Docker Compose | Cấu hình hợp lệ, khởi động/dừng có kiểm soát và service network hoạt động. |
| PostgreSQL + pgvector | Client kết nối được, pgvector khả dụng và dữ liệu hạ tầng vẫn tồn tại sau restart. |
| Redis | Client `PING` thành công; đặc tính transient/persistence được cấu hình hoặc ghi rõ. |
| Nginx | Cấu hình được kiểm tra hợp lệ và chỉ mở theo local boundary đã định. |
| Ollama host | Host cung cấp Ollama; container truy cập được qua host gateway; có smoke test model cục bộ. |
| MinIO | Xác thực được, đọc/ghi object kiểm thử thành công và object persistence được xác nhận. |
| n8n | Service khởi động, state persistence được xác nhận; chưa có workflow nghiệp vụ. |
| Prometheus + Grafana + Dozzle | Target/service health quan sát được, Grafana có datasource/hiển thị cơ bản và Dozzle xem được log container. |

Container `Up` không phải bằng chứng M2 hoàn thành. M2 chỉ `COMPLETE` khi toàn bộ năng lực trên được xác thực, resource usage được kiểm tra phù hợp phần cứng và các lệnh vận hành được tài liệu hóa.

## Phase 1 — Knowledge Assistant

### M3 — Knowledge Platform

- Kết nối Obsidian Vault chỉ đọc; ban đầu chỉ xử lý `01. Knowledge`.
- Parse Markdown/native `#tags`, index incremental, retrieval filter và citation.
- **DoD:** note hợp lệ được index/search với nguồn, passage và tag; Notes/Archives không bị index.

### M4 — AI Platform

- Thêm AI gateway local, model/resource policy, session, tool permission và RAG router.
- **DoD:** agent chỉ truy cập retrieval qua Knowledge Platform và không tạo citation không có nguồn.

### M5 — Web Chat

- Tạo `ai-chat` hiển thị câu trả lời, citation và trạng thái index.
- **DoD:** truy vấn end-to-end local trả lời có citation; câu hỏi thiếu bằng chứng được báo rõ.

### M6 — Automation + Observability

- Tạo n8n workflow cho index/notification và telemetry theo application/runbook.
- **DoD:** index run trace được từ trigger đến kết quả; lỗi có log, metric và hướng dẫn xử lý.

## Phase 2 — L&SC Intelligence

### M7 — Data Intake & Data Plant

- Nhận sales/demand, inventory snapshot và purchase/lead-time qua Landing → Validation/Quarantine → Bronze → Silver → Gold.
- **DoD:** dữ liệu hợp lệ đến Gold có lineage; dữ liệu không hợp lệ bị quarantine có bằng chứng rõ ràng.

### M8 — Forecasting

- Backtesting, baseline/champion forecast, model registry metadata và inference local.
- **DoD:** mỗi forecast truy vết được data version, feature, model version, evaluation và thời điểm chạy.

### M9 — Dashboard

- Tạo `lsc-dashboard` dùng Gold data product và semantic metrics.
- **DoD:** metric và forecast hiển thị được truy vết về Gold data/product tương ứng.

## Phase 3 — V1 Release

### M10 — Hardening

- Security boundary, backup/restore, E2E, resource validation, release runbook và known limitations.
- **DoD:** các luồng V1 được kiểm thử; restore được xác nhận; không lộ secret; vận hành local được tài liệu hóa.

## Bản đồ hoàn thành theo cây thư mục

| Khu vực | Trạng thái thành phần hiện tại | Milestone sở hữu | Bằng chứng hoàn thành |
| --- | --- | --- | --- |
| Tài liệu kiến trúc | `IMPLEMENTED` | Duy trì xuyên suốt | Tài liệu mô tả boundary hiện có; không phải bằng chứng runtime. |
| CI, Makefile, script và test framework | `PLANNED` | M1 | Lệnh kiểm chứng và CI chạy được. |
| Docker, database, networking, reverse proxy | `PLANNED` | M2 | Service readiness theo Definition of Done M2. |
| Knowledge Platform | `PLANNED` | M3 | Index, retrieval và citation được kiểm thử. |
| AI Platform và ai-chat | `PLANNED` | M4–M5 | Luồng chat local có bằng chứng end-to-end. |
| Automation và observability theo nghiệp vụ | `PLANNED` | M6 | Workflow, telemetry và runbook đã xác thực. |
| L&SC Data Plant, forecasting và dashboard | `PLANNED` | M7–M9 | Data quality, lineage, model và dashboard được kiểm chứng. |
| Experiments | `PLANNED` | M8 trở đi | Đánh giá cô lập và quyết định promotion được ghi lại. |
| Admin dashboard và document manager | `DEFERRED` | Sau V1 | Có nhu cầu cụ thể được chủ sở hữu phê duyệt. |

## Đồng bộ tiến độ và Changelog

Khi một task đạt Definition of Done, cập nhật trong cùng change set khi phù hợp:

1. Current Focus, trạng thái milestone/task và bản đồ cây thư mục trong `PLAN.md`.
2. Bằng chứng hoàn thành, kiểm tra đã chạy và limitation còn lại trong `PLAN.md`.
3. Một entry `Added`, `Changed`, `Fixed` hoặc `Security` trong `CHANGELOG.md`.

Không cập nhật `CHANGELOG.md` cho kế hoạch, placeholder, directory rỗng, code chưa kiểm chứng hoặc task chưa đạt Definition of Done.

## Ranh giới V1

- Hệ thống local-first, một người dùng, Docker Compose theo nhu cầu; không Kubernetes, Kafka, SaaS nhiều người dùng hay autonomous agent không giới hạn.
- Obsidian là nguồn tri thức do người dùng viết; hệ thống không ghi tùy ý vào Vault.
- Knowledge Assistant hoàn thành trước L&SC Intelligence.
- Routing/optimization nâng cao, multimodal indexing, ontology, context pack và ứng dụng bổ sung chỉ được xem xét sau V1 khi có quyết định mới.




<!-- Bản nháp kế hoạch trước đã được thay thế; không dùng để điều phối công việc.

## Kế hoạch phát triển V1

> **Trạng thái tài liệu:** BẢN NHÁP — chờ chủ sở hữu phê duyệt
> **Đánh giá gần nhất:** 2026-08-10
> \`PLAN.md\` theo dõi tiến độ và trình tự phát triển; \`CHANGELOG.md\` chỉ lưu thay đổi đã hoàn thành và được xác thực.

## Current Focus

**Milestone:** M0 — Phê duyệt kế hoạch
**Trạng thái:** \`BLOCKED\`

**Active Task:** Chủ sở hữu rà soát và phê duyệt kế hoạch V1 này.

**Phạm vi:**

- Chốt lộ trình vertical slice, Decision Log và Definition of Done.
- Không triển khai runtime, CI, schema, service, pipeline hoặc ứng dụng.

**Hành động kế tiếp khi được phê duyệt:** M1/T1 — tạo nền tảng phát triển và kiểm chứng repository.

**Blocker:** Chưa có phê duyệt cuối cùng cho bản kế hoạch này.

**Definition of Done:** Chủ sở hữu xác nhận kế hoạch. M0 không bao gồm thay đổi chức năng hệ thống.

## Nhật ký quyết định

| ID | Ngày | Trạng thái | Quyết định | Lý do | Tác động |
| --- | --- | --- | --- | --- | --- |
| D-001 | 2026-08-10 | \`ACCEPTED\` | V1 đi theo vertical slice: Knowledge Assistant, rồi L&SC Intelligence, rồi hardening. | Hoàn thành một luồng dùng được trước khi mở rộng phạm vi. | M3–M6 hoàn tất trước M7. |
| D-002 | 2026-08-10 | \`ACCEPTED\` | AI và embedding là local-first; Ollama chạy trên Windows host. | Phù hợp RAM 24 GB, VRAM 6 GB và yêu cầu không dùng cloud. | Container truy cập Ollama qua host gateway; M2 xác thực kết nối này. |
| D-003 | 2026-08-10 | \`ACCEPTED\` | M1 chỉ là Development Foundation. | Không đưa domain hoặc runtime vào trước khi repository có cơ chế kiểm chứng. | Không có database schema, business logic, RAG, agent hoặc dashboard ở M1. |
| D-004 | 2026-08-10 | \`ACCEPTED\` | M2 gồm Docker, PostgreSQL + pgvector, Redis, Nginx, Ollama, Prometheus, Grafana, Dozzle, MinIO và n8n. | Cung cấp nền local cho các vertical slice sau. | M2 chỉ xác thực hạ tầng; chưa có workflow nghiệp vụ hoặc data pipeline. |
| D-005 | 2026-08-10 | \`ACCEPTED\` | \`PLAN.md\` là nguồn trạng thái; \`CHANGELOG.md\` chỉ ghi việc đã hoàn thành và được xác thực. | Tách kế hoạch khỏi lịch sử thay đổi. | Hai file cập nhật cùng change set khi task đạt Definition of Done. |

## Lộ trình Personal Tool V1

\`\`\`text
PERSONAL TOOL V1
│
M0  Phê duyệt kế hoạch
│
M1  Development Foundation
│
M2  Local Infrastructure
│
├── PHASE 1 — KNOWLEDGE ASSISTANT
│   ├── M3  Knowledge Platform
│   ├── M4  AI Platform
│   ├── M5  Web Chat
│   └── M6  Automation + Observability
│
├── PHASE 2 — L&SC INTELLIGENCE
│   ├── M7  Data Intake & Data Plant
│   ├── M8  Forecasting
│   └── M9  Dashboard
│
└── PHASE 3 — V1 RELEASE
    └── M10 Hardening → V1 DONE
\`\`\`

| Milestone | Trạng thái | Phụ thuộc | Mục tiêu |
| --- | --- | --- | --- |
| M0 — Phê duyệt kế hoạch | \`BLOCKED\` | — | Chốt phạm vi, thứ tự và Definition of Done. |
| M1 — Development Foundation | \`NOT STARTED\` | M0 \`COMPLETE\` | Tạo nền tảng phát triển và kiểm chứng repository. |
| M2 — Local Infrastructure | \`NOT STARTED\` | M1 \`COMPLETE\` | Đưa và xác thực các service nền local. |
| M3 — Knowledge Platform | \`NOT STARTED\` | M2 \`COMPLETE\` | Index và retrieval Obsidian có citation. |
| M4 — AI Platform | \`NOT STARTED\` | M3 \`COMPLETE\` | Điều phối AI local và RAG route. |
| M5 — Web Chat | \`NOT STARTED\` | M4 \`COMPLETE\` | Cung cấp ai-chat dùng Knowledge Assistant. |
| M6 — Automation + Observability | \`NOT STARTED\` | M5 \`COMPLETE\` | Tự động hóa, telemetry và runbook cho Knowledge Assistant. |
| M7 — Data Intake & Data Plant | \`NOT STARTED\` | M6 \`COMPLETE\` | Tạo dữ liệu L&SC được govern. |
| M8 — Forecasting | \`NOT STARTED\` | M7 \`COMPLETE\` | Huấn luyện, đánh giá và suy luận dự báo local. |
| M9 — Dashboard | \`NOT STARTED\` | M8 \`COMPLETE\` | Hiển thị data product và forecast có lineage. |
| M10 — Hardening | \`NOT STARTED\` | M9 \`COMPLETE\` | Sẵn sàng phát hành V1. |

## M1 — Development Foundation

**Phạm vi được phép:**

- Git và GitHub workflow.
- CI cơ bản; framework lint, format và test.
- Quy ước repository và environment không chứa secret.
- Makefile/script cơ bản và tài liệu phát triển.

**Ngoài phạm vi:**

- Database schema hoàn chỉnh.
- Business logic.
- Knowledge RAG, AI Agent và dashboard.

**Definition of Done:**

- Quy ước phát triển và cấu trúc kiểm thử được ghi rõ.
- Lệnh lint, format, test và verify được tái lập từ hướng dẫn phát triển.
- GitHub workflow kiểm tra các điều kiện cốt lõi đó.
- Không có runtime service, domain implementation hoặc secret được thêm vào M1.

## M2 — Local Infrastructure

**Phạm vi được phép:**

- Docker Compose; PostgreSQL + pgvector; Redis; Nginx.
- Ollama chạy trên Windows host.
- Prometheus; Grafana; Dozzle; MinIO; n8n.
- Cấu hình, persistence, health check, network local, script vận hành và tài liệu kiểm chứng hạ tầng.

**Ngoài phạm vi:**

- Database schema nghiệp vụ; Knowledge RAG; AI Agent; dashboard; data pipeline.
- n8n workflow nghiệp vụ, index workflow và notification workflow.

**Definition of Done:**

| Năng lực | Bằng chứng bắt buộc |
| --- | --- |
| Docker Compose | Cấu hình hợp lệ, khởi động/dừng có kiểm soát và service network hoạt động. |
| PostgreSQL + pgvector | Client kết nối được, pgvector khả dụng và dữ liệu hạ tầng vẫn tồn tại sau restart. |
| Redis | Client \`PING\` thành công; đặc tính transient/persistence được cấu hình hoặc ghi rõ. |
| Nginx | Cấu hình được kiểm tra hợp lệ và chỉ mở theo local boundary đã định. |
| Ollama host | Host cung cấp Ollama; container truy cập được qua host gateway; có smoke test model cục bộ. |
| MinIO | Xác thực được, đọc/ghi object kiểm thử thành công và object persistence được xác nhận. |
| n8n | Service khởi động, state persistence được xác nhận; chưa có workflow nghiệp vụ. |
| Prometheus + Grafana + Dozzle | Target/service health quan sát được, Grafana có datasource/hiển thị cơ bản và Dozzle xem được log container. |

Container \`Up\` không phải bằng chứng M2 hoàn thành. M2 chỉ \`COMPLETE\` khi toàn bộ năng lực trên được xác thực, resource usage được kiểm tra phù hợp phần cứng và các lệnh vận hành được tài liệu hóa.

## Phase 1 — Knowledge Assistant

### M3 — Knowledge Platform

- Kết nối Obsidian Vault chỉ đọc; ban đầu chỉ xử lý \`01. Knowledge\`.
- Parse Markdown/native \`#tags\`, index incremental, retrieval filter và citation.
- **DoD:** note hợp lệ được index/search với nguồn, passage và tag; Notes/Archives không bị index.

### M4 — AI Platform

- Thêm AI gateway local, model/resource policy, session, tool permission và RAG router.
- **DoD:** agent chỉ truy cập retrieval qua Knowledge Platform và không tạo citation không có nguồn.

### M5 — Web Chat

- Tạo \`ai-chat\` hiển thị câu trả lời, citation và trạng thái index.
- **DoD:** truy vấn end-to-end local trả lời có citation; câu hỏi thiếu bằng chứng được báo rõ.

### M6 — Automation + Observability

- Tạo n8n workflow cho index/notification và telemetry theo application/runbook.
- **DoD:** index run trace được từ trigger đến kết quả; lỗi có log, metric và hướng dẫn xử lý.

## Phase 2 — L&SC Intelligence

### M7 — Data Intake & Data Plant

- Nhận sales/demand, inventory snapshot và purchase/lead-time qua Landing → Validation/Quarantine → Bronze → Silver → Gold.
- **DoD:** dữ liệu hợp lệ đến Gold có lineage; dữ liệu không hợp lệ bị quarantine có bằng chứng rõ ràng.

### M8 — Forecasting

- Backtesting, baseline/champion forecast, model registry metadata và inference local.
- **DoD:** mỗi forecast truy vết được data version, feature, model version, evaluation và thời điểm chạy.

### M9 — Dashboard

- Tạo \`lsc-dashboard\` dùng Gold data product và semantic metrics.
- **DoD:** metric và forecast hiển thị được truy vết về Gold data/product tương ứng.

## Phase 3 — V1 Release

### M10 — Hardening

- Security boundary, backup/restore, E2E, resource validation, release runbook và known limitations.
- **DoD:** các luồng V1 được kiểm thử; restore được xác nhận; không lộ secret; vận hành local được tài liệu hóa.

## Bản đồ hoàn thành theo cây thư mục

| Khu vực | Trạng thái thành phần hiện tại | Milestone sở hữu | Bằng chứng hoàn thành |
| --- | --- | --- | --- |
| Tài liệu kiến trúc | \`IMPLEMENTED\` | Duy trì xuyên suốt | Tài liệu mô tả boundary hiện có; không phải bằng chứng runtime. |
| CI, Makefile, script và test framework | \`PLANNED\` | M1 | Lệnh kiểm chứng và CI chạy được. |
| Docker, database, networking, reverse proxy | \`PLANNED\` | M2 | Service readiness theo Definition of Done M2. |
| Knowledge Platform | \`PLANNED\` | M3 | Index, retrieval và citation được kiểm thử. |
| AI Platform và ai-chat | \`PLANNED\` | M4–M5 | Luồng chat local có bằng chứng end-to-end. |
| Automation và observability theo nghiệp vụ | \`PLANNED\` | M6 | Workflow, telemetry và runbook đã xác thực. |
| L&SC Data Plant, forecasting và dashboard | \`PLANNED\` | M7–M9 | Data quality, lineage, model và dashboard được kiểm chứng. |
| Experiments | \`PLANNED\` | M8 trở đi | Đánh giá cô lập và quyết định promotion được ghi lại. |
| Admin dashboard và document manager | \`DEFERRED\` | Sau V1 | Có nhu cầu cụ thể được chủ sở hữu phê duyệt. |

## Đồng bộ tiến độ và Changelog

Khi một task đạt Definition of Done, cập nhật trong cùng change set khi phù hợp:

1. Current Focus, trạng thái milestone/task và bản đồ cây thư mục trong \`PLAN.md\`.
2. Bằng chứng hoàn thành, kiểm tra đã chạy và limitation còn lại trong \`PLAN.md\`.
3. Một entry \`Added\`, \`Changed\`, \`Fixed\` hoặc \`Security\` trong \`CHANGELOG.md\`.

Không cập nhật \`CHANGELOG.md\` cho kế hoạch, placeholder, directory rỗng, code chưa kiểm chứng hoặc task chưa đạt Definition of Done.

## Ranh giới V1

- Hệ thống local-first, một người dùng, Docker Compose theo nhu cầu; không Kubernetes, Kafka, SaaS nhiều người dùng hay autonomous agent không giới hạn.
- Obsidian là nguồn tri thức do người dùng viết; hệ thống không ghi tùy ý vào Vault.
- Knowledge Assistant hoàn thành trước L&SC Intelligence.
- Routing/optimization nâng cao, multimodal indexing, ontology, context pack và ứng dụng bổ sung chỉ được xem xét sau V1 khi có quyết định mới.

Bản nháp tiếng Anh đã được thay thế bởi kế hoạch tiếng Việt ở trên; chỉ lưu nội bộ, không dùng để điều phối công việc.


> **Document status:** DRAFT — awaiting owner approval
> **Last assessed:** 2026-08-10
> **Progress source of truth:** this file records verified repository state and the approved development sequence. `CHANGELOG.md` records only completed, validated changes.

## Status legend

| Status | Meaning |
| --- | --- |
| `IMPLEMENTED` | Required code/configuration exists and its stated validation has passed. |
| `PARTIALLY IMPLEMENTED` | Some required work exists; the remaining work is stated explicitly. |
| `PLANNED` | The target directory or design exists, but no working implementation exists. |
| `MISSING` | The required files or implementation do not yet exist. |
| `NOT STARTED` | An approved task has not yet been opened for implementation. |
| `IN PROGRESS` | A task is actively being implemented; completion evidence is not yet sufficient. |
| `BLOCKED` | Work cannot proceed until the stated dependency or owner decision is resolved. |
| `DEFERRED` | Intentionally outside the active v1 sequence. |

## Current Focus

**Milestone:** M0 — Approve development plan
**Status:** `BLOCKED`

**Active task:** Review and approve this initial `PLAN.md`.

**Scope:**

- Establish the approved sequencing and Definition of Done for the project.
- Record the verified scaffold state before implementation begins.
- Define how progress in the directory tree drives `CHANGELOG.md` updates.

**Next action after approval:** Start M1/T1, *replace the executable-delivery placeholders with a minimal, validated development baseline*.

**Blocker:** Owner approval is required before any runtime, application, schema, pipeline, or CI implementation begins.

**Definition of Done for M0:** The owner approves this document or supplies requested revisions. No runtime implementation is part of M0.

## Verified Repository Snapshot

- Architecture documentation is present in `docs/architecture/`; it describes the target architecture, not an implemented runtime.
- Docker Compose files, Docker PowerShell scripts, network definition, Redis configuration, and GitHub workflow files are placeholders only.
- No PostgreSQL migration, shared schema, platform service, application source, test suite, or executable pipeline is present.
- `git` does not currently detect a repository at the workspace root; this must be verified and resolved before CI/release work.
- Docker CLI is installed, but its daemon was not accessible at assessment time. Ollama, Python, and n8n were not available on `PATH`.
- `CHANGELOG.md` contains historical architecture-scaffold notes only. It is not updated by the creation of this draft plan.

## Milestone Sequence

### M1 — Development foundation

**Status:** `NOT STARTED`
**Depends on:** M0 approval

- Confirm Git repository ownership and establish a reproducible developer entry point.
- Replace placeholder Makefile/PowerShell commands with non-secret environment validation, build, test, and verification commands.
- Establish Python/FastAPI and React/TypeScript workspace conventions, dependency locking, code quality checks, test layout, and real CI/security workflows.
- Define shared versioned API/error/run metadata contracts without creating domain services prematurely.

**Definition of Done:** A clean checkout can run the documented validation command; CI executes the same checks; secrets remain excluded; no delivery command remains a placeholder.

### M2 — Core local runtime

**Status:** `NOT STARTED`
**Depends on:** M1

- Implement Docker Compose profiles for on-demand local operation: PostgreSQL with pgvector, Redis, MinIO, Nginx, and the Python runtime foundation.
- Add persistent volumes, internal networking, health checks, non-secret environment templates, initial shared database migrations, and MinIO bucket provisioning.
- Implement and validate start, stop, backup, restore, and configuration checks; expose services only through the intended local boundary.

**Definition of Done:** The core profile starts from documented configuration, all health checks pass, migrations apply once and idempotently, buckets exist, and a backup/restore smoke test succeeds.

### M3 — Knowledge Platform: governed Obsidian RAG

**Status:** `NOT STARTED`
**Depends on:** M2

- Mount the external Obsidian Vault read-only and index only `01. Knowledge` initially.
- Parse Markdown and native lowercase `#tags`; normalize, chunk, embed locally through Ollama, and store vectors/metadata in PostgreSQL/pgvector.
- Build incremental indexing, index-run status, retrieval filters, source policy, and citations. Notes and Archives remain excluded; Books/Papers remain opt-in.
- Provide a tested Knowledge API for index runs and citation-backed search.

**Definition of Done:** A fixture and a permitted Vault note can be indexed incrementally; search returns the correct source path, passage, and tags; excluded paths are never indexed.

### M4 — AI Platform and `ai-chat` application

**Status:** `NOT STARTED`
**Depends on:** M3

- Implement the minimal AI gateway: local Ollama model profile, resource/concurrency policy, session handling, tool permission boundary, and RAG routing.
- Add the Knowledge Assistant workflow, which can only retrieve through the Knowledge Platform and must return citations or state that the evidence is insufficient.
- Build the React web chat and index-status view. The web app talks to the AI API; it does not access the Vault, database, or vector store directly.

**Definition of Done:** An end-to-end local query returns a cited answer from an indexed note; unsupported questions do not fabricate citations; resource limits prevent competing AI runs from exhausting the laptop.

### M5 — Automation and observability

**Status:** `NOT STARTED`
**Depends on:** M4

- Add n8n workflows for scheduled/manual indexing and failure notification; domain logic remains in platform services.
- Add Prometheus, Grafana, and Dozzle with core-service, indexing, API latency, and local AI resource telemetry.
- Document operational runbooks for startup, index failure, workflow failure, and service health.

**Definition of Done:** A scheduled index run is traceable from trigger to result; failure is visible in logs/metrics; dashboards and runbooks identify the failing boundary.

### M6 — L&SC Data Plant: governed inventory intake

**Status:** `NOT STARTED`
**Depends on:** M2; may proceed alongside M4–M5 only after their service contracts are stable.

- Define versioned CSV contracts for sales/demand, inventory snapshots, and purchase/lead-time data; use fixtures until real data is approved.
- Implement Landing → validation → Quarantine or anonymization → immutable Bronze → Silver → Gold, with MinIO for files and PostgreSQL for run metadata and lineage.
- Implement deterministic data-quality rules and re-validation. AI remediation is advisory/controlled and cannot modify governed data without an auditable run.
- Define the initial semantic metrics: demand, on-hand inventory, lead time, stock-out risk, safety stock, and reorder point.

**Definition of Done:** Valid fixture data reaches Gold with lineage; invalid data is quarantined with actionable validation evidence; no transformation overwrites Bronze source data.

### M7 — L&SC products, forecasting, and dashboard

**Status:** `NOT STARTED`
**Depends on:** M6

- Publish Gold-backed analytics/data-product APIs and the React `lsc-dashboard`.
- Build time-based backtesting, baseline forecasts, champion selection by documented metrics, model registry metadata, and local inference.
- Add L&SC Data Product RAG only over governed semantic context and product metadata; keep it separate from Knowledge RAG.

**Definition of Done:** Dashboard metrics trace to Gold data; each forecast records data version, features, model version, evaluation, and timestamp; Knowledge and L&SC retrieval remain independently governed.

### M8 — v1 hardening and release readiness

**Status:** `NOT STARTED`
**Depends on:** M5 and M7

- Complete security boundaries, dependency maintenance, data retention, backup/restore verification, resource monitoring, and release runbooks.
- Add cross-platform integration/E2E tests and promotion gates for experiments, RAG changes, and forecasting candidates.
- Record known limitations and explicitly defer non-v1 capabilities.

**Definition of Done:** All milestone acceptance tests pass, backup restoration is verified, no secrets are tracked, the core flows operate locally on the target hardware, and operational limitations are documented.

## Directory Completion Map

| Repository area | Current status | Planned milestone | Completion evidence required |
| --- | --- | --- | --- |
| `docs/architecture/` | `IMPLEMENTED` — architecture documentation only | Maintained throughout | Architecture remains aligned with implemented boundaries. |
| `.github/workflows/`, `Makefile`, `scripts/` | `PARTIALLY IMPLEMENTED` — placeholders | M1 | Executable CI, test, security, and local verification commands. |
| `infrastructure/docker/`, `networking/`, `databases/`, `nginx/` | `PLANNED` — placeholder/empty implementation | M2 | Valid Compose, health checks, persistence, migrations, and smoke tests. |
| `infrastructure/observability/`, `gpu/`, `deployment/` | `PLANNED` | M5, M8 | Telemetry, resource policy, and release operation validated. |
| `shared/`, `configs/`, `tests/` | `PLANNED` | M1 onward | Versioned contracts/configuration and corresponding automated tests. |
| `platforms/knowledge-platform/` | `PLANNED` | M3 | Read-only Vault indexing, retrieval policy, and cited search tests. |
| `platforms/ai-platform/`, `applications/ai-chat/` | `PLANNED` | M4 | Local, citation-grounded chat through platform boundaries. |
| `platforms/automation-platform/` | `PLANNED` | M5 | Traceable n8n triggers and notifications with no duplicated domain logic. |
| `platforms/lsc-data-plant/`, `applications/lsc-dashboard/` | `PLANNED` | M6–M7 | Governed data lifecycle, lineage, forecast, and dashboard tests. |
| `experiments/` | `PLANNED` | M7 onward | Isolated evaluation with a documented promotion decision. |
| `applications/admin-dashboard/`, `applications/document-manager/` | `DEFERRED` | Post-v1 | A concrete need beyond Obsidian, Grafana, and the focused apps is approved. |

## Progress and `CHANGELOG.md` Synchronization

After every meaningful implementation task, update this file in the same change set with:

1. The actual status of the affected directory-map row and task checklist.
2. The validated evidence: files/services added, tests run, and remaining limitation or blocker.
3. The new Current Focus and next action.

When, and only when, a task meets its Definition of Done, update `CHANGELOG.md` in the same change set. The entry must be derived from the completed directory-map row(s), categorized as `Added`, `Changed`, `Fixed`, or `Security`, and summarize the validated outcome rather than planned work.

Do not add Changelog entries for `DRAFT`, `NOT STARTED`, `IN PROGRESS`, a created empty directory, or unvalidated code. Never remove prior Changelog history to make the tree appear more complete.

## Explicit v1 Boundaries

- Local-first, single-user, on-demand Docker Compose operation; no Kubernetes, Kafka, multi-user SaaS, or unrestricted autonomous agent.
- Local Ollama is the only inference/embedding provider in v1; model profiles must fit the 24 GB RAM / 6 GB VRAM hardware limit.
- Obsidian remains the human-authored knowledge source of truth; the system does not write arbitrary Vault files.
- The first L&SC domain is inventory and demand forecasting. Routing, optimization, multimodal indexing, formal ontology, context packs, and additional document-management UI remain deferred until a demonstrated requirement.

-->
