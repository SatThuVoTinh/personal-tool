# Hướng dẫn Sử dụng Công cụ SQL (zink_sql)

Tài liệu này hướng dẫn chi tiết cách thức sử dụng giao diện công cụ `zink_sql` và Governed DuckDB Windows Bridge bằng tiếng Việt, tuần tự theo đúng logic mã nguồn thực tế.

---

## 1. Giới thiệu & Phạm vi

`zink_sql` cung cấp khả năng thực thi truy vấn SQL phân tích ở chế độ chỉ đọc (read-only analytical queries) trên các cơ sở dữ liệu đã được phê duyệt.

- **Agent được phép gọi:** Duy nhất agent `sql` (`TOOL_POLICY.sql = ["zink_sql"]`).
- **Lược đồ hợp đồng:** [`contracts/tools/zink-sql.schema.json`](../contracts/tools/zink-sql.schema.json).
- **Bộ kiểm tra cú pháp:** [`sql/validator.mjs`](validator.mjs).
- **Cầu nối thực thi DuckDB:** [`sql/duckdb-bridge.mjs`](duckdb-bridge.mjs).

---

## 2. Quy tắc Cú pháp An toàn (Lean Option B)

Mọi truy vấn gửi tới `zink_sql` đều phải tuân thủ nghiêm ngặt tập con cú pháp an toàn Lean Option B:

1. **Chỉ chấp nhận lệnh `SELECT`:** Mọi từ khóa biến đổi dữ liệu (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `CREATE`) đều bị từ chối ngay lập tức (`SQL_MUTATION_NOT_PERMITTED`).
2. **Không cho phép phép nối (No JOIN):** Cấm `JOIN`, `INNER`, `LEFT`, `RIGHT`, `CROSS`, `NATURAL`.
3. **Không truy vấn con hoặc CTE:** Cấm `WITH`, `UNION`, `INTERSECT`, `EXCEPT` hoặc subquery.
4. **Không gom nhóm hay hàm:** Cấm `GROUP BY`, `HAVING`, `WINDOW`, `OVER`, `CASE WHEN`.
5. **Không dùng chú thích hoặc dấu chấm phẩy:** Cấm `--`, `/* */` và `;`.
6. **Tham số đặt tên (Named Parameters):** Phải gắn kết chính xác theo tên dạng `:param_name` (injective binding).
7. **`NOT` chỉ hợp lệ trong `IS NOT NULL`:** `NOT` đứng một mình bị cả `validateSqlQuery` và `assertReadOnlyStatement` từ chối với `SQL_UNSUPPORTED_SYNTAX`; dạng `IS NOT NULL` vẫn được chấp nhận.

---

## 3. Danh sách Cơ sở Dữ liệu Hợp lệ (Allowlist)

Chỉ có đúng 2 cơ sở dữ liệu logic được phép truy vấn:

- `knowledge`: Chỉ mục tri thức và bảng dữ liệu tham chiếu nội bộ.
- `analytics_read`: Dữ liệu phân tích đã được làm sạch ở tầng Silver/Gold.

Mọi nỗ lực truy vấn ra ngoài danh sách trên đều bị ném lỗi `DUCKDB_UNAUTHORIZED_RESOURCE`.

---

## 4. Hướng dẫn Thực thi Từng bước qua Code

### Bước 1: Chuẩn bị tham số và câu lệnh

```javascript
const query =
  "SELECT id, name, category, value FROM analytics_read WHERE category = :cat";
const parameters = [{ name: "cat", type: "string", value: "silver" }];
// `type` is required by the published contract and is discarded by the
// binder: the value's JavaScript type decides how it is rendered.
```

### Bước 2: Gọi Cầu nối DuckDB có kiểm soát

```javascript
import { executeGovernedDuckDbQuery } from "./zink-tools/sql/duckdb-bridge.mjs";

const context = {
  agent_id: "sql", // Bắt buộc là "sql"
  task_id: "task-analytics-01",
};

const input = {
  query,
  target_database: "analytics_read",
  max_rows: 50, // Mặc định 100, tối đa 1000
  parameters,
};

const result = await executeGovernedDuckDbQuery(context, input);

console.log(`Số dòng trả về: ${result.row_count}`);
console.log(`Danh sách cột: ${result.columns.join(", ")}`);
console.table(result.rows);
```

---

## 5. Các Lỗi Thường gặp & Mã lỗi

| Mã lỗi                            | Nguyên nhân                                               | Cách xử lý                                    |
| --------------------------------- | --------------------------------------------------------- | --------------------------------------------- |
| `DUCKDB_UNAUTHORIZED_CALLER`      | Agent gọi khác `sql` (ví dụ `main`, `excel`)              | Giao việc cho đúng agent `sql`                |
| `DUCKDB_UNAUTHORIZED_RESOURCE`    | `target_database` không thuộc allowlist                   | Chỉ định `knowledge` hoặc `analytics_read`    |
| `DUCKDB_FILESYSTEM_ACCESS_DENIED` | Chứa `ATTACH`, `COPY`, `read_csv`, hoặc đọc tệp trực tiếp | Truy vấn trực tiếp bảng có sẵn trong database |
| `DUCKDB_HOST_EXECUTION_DENIED`    | Chứa `powershell`, `cmd`, `wsl`, `PRAGMA`                 | Loại bỏ các lệnh hệ thống khỏi truy vấn       |
| `DUCKDB_MUTATION_NOT_PERMITTED`   | Truy vấn cố ý sửa đổi dữ liệu                             | Chuyển sang câu lệnh `SELECT` thuần túy       |
