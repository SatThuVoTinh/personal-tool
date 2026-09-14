# Hướng dẫn Định dạng Bài toán Tối ưu hóa Toán học (zink_optimization)

Tài liệu này hướng dẫn chi tiết cách thức đặc tả bài toán tối ưu hóa toán học (Mathematical Optimization) bằng tiếng Việt, tuần tự theo đúng lược đồ [`contracts/tools/zink-optimization.schema.json`](../contracts/tools/zink-optimization.schema.json).

---

## 1. Giới thiệu & Vai trò

`zink_optimization` là một **năng lực đặc tả bài toán (schema-only capability)** thuộc Stack 4 và Stack 5, chuẩn hóa định dạng bài toán quy hoạch toán học (LP, MIP, NLP).

- **Mục tiêu:** Mô hình hóa các bài toán phân bổ nguồn lực, tối ưu chi phí vận chuyển hoặc lập kế hoạch sản xuất theo cấu trúc chuẩn trước khi chuyển cho solver (PuLP, SciPy, Gurobi) giải quyết.
- **Lược đồ hợp đồng:** [`contracts/tools/zink-optimization.schema.json`](../contracts/tools/zink-optimization.schema.json).

---

## 2. Các Thành phần của Bản Đặc tả Bài toán

1. **Hàm mục tiêu (`objective`):**
   - Hướng tối ưu: `MINIMIZE` hoặc `MAXIMIZE`.
   - Biểu thức mục tiêu và trọng số chi phí.
2. **Biến quyết định (`variables`):**
   - Định danh biến, kiểu dữ liệu (`CONTINUOUS`, `INTEGER`, `BINARY`), cận dưới (`lb`) và cận trên (`ub`).
3. **Các ràng buộc (`constraints`):**
   - Tên ràng buộc, biểu thức vế trái (`lhs`), toán tử so sánh (`LE`, `GE`, `EQ`), và giá trị vế phải (`rhs`).

---

## 3. Hướng dẫn Tạo Đặc tả Từng bước qua JSON

```json
{
  "problem_name": "production_cost_minimization",
  "sense": "MINIMIZE",
  "variables": [
    { "name": "x_product_A", "type": "INTEGER", "lb": 0, "ub": 500 },
    { "name": "x_product_B", "type": "INTEGER", "lb": 0, "ub": 300 }
  ],
  "objective": {
    "coefficients": { "x_product_A": 25.0, "x_product_B": 40.0 }
  },
  "constraints": [
    {
      "name": "labor_hours_limit",
      "coefficients": { "x_product_A": 2.0, "x_product_B": 3.5 },
      "operator": "LE",
      "rhs": 1200.0
    }
  ]
}
```
