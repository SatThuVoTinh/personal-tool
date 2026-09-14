# Hướng dẫn Định dạng Bài toán Mô phỏng (zink_simulation)

Tài liệu này hướng dẫn chi tiết cách thức đặc tả bài toán mô phỏng Monte Carlo ngẫu nhiên và mô phỏng sự kiện rời rạc (Discrete Event Simulation) bằng tiếng Việt, tuần tự theo đúng lược đồ [`contracts/tools/zink-simulation.schema.json`](../contracts/tools/zink-simulation.schema.json).

---

## 1. Giới thiệu & Vai trò

`zink_simulation` là một **năng lực đặc tả bài toán (schema-only capability)** thuộc Stack 4 và Stack 5, chuẩn hóa bài toán đánh giá rủi ro ngẫu nhiên, độ bất định của thời gian giao hàng (lead time variability), và hàng đợi chuỗi cung ứng.

- **Lược đồ hợp đồng:** [`contracts/tools/zink-simulation.schema.json`](../contracts/tools/zink-simulation.schema.json).

---

## 2. Cấu trúc Đặc tả Mô phỏng Ngẫu nhiên

1. **Số lượt lặp (`iterations`):** Số lần mô phỏng Monte Carlo (ví dụ: 10,000 lần).
2. **Hạt giống ngẫu nhiên (`random_seed`):** Đảm bảo kết quả mô phỏng có thể tái lập (reproducible).
3. **Phân phối xác suất biến đầu vào (`input_distributions`):**
   - Phân phối chuẩn (`NORMAL`), đều (`UNIFORM`), tam giác (`TRIANGULAR`), hoặc Poisson.
4. **Độ đo đầu ra cần theo dõi (`tracked_metrics`):** Tỉ lệ hết hàng (stockout probability), thời gian chờ trung bình, phân vị 95% (P95 Lead Time).

---

## 3. Hướng dẫn Tạo Đặc tả Từng bước qua JSON

```json
{
  "simulation_name": "lead_time_uncertainty_monte_carlo",
  "iterations": 10000,
  "random_seed": 42,
  "parameters": [
    {
      "name": "supplier_lead_time_days",
      "distribution": "TRIANGULAR",
      "params": { "min": 10, "mode": 14, "max": 25 }
    },
    {
      "name": "daily_demand_units",
      "distribution": "NORMAL",
      "params": { "mean": 100, "std_dev": 15 }
    }
  ],
  "target_metrics": ["stockout_probability", "expected_holding_cost"]
}
```
