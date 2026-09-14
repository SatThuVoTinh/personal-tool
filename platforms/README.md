# Tầng Nền tảng Hệ thống Zink (Zink Platforms)

Thư mục `platforms/` chứa các đặc tả kiến trúc, ranh giới thiết kế và phân vùng chức năng cho các nền tảng dịch vụ trong hệ sinh thái Zink.

---

## 1. Danh mục Nền tảng

- **`platforms/knowledge-platform/`**: Đặc tả kiến trúc toàn diện của **Zink Knowledge Platform** (Zink Knowledgebase) – trung tâm tiếp nhận, lập chỉ mục, truy xuất ngữ nghĩa và quản lý nguồn gốc tri thức tham chiếu từ con người.

---

## 2. Ranh giới Kiến trúc & Runtime Hiện hành

Theo quy định nghiêm ngặt tại hợp đồng kiến trúc [AGENTS.md](../AGENTS.md):

1. **Vị trí Runtime thực tế (`apps/knowledge/`):**
   - Mã nguồn và môi trường container Docker thực thi của Knowledgebase hiện tại được triển khai và vận hành ổn định tại thư mục `apps/knowledge/`.
   - Thư mục `platforms/knowledge-platform/` đóng vai trò là kiến trúc mục tiêu chuẩn hóa (canonical target architecture). Bất kỳ sự chuyển dịch cấu trúc nào sang `platforms/` đều cần một kế hoạch nâng cấp riêng biệt và cổng kiểm thử hồi quy nghiêm ngặt.

2. **Sự cô lập với Zink Skill Store:**
   - **Zink Skill Store** là module ngang hàng độc lập tại thư mục gốc `zink-skill-store/`.
   - Tuyệt đối không nhúng hoặc lồng ghép Skill Store vào bên trong Knowledge Platform hoặc các thư mục nền tảng.
