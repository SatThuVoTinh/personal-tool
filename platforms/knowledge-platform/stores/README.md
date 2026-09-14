# Kho Dữ liệu Bền vững của Knowledgebase (Knowledgebase Stores)

Thư mục này thuộc quyền quản lý của **Zink Knowledgebase**:

- **`research-knowledge-store/`**: Chứa dữ liệu bền vững của Knowledgebase được trích xuất từ các nguồn tri thức tham chiếu của con người đã qua phê duyệt, phục vụ truy xuất có nguồn gốc và trích dẫn.

### Ranh giới kiến trúc bất biến:

- **Zink Skill Store không thuộc quyền sở hữu của thư mục này:** Đường dẫn chuẩn của Skill Store là `zink-skill-store/` (ngang hàng độc lập).
- Knowledgebase và Skill Store có thể dùng chung hạ tầng PostgreSQL/pgvector hoặc lưu trữ đối tượng, nhưng luôn được cách ly hoàn toàn theo định danh, namespace lưu trữ, trạng thái xuất bản, nguồn gốc và chính sách truy cập.
